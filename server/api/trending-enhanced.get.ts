import { getDatabase } from '../database/db'
import { keywords, articles, topicRelationships } from '../database/schema'
import { eq, sql, desc, and, gte, inArray, or } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)
  const limit = parseInt(query.limit as string) || 30
  const includeRelationships = query.relationships !== 'false'

  try {
    // Get trending keywords from recent articles (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Use Drizzle (same as original trending API) - it works!
    const trendingKeywords = await db
      .select({
        id: sql<number>`MIN(${keywords.id})`,
        keyword: keywords.keyword,
        category: keywords.category,
        count: sql<number>`COUNT(DISTINCT ${keywords.articleId})`,
        avgRelevance: sql<number>`AVG(${keywords.relevanceScore})`,
      })
      .from(keywords)
      .innerJoin(articles, eq(keywords.articleId, articles.id))
      .where(gte(articles.publishedAt, sevenDaysAgo))
      .groupBy(keywords.keyword, keywords.category)
      .orderBy(desc(sql`COUNT(DISTINCT ${keywords.articleId})`))
      .limit(limit)

    // Calculate bubble sizes based on count and relevance
    const maxCount = Math.max(...trendingKeywords.map((k) => Number(k.count)), 1)

    const bubbles = trendingKeywords.map((item) => {
      const count = Number(item.count)
      const avgRelevance = Number(item.avgRelevance)

      // Size calculation: normalize count (1-10 scale) and boost by relevance
      const normalizedCount = (count / maxCount) * 8 + 2
      const size = Math.round(normalizedCount * (0.8 + avgRelevance * 0.4))

      return {
        id: Number(item.id),
        keyword: item.keyword,
        category: item.category,
        count,
        size: Math.min(size, 10), // Cap at 10
        relevance: Math.round(avgRelevance * 100) / 100,
      }
    })

    // Get relationships between trending keywords
    let relationships: Array<{
      sourceId: number
      sourceKeyword: string
      targetId: number
      targetKeyword: string
      type: string
      strength: number
    }> = []

    if (includeRelationships && bubbles.length > 0) {
      const keywordIds = bubbles.map((b) => b.id)

      // Use Drizzle with inArray - simpler and works better
      try {
        const relData = await db
          .select({
            sourceId: topicRelationships.sourceId,
            targetId: topicRelationships.targetId,
            relationType: topicRelationships.relationshipType,
            strength: topicRelationships.strength,
          })
          .from(topicRelationships)
          .where(
            and(
              eq(topicRelationships.sourceType, 'keyword'),
              eq(topicRelationships.targetType, 'keyword'),
              inArray(topicRelationships.sourceId, keywordIds),
              inArray(topicRelationships.targetId, keywordIds),
              or(
                eq(topicRelationships.relationshipType, 'co_occurrence'),
                eq(topicRelationships.relationshipType, 'synonym'),
                eq(topicRelationships.relationshipType, 'related')
              )
            )
          )

        // Map relationships with keyword names
        relationships = relData
          .map((rel) => {
            const sourceBubble = bubbles.find((b) => b.id === rel.sourceId)
            const targetBubble = bubbles.find((b) => b.id === rel.targetId)

            if (!sourceBubble || !targetBubble) return null

            return {
              sourceId: rel.sourceId,
              sourceKeyword: sourceBubble.keyword,
              targetId: rel.targetId,
              targetKeyword: targetBubble.keyword,
              type: rel.relationType,
              strength: Number(rel.strength),
            }
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
      } catch (relError) {
        console.error('Error fetching relationships (continuing without them):', relError)
        // Continue without relationships rather than failing
      }
    }

    // Calculate clustering positions using force-directed layout
    const positions = calculateClusteredPositions(bubbles, relationships)

    return {
      bubbles: bubbles.map((b, i) => ({
        ...b,
        position: positions[i],
      })),
      relationships,
      timestamp: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error('Error fetching enhanced trending keywords:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch enhanced trending keywords',
    })
  }
})

/**
 * Calculate positions for bubbles using force-directed layout
 * Related bubbles are positioned closer together
 */
function calculateClusteredPositions(
  bubbles: Array<{ id: number; size: number }>,
  relationships: Array<{ sourceId: number; targetId: number; strength: number }>
): Array<{ x: number; y: number }> {
  const n = bubbles.length
  if (n === 0) return []

  // Initialize random positions
  const positions = bubbles.map(() => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
  }))

  // Build adjacency map for faster lookups
  const adjacency = new Map<number, Array<{ targetId: number; strength: number }>>()
  for (const rel of relationships) {
    if (!adjacency.has(rel.sourceId)) {
      adjacency.set(rel.sourceId, [])
    }
    adjacency.get(rel.sourceId)!.push({ targetId: rel.targetId, strength: rel.strength })
  }

  // Simple force-directed layout (50 iterations)
  const iterations = 50
  const repulsionStrength = 800
  const attractionStrength = 0.1

  for (let iter = 0; iter < iterations; iter++) {
    const forces = positions.map(() => ({ x: 0, y: 0 }))

    // Repulsion between all bubbles (prevent overlap)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = positions[j].x - positions[i].x
        const dy = positions[j].y - positions[i].y
        const distSq = dx * dx + dy * dy + 0.1
        const dist = Math.sqrt(distSq)

        // Size-based repulsion
        const repulsion = (repulsionStrength * (bubbles[i].size + bubbles[j].size)) / distSq

        forces[i].x -= (dx / dist) * repulsion
        forces[i].y -= (dy / dist) * repulsion
        forces[j].x += (dx / dist) * repulsion
        forces[j].y += (dy / dist) * repulsion
      }
    }

    // Attraction between related bubbles
    for (let i = 0; i < n; i++) {
      const bubble = bubbles[i]
      const neighbors = adjacency.get(bubble.id) || []

      for (const neighbor of neighbors) {
        const j = bubbles.findIndex((b) => b.id === neighbor.targetId)
        if (j === -1) continue

        const dx = positions[j].x - positions[i].x
        const dy = positions[j].y - positions[i].y

        // Stronger attraction for stronger relationships
        const attraction = attractionStrength * neighbor.strength

        forces[i].x += dx * attraction
        forces[i].y += dy * attraction
      }
    }

    // Apply forces
    for (let i = 0; i < n; i++) {
      positions[i].x += forces[i].x * 0.1
      positions[i].y += forces[i].y * 0.1

      // Keep within bounds
      positions[i].x = Math.max(5, Math.min(95, positions[i].x))
      positions[i].y = Math.max(5, Math.min(95, positions[i].y))
    }
  }

  return positions
}
