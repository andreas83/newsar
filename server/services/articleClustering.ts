import { getDatabase } from '../database/db.js'
import { articles, articleEmbeddings, stories, storyMembers, classifications } from '../database/schema.js'
import { eq, inArray } from 'drizzle-orm'

export interface ClusterResult {
  success: boolean
  groupsCreated: number
  articlesGrouped: number
  storiesMerged: number
  error?: string
}

export interface ArticleCluster {
  articles: number[] // Article IDs in this cluster
  centroid: number[] // Average embedding vector
  coherence: number // Average intra-cluster similarity
}

// Maximum time difference (in hours) between two articles for them to be clustered together.
// Articles published more than 72 hours apart will not be grouped, even if semantically similar,
// to prevent unrelated events on the same topic from merging.
const TEMPORAL_WINDOW_HOURS = 72

/**
 * Simple DBSCAN-like clustering for articles
 * Groups articles that are semantically similar
 *
 * Improvements over the original:
 * - Temporal constraints: articles >72h apart are rejected
 * - Better representative selection: most central article (highest avg similarity)
 * - Story merging: stories sharing >50% articles are merged
 *
 * NOTE: The default minSimilarity of 0.80 is fairly strict. A value of 0.72-0.75
 * may give better multi-perspective coverage by grouping articles that cover the
 * same event from different angles. Test with your data before changing.
 */
export async function clusterArticles(
  minSimilarity: number = 0.80,
  minClusterSize: number = 2
): Promise<ClusterResult> {
  const db = getDatabase()

  try {
    console.log(`\nClustering articles (similarity >= ${minSimilarity}, min size ${minClusterSize})`)

    // 1. Get all embeddings
    const allEmbeddings = await db
      .select({
        articleId: articleEmbeddings.articleId,
        embedding: articleEmbeddings.embedding,
      })
      .from(articleEmbeddings)

    if (allEmbeddings.length < minClusterSize) {
      console.log(`   Not enough articles with embeddings (need at least ${minClusterSize})`)
      return {
        success: true,
        groupsCreated: 0,
        articlesGrouped: 0,
        storiesMerged: 0,
      }
    }

    console.log(`   Found ${allEmbeddings.length} articles with embeddings`)

    // 2. Parse embeddings
    const articleVectors = allEmbeddings.map((e) => ({
      articleId: e.articleId,
      vector: (Array.isArray(e.embedding)
        ? e.embedding
        : JSON.parse(e.embedding as string)) as number[],
    }))

    // Build lookup map from articleId to vector for per-article similarity
    const vectorMap = new Map<number, number[]>()
    for (const av of articleVectors) {
      vectorMap.set(av.articleId, av.vector)
    }

    // 2b. Load published_at dates, feedId, and language for all articles with embeddings
    const articleIds = articleVectors.map(av => av.articleId)
    const articleDateRows = await db
      .select({
        id: articles.id,
        publishedAt: articles.publishedAt,
        feedId: articles.feedId,
      })
      .from(articles)
      .where(inArray(articles.id, articleIds))

    const publishedAtMap = new Map<number, Date | null>()
    const feedIdMap = new Map<number, number>()
    for (const row of articleDateRows) {
      publishedAtMap.set(row.id, row.publishedAt)
      feedIdMap.set(row.id, row.feedId)
    }

    // Load language from classifications
    const classificationRows = await db
      .select({
        articleId: classifications.articleId,
        language: classifications.language,
      })
      .from(classifications)
      .where(inArray(classifications.articleId, articleIds))

    const languageMap = new Map<number, string | null>()
    for (const row of classificationRows) {
      languageMap.set(row.articleId, row.language)
    }

    // 3. Build similarity matrix and find clusters
    const visited = new Set<number>()
    const clusters: ArticleCluster[] = []

    for (let i = 0; i < articleVectors.length; i++) {
      const article = articleVectors[i]

      if (visited.has(article.articleId)) {
        continue
      }

      // Find all neighbors (similar articles)
      // Start with seed article
      const clusterArticleIds: number[] = [article.articleId]
      const clusterVectors: number[][] = [article.vector]
      visited.add(article.articleId)

      // Calculate initial centroid
      let centroid = article.vector

      const seedPublishedAt = publishedAtMap.get(article.articleId)
      const seedLanguage = languageMap.get(article.articleId)
      const seedFeedId = feedIdMap.get(article.articleId)
      let languageSkipped = 0

      // Iteratively add articles that are similar to the centroid
      for (let j = 0; j < articleVectors.length; j++) {
        if (i === j || visited.has(articleVectors[j].articleId)) {
          continue
        }

        const candidateId = articleVectors[j].articleId

        // Language constraint: skip if languages differ
        const candidateLanguage = languageMap.get(candidateId)
        if (seedLanguage && candidateLanguage && seedLanguage !== candidateLanguage) {
          languageSkipped++
          continue
        }

        // Temporal constraint: reject pairs where published_at dates are more than 72 hours apart
        const candidatePublishedAt = publishedAtMap.get(candidateId)
        if (seedPublishedAt && candidatePublishedAt) {
          const hoursDiff = Math.abs(seedPublishedAt.getTime() - candidatePublishedAt.getTime()) / (1000 * 60 * 60)
          if (hoursDiff > TEMPORAL_WINDOW_HOURS) {
            continue
          }
        }

        // Check similarity against current centroid to prevent chain effects
        let similarity = cosineSimilarity(centroid, articleVectors[j].vector)

        // Same-feed penalty: multiply by 0.5 so same-feed articles need ~1.6x the threshold
        const candidateFeedId = feedIdMap.get(candidateId)
        if (seedFeedId && candidateFeedId && seedFeedId === candidateFeedId) {
          similarity *= 0.5
        }

        if (similarity >= minSimilarity) {
          clusterArticleIds.push(articleVectors[j].articleId)
          clusterVectors.push(articleVectors[j].vector)
          visited.add(articleVectors[j].articleId)

          // Update centroid as we add articles
          centroid = calculateCentroid(clusterVectors)
        }
      }

      // Only create cluster if we have enough members
      if (clusterArticleIds.length >= minClusterSize) {
        const coherence = calculateCoherence(clusterVectors, centroid)

        clusters.push({
          articles: clusterArticleIds,
          centroid,
          coherence,
        })
      }
    }

    console.log(`   Found ${clusters.length} clusters (before single-source filter)`)

    // 3b. Filter out single-source clusters (all articles from same feed)
    const preFilterCount = clusters.length
    const filteredClusters = clusters.filter(cluster => {
      const feedIds = new Set<number>()
      for (const articleId of cluster.articles) {
        const fid = feedIdMap.get(articleId)
        if (fid) feedIds.add(fid)
      }
      return feedIds.size > 1
    })
    const singleSourceDiscarded = preFilterCount - filteredClusters.length
    if (singleSourceDiscarded > 0) {
      console.log(`   Discarded ${singleSourceDiscarded} single-source clusters`)
    }
    console.log(`   ${filteredClusters.length} multi-source clusters remaining`)

    // 3c. Merge clusters that share >50% of their articles
    const mergedClusters = mergeOverlappingClusters(filteredClusters, vectorMap)
    const storiesMerged = filteredClusters.length - mergedClusters.length
    if (storiesMerged > 0) {
      console.log(`   Merged ${storiesMerged} overlapping clusters (${clusters.length} -> ${mergedClusters.length})`)
    }

    // 4. Store clusters in database
    let groupsCreated = 0
    let articlesGrouped = 0

    for (const cluster of mergedClusters) {
      // Get article details for all articles in cluster
      const clusterArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          publishedAt: articles.publishedAt,
          feedId: articles.feedId,
        })
        .from(articles)
        .where(inArray(articles.id, cluster.articles))

      if (clusterArticles.length === 0) {
        continue
      }

      // Select best representative: the article with highest average cosine similarity
      // to all other articles in the cluster (the most "central" article)
      const representativeArticle = selectRepresentativeArticle(cluster.articles, vectorMap, clusterArticles)

      // Calculate source count (distinct feeds)
      const uniqueFeedIds = new Set(clusterArticles.map(a => a.feedId).filter(Boolean))
      const sourceCount = uniqueFeedIds.size

      // Determine primary language (majority language of member articles)
      const langCounts = new Map<string, number>()
      for (const articleId of cluster.articles) {
        const lang = languageMap.get(articleId)
        if (lang) {
          langCounts.set(lang, (langCounts.get(lang) || 0) + 1)
        }
      }
      let primaryLanguage: string | null = null
      let maxLangCount = 0
      for (const [lang, count] of langCounts) {
        if (count > maxLangCount) {
          maxLangCount = count
          primaryLanguage = lang
        }
      }

      // Calculate proper first_seen and last_updated from article dates
      const sortedDates = clusterArticles
        .map(a => a.publishedAt)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())

      const firstSeen = sortedDates.length > 0 ? sortedDates[0] : new Date()
      const lastUpdated = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : new Date()

      // Create story (article group)
      const [story] = await db
        .insert(stories)
        .values({
          representativeTitle: representativeArticle.title,
          articleCount: cluster.articles.length,
          sourceCount: sourceCount,
          firstSeen,
          lastUpdated,
          primaryLanguage,
          clusterMethod: 'auto',
          status: 'active',
          sourceDiversityScore: cluster.coherence, // Store coherence here for now
        })
        .returning({ id: stories.id })

      // Add articles to story with individual similarity scores
      for (let i = 0; i < cluster.articles.length; i++) {
        const articleId = cluster.articles[i]
        const articleVector = vectorMap.get(articleId)
        const individualSimilarity = articleVector
          ? cosineSimilarity(articleVector, cluster.centroid)
          : cluster.coherence
        await db.insert(storyMembers).values({
          storyId: story.id,
          articleId,
          similarity: individualSimilarity,
          isRepresentative: articleId === representativeArticle.id,
        })
      }

      groupsCreated++
      articlesGrouped += cluster.articles.length

      console.log(`   Story ${story.id}: ${cluster.articles.length} articles from ${sourceCount} sources (coherence: ${cluster.coherence.toFixed(2)})`)
      console.log(`      "${representativeArticle.title.substring(0, 60)}..."`)
    }

    return {
      success: true,
      groupsCreated,
      articlesGrouped,
      storiesMerged,
    }
  } catch (error) {
    console.error('Error clustering articles:', error)
    return {
      success: false,
      groupsCreated: 0,
      articlesGrouped: 0,
      storiesMerged: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Select the most representative article in a cluster.
 * The representative is the article with the highest average cosine similarity
 * to all other articles in the cluster (the most "central" article).
 */
function selectRepresentativeArticle(
  clusterArticleIds: number[],
  vectorMap: Map<number, number[]>,
  clusterArticles: Array<{ id: number; title: string; publishedAt: Date | null; feedId: number }>
): { id: number; title: string; publishedAt: Date | null; feedId: number } {
  // If we only have 1-2 articles, or no vectors, just use the first
  if (clusterArticleIds.length <= 1) {
    return clusterArticles[0]
  }

  // Collect vectors for articles in this cluster
  const articlesWithVectors = clusterArticleIds
    .map(id => ({ id, vector: vectorMap.get(id) }))
    .filter((a): a is { id: number; vector: number[] } => a.vector !== undefined)

  // If we can't compute similarities (no vectors), fall back to first article
  if (articlesWithVectors.length < 2) {
    return clusterArticles[0]
  }

  // For each article, compute average similarity to all other articles
  let bestArticleId = articlesWithVectors[0].id
  let bestAvgSimilarity = -1

  for (const article of articlesWithVectors) {
    let totalSim = 0
    let count = 0

    for (const other of articlesWithVectors) {
      if (other.id === article.id) continue
      totalSim += cosineSimilarity(article.vector, other.vector)
      count++
    }

    const avgSim = count > 0 ? totalSim / count : 0

    if (avgSim > bestAvgSimilarity) {
      bestAvgSimilarity = avgSim
      bestArticleId = article.id
    }
  }

  // Find the article details for the best representative
  const representative = clusterArticles.find(a => a.id === bestArticleId)
  return representative || clusterArticles[0]
}

/**
 * Merge clusters that share more than 50% of their articles.
 * When two clusters overlap significantly, the smaller one is merged into the larger.
 * Centroids and coherence are recalculated after merging.
 */
function mergeOverlappingClusters(
  clusters: ArticleCluster[],
  vectorMap: Map<number, number[]>
): ArticleCluster[] {
  if (clusters.length <= 1) return clusters

  // Work with a mutable copy
  const activeClusters = clusters.map(c => ({
    articles: new Set(c.articles),
    centroid: c.centroid,
    coherence: c.coherence,
  }))

  let merged = true
  while (merged) {
    merged = false

    for (let i = 0; i < activeClusters.length; i++) {
      if (activeClusters[i].articles.size === 0) continue

      for (let j = i + 1; j < activeClusters.length; j++) {
        if (activeClusters[j].articles.size === 0) continue

        const clusterA = activeClusters[i]
        const clusterB = activeClusters[j]

        // Count shared articles
        let sharedCount = 0
        for (const articleId of clusterA.articles) {
          if (clusterB.articles.has(articleId)) {
            sharedCount++
          }
        }

        // Check if overlap exceeds 50% of the smaller cluster
        const smallerSize = Math.min(clusterA.articles.size, clusterB.articles.size)
        if (sharedCount > smallerSize * 0.5) {
          // Merge: absorb smaller into larger
          const [larger, smaller] = clusterA.articles.size >= clusterB.articles.size
            ? [i, j]
            : [j, i]

          for (const articleId of activeClusters[smaller].articles) {
            activeClusters[larger].articles.add(articleId)
          }
          activeClusters[smaller].articles.clear()

          // Recalculate centroid and coherence for merged cluster
          const mergedArticleIds = Array.from(activeClusters[larger].articles)
          const mergedVectors = mergedArticleIds
            .map(id => vectorMap.get(id))
            .filter((v): v is number[] => v !== undefined)

          if (mergedVectors.length > 0) {
            activeClusters[larger].centroid = calculateCentroid(mergedVectors)
            activeClusters[larger].coherence = calculateCoherence(mergedVectors, activeClusters[larger].centroid)
          }

          merged = true
          break // Restart outer loop after a merge
        }
      }

      if (merged) break
    }
  }

  // Convert back to ArticleCluster format, removing empty clusters
  return activeClusters
    .filter(c => c.articles.size > 0)
    .map(c => ({
      articles: Array.from(c.articles),
      centroid: c.centroid,
      coherence: c.coherence,
    }))
}

/**
 * Get articles in the same story (group)
 */
export async function getArticleGroup(articleId: number) {
  const db = getDatabase()

  // Find which story this article belongs to
  const [membership] = await db
    .select({
      storyId: storyMembers.storyId,
    })
    .from(storyMembers)
    .where(eq(storyMembers.articleId, articleId))
    .limit(1)

  if (!membership) {
    return null
  }

  // Get all articles in this story
  const members = await db
    .select({
      articleId: storyMembers.articleId,
    })
    .from(storyMembers)
    .where(eq(storyMembers.storyId, membership.storyId))

  const articleIdsInGroup = members.map((m) => m.articleId)

  // Get article details
  const articlesInGroup = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      feedId: articles.feedId,
    })
    .from(articles)
    .where(inArray(articles.id, articleIdsInGroup))

  // Get story info
  const [story] = await db
    .select()
    .from(stories)
    .where(eq(stories.id, membership.storyId))
    .limit(1)

  return {
    story,
    articles: articlesInGroup,
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (normA * normB)
}

/**
 * Calculate centroid (average vector) of a set of vectors
 */
function calculateCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return []
  }

  const dimensions = vectors[0].length
  const centroid = new Array(dimensions).fill(0)

  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += vector[i]
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= vectors.length
  }

  return centroid
}

/**
 * Calculate average similarity within a cluster (coherence)
 */
function calculateCoherence(vectors: number[][], centroid: number[]): number {
  if (vectors.length === 0) {
    return 0
  }

  let totalSimilarity = 0

  for (const vector of vectors) {
    totalSimilarity += cosineSimilarity(vector, centroid)
  }

  return totalSimilarity / vectors.length
}
