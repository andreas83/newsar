// Load environment variables first
import { config } from 'dotenv'
config()

import { Worker, Job } from 'bullmq'
import { fileURLToPath } from 'url'
import { getRedisClient } from '../utils/redis.js'
import { parseFeed } from '../services/rssParser.js'
import { queueAllActiveFeeds } from '../queues/feedQueue.js'
import { extractArticleById } from '../services/contentExtractor.js'
import { extractArticleImage } from '../services/imageExtractor.js'
import { getRunPodManager } from '../services/runpodManager.js'

const queueName = process.env.BULLMQ_QUEUE_NAME || 'newsar-jobs'
const concurrency = parseInt(process.env.BULLMQ_CONCURRENCY || '5')

// Initialize RunPod manager if enabled (async to wait for state loading)
console.log('[Worker] RUNPOD_ENABLED:', process.env.RUNPOD_ENABLED)
let runpodReady = Promise.resolve() // Default: immediately ready

if (process.env.RUNPOD_ENABLED === 'true') {
  const apiKey = process.env.RUNPOD_API_KEY
  const templateId = process.env.RUNPOD_TEMPLATE_ID

  if (apiKey && templateId) {
    runpodReady = (async () => {
      try {
        console.log('[Worker] Initializing RunPod manager...')
        getRunPodManager({
          apiKey,
          templateId,
          gpuType: process.env.RUNPOD_GPU_TYPE,
          enabled: true,
          maxPods: parseInt(process.env.RUNPOD_MAX_PODS || '1'),
          maxCostPerDay: parseFloat(process.env.RUNPOD_MAX_COST_PER_DAY || '20'),
          idleTimeoutMs: parseInt(process.env.RUNPOD_POD_IDLE_TIMEOUT || '900000'),
        })
        // Wait a moment for async loadStateFromRedis() to complete
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Set global for ollama.ts to access (workaround for module instance mismatch)
        // @ts-ignore - setting global
        global._getRunPodManager = getRunPodManager

        console.log('[Worker] ✓ RunPod manager initialized and ready')
      } catch (error) {
        console.error('[Worker] Failed to initialize RunPod manager:', error)
      }
    })()
  }
}

/**
 * Wait for RunPod pod to be ready (if enabled)
 */
async function waitForPodReady(): Promise<void> {
  const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

  if (!runpodEnabled) {
    return
  }

  try {
    const { getRunPodManager } = await import('../services/runpodManager.js')
    const manager = getRunPodManager()

    if (!manager || !manager.isEnabled()) {
      return
    }

    const currentPod = manager.getCurrentPod()

    // Pod already ready
    if (currentPod && (currentPod.status === 'READY' || currentPod.status === 'ACTIVE')) {
      return
    }

    // Pod is starting, wait for it
    if (currentPod && (currentPod.status === 'PENDING' || currentPod.status === 'STARTING')) {
      console.log('[Worker] Waiting for RunPod pod to be ready...')

      const maxWaitTime = 5 * 60 * 1000 // 5 minutes
      const pollInterval = 5000 // 5 seconds
      const startTime = Date.now()

      while (Date.now() - startTime < maxWaitTime) {
        const pod = manager.getCurrentPod()

        if (pod && (pod.status === 'READY' || pod.status === 'ACTIVE')) {
          console.log('[Worker] Pod is ready, proceeding with job')
          return
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }

      console.warn('[Worker] Pod did not become ready within 5 minutes, will try fallback')
    }
  } catch (error) {
    console.error('[Worker] Error waiting for pod:', error)
    // Continue anyway - fallback Ollama will be used
  }
}

/**
 * Record activity after successful Ollama job
 */
async function recordPodActivity(): Promise<void> {
  const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

  if (!runpodEnabled) {
    return
  }

  try {
    const { getRunPodManager } = await import('../services/runpodManager.js')
    const manager = getRunPodManager()

    if (manager && manager.isEnabled()) {
      await manager.recordActivity()
    }
  } catch (error) {
    // Non-critical error, just log it
    console.error('[Worker] Failed to record pod activity:', error)
  }
}

/**
 * Process a feed fetch job
 */
async function processFeedFetchJob(job: Job) {
  const { feedId } = job.data

  console.log(`Processing feed fetch job ${job.id} for feed ${feedId}`)

  try {
    const result = await parseFeed(feedId)

    return {
      success: true,
      feedId,
      ...result,
    }
  } catch (error) {
    console.error(`Failed to process feed ${feedId}:`, error)
    throw error // This will cause the job to be retried
  }
}

/**
 * Process a fetch-all-feeds job (triggered periodically)
 */
async function processFetchAllFeedsJob(job: Job) {
  console.log(`Processing fetch-all-feeds job ${job.id}`)

  try {
    const jobs = await queueAllActiveFeeds()

    return {
      success: true,
      queuedFeeds: jobs.length,
    }
  } catch (error) {
    console.error('Failed to queue all feeds:', error)
    throw error
  }
}

/**
 * Process a content extraction job
 */
async function processContentExtractionJob(job: Job) {
  const { articleId } = job.data

  console.log(`Processing content extraction job ${job.id} for article ${articleId}`)

  try {
    const result = await extractArticleById(articleId)

    return {
      success: true,
      articleId,
      ...result,
    }
  } catch (error) {
    console.error(`Failed to extract content for article ${articleId}:`, error)
    throw error // This will cause the job to be retried
  }
}

/**
 * Process an image extraction job
 */
async function processImageExtractionJob(job: Job) {
  const { articleId } = job.data

  console.log(`Processing image extraction job ${job.id} for article ${articleId}`)

  try {
    const result = await extractArticleImage(articleId)

    return {
      success: true,
      articleId,
      ...result,
    }
  } catch (error) {
    console.error(`Failed to extract image for article ${articleId}:`, error)
    throw error // This will cause the job to be retried
  }
}

/**
 * Process an article classification job
 */
async function processClassificationJob(job: Job) {
  const { articleId } = job.data

  console.log(`Processing classification job ${job.id} for article ${articleId}`)

  try {
    // Wait for pod to be ready (if using RunPod)
    await waitForPodReady()

    const { classifyArticle } = await import('../services/articleClassifier.js')
    const result = await classifyArticle(articleId)

    // Record pod activity
    await recordPodActivity()

    // Add small delay to prevent Ollama overload
    await new Promise(resolve => setTimeout(resolve, 1000))

    return {
      success: true,
      articleId,
      ...result,
    }
  } catch (error) {
    console.error(`Failed to classify article ${articleId}:`, error)
    throw error
  }
}

/**
 * Process an embedding generation job
 */
async function processEmbeddingJob(job: Job) {
  const { articleId } = job.data

  console.log(`Processing embedding job ${job.id} for article ${articleId}`)

  try {
    // Wait for pod to be ready (if using RunPod)
    await waitForPodReady()

    const { generateArticleEmbedding } = await import('../services/embeddingGenerator.js')
    const result = await generateArticleEmbedding(articleId)

    // Record pod activity
    await recordPodActivity()

    // Add delay after embedding (resource intensive)
    await new Promise(resolve => setTimeout(resolve, 2000))

    return {
      success: true,
      articleId,
      ...result,
    }
  } catch (error) {
    console.error(`Failed to generate embedding for article ${articleId}:`, error)
    throw error
  }
}

/**
 * Process an article analysis job
 */
async function processAnalysisJob(job: Job) {
  const { articleId } = job.data

  console.log(`Processing analysis job ${job.id} for article ${articleId}`)

  try {
    // Wait for pod to be ready (if using RunPod)
    await waitForPodReady()

    const { analyzeArticle } = await import('../services/articleAnalyzer.js')
    const result = await analyzeArticle(articleId)

    // Record pod activity
    await recordPodActivity()

    // Delay removed: parallel processing + RunPod handles load better

    return {
      success: true,
      articleId,
      ...result,
    }
  } catch (error) {
    console.error(`Failed to analyze article ${articleId}:`, error)
    throw error
  }
}

/**
 * Process an article clustering job
 */
async function processClusteringJob(job: Job) {
  const { minSimilarity, minClusterSize } = job.data

  console.log(`Processing clustering job ${job.id}`)

  try {
    const { clusterArticles } = await import('../services/articleClustering.js')
    const result = await clusterArticles(minSimilarity, minClusterSize)

    return {
      success: true,
      ...result,
    }
  } catch (error) {
    console.error('Failed to cluster articles:', error)
    throw error
  }
}

/**
 * Main worker process handler
 */
async function processJob(job: Job) {
  console.log(`[Worker] Processing job ${job.id} of type ${job.name}`)

  switch (job.name) {
    case 'fetch-feed':
      return await processFeedFetchJob(job)

    case 'fetch-all-feeds':
      return await processFetchAllFeedsJob(job)

    case 'extract-content':
      return await processContentExtractionJob(job)

    case 'extract-image':
      return await processImageExtractionJob(job)

    case 'classify-article':
      return await processClassificationJob(job)

    case 'generate-embedding':
      return await processEmbeddingJob(job)

    case 'analyze-article':
      return await processAnalysisJob(job)

    case 'cluster-articles':
      return await processClusteringJob(job)

    default:
      throw new Error(`Unknown job type: ${job.name}`)
  }
}

/**
 * Create and start the worker
 */
export function createFeedWorker() {
  const worker = new Worker(queueName, processJob, {
    connection: getRedisClient(),
    concurrency,
  })

  worker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completed successfully`)
  })

  worker.on('failed', (job, err) => {
    if (job) {
      const jobName = job.name
      const jobData = JSON.stringify(job.data)
      const errorMsg = err.message || 'Unknown error'

      console.error(`❌ Job ${job.id} (${jobName}) failed:`, errorMsg)
      console.error(`   Job data:`, jobData)
      console.error(`   Attempts: ${job.attemptsMade}/${job.opts?.attempts || 3}`)

      // Log returnvalue if it contains additional error context
      if (job.returnvalue && typeof job.returnvalue === 'object' && 'error' in job.returnvalue) {
        console.error(`   Additional context:`, job.returnvalue.error)
      }
    } else {
      console.error(`❌ Job failed:`, err.message)
    }
  })

  worker.on('error', (err) => {
    console.error('Worker error:', err)
  })

  console.log(`🚀 Feed worker started with concurrency ${concurrency}`)

  return worker
}

// Auto-start worker if this file is run directly
const __filename = fileURLToPath(import.meta.url)
if (process.argv[1] === __filename) {
  // Wait for RunPod manager to be ready before starting worker
  runpodReady.then(() => {
    console.log('Starting feed worker...')
    createFeedWorker()
  })

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, closing worker...')
    const { closeBrowser } = await import('../utils/googleNewsResolver.js')
    await closeBrowser()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    console.log('SIGINT received, closing worker...')
    const { closeBrowser } = await import('../utils/googleNewsResolver.js')
    await closeBrowser()
    process.exit(0)
  })
}
