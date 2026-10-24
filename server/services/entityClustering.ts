/**
 * Entity-Based Topic Clustering Service
 *
 * Replaces embedding-only DBSCAN with a composite affinity score:
 *   40% Entity overlap (IDF-weighted Jaccard)
 *   20% Time proximity (72h half-life exponential decay)
 *   10% Geographic perspective match
 *   30% Embedding cosine similarity
 *
 * Uses inverted index for candidate generation and union-find for clustering.
 */

import { getDatabase } from '../database/db'
import {
  articles,
  articleEmbeddings,
  articleEntities,
  classifications,
  entities,
  stories,
  storyMembers,
  storyCoverage,
  storyEntities,
  storyMetrics,
  storyRedirects,
  feeds,
} from '../database/schema'
import { and, eq, sql, inArray } from 'drizzle-orm'
import { normalizeGeoPov } from './geoNormalizer'

// --- Types ---

export interface EntityClusterResult {
  success: boolean
  groupsCreated: number
  articlesGrouped: number
  orphansAssigned: number
  candidatePairs: number
  storiesKept?: number
  storiesRemoved?: number
  error?: string
}

interface ArticleData {
  id: number
  feedId: number
  publishedAt: Date | null
  title: string
  language: string | null
  entityWeights: Map<number, number> // entityId → relevance * IDF
  geoPov: string | null
  embedding: number[] | null
}

interface IdfEntry {
  entityId: number
  name: string
  articleCount: number
  idf: number
}

// --- Cosine Similarity (exported for reuse) ---

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0

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

// --- IDF Computation ---

export async function computeEntityIDF(): Promise<Map<number, IdfEntry>> {
  const db = getDatabase()

  // Count total articles with entities
  const [{ count: totalStr }] = await db
    .select({ count: sql<string>`COUNT(DISTINCT ${articleEntities.articleId})` })
    .from(articleEntities)
  const totalArticles = parseInt(totalStr) || 1

  // Count articles per entity
  const entityCounts = await db
    .select({
      entityId: articleEntities.entityId,
      name: entities.name,
      articleCount: sql<string>`COUNT(DISTINCT ${articleEntities.articleId})`,
    })
    .from(articleEntities)
    .innerJoin(entities, eq(articleEntities.entityId, entities.id))
    .groupBy(articleEntities.entityId, entities.name)

  const idfMap = new Map<number, IdfEntry>()
  const stopThreshold = totalArticles * 0.05 // 5% = stop-entity

  for (const row of entityCounts) {
    const articleCount = parseInt(row.articleCount)
    let idf = Math.log(totalArticles / articleCount)

    // Cap IDF at 0.5 for stop-entities (appear in >5% of articles)
    if (articleCount > stopThreshold) {
      idf = Math.min(idf, 0.5)
    }

    idfMap.set(row.entityId, {
      entityId: row.entityId,
      name: row.name,
      articleCount,
      idf,
    })
  }

  console.log(`[EntityClustering] Computed IDF for ${idfMap.size} entities (total articles: ${totalArticles})`)
  return idfMap
}

// --- Data Loading ---

async function loadArticleData(idfMap: Map<number, IdfEntry>): Promise<Map<number, ArticleData>> {
  const db = getDatabase()
  const articleMap = new Map<number, ArticleData>()

  // Load articles with publishedAt
  const allArticles = await db
    .select({
      id: articles.id,
      feedId: articles.feedId,
      publishedAt: articles.publishedAt,
      title: articles.title,
    })
    .from(articles)

  for (const a of allArticles) {
    articleMap.set(a.id, {
      id: a.id,
      feedId: a.feedId,
      publishedAt: a.publishedAt,
      title: a.title,
      language: null,
      entityWeights: new Map(),
      geoPov: null,
      embedding: null,
    })
  }

  console.log(`[EntityClustering] Loaded ${articleMap.size} articles`)

  // Load entity links with IDF weighting
  const entityLinks = await db
    .select({
      articleId: articleEntities.articleId,
      entityId: articleEntities.entityId,
      relevanceScore: articleEntities.relevanceScore,
    })
    .from(articleEntities)

  let entityLinksLoaded = 0
  for (const link of entityLinks) {
    const article = articleMap.get(link.articleId)
    if (!article) continue

    const idfEntry = idfMap.get(link.entityId)
    const idf = idfEntry?.idf ?? 1.0
    article.entityWeights.set(link.entityId, link.relevanceScore * idf)
    entityLinksLoaded++
  }

  console.log(`[EntityClustering] Loaded ${entityLinksLoaded} entity links`)

  // Load geoPov and language from classifications
  const classRows = await db
    .select({
      articleId: classifications.articleId,
      geoPov: classifications.geoPov,
      language: classifications.language,
    })
    .from(classifications)

  let geoPovLoaded = 0
  let languageLoaded = 0
  for (const row of classRows) {
    const article = articleMap.get(row.articleId)
    if (article) {
      if (row.geoPov) {
        article.geoPov = row.geoPov
        geoPovLoaded++
      }
      if (row.language) {
        article.language = row.language
        languageLoaded++
      }
    }
  }

  console.log(`[EntityClustering] Loaded ${geoPovLoaded} geoPov values, ${languageLoaded} languages`)

  // Load embeddings
  const embeddingRows = await db
    .select({
      articleId: articleEmbeddings.articleId,
      embedding: articleEmbeddings.embedding,
    })
    .from(articleEmbeddings)

  let embeddingsLoaded = 0
  for (const row of embeddingRows) {
    const article = articleMap.get(row.articleId)
    if (article) {
      article.embedding = Array.isArray(row.embedding)
        ? row.embedding
        : JSON.parse(row.embedding as string)
      embeddingsLoaded++
    }
  }

  console.log(`[EntityClustering] Loaded ${embeddingsLoaded} embeddings`)

  return articleMap
}

// --- Affinity Score Components ---

function entityScore(a: ArticleData, b: ArticleData): number {
  if (a.entityWeights.size === 0 || b.entityWeights.size === 0) return 0

  // Weighted Jaccard: sum(min) / sum(max)
  const allEntityIds = new Set([...a.entityWeights.keys(), ...b.entityWeights.keys()])

  let sumMin = 0
  let sumMax = 0

  for (const entityId of allEntityIds) {
    const wa = a.entityWeights.get(entityId) ?? 0
    const wb = b.entityWeights.get(entityId) ?? 0
    sumMin += Math.min(wa, wb)
    sumMax += Math.max(wa, wb)
  }

  return sumMax > 0 ? sumMin / sumMax : 0
}

function timeScore(a: ArticleData, b: ArticleData): number {
  if (!a.publishedAt || !b.publishedAt) return 0.5

  const hoursDiff = Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime()) / (1000 * 60 * 60)
  // Exponential decay with 72-hour half-life
  return Math.exp(-hoursDiff * Math.LN2 / 72)
}

async function geoScore(a: ArticleData, b: ArticleData): Promise<number> {
  if (!a.geoPov && !b.geoPov) return 0.5 // Both missing → neutral
  if (!a.geoPov || !b.geoPov) return 0.5 // One missing → neutral

  const normA = await normalizeGeoPov(a.geoPov)
  const normB = await normalizeGeoPov(b.geoPov)

  if (!normA || !normB) return 0.5

  if (normA.country.toLowerCase() === normB.country.toLowerCase()) return 1.0
  if (normA.region && normB.region && normA.region.toLowerCase() === normB.region.toLowerCase()) return 0.7
  return 0.3
}

function embedScore(a: ArticleData, b: ArticleData): number {
  if (!a.embedding || !b.embedding) return 0.5 // Missing → neutral

  const cos = cosineSimilarity(a.embedding, b.embedding)
  // Map [0.5, 1.0] → [0.0, 1.0], below 0.5 → 0.0
  if (cos < 0.5) return 0.0
  return (cos - 0.5) * 2.0
}

// --- Composite Affinity ---

async function computeAffinity(a: ArticleData, b: ArticleData): Promise<number> {
  const ent = entityScore(a, b)
  const time = timeScore(a, b)
  const geo = await geoScore(a, b)
  const embed = embedScore(a, b)

  return 0.40 * ent + 0.20 * time + 0.10 * geo + 0.30 * embed
}

// --- Candidate Generation (Inverted Index) ---

function generateCandidatePairs(
  articleMap: Map<number, ArticleData>,
  idfMap: Map<number, IdfEntry>,
): Set<string> {
  // Build entityId → Set<articleId> inverted index
  const invertedIndex = new Map<number, Set<number>>()

  for (const [articleId, article] of articleMap) {
    for (const entityId of article.entityWeights.keys()) {
      let set = invertedIndex.get(entityId)
      if (!set) {
        set = new Set()
        invertedIndex.set(entityId, set)
      }
      set.add(articleId)
    }
  }

  // Identify stop-entities (>1000 articles)
  const stopEntities = new Set<number>()
  for (const [entityId, articleSet] of invertedIndex) {
    if (articleSet.size > 1000) {
      stopEntities.add(entityId)
    }
  }

  console.log(`[EntityClustering] Inverted index: ${invertedIndex.size} entities, ${stopEntities.size} stop-entities skipped`)

  // Generate candidate pairs via entity co-occurrence
  const pairCounts = new Map<string, number>() // "minId:maxId" → shared entity count
  const pairHighIdf = new Map<string, number>() // Track highest IDF in shared entities
  const candidatePairs = new Set<string>()
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

  for (const [entityId, articleSet] of invertedIndex) {
    if (stopEntities.has(entityId)) continue

    const articleIds = Array.from(articleSet)
    const idfEntry = idfMap.get(entityId)
    const entityIdf = idfEntry?.idf ?? 0

    for (let i = 0; i < articleIds.length; i++) {
      for (let j = i + 1; j < articleIds.length; j++) {
        const a = articleMap.get(articleIds[i])!
        const b = articleMap.get(articleIds[j])!

        // Time window check
        if (a.publishedAt && b.publishedAt) {
          const timeDiff = Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime())
          if (timeDiff > FOURTEEN_DAYS_MS) continue
        }

        const minId = Math.min(articleIds[i], articleIds[j])
        const maxId = Math.max(articleIds[i], articleIds[j])
        const key = `${minId}:${maxId}`

        const currentCount = (pairCounts.get(key) || 0) + 1
        pairCounts.set(key, currentCount)

        const currentMaxIdf = pairHighIdf.get(key) || 0
        if (entityIdf > currentMaxIdf) {
          pairHighIdf.set(key, entityIdf)
        }
      }
    }
  }

  // Filter candidates: Tier 1 (≥2 shared entities) or Tier 2 (≥1 high-IDF entity, ≤7 days)
  for (const [key, count] of pairCounts) {
    // Tier 1: ≥2 shared entities AND ≤14-day window (already filtered above)
    if (count >= 2) {
      candidatePairs.add(key)
      continue
    }

    // Tier 2: ≥1 high-IDF entity (IDF > 3.0) AND ≤7-day window
    const highIdf = pairHighIdf.get(key) || 0
    if (count >= 1 && highIdf > 3.0) {
      const [minId, maxId] = key.split(':').map(Number)
      const a = articleMap.get(minId)
      const b = articleMap.get(maxId)
      if (a?.publishedAt && b?.publishedAt) {
        const timeDiff = Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime())
        if (timeDiff <= SEVEN_DAYS_MS) {
          candidatePairs.add(key)
        }
      }
    }
  }

  console.log(`[EntityClustering] Generated ${candidatePairs.size} candidate pairs from ${pairCounts.size} total pairs`)
  return candidatePairs
}

// --- Union-Find ---

class UnionFind {
  parent: Map<number, number>
  rank: Map<number, number>
  size: Map<number, number>

  constructor() {
    this.parent = new Map()
    this.rank = new Map()
    this.size = new Map()
  }

  makeSet(x: number) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
      this.size.set(x, 1)
    }
  }

  find(x: number): number {
    if (!this.parent.has(x)) this.makeSet(x)

    let root = x
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!
    }
    // Path compression
    let current = x
    while (current !== root) {
      const next = this.parent.get(current)!
      this.parent.set(current, root)
      current = next
    }
    return root
  }

  union(x: number, y: number): boolean {
    const rx = this.find(x)
    const ry = this.find(y)
    if (rx === ry) return false

    // Union by rank
    const rankX = this.rank.get(rx)!
    const rankY = this.rank.get(ry)!
    const sizeX = this.size.get(rx)!
    const sizeY = this.size.get(ry)!

    if (rankX < rankY) {
      this.parent.set(rx, ry)
      this.size.set(ry, sizeX + sizeY)
    } else if (rankX > rankY) {
      this.parent.set(ry, rx)
      this.size.set(rx, sizeX + sizeY)
    } else {
      this.parent.set(ry, rx)
      this.size.set(rx, sizeX + sizeY)
      this.rank.set(rx, rankX + 1)
    }
    return true
  }

  getSize(x: number): number {
    return this.size.get(this.find(x)) || 1
  }

  getClusters(): Map<number, number[]> {
    const clusters = new Map<number, number[]>()
    for (const x of this.parent.keys()) {
      const root = this.find(x)
      let cluster = clusters.get(root)
      if (!cluster) {
        cluster = []
        clusters.set(root, cluster)
      }
      cluster.push(x)
    }
    return clusters
  }
}

// --- Cluster Splitting ---

function splitClusterAtTemporalGap(
  articleIds: number[],
  articleMap: Map<number, ArticleData>,
  maxSize: number,
): number[][] {
  // Sort by publishedAt
  const sorted = articleIds
    .map(id => ({ id, publishedAt: articleMap.get(id)?.publishedAt }))
    .sort((a, b) => (a.publishedAt?.getTime() || 0) - (b.publishedAt?.getTime() || 0))

  if (sorted.length <= maxSize) return [articleIds]

  // Find largest temporal gap
  let maxGapIdx = 0
  let maxGap = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].publishedAt?.getTime() || 0) - (sorted[i - 1].publishedAt?.getTime() || 0)
    if (gap > maxGap) {
      maxGap = gap
      maxGapIdx = i
    }
  }

  const left = sorted.slice(0, maxGapIdx).map(s => s.id)
  const right = sorted.slice(maxGapIdx).map(s => s.id)

  // Recursively split if still too large
  const results: number[][] = []
  for (const part of [left, right]) {
    if (part.length > maxSize) {
      results.push(...splitClusterAtTemporalGap(part, articleMap, maxSize))
    } else if (part.length > 0) {
      results.push(part)
    }
  }

  return results
}

// --- Topic Metadata ---

async function computeTopicMetadata(
  clusterArticleIds: number[],
  articleMap: Map<number, ArticleData>,
  idfMap: Map<number, IdfEntry>,
): Promise<{
  topicLabel: string
  primaryRegion: string | null
  primaryEntities: Array<{ id: number; name: string; type: string }>
  timeSpanHours: number
}> {
  const db = getDatabase()

  // Aggregate entity weights across cluster
  const entityAggWeights = new Map<number, number>()
  for (const articleId of clusterArticleIds) {
    const article = articleMap.get(articleId)
    if (!article) continue
    for (const [entityId, weight] of article.entityWeights) {
      entityAggWeights.set(entityId, (entityAggWeights.get(entityId) || 0) + weight)
    }
  }

  // Sort by aggregate weight descending
  const sortedEntities = Array.from(entityAggWeights.entries())
    .sort((a, b) => b[1] - a[1])

  // Get entity details for top 5
  const top5Ids = sortedEntities.slice(0, 5).map(([id]) => id)
  let primaryEntitiesResult: Array<{ id: number; name: string; type: string }> = []

  if (top5Ids.length > 0) {
    const entityRows = await db
      .select({ id: entities.id, name: entities.name, type: entities.type })
      .from(entities)
      .where(inArray(entities.id, top5Ids))

    // Preserve sort order
    const entityById = new Map(entityRows.map(e => [e.id, e]))
    primaryEntitiesResult = top5Ids
      .map(id => entityById.get(id))
      .filter((e): e is { id: number; name: string; type: string } => !!e)
  }

  // Topic label: top 3 entity names
  const topicLabel = primaryEntitiesResult.slice(0, 3).map(e => e.name).join(' / ') || 'Ungrouped'

  // Primary region: most common normalized country from geoPov
  const regionCounts = new Map<string, number>()
  for (const articleId of clusterArticleIds) {
    const article = articleMap.get(articleId)
    if (!article?.geoPov) continue
    const norm = await normalizeGeoPov(article.geoPov)
    if (norm) {
      regionCounts.set(norm.country, (regionCounts.get(norm.country) || 0) + 1)
    }
  }

  let primaryRegion: string | null = null
  let maxRegionCount = 0
  for (const [region, count] of regionCounts) {
    if (count > maxRegionCount) {
      maxRegionCount = count
      primaryRegion = region
    }
  }

  // Time span
  let minTime = Infinity
  let maxTime = -Infinity
  for (const articleId of clusterArticleIds) {
    const article = articleMap.get(articleId)
    if (article?.publishedAt) {
      const t = article.publishedAt.getTime()
      if (t < minTime) minTime = t
      if (t > maxTime) maxTime = t
    }
  }
  const timeSpanHours = minTime < Infinity ? (maxTime - minTime) / (1000 * 60 * 60) : 0

  return { topicLabel, primaryRegion, primaryEntities: primaryEntitiesResult, timeSpanHours }
}

// --- Temporal Outliers ---

/** An article this far from both of its time neighbours doesn't belong to the story. */
const OUTLIER_GAP_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Drop isolated articles whose publish date is weeks away from every other
 * member (e.g. one March article inside an October riot story). They stretch
 * the story's time span and timeline without adding to it.
 */
function pruneTemporalOutliers(articleIds: number[], articleMap: Map<number, ArticleData>): number[] {
  const dated = articleIds
    .map(id => ({ id, t: articleMap.get(id)?.publishedAt?.getTime() }))
    .filter((a): a is { id: number; t: number } => a.t !== undefined)
    .sort((a, b) => a.t - b.t)

  if (dated.length < 3) return articleIds

  const drop = new Set<number>()
  for (let i = 0; i < dated.length; i++) {
    const gapBefore = i > 0 ? dated[i].t - dated[i - 1].t : Infinity
    const gapAfter = i < dated.length - 1 ? dated[i + 1].t - dated[i].t : Infinity
    if (gapBefore > OUTLIER_GAP_MS && gapAfter > OUTLIER_GAP_MS) drop.add(dated[i].id)
  }

  // Never prune a cluster down to nothing meaningful
  if (drop.size === 0 || dated.length - drop.size < 2) return articleIds
  return articleIds.filter(id => !drop.has(id))
}

// --- Writing Clusters (stable story identity) ---

/**
 * A new cluster keeps an old story's ID when it carries on that story:
 * most of the old story is in it, or most of it comes from the old story and
 * that is still a fair part of the old story.
 */
const KEEP_ID_MIN_OLD_SHARE = 0.5
const KEEP_ID_MIN_NEW_SHARE = 0.6
const KEEP_ID_MIN_OLD_SHARE_WEAK = 0.25

interface ClusterWriteStats {
  kept: number
  created: number
  removed: number
  redirected: number
  articlesGrouped: number
}

/** Match each new cluster (by index) to the old story ID it continues. */
async function matchPreviousStories(finalClusters: number[][]): Promise<{
  matches: Map<number, number>
  oldMembers: Map<number, Set<number>>
}> {
  const db = getDatabase()
  const rows = await db
    .select({ storyId: storyMembers.storyId, articleId: storyMembers.articleId })
    .from(storyMembers)

  const oldMembers = new Map<number, Set<number>>()
  const oldStoryOf = new Map<number, number>()
  for (const row of rows) {
    if (!oldMembers.has(row.storyId)) oldMembers.set(row.storyId, new Set())
    oldMembers.get(row.storyId)!.add(row.articleId)
    oldStoryOf.set(row.articleId, row.storyId)
  }

  const candidates: { ci: number; storyId: number; overlap: number; jaccard: number }[] = []
  finalClusters.forEach((cluster, ci) => {
    const overlaps = new Map<number, number>()
    for (const articleId of cluster) {
      const storyId = oldStoryOf.get(articleId)
      if (storyId !== undefined) overlaps.set(storyId, (overlaps.get(storyId) || 0) + 1)
    }
    for (const [storyId, overlap] of overlaps) {
      const oldSize = oldMembers.get(storyId)!.size
      const oldShare = overlap / oldSize
      const newShare = overlap / cluster.length
      if (oldShare >= KEEP_ID_MIN_OLD_SHARE || (newShare >= KEEP_ID_MIN_NEW_SHARE && oldShare >= KEEP_ID_MIN_OLD_SHARE_WEAK)) {
        candidates.push({ ci, storyId, overlap, jaccard: overlap / (oldSize + cluster.length - overlap) })
      }
    }
  })

  // Greedy: biggest continuations claim their ID first; each ID used once
  candidates.sort((a, b) => b.overlap - a.overlap || b.jaccard - a.jaccard)
  const matches = new Map<number, number>()
  const usedIds = new Set<number>()
  for (const c of candidates) {
    if (matches.has(c.ci) || usedIds.has(c.storyId)) continue
    matches.set(c.ci, c.storyId)
    usedIds.add(c.storyId)
  }

  return { matches, oldMembers }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function writeClusters(
  finalClusters: number[][],
  articleMap: Map<number, ArticleData>,
  idfMap: Map<number, IdfEntry>,
  dryRun: boolean,
): Promise<ClusterWriteStats> {
  const db = getDatabase()
  const { matches, oldMembers } = await matchPreviousStories(finalClusters)
  const keptIds = new Set(matches.values())
  const removedIds = [...oldMembers.keys()].filter(id => !keptIds.has(id))
  const articlesGrouped = finalClusters.reduce((sum, c) => sum + c.length, 0)

  if (dryRun) {
    return { kept: matches.size, created: finalClusters.length - matches.size, removed: removedIds.length, redirected: 0, articlesGrouped }
  }

  // Compute everything that needs reads before opening the transaction
  const prepared: {
    ci: number
    cluster: number[]
    metadata: Awaited<ReturnType<typeof computeTopicMetadata>>
    representative: ArticleData
    values: Omit<typeof stories.$inferInsert, 'id' | 'status'>
  }[] = []
  for (const [ci, cluster] of finalClusters.entries()) {
    const metadata = await computeTopicMetadata(cluster, articleMap, idfMap)
    const members = cluster.map(id => articleMap.get(id)).filter((a): a is ArticleData => !!a)
    if (members.length === 0) continue

    // Representative: most recent article
    const representative = [...members].sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0))[0]
    const uniqueFeeds = new Set(members.map(a => a.feedId).filter(Boolean))

    // Primary language: majority language of member articles
    const langCounts = new Map<string, number>()
    for (const a of members) {
      if (a.language) langCounts.set(a.language, (langCounts.get(a.language) || 0) + 1)
    }
    const primaryLanguage = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null

    const timestamps = members
      .map(a => a.publishedAt)
      .filter((t): t is Date => t !== null)
      .sort((a, b) => a.getTime() - b.getTime())

    prepared.push({
      ci,
      cluster,
      metadata,
      representative,
      values: {
        representativeTitle: representative.title,
        articleCount: cluster.length,
        sourceCount: uniqueFeeds.size,
        firstSeen: timestamps[0] || new Date(),
        lastUpdated: timestamps[timestamps.length - 1] || new Date(),
        primaryLanguage,
        clusterMethod: 'auto',
        topicLabel: metadata.topicLabel,
        primaryRegion: metadata.primaryRegion,
        primaryEntities: metadata.primaryEntities,
        timeSpanHours: metadata.timeSpanHours,
        clusterVersion: 'v2',
      },
    })
  }

  let redirected = 0
  await db.transaction(async (tx) => {
    const newStoryOf = new Map<number, number>()
    let written = 0

    for (const p of prepared) {
      let storyId = matches.get(p.ci)
      const repEmbedding = p.representative.embedding
      const memberValues = (id: number) => p.cluster.map((articleId) => {
        const article = articleMap.get(articleId)
        const similarity = article?.embedding && repEmbedding ? cosineSimilarity(article.embedding, repEmbedding) : 0
        return { storyId: id, articleId, similarity, isRepresentative: articleId === p.representative.id }
      })

      if (storyId !== undefined) {
        // Status and trending score are left to updateStoryTrending
        await tx.update(stories).set({ ...p.values, updatedAt: new Date() }).where(eq(stories.id, storyId))
        const old = oldMembers.get(storyId)!
        // Same members means the representative (newest article) is unchanged too
        const unchanged = old.size === p.cluster.length && p.cluster.every(id => old.has(id))
        if (!unchanged) {
          await tx.delete(storyMembers).where(eq(storyMembers.storyId, storyId))
          for (const batch of chunk(memberValues(storyId), 100)) await tx.insert(storyMembers).values(batch)
        }
      } else {
        const [story] = await tx
          .insert(stories)
          .values({ ...p.values, status: 'active' })
          .returning({ id: stories.id })
        storyId = story.id
        for (const batch of chunk(memberValues(storyId), 100)) await tx.insert(storyMembers).values(batch)
      }

      await tx.update(articles)
        .set({ storyId })
        .where(and(inArray(articles.id, p.cluster), sql`${articles.storyId} IS DISTINCT FROM ${storyId}`))

      // Story entities follow the (IDF-weighted) metadata, which drifts even for unchanged members
      await tx.delete(storyEntities).where(eq(storyEntities.storyId, storyId))
      if (p.metadata.primaryEntities.length > 0) {
        await tx.insert(storyEntities).values(p.metadata.primaryEntities.map((entity, idx) => ({
          storyId: storyId!,
          entityId: entity.id,
          isPrimary: idx === 0,
          relevance: 1.0 - idx * 0.15, // Decreasing relevance
          articleCount: p.cluster.length,
        })))
      }

      for (const articleId of p.cluster) newStoryOf.set(articleId, storyId)

      written++
      if (written % 500 === 0) {
        console.log(`[EntityClustering] Written ${written} clusters...`)
      }
    }

    // Dissolved stories redirect to the story that took most of their articles
    for (const oldId of removedIds) {
      const counts = new Map<number, number>()
      for (const articleId of oldMembers.get(oldId)!) {
        const target = newStoryOf.get(articleId)
        if (target !== undefined) counts.set(target, (counts.get(target) || 0) + 1)
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (!best) continue
      await tx.insert(storyRedirects)
        .values({ oldId, newId: best[0] })
        .onConflictDoUpdate({ target: storyRedirects.oldId, set: { newId: best[0], createdAt: new Date() } })
      // Collapse chains: anything that pointed at the dissolved story now points at its successor
      await tx.update(storyRedirects).set({ newId: best[0] }).where(eq(storyRedirects.newId, oldId))
      redirected++
    }

    for (const ids of chunk(removedIds, 1000)) {
      await tx.delete(storyMetrics).where(inArray(storyMetrics.storyId, ids))
      await tx.delete(storyCoverage).where(inArray(storyCoverage.storyId, ids))
      await tx.delete(storyEntities).where(inArray(storyEntities.storyId, ids))
      await tx.delete(storyMembers).where(inArray(storyMembers.storyId, ids))
    }

    // Articles that fell out of every cluster (or whose story dissolved)
    await tx.execute(sql`
      UPDATE articles a SET story_id = NULL
      WHERE a.story_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM story_members sm WHERE sm.article_id = a.id AND sm.story_id = a.story_id)
    `)

    for (const ids of chunk(removedIds, 1000)) {
      await tx.delete(stories).where(inArray(stories.id, ids))
    }
  })

  return { kept: matches.size, created: prepared.length - matches.size, removed: removedIds.length, redirected, articlesGrouped }
}

// --- Main Clustering Function ---

export async function clusterWithEntities(
  threshold: number = 0.35,
  minSize: number = 2,
  maxSize: number = 80,
  dryRun: boolean = false,
): Promise<EntityClusterResult> {
  const db = getDatabase()

  try {
    console.log(`\n[EntityClustering] Starting entity-based clustering`)
    console.log(`  Threshold: ${threshold}, Min size: ${minSize}, Max size: ${maxSize}`)

    // Step 1: Compute IDF
    const idfMap = await computeEntityIDF()

    // Step 2: Load all article data
    const articleMap = await loadArticleData(idfMap)

    // Step 3: Generate candidate pairs via inverted index
    const candidatePairs = generateCandidatePairs(articleMap, idfMap)

    // Step 4: Compute affinities and build union-find clusters
    const uf = new UnionFind()
    let mergeCount = 0
    let pairIndex = 0
    const totalPairs = candidatePairs.size

    let languageSkipped = 0
    let sameFeedPenalized = 0

    for (const key of candidatePairs) {
      pairIndex++
      if (pairIndex % 50000 === 0) {
        console.log(`[EntityClustering] Processing pair ${pairIndex}/${totalPairs}...`)
      }

      const [minId, maxId] = key.split(':').map(Number)
      const a = articleMap.get(minId)
      const b = articleMap.get(maxId)
      if (!a || !b) continue

      // Language constraint: skip pairs with different languages
      if (a.language && b.language && a.language !== b.language) {
        languageSkipped++
        continue
      }

      // Size cap check: don't merge if combined would exceed maxSize
      uf.makeSet(minId)
      uf.makeSet(maxId)

      if (uf.find(minId) !== uf.find(maxId)) {
        const combinedSize = uf.getSize(minId) + uf.getSize(maxId)
        if (combinedSize > maxSize) continue
      }

      let affinity = await computeAffinity(a, b)

      // Same-feed penalty: multiply affinity by 0.5 so same-feed articles
      // need ~2x the threshold to cluster (effectively blocks same-feed pairs)
      if (a.feedId === b.feedId) {
        affinity *= 0.5
        sameFeedPenalized++
      }

      if (affinity >= threshold) {
        uf.union(minId, maxId)
        mergeCount++
      }
    }

    console.log(`[EntityClustering] Language-skipped: ${languageSkipped}, Same-feed penalized: ${sameFeedPenalized}`)

    console.log(`[EntityClustering] Merged ${mergeCount} pairs`)

    // Step 5: Extract clusters, split oversized ones
    const rawClusters = uf.getClusters()
    const finalClusters: number[][] = []

    for (const [, members] of rawClusters) {
      if (members.length < minSize) continue

      if (members.length > maxSize) {
        const splits = splitClusterAtTemporalGap(members, articleMap, maxSize)
        for (const split of splits) {
          if (split.length >= minSize) {
            finalClusters.push(split)
          }
        }
      } else {
        finalClusters.push(members)
      }
    }

    // Step 5b: Filter out single-source clusters (all articles from same feed)
    const preFilterCount = finalClusters.length
    const multiSourceClusters = finalClusters.filter(cluster => {
      if (cluster.length < minSize) return false
      const feedIds = new Set<number>()
      for (const articleId of cluster) {
        const article = articleMap.get(articleId)
        if (article) feedIds.add(article.feedId)
      }
      return feedIds.size > 1
    })
    const singleSourceDiscarded = preFilterCount - multiSourceClusters.length
    // Replace finalClusters contents with filtered results
    finalClusters.length = 0
    finalClusters.push(...multiSourceClusters)

    console.log(`[EntityClustering] ${preFilterCount} clusters after splitting (from ${rawClusters.size} raw)`)
    if (singleSourceDiscarded > 0) {
      console.log(`[EntityClustering] Discarded ${singleSourceDiscarded} single-source clusters`)
    }
    console.log(`[EntityClustering] ${finalClusters.length} multi-source clusters remaining`)

    // Step 6: Orphan assignment (articles without entities)
    const clusteredArticleIds = new Set<number>()
    for (const cluster of finalClusters) {
      for (const id of cluster) {
        clusteredArticleIds.add(id)
      }
    }

    // Compute centroids for orphan assignment
    const clusterCentroids: { cluster: number[]; centroid: number[] }[] = []
    for (const cluster of finalClusters) {
      const vectors: number[][] = []
      for (const id of cluster) {
        const article = articleMap.get(id)
        if (article?.embedding) {
          vectors.push(article.embedding)
        }
      }
      if (vectors.length > 0) {
        const dims = vectors[0].length
        const centroid = new Array(dims).fill(0)
        for (const v of vectors) {
          for (let i = 0; i < dims; i++) centroid[i] += v[i]
        }
        for (let i = 0; i < dims; i++) centroid[i] /= vectors.length
        clusterCentroids.push({ cluster, centroid })
      }
    }

    let orphansAssigned = 0
    for (const [articleId, article] of articleMap) {
      if (clusteredArticleIds.has(articleId)) continue
      if (!article.embedding) continue
      if (article.entityWeights.size > 0) continue // Only orphan-assign entity-less articles

      let bestSim = 0
      let bestCluster: number[] | null = null
      for (const { cluster, centroid } of clusterCentroids) {
        const sim = cosineSimilarity(article.embedding, centroid)
        if (sim > bestSim) {
          bestSim = sim
          bestCluster = cluster
        }
      }

      if (bestSim > 0.85 && bestCluster && bestCluster.length < maxSize) {
        bestCluster.push(articleId)
        clusteredArticleIds.add(articleId)
        orphansAssigned++
      }
    }

    console.log(`[EntityClustering] Assigned ${orphansAssigned} orphan articles`)

    // Step 6b: Drop articles published weeks away from the rest of their cluster.
    // After orphan assignment, since that matches on embeddings alone and is
    // where most of these come from.
    let outliersDropped = 0
    for (let i = 0; i < finalClusters.length; i++) {
      const pruned = pruneTemporalOutliers(finalClusters[i], articleMap)
      outliersDropped += finalClusters[i].length - pruned.length
      finalClusters[i] = pruned
    }
    console.log(`[EntityClustering] Dropped ${outliersDropped} temporal outlier articles`)

    // Step 7: Write clusters, keeping the ID of any story a cluster continues
    const written = await writeClusters(finalClusters, articleMap, idfMap, dryRun)
    const groupsCreated = finalClusters.length
    const articlesGrouped = written.articlesGrouped

    console.log(`[EntityClustering] Complete${dryRun ? ' (dry run, nothing written)' : ''}: ${groupsCreated} stories (${written.kept} kept ID, ${written.created} new, ${written.removed} removed, ${written.redirected} redirected), ${articlesGrouped} articles grouped, ${orphansAssigned} orphans assigned`)

    return {
      success: true,
      groupsCreated,
      articlesGrouped,
      orphansAssigned,
      candidatePairs: candidatePairs.size,
      storiesKept: written.kept,
      storiesRemoved: written.removed,
    }
  } catch (error) {
    console.error('[EntityClustering] Error:', error)
    return {
      success: false,
      groupsCreated: 0,
      articlesGrouped: 0,
      orphansAssigned: 0,
      candidatePairs: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
