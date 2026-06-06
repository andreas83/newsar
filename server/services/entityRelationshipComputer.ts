/**
 * Entity Relationship Computer - Computes entity-to-entity relationships for network graphs
 *
 * Analyzes co-occurrence patterns, sentiment correlation, and temporal dynamics
 * for OSINT network analysis.
 */

import { getDatabase } from '../database/db'
import {
  entities,
  articleEntities,
  entityRelationships,
  articles,
  analyses
} from '../database/schema'
import { eq, and, sql, inArray, gte } from 'drizzle-orm'

// Lazy initialization to ensure env vars are loaded first
let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) {
    db = getDatabase()
  }
  return db
}

interface EntityPair {
  sourceEntityId: number
  targetEntityId: number
  articleId: number
  publishedAt: Date | null
  sourceRelevance: number
  targetRelevance: number
  sourceSentiment: string | null
  targetSentiment: string | null
  articleSentiment: number | null
}

interface RelationshipData {
  sourceEntityId: number
  targetEntityId: number
  cooccurrenceCount: number
  strength: number
  sentimentCorrelation: number | null
  firstCooccurrence: Date
  lastCooccurrence: Date
  sharedArticles: Array<{
    article_id: number
    published_at: string | null
    relevance_scores: { source: number; target: number }
  }>
  temporalPattern: {
    daily_counts: Array<{ date: string; count: number }>
    velocity_trend: string
  }
}

/**
 * Compute entity relationships for all entities or a specific date range
 */
export async function computeEntityRelationships(options: {
  entityIds?: number[]
  fromDate?: Date
  limit?: number
  minCooccurrence?: number
}): Promise<number> {
  const { entityIds, fromDate, limit, minCooccurrence = 2 } = options

  console.log('🔗 Computing entity relationships...', {
    entityIds: entityIds?.length || 'all',
    fromDate: fromDate?.toISOString() || 'all time',
    minCooccurrence
  })

  // Find all entity pairs that co-occur in articles
  const entityPairs = await findEntityPairs({ entityIds, fromDate, limit })

  if (entityPairs.length === 0) {
    console.log('No entity pairs found')
    return 0
  }

  console.log(`Found ${entityPairs.length} entity co-occurrences`)

  // Group by entity pair and compute relationships
  const relationshipMap = new Map<string, EntityPair[]>()

  for (const pair of entityPairs) {
    // Always use smaller ID as source for consistency (undirected graph)
    const [sourceId, targetId] = [pair.sourceEntityId, pair.targetEntityId].sort((a, b) => a - b)
    const key = `${sourceId}-${targetId}`

    if (!relationshipMap.has(key)) {
      relationshipMap.set(key, [])
    }

    relationshipMap.get(key)!.push({
      ...pair,
      sourceEntityId: sourceId,
      targetEntityId: targetId
    })
  }

  // Filter out pairs with insufficient co-occurrence
  const significantPairs = Array.from(relationshipMap.entries())
    .filter(([_, pairs]) => pairs.length >= minCooccurrence)

  console.log(`${significantPairs.length} significant relationships (>= ${minCooccurrence} co-occurrences)`)

  // Compute and upsert relationships
  let upsertCount = 0

  for (const [key, pairs] of significantPairs) {
    const relationshipData = computeRelationshipMetrics(pairs)

    try {
      await upsertEntityRelationship(relationshipData)
      upsertCount++

      if (upsertCount % 100 === 0) {
        console.log(`Processed ${upsertCount}/${significantPairs.length} relationships`)
      }
    } catch (error) {
      console.error(`Error upserting relationship ${key}:`, error)
    }
  }

  console.log(`✅ Computed ${upsertCount} entity relationships`)
  return upsertCount
}

/**
 * Find entity pairs that appear together in articles
 */
async function findEntityPairs(options: {
  entityIds?: number[]
  fromDate?: Date
  limit?: number
}): Promise<EntityPair[]> {
  const { entityIds, fromDate, limit } = options

  // Build query to find all pairs of entities in the same article
  const result = await getDb().execute(sql`
    SELECT
      ae1.entity_id as source_entity_id,
      ae2.entity_id as target_entity_id,
      ae1.article_id,
      a.published_at,
      ae1.relevance_score as source_relevance,
      ae2.relevance_score as target_relevance,
      ae1.sentiment as source_sentiment,
      ae2.sentiment as target_sentiment,
      an.sentiment as article_sentiment
    FROM article_entities ae1
    INNER JOIN article_entities ae2
      ON ae1.article_id = ae2.article_id
      AND ae1.entity_id < ae2.entity_id
    INNER JOIN articles a ON ae1.article_id = a.id
    LEFT JOIN analyses an ON a.id = an.article_id
    WHERE 1=1
      ${entityIds ? sql`AND (ae1.entity_id = ANY(${entityIds}) OR ae2.entity_id = ANY(${entityIds}))` : sql``}
      ${fromDate ? sql`AND a.published_at >= ${fromDate}` : sql``}
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `)

  return result.rows.map((row: any) => ({
    sourceEntityId: parseInt(row.source_entity_id),
    targetEntityId: parseInt(row.target_entity_id),
    articleId: parseInt(row.article_id),
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    sourceRelevance: parseFloat(row.source_relevance),
    targetRelevance: parseFloat(row.target_relevance),
    sourceSentiment: row.source_sentiment,
    targetSentiment: row.target_sentiment,
    articleSentiment: row.article_sentiment ? parseFloat(row.article_sentiment) : null,
  }))
}

/**
 * Compute relationship metrics from entity pairs
 */
function computeRelationshipMetrics(pairs: EntityPair[]): RelationshipData {
  const sorted = pairs.sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return dateA - dateB
  })

  const firstPair = sorted[0]
  const lastPair = sorted[sorted.length - 1]

  // Compute strength (normalized by relevance scores)
  const totalRelevance = pairs.reduce((sum, p) => sum + (p.sourceRelevance + p.targetRelevance) / 2, 0)
  const avgRelevance = totalRelevance / pairs.length
  const strength = Math.min(1, avgRelevance * Math.log10(pairs.length + 1))

  // Compute sentiment correlation
  const sentimentCorrelation = computeSentimentCorrelation(pairs)

  // Build temporal pattern
  const temporalPattern = buildTemporalPattern(pairs)

  // Build shared articles list
  const sharedArticles = pairs.map(p => ({
    article_id: p.articleId,
    published_at: p.publishedAt?.toISOString() || null,
    relevance_scores: {
      source: p.sourceRelevance,
      target: p.targetRelevance
    }
  }))

  return {
    sourceEntityId: firstPair.sourceEntityId,
    targetEntityId: firstPair.targetEntityId,
    cooccurrenceCount: pairs.length,
    strength,
    sentimentCorrelation,
    firstCooccurrence: firstPair.publishedAt || new Date(),
    lastCooccurrence: lastPair.publishedAt || new Date(),
    sharedArticles,
    temporalPattern
  }
}

/**
 * Compute sentiment correlation between entities
 * Returns -1 to 1 correlation score
 */
function computeSentimentCorrelation(pairs: EntityPair[]): number | null {
  // Convert sentiment strings to numeric values
  const sentimentToValue = (s: string | null): number | null => {
    if (!s) return null
    if (s === 'positive') return 1
    if (s === 'negative') return -1
    return 0 // neutral
  }

  const validPairs = pairs.filter(p => p.sourceSentiment && p.targetSentiment)

  if (validPairs.length < 2) return null

  const sourceValues = validPairs.map(p => sentimentToValue(p.sourceSentiment)!)
  const targetValues = validPairs.map(p => sentimentToValue(p.targetSentiment)!)

  // Calculate Pearson correlation coefficient
  const n = validPairs.length
  const sumSource = sourceValues.reduce((a, b) => a + b, 0)
  const sumTarget = targetValues.reduce((a, b) => a + b, 0)
  const sumSourceSq = sourceValues.reduce((a, b) => a + b * b, 0)
  const sumTargetSq = targetValues.reduce((a, b) => a + b * b, 0)
  const sumProduct = sourceValues.reduce((a, b, i) => a + b * targetValues[i], 0)

  const numerator = n * sumProduct - sumSource * sumTarget
  const denominator = Math.sqrt(
    (n * sumSourceSq - sumSource * sumSource) *
    (n * sumTargetSq - sumTarget * sumTarget)
  )

  if (denominator === 0) return 0

  return numerator / denominator
}

/**
 * Build temporal pattern showing relationship evolution over time
 */
function buildTemporalPattern(pairs: EntityPair[]): {
  daily_counts: Array<{ date: string; count: number }>
  velocity_trend: string
} {
  // Group by date
  const dateCounts = new Map<string, number>()

  for (const pair of pairs) {
    if (!pair.publishedAt) continue
    const dateStr = pair.publishedAt.toISOString().split('T')[0]
    dateCounts.set(dateStr, (dateCounts.get(dateStr) || 0) + 1)
  }

  const daily_counts = Array.from(dateCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Compute velocity trend
  let velocity_trend = 'stable'
  if (daily_counts.length >= 2) {
    const firstHalf = daily_counts.slice(0, Math.floor(daily_counts.length / 2))
    const secondHalf = daily_counts.slice(Math.floor(daily_counts.length / 2))

    const firstAvg = firstHalf.reduce((sum, d) => sum + d.count, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((sum, d) => sum + d.count, 0) / secondHalf.length

    if (secondAvg > firstAvg * 1.5) velocity_trend = 'increasing'
    else if (secondAvg < firstAvg * 0.5) velocity_trend = 'decreasing'
  }

  return { daily_counts, velocity_trend }
}

/**
 * Upsert entity relationship to database
 */
async function upsertEntityRelationship(data: RelationshipData): Promise<void> {
  // Check if relationship exists
  const existing = await getDb()
    .select()
    .from(entityRelationships)
    .where(
      and(
        eq(entityRelationships.sourceEntityId, data.sourceEntityId),
        eq(entityRelationships.targetEntityId, data.targetEntityId)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    // Update existing
    await getDb()
      .update(entityRelationships)
      .set({
        cooccurrenceCount: data.cooccurrenceCount,
        strength: data.strength,
        sentimentCorrelation: data.sentimentCorrelation,
        lastCooccurrence: data.lastCooccurrence,
        sharedArticles: data.sharedArticles as any,
        temporalPattern: data.temporalPattern as any,
        updatedAt: new Date(),
      })
      .where(eq(entityRelationships.id, existing[0].id))
  } else {
    // Insert new
    await getDb()
      .insert(entityRelationships)
      .values({
        sourceEntityId: data.sourceEntityId,
        targetEntityId: data.targetEntityId,
        cooccurrenceCount: data.cooccurrenceCount,
        strength: data.strength,
        sentimentCorrelation: data.sentimentCorrelation,
        firstCooccurrence: data.firstCooccurrence,
        lastCooccurrence: data.lastCooccurrence,
        sharedArticles: data.sharedArticles as any,
        temporalPattern: data.temporalPattern as any,
      })
  }
}

/**
 * Get entity network graph data for visualization
 */
export async function getEntityNetworkGraph(options: {
  entityIds?: number[]
  minStrength?: number
  fromDate?: Date
  toDate?: Date
  limit?: number
}): Promise<{
  nodes: Array<{
    id: number
    name: string
    type: string
    slug: string | null
    trendingScore: number
    shortDescription: string | null
    imageUrl: string | null
  }>
  edges: Array<{
    source: number
    target: number
    weight: number
    cooccurrenceCount: number
    sentimentCorrelation: number | null
    lastSeen: Date
  }>
}> {
  const { entityIds, minStrength = 0.1, fromDate, toDate, limit = 500 } = options

  // Build query for relationships
  const conditions = [
    sql`er.strength >= ${minStrength}`
  ]

  if (entityIds && entityIds.length > 0) {
    const idList = sql.join(entityIds.map(id => sql`${id}`), sql`, `)
    conditions.push(
      sql`(er.source_entity_id IN (${idList}) OR er.target_entity_id IN (${idList}))`
    )
  }

  if (fromDate) {
    conditions.push(sql`er.last_co_occurrence >= ${fromDate}`)
  }

  if (toDate) {
    conditions.push(sql`er.last_co_occurrence <= ${toDate}`)
  }

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``

  // Fetch relationships with entity details
  const result = await getDb().execute(sql`
    SELECT
      er.source_entity_id,
      er.target_entity_id,
      er.strength,
      er.cooccurrence_count,
      er.sentiment_correlation,
      er.last_co_occurrence,
      e1.id as source_id,
      e1.name as source_name,
      e1.type as source_type,
      e1.slug as source_slug,
      e2.id as target_id,
      e2.name as target_name,
      e2.type as target_type,
      e2.slug as target_slug,
      COALESCE(es1.trending_score, 0) as source_trending,
      COALESCE(es2.trending_score, 0) as target_trending,
      es1.short_description as source_short_description,
      es1.image_url as source_image_url,
      es2.short_description as target_short_description,
      es2.image_url as target_image_url
    FROM entity_relationships er
    INNER JOIN entities e1 ON er.source_entity_id = e1.id
    INNER JOIN entities e2 ON er.target_entity_id = e2.id
    LEFT JOIN entity_summaries es1 ON e1.id = es1.entity_id
    LEFT JOIN entity_summaries es2 ON e2.id = es2.entity_id
    ${whereClause}
    ORDER BY er.strength DESC
    LIMIT ${limit}
  `)

  // Build nodes map
  const nodesMap = new Map<number, any>()
  const edges: any[] = []

  for (const row of result.rows as any[]) {
    // Add source node
    if (!nodesMap.has(row.source_id)) {
      nodesMap.set(row.source_id, {
        id: row.source_id,
        name: row.source_name,
        type: row.source_type,
        slug: row.source_slug,
        trendingScore: parseFloat(row.source_trending) || 0,
        shortDescription: row.source_short_description || null,
        imageUrl: row.source_image_url || null,
      })
    }

    // Add target node
    if (!nodesMap.has(row.target_id)) {
      nodesMap.set(row.target_id, {
        id: row.target_id,
        name: row.target_name,
        type: row.target_type,
        slug: row.target_slug,
        trendingScore: parseFloat(row.target_trending) || 0,
        shortDescription: row.target_short_description || null,
        imageUrl: row.target_image_url || null,
      })
    }

    // Add edge
    edges.push({
      source: row.source_entity_id,
      target: row.target_entity_id,
      weight: parseFloat(row.strength),
      cooccurrenceCount: parseInt(row.cooccurrence_count),
      sentimentCorrelation: row.sentiment_correlation ? parseFloat(row.sentiment_correlation) : null,
      lastSeen: new Date(row.last_co_occurrence)
    })
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges
  }
}
