import { getDatabase } from '../database/db.js'
import { articles, articleEmbeddings, feeds } from '../database/schema.js'
import { eq, sql, and, gte, ne, desc } from 'drizzle-orm'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NearDuplicate {
  article1: { id: number; title: string; url: string; feedName: string; publishedAt: Date | null }
  article2: { id: number; title: string; url: string; feedName: string; publishedAt: Date | null }
  titleSimilarity: number
  embeddingSimilarity: number | null  // null if embeddings not available
  classification: 'duplicate' | 'possible_duplicate'
}

export interface FindNearDuplicateOptions {
  articleId?: number        // If provided, find duplicates for this specific article
  days?: number             // How many days back to scan (default 7)
  titleThreshold?: number   // Title similarity threshold (default 0.85)
  limit?: number            // Max results (default 100)
}

// ─── Jaro-Winkler Similarity ─────────────────────────────────────────────────

/**
 * Jaro similarity between two strings.
 * Returns a value between 0 and 1.
 */
function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0
  if (s1.length === 0 || s2.length === 0) return 0.0

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  if (matchDistance < 0) return 0.0

  const s1Matches = new Array(s1.length).fill(false)
  const s2Matches = new Array(s2.length).fill(false)

  let matches = 0
  let transpositions = 0

  // Find matching characters
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, s2.length)

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0.0

  // Count transpositions
  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  return (
    matches / s1.length +
    matches / s2.length +
    (matches - transpositions / 2) / matches
  ) / 3
}

/**
 * Jaro-Winkler similarity (gives more weight to common prefixes).
 * Returns a value between 0 and 1.
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2)

  // Find length of common prefix (max 4 chars)
  let prefixLength = 0
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length))
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLength++
    } else {
      break
    }
  }

  // Winkler modification: scale factor of 0.1
  const scalingFactor = 0.1
  return jaro + prefixLength * scalingFactor * (1 - jaro)
}

// ─── Title Normalization ─────────────────────────────────────────────────────

const TITLE_NOISE_PREFIXES = [
  'breaking:',
  'exclusive:',
  'update:',
  'opinion:',
  'analysis:',
  'watch:',
  'live:',
  'just in:',
  'developing:',
  'report:',
]

/**
 * Normalize a title for comparison:
 * - Lowercase
 * - Remove common news prefixes (BREAKING:, EXCLUSIVE:, etc.)
 * - Remove punctuation
 * - Remove source suffixes (e.g., "- CNN", "| BBC")
 * - Collapse whitespace
 */
export function normalizeTitle(title: string): string {
  let normalized = title.toLowerCase().trim()

  // Remove common news prefixes
  for (const prefix of TITLE_NOISE_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length).trim()
    }
  }

  // Remove source suffixes like "- CNN", "| BBC News", "- The Guardian"
  normalized = normalized.replace(/\s*[-|]\s*[a-z0-9\s.]+$/i, '')

  // Remove punctuation
  normalized = normalized.replace(/[^\w\s]/g, ' ')

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Token overlap for titles (alternative to Jaro-Winkler for longer titles).
 * Returns a value between 0 and 1.
 */
export function titleTokenOverlap(title1: string, title2: string): number {
  const tokens1 = new Set(normalizeTitle(title1).split(/\s+/).filter(t => t.length > 2))
  const tokens2 = new Set(normalizeTitle(title2).split(/\s+/).filter(t => t.length > 2))

  if (tokens1.size === 0 || tokens2.size === 0) return 0

  let overlap = 0
  for (const token of tokens1) {
    if (tokens2.has(token)) overlap++
  }

  // Jaccard-like: overlap / union
  const union = new Set([...tokens1, ...tokens2]).size
  return overlap / union
}

/**
 * Combined title similarity using both Jaro-Winkler and token overlap.
 * Returns the higher of the two scores.
 */
export function computeTitleSimilarity(title1: string, title2: string): number {
  const norm1 = normalizeTitle(title1)
  const norm2 = normalizeTitle(title2)

  // Exact match after normalization
  if (norm1 === norm2) return 1.0

  const jw = jaroWinklerSimilarity(norm1, norm2)
  const tokenOvl = titleTokenOverlap(title1, title2)

  return Math.max(jw, tokenOvl)
}

// ─── Cosine Similarity ───────────────────────────────────────────────────────

/**
 * Calculate cosine similarity between two vectors.
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

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (normA * normB)
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Find near-duplicate articles.
 *
 * Strategy:
 * 1. Title similarity pre-filter (fast)
 * 2. Embedding cosine similarity for flagged pairs (accurate)
 *
 * If articleId is provided: find duplicates for that specific article.
 * If not: scan recent articles for duplicate clusters.
 */
export async function findNearDuplicates(
  options: FindNearDuplicateOptions = {}
): Promise<NearDuplicate[]> {
  const {
    articleId,
    days = 7,
    titleThreshold = 0.85,
    limit = 100,
  } = options

  const db = getDatabase()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)

  if (articleId) {
    return findDuplicatesForArticle(articleId, cutoffDate, titleThreshold, limit)
  }

  return scanForDuplicates(cutoffDate, titleThreshold, limit)
}

/**
 * Find duplicates for a specific article.
 */
async function findDuplicatesForArticle(
  articleId: number,
  cutoffDate: Date,
  titleThreshold: number,
  limit: number
): Promise<NearDuplicate[]> {
  const db = getDatabase()

  // Get the target article
  const [targetArticle] = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      feedName: feeds.name,
    })
    .from(articles)
    .leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(eq(articles.id, articleId))
    .limit(1)

  if (!targetArticle) {
    throw new Error(`Article ${articleId} not found`)
  }

  // Get candidate articles (recent, not excluded, different from target)
  const candidates = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      feedName: feeds.name,
    })
    .from(articles)
    .leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(
      and(
        ne(articles.id, articleId),
        gte(articles.publishedAt, cutoffDate),
        eq(articles.excluded, false)
      )
    )
    .orderBy(desc(articles.publishedAt))

  // Phase 1: Title similarity pre-filter
  const titleMatches: Array<{
    candidate: typeof candidates[0]
    titleSimilarity: number
  }> = []

  for (const candidate of candidates) {
    const similarity = computeTitleSimilarity(targetArticle.title, candidate.title)
    if (similarity >= titleThreshold) {
      titleMatches.push({ candidate, titleSimilarity: similarity })
    }
  }

  if (titleMatches.length === 0) return []

  // Phase 2: Embedding similarity for flagged pairs
  const results = await enrichWithEmbeddingSimilarity(
    targetArticle,
    titleMatches,
    db
  )

  // Sort by embedding similarity (if available) then title similarity
  results.sort((a, b) => {
    const embA = a.embeddingSimilarity ?? a.titleSimilarity
    const embB = b.embeddingSimilarity ?? b.titleSimilarity
    return embB - embA
  })

  return results.slice(0, limit)
}

/**
 * Scan recent articles for duplicate clusters.
 */
async function scanForDuplicates(
  cutoffDate: Date,
  titleThreshold: number,
  limit: number
): Promise<NearDuplicate[]> {
  const db = getDatabase()

  // Load recent articles
  const recentArticles = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      feedName: feeds.name,
    })
    .from(articles)
    .leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(
      and(
        gte(articles.publishedAt, cutoffDate),
        eq(articles.excluded, false)
      )
    )
    .orderBy(desc(articles.publishedAt))

  console.log(`Scanning ${recentArticles.length} recent articles for near-duplicates...`)

  // Build normalized title index for faster comparison
  // Group articles by first 3 significant tokens to reduce O(n^2) comparisons
  const tokenBuckets = new Map<string, typeof recentArticles>()
  for (const article of recentArticles) {
    const tokens = normalizeTitle(article.title).split(/\s+/).filter(t => t.length > 2)
    const significantTokens = tokens.slice(0, 5) // Use first 5 significant tokens for bucketing
    for (const token of significantTokens) {
      const bucket = tokenBuckets.get(token) || []
      bucket.push(article)
      tokenBuckets.set(token, bucket)
    }
  }

  // Find title-similar pairs using buckets
  const scoredPairs = new Set<string>()
  const titleMatches: Array<{
    article1: typeof recentArticles[0]
    article2: typeof recentArticles[0]
    titleSimilarity: number
  }> = []

  for (const [_token, bucket] of tokenBuckets) {
    if (bucket.length < 2 || bucket.length > 500) continue

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a1 = bucket[i]
        const a2 = bucket[j]
        const key = `${Math.min(a1.id, a2.id)}-${Math.max(a1.id, a2.id)}`

        if (scoredPairs.has(key)) continue
        scoredPairs.add(key)

        const similarity = computeTitleSimilarity(a1.title, a2.title)
        if (similarity >= titleThreshold) {
          titleMatches.push({
            article1: a1,
            article2: a2,
            titleSimilarity: similarity,
          })
        }
      }
    }
  }

  console.log(`Found ${titleMatches.length} title-similar pairs (threshold: ${titleThreshold})`)

  if (titleMatches.length === 0) return []

  // Phase 2: Enrich with embedding similarity
  // Collect all article IDs that need embeddings
  const embeddingArticleIds = new Set<number>()
  for (const match of titleMatches) {
    embeddingArticleIds.add(match.article1.id)
    embeddingArticleIds.add(match.article2.id)
  }

  // Bulk load embeddings
  const embeddingMap = await loadEmbeddings(Array.from(embeddingArticleIds))

  const results: NearDuplicate[] = []

  for (const match of titleMatches) {
    const emb1 = embeddingMap.get(match.article1.id)
    const emb2 = embeddingMap.get(match.article2.id)

    let embeddingSimilarity: number | null = null
    if (emb1 && emb2) {
      embeddingSimilarity = cosineSimilarity(emb1, emb2)
    }

    // Classify the duplicate
    let classification: 'duplicate' | 'possible_duplicate'
    if (embeddingSimilarity !== null) {
      classification = embeddingSimilarity > 0.95 ? 'duplicate' : 'possible_duplicate'
    } else {
      // Without embeddings, use title similarity alone
      classification = match.titleSimilarity > 0.95 ? 'duplicate' : 'possible_duplicate'
    }

    results.push({
      article1: {
        id: match.article1.id,
        title: match.article1.title,
        url: match.article1.url,
        feedName: match.article1.feedName || 'Unknown',
        publishedAt: match.article1.publishedAt,
      },
      article2: {
        id: match.article2.id,
        title: match.article2.title,
        url: match.article2.url,
        feedName: match.article2.feedName || 'Unknown',
        publishedAt: match.article2.publishedAt,
      },
      titleSimilarity: match.titleSimilarity,
      embeddingSimilarity,
      classification,
    })
  }

  // Sort: duplicates first, then by embedding similarity, then title similarity
  results.sort((a, b) => {
    if (a.classification !== b.classification) {
      return a.classification === 'duplicate' ? -1 : 1
    }
    const embA = a.embeddingSimilarity ?? a.titleSimilarity
    const embB = b.embeddingSimilarity ?? b.titleSimilarity
    return embB - embA
  })

  return results.slice(0, limit)
}

/**
 * Enrich title matches with embedding similarity for a single target article.
 */
async function enrichWithEmbeddingSimilarity(
  targetArticle: { id: number; title: string; url: string; publishedAt: Date | null; feedName: string | null },
  titleMatches: Array<{ candidate: { id: number; title: string; url: string; publishedAt: Date | null; feedName: string | null }; titleSimilarity: number }>,
  _db: any
): Promise<NearDuplicate[]> {
  // Collect article IDs
  const articleIds = [targetArticle.id, ...titleMatches.map(m => m.candidate.id)]
  const embeddingMap = await loadEmbeddings(articleIds)

  const targetEmb = embeddingMap.get(targetArticle.id)

  const results: NearDuplicate[] = []

  for (const match of titleMatches) {
    const candidateEmb = embeddingMap.get(match.candidate.id)

    let embeddingSimilarity: number | null = null
    if (targetEmb && candidateEmb) {
      embeddingSimilarity = cosineSimilarity(targetEmb, candidateEmb)
    }

    let classification: 'duplicate' | 'possible_duplicate'
    if (embeddingSimilarity !== null) {
      classification = embeddingSimilarity > 0.95 ? 'duplicate' : 'possible_duplicate'
    } else {
      classification = match.titleSimilarity > 0.95 ? 'duplicate' : 'possible_duplicate'
    }

    results.push({
      article1: {
        id: targetArticle.id,
        title: targetArticle.title,
        url: targetArticle.url,
        feedName: targetArticle.feedName || 'Unknown',
        publishedAt: targetArticle.publishedAt,
      },
      article2: {
        id: match.candidate.id,
        title: match.candidate.title,
        url: match.candidate.url,
        feedName: match.candidate.feedName || 'Unknown',
        publishedAt: match.candidate.publishedAt,
      },
      titleSimilarity: match.titleSimilarity,
      embeddingSimilarity,
      classification,
    })
  }

  return results
}

/**
 * Bulk load embeddings for a list of article IDs.
 * Returns a map of articleId -> embedding vector.
 */
async function loadEmbeddings(articleIds: number[]): Promise<Map<number, number[]>> {
  if (articleIds.length === 0) return new Map()

  const db = getDatabase()
  const map = new Map<number, number[]>()

  // Load in batches of 500 to avoid query size limits
  const batchSize = 500
  for (let i = 0; i < articleIds.length; i += batchSize) {
    const batch = articleIds.slice(i, i + batchSize)

    const rows = await db
      .select({
        articleId: articleEmbeddings.articleId,
        embedding: articleEmbeddings.embedding,
      })
      .from(articleEmbeddings)
      .where(sql`${articleEmbeddings.articleId} = ANY(ARRAY[${sql.raw(batch.join(','))}]::int[])`)

    for (const row of rows) {
      const vec = Array.isArray(row.embedding)
        ? row.embedding
        : JSON.parse(row.embedding as string)
      map.set(row.articleId, vec)
    }
  }

  return map
}

// ─── Duplicate Management ────────────────────────────────────────────────────

/**
 * Mark an article as a duplicate by excluding it.
 * Optionally stores the duplicate relationship in the article's raw_data metadata.
 */
export async function markAsDuplicate(
  articleId: number,
  originalArticleId: number
): Promise<{ success: boolean; articleId: number; originalArticleId: number }> {
  const db = getDatabase()

  // Verify both articles exist
  const [article] = await db
    .select({ id: articles.id, title: articles.title, rawData: articles.rawData })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1)

  const [original] = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(eq(articles.id, originalArticleId))
    .limit(1)

  if (!article) throw new Error(`Article ${articleId} not found`)
  if (!original) throw new Error(`Original article ${originalArticleId} not found`)

  console.log(`Marking article ${articleId} ("${article.title.substring(0, 60)}...") as duplicate of ${originalArticleId}`)

  // Store duplicate relationship in rawData metadata
  const existingRawData = (article.rawData as Record<string, any>) || {}
  const updatedRawData = {
    ...existingRawData,
    duplicate_of: originalArticleId,
    marked_duplicate_at: new Date().toISOString(),
  }

  // Exclude the duplicate article
  await db
    .update(articles)
    .set({
      excluded: true,
      rawData: updatedRawData,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId))

  console.log(`Article ${articleId} excluded as duplicate of ${originalArticleId}`)

  return {
    success: true,
    articleId,
    originalArticleId,
  }
}
