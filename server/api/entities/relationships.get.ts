/**
 * GET /api/entities/relationships
 *
 * Returns entities related to a given entity, optionally filtered by type.
 * Uses article co-occurrence data to find associations.
 *
 * Query params:
 *   - entityId: the entity to find relationships for (required)
 *   - relatedType: filter related entities by type (person, organization, location, event)
 *   - limit: max number of results (default 20, max 50)
 *
 * Returns: { relationships: Array<{ id, type, name, slug, coOccurrenceCount, avgSentiment, shortDescription, imageUrl }> }
 */

import { getDatabase } from '../../database/db'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const entityId = query.entityId ? parseInt(query.entityId as string) : undefined
  const relatedType = query.relatedType as string | undefined
  const limit = Math.min(query.limit ? parseInt(query.limit as string) : 20, 50)

  if (!entityId) {
    throw createError({
      statusCode: 400,
      message: 'entityId query parameter is required',
    })
  }

  const validTypes = ['person', 'organization', 'location', 'event', 'topic']
  if (relatedType && !validTypes.includes(relatedType)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid relatedType. Must be one of: person, organization, location, event, topic',
    })
  }

  const db = getDatabase()

  try {
    // Find entities that co-occur in the same articles as the given entity,
    // optionally filtered by type, ranked by co-occurrence count
    const typeFilter = relatedType
      ? sql`AND e.type = ${relatedType}`
      : sql``

    const result = await db.execute(sql`
      SELECT
        e.id,
        e.type,
        e.subtype,
        e.name,
        e.slug,
        es.short_description,
        es.image_url,
        es.trending_score,
        COUNT(DISTINCT ae2.article_id) as co_occurrence_count,
        ROUND(AVG(CASE WHEN ae2.sentiment = 'positive' THEN 1 WHEN ae2.sentiment = 'negative' THEN -1 ELSE 0 END)::numeric, 2) as avg_sentiment
      FROM article_entities ae1
      INNER JOIN article_entities ae2 ON ae1.article_id = ae2.article_id
      INNER JOIN entities e ON ae2.entity_id = e.id
      LEFT JOIN entity_summaries es ON e.id = es.entity_id
      WHERE ae1.entity_id = ${entityId}
        AND ae2.entity_id != ${entityId}
        ${typeFilter}
      GROUP BY e.id, e.type, e.subtype, e.name, e.slug, es.short_description, es.image_url, es.trending_score
      ORDER BY co_occurrence_count DESC, es.trending_score DESC NULLS LAST
      LIMIT ${limit}
    `)

    const relationships = result.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      subtype: r.subtype || null,
      name: r.name,
      slug: r.slug,
      coOccurrenceCount: parseInt(r.co_occurrence_count) || 0,
      avgSentiment: parseFloat(r.avg_sentiment) || 0,
      shortDescription: r.short_description || null,
      imageUrl: r.image_url || null,
      trendingScore: r.trending_score || 0,
    }))

    return { relationships }
  } catch (error) {
    console.error(`[EntityRelationships] Error fetching relationships for entity ${entityId}:`, error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch entity relationships',
    })
  }
})
