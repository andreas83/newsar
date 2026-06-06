import { Queue } from 'bullmq'
import { getRedisClient } from '../utils/redis.js'
import { getDatabase } from '../database/db.js'
import { articles, storyMembers, stories } from '../database/schema.js'
import { eq } from 'drizzle-orm'

let feedQueue: Queue | null = null

/**
 * Ensure RunPod pod is available for Ollama jobs
 * Creates pod if needed and enabled
 * Uses distributed lock to prevent race conditions
 *
 * Race condition prevention:
 * 1. Check persistent Redis state for creation in progress
 * 2. Acquire lock with 15-minute timeout (covers 10-min pod creation)
 * 3. Set creation state that persists across all processes
 * 4. Release lock only after pod is ready or creation fails
 */
async function ensurePodAvailable(): Promise<void> {
  const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

  if (!runpodEnabled) {
    // RunPod not enabled, use static URL
    return
  }

  try {
    // Dynamic import to avoid circular dependencies
    const { getRunPodManager } = await import('../services/runpodManager.js')
    const { getRedisClient } = await import('../utils/redis.js')
    const manager = getRunPodManager()
    const redis = getRedisClient()

    if (!manager || !manager.isEnabled()) {
      return
    }

    const currentPod = manager.getCurrentPod()

    // Pod already running and ready
    if (currentPod && (currentPod.status === 'READY' || currentPod.status === 'ACTIVE')) {
      return
    }

    // Pod starting, no action needed
    if (currentPod && (currentPod.status === 'PENDING' || currentPod.status === 'STARTING')) {
      console.log('[FeedQueue] Pod is starting, jobs will wait for it')
      return
    }

    // Check persistent creation state (survives across processes)
    const creatingKey = 'runpod:creating'
    const isCreating = await redis.get(creatingKey)

    if (isCreating) {
      console.log('[FeedQueue] Pod creation in progress (state flag set), skipping')
      return
    }

    // Try to acquire distributed lock with 15-minute timeout (covers 10-min pod creation)
    const lockKey = 'runpod:creating_lock'
    const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 900) // 900 seconds = 15 minutes

    if (!lockAcquired) {
      console.log('[FeedQueue] Pod creation already in progress (lock held), skipping')
      return
    }

    try {
      // Set persistent creation state (15-minute expiry as safety fallback)
      await redis.set(creatingKey, '1', 'EX', 900)

      console.log('[FeedQueue] No active pod, creating new pod for Ollama jobs...')
      console.log('[FeedQueue] Note: Pod creation can take up to 10 minutes')

      // Create pod and WAIT for it to be ready
      // This ensures the lock isn't released until pod is actually ready
      await manager.createPod()

      console.log('[FeedQueue] Pod creation completed successfully')
    } catch (error) {
      console.error('[FeedQueue] Failed to create pod:', error)
      throw error
    } finally {
      // Release both lock and creation state
      await redis.del(lockKey).catch(() => {})
      await redis.del(creatingKey).catch(() => {})
      console.log('[FeedQueue] Released pod creation lock and state')
    }
  } catch (error) {
    console.error('[FeedQueue] Error checking pod availability:', error)
    // Continue anyway - fallback Ollama will be used
  }
}

export function getFeedQueue(): Queue {
  if (!feedQueue) {
    const queueName = process.env.BULLMQ_QUEUE_NAME || 'newsar-jobs'

    feedQueue = new Queue(queueName, {
      connection: getRedisClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5 seconds
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000, // Keep max 1000 completed jobs
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    })

    feedQueue.on('error', (err) => {
      console.error('Feed queue error:', err)
    })
  }

  return feedQueue
}

/**
 * Calculate dynamic priority for an article based on:
 * - Recency (published within last 6 hours)
 * - Story trending score
 * - Default fallback
 *
 * Priority scale: Lower number = higher priority
 * - 5: Recent (<6h) + trending story
 * - 10: Recent (<6h) article
 * - 15: Trending/emerging story
 * - 30: Default
 */
export async function calculateArticlePriority(articleId: number): Promise<number> {
  try {
    const db = getDatabase()

    // Get article with story info
    const [article] = await db
      .select({
        publishedAt: articles.publishedAt,
        storyId: storyMembers.storyId,
        trendingScore: stories.trendingScore,
        status: stories.status,
      })
      .from(articles)
      .leftJoin(storyMembers, eq(articles.id, storyMembers.articleId))
      .leftJoin(stories, eq(storyMembers.storyId, stories.id))
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!article) return 30 // Default low priority

    const now = new Date()
    const publishedAt = new Date(article.publishedAt)
    const hoursSincePublished = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60)

    // High priority: Recent articles (<6h) in trending stories
    if (hoursSincePublished < 6 && article.status === 'trending') {
      return 5
    }

    // Medium-high priority: Recent articles (<6h)
    if (hoursSincePublished < 6) {
      return 10
    }

    // Medium priority: Part of trending/emerging story
    if (article.status === 'trending' || article.status === 'emerging') {
      return 15
    }

    // Normal priority: Everything else
    return 30
  } catch (error) {
    console.error(`Error calculating priority for article ${articleId}:`, error)
    return 30 // Fallback to default priority on error
  }
}

/**
 * Add a job to fetch a specific feed
 */
export async function queueFeedFetch(feedId: number, priority: number = 10) {
  const queue = getFeedQueue()

  try {
    const job = await queue.add(
      'fetch-feed',
      {
        feedId,
        timestamp: new Date().toISOString(),
      },
      {
        priority, // Lower number = higher priority
        jobId: `feed-${feedId}-${Date.now()}`,
      }
    )

    console.log(`Queued feed fetch job: ${job.id} for feed ${feedId}`)
    return job
  } catch (error) {
    console.error(`Failed to queue feed fetch for feed ${feedId}:`, error)
    throw error
  }
}

/**
 * Add jobs to fetch all active feeds
 */
export async function queueAllActiveFeeds() {
  const { getDatabase } = await import('../database/db.js')
  const db = getDatabase()
  const { feeds } = await import('../database/schema.js')
  const { eq } = await import('drizzle-orm')

  const activeFeeds = await db
    .select()
    .from(feeds)
    .where(eq(feeds.isActive, 1))

  const jobs = await Promise.all(
    activeFeeds.map((feed) => queueFeedFetch(feed.id, 10))
  )

  console.log(`Queued ${jobs.length} feed fetch jobs`)
  return jobs
}

/**
 * Schedule periodic feed fetching
 */
export async function schedulePeriodicFeedFetch(intervalMinutes: number = 30) {
  const queue = getFeedQueue()

  // Add a repeatable job that triggers all feeds
  await queue.add(
    'fetch-all-feeds',
    {
      type: 'periodic',
      timestamp: new Date().toISOString(),
    },
    {
      repeat: {
        every: intervalMinutes * 60 * 1000, // Convert to milliseconds
      },
      jobId: 'periodic-feed-fetch',
    }
  )

  console.log(`Scheduled periodic feed fetch every ${intervalMinutes} minutes`)
}

/**
 * Add a job to extract content for a specific article
 */
export async function queueContentExtraction(articleId: number, priority: number = 15) {
  const queue = getFeedQueue()

  try {
    const job = await queue.add(
      'extract-content',
      {
        articleId,
        timestamp: new Date().toISOString(),
      },
      {
        priority, // Lower number = higher priority
        jobId: `extract-${articleId}`,
      }
    )

    console.log(`Queued content extraction job: ${job.id} for article ${articleId}`)
    return job
  } catch (error) {
    console.error(`Failed to queue content extraction for article ${articleId}:`, error)
    throw error
  }
}

/**
 * Queue content extraction for multiple articles
 */
export async function queueBatchContentExtraction(articleIds: number[]) {
  const queue = getFeedQueue()

  const jobs = await Promise.all(
    articleIds.map((articleId) => queueContentExtraction(articleId, 15))
  )

  console.log(`Queued ${jobs.length} content extraction jobs`)
  return jobs
}

/**
 * Queue extraction for all pending articles
 */
export async function queuePendingExtractions(limit: number = 100) {
  const { getDatabase } = await import('../database/db.js')
  const db = getDatabase()
  const { articles } = await import('../database/schema.js')
  const { eq } = await import('drizzle-orm')

  const pendingArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.extractionStatus, 'pending'))
    .limit(limit)

  const articleIds = pendingArticles.map((a) => a.id)

  if (articleIds.length === 0) {
    console.log('No pending articles to extract')
    return []
  }

  return queueBatchContentExtraction(articleIds)
}

/**
 * Add a job to extract image for a specific article
 */
export async function queueImageExtraction(articleId: number, priority: number = 20) {
  const queue = getFeedQueue()

  try {
    const job = await queue.add(
      'extract-image',
      {
        articleId,
        timestamp: new Date().toISOString(),
      },
      {
        priority, // Lower number = higher priority (images are lower priority than content)
        jobId: `image-${articleId}`,
      }
    )

    console.log(`Queued image extraction job: ${job.id} for article ${articleId}`)
    return job
  } catch (error) {
    console.error(`Failed to queue image extraction for article ${articleId}:`, error)
    throw error
  }
}

/**
 * Queue image extraction for multiple articles
 */
export async function queueBatchImageExtraction(articleIds: number[]) {
  const queue = getFeedQueue()

  const jobs = await Promise.all(
    articleIds.map((articleId) => queueImageExtraction(articleId, 20))
  )

  console.log(`Queued ${jobs.length} image extraction jobs`)
  return jobs
}

/**
 * Queue image extraction for all pending articles
 */
export async function queuePendingImageExtractions(limit: number = 100) {
  const { getDatabase } = await import('../database/db.js')
  const db = getDatabase()
  const { articles } = await import('../database/schema.js')
  const { eq } = await import('drizzle-orm')

  const pendingArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.imageFetchStatus, 'pending'))
    .limit(limit)

  const articleIds = pendingArticles.map((a) => a.id)

  if (articleIds.length === 0) {
    console.log('No pending articles for image extraction')
    return []
  }

  return queueBatchImageExtraction(articleIds)
}

/**
 * Add a job to classify a specific article
 */
export async function queueArticleClassification(articleId: number, priority?: number) {
  const queue = getFeedQueue()

  try {
    // Calculate dynamic priority if not provided
    const finalPriority = priority !== undefined ? priority : await calculateArticlePriority(articleId)

    const job = await queue.add(
      'classify-article',
      {
        articleId,
        timestamp: new Date().toISOString(),
      },
      {
        priority: finalPriority, // Use dynamic priority
        jobId: `classify-${articleId}`,
      }
    )

    console.log(`Queued classification job: ${job.id} for article ${articleId} (priority: ${finalPriority})`)
    return job
  } catch (error) {
    console.error(`Failed to queue classification for article ${articleId}:`, error)
    throw error
  }
}

/**
 * Queue classification for articles with full content that haven't been classified
 */
export async function queuePendingClassifications(limit: number = 50) {
  const { getDatabase } = await import('../database/db.js')
  const db = getDatabase()
  const { articles, classifications } = await import('../database/schema.js')
  const { eq, isNull, and, not, inArray, sql } = await import('drizzle-orm')

  // Get articles with sufficient content (>= 100 chars) but no classification
  const pendingArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .leftJoin(classifications, eq(articles.id, classifications.articleId))
    .where(
      and(
        inArray(articles.extractionStatus, ['success', 'fallback']),
        sql`LENGTH(${articles.fullContent}) >= 100`, // Only articles with sufficient content
        isNull(classifications.id)
      )
    )
    .limit(limit)

  const articleIds = pendingArticles.map((a) => a.id)

  if (articleIds.length === 0) {
    console.log('No pending articles for classification')
    return []
  }

  // Ensure pod is available before queuing Ollama jobs
  await ensurePodAvailable()

  const jobs = await Promise.all(
    articleIds.map((articleId) => queueArticleClassification(articleId, 25))
  )

  console.log(`Queued ${jobs.length} classification jobs`)
  return jobs
}

/**
 * Add a job to generate embedding for a specific article
 */
export async function queueArticleEmbedding(articleId: number, priority?: number) {
  const queue = getFeedQueue()

  try {
    // Calculate dynamic priority if not provided
    const finalPriority = priority !== undefined ? priority : await calculateArticlePriority(articleId)

    const job = await queue.add(
      'generate-embedding',
      {
        articleId,
        timestamp: new Date().toISOString(),
      },
      {
        priority: finalPriority, // Use dynamic priority
        jobId: `embed-${articleId}`,
      }
    )

    console.log(`Queued embedding job: ${job.id} for article ${articleId} (priority: ${finalPriority})`)
    return job
  } catch (error) {
    console.error(`Failed to queue embedding for article ${articleId}:`, error)
    throw error
  }
}

/**
 * Queue embedding generation for classified articles without embeddings
 */
export async function queuePendingEmbeddings(limit: number = 20) {
  const { getDatabase } = await import('../database/db.js')
  const db = getDatabase()
  const { articles, classifications, articleEmbeddings } = await import('../database/schema.js')
  const { eq, isNull, and, inArray } = await import('drizzle-orm')

  // Get classified articles without embeddings (both 'success' and 'fallback' status)
  const pendingArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(classifications, eq(articles.id, classifications.articleId))
    .leftJoin(articleEmbeddings, eq(articles.id, articleEmbeddings.articleId))
    .where(
      and(
        inArray(articles.extractionStatus, ['success', 'fallback']),
        isNull(articleEmbeddings.id)
      )
    )
    .limit(limit)

  const articleIds = pendingArticles.map((a) => a.id)

  if (articleIds.length === 0) {
    console.log('No pending articles for embedding generation')
    return []
  }

  // Ensure pod is available before queuing Ollama jobs
  await ensurePodAvailable()

  const jobs = await Promise.all(
    articleIds.map((articleId) => queueArticleEmbedding(articleId, 30))
  )

  console.log(`Queued ${jobs.length} embedding jobs`)
  return jobs
}

/**
 * Add a job to analyze a specific article
 */
export async function queueArticleAnalysis(articleId: number, priority?: number) {
  const queue = getFeedQueue()

  try {
    // Calculate dynamic priority if not provided
    const finalPriority = priority !== undefined ? priority : await calculateArticlePriority(articleId)

    const job = await queue.add(
      'analyze-article',
      {
        articleId,
        timestamp: new Date().toISOString(),
      },
      {
        priority: finalPriority, // Use dynamic priority
        jobId: `analyze-${articleId}`,
      }
    )

    console.log(`Queued analysis job: ${job.id} for article ${articleId} (priority: ${finalPriority})`)
    return job
  } catch (error) {
    console.error(`Failed to queue analysis for article ${articleId}:`, error)
    throw error
  }
}

/**
 * Queue analysis for classified articles without analysis
 */
export async function queuePendingAnalyses(limit: number = 30) {
  const { getDatabase } = await import('../database/db.js')
  const db = getDatabase()
  const { articles, classifications, analyses } = await import('../database/schema.js')
  const { eq, isNull, and, inArray } = await import('drizzle-orm')

  // Get classified articles without analysis (both 'success' and 'fallback' status)
  const pendingArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(classifications, eq(articles.id, classifications.articleId))
    .leftJoin(analyses, eq(articles.id, analyses.articleId))
    .where(
      and(
        inArray(articles.extractionStatus, ['success', 'fallback']),
        isNull(analyses.id)
      )
    )
    .limit(limit)

  const articleIds = pendingArticles.map((a) => a.id)

  if (articleIds.length === 0) {
    console.log('No pending articles for analysis')
    return []
  }

  // Ensure pod is available before queuing Ollama jobs
  await ensurePodAvailable()

  const jobs = await Promise.all(
    articleIds.map((articleId) => queueArticleAnalysis(articleId, 28))
  )

  console.log(`Queued ${jobs.length} analysis jobs`)
  return jobs
}

/**
 * Queue article clustering job
 */
export async function queueArticleClustering(options?: { minSimilarity?: number; minClusterSize?: number }) {
  const queue = getFeedQueue()

  try {
    const job = await queue.add(
      'cluster-articles',
      {
        minSimilarity: options?.minSimilarity || 0.80,
        minClusterSize: options?.minClusterSize || 2,
        timestamp: new Date().toISOString(),
      },
      {
        priority: 30,
        jobId: `cluster-${Date.now()}`,
      }
    )

    console.log(`Queued article clustering job: ${job.id}`)
    return job
  } catch (error) {
    console.error('Failed to queue article clustering:', error)
    throw error
  }
}
