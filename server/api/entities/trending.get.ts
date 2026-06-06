import { getDatabase } from '../../database/db.js'
import { entities, entitySummaries } from '../../database/schema.js'
import { eq, desc, and, gte, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = query.type as string | undefined
  const subtype = (query.subtype as string || '').trim() || undefined
  const limit = Math.min(parseInt(query.limit as string) || 50, 100)

  // Validate entity type if provided
  const validTypes = ['person', 'organization', 'location', 'event', 'topic']
  if (type && !validTypes.includes(type)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid entity type. Must be one of: person, organization, location, event, topic'
    })
  }

  const db = getDatabase()

  try {
    // Get trending entities with summaries
    // Trending score is calculated in entitySummarizer.updateEntityTrendingScores()
    const conditions = []

    if (type) {
      conditions.push(eq(entities.type, type))
    }
    if (subtype) {
      conditions.push(eq(entities.subtype, subtype))
    }

    // Only include entities with at least 3 mentions (visibility threshold)
    conditions.push(gte(entitySummaries.mentionCount, 3))

    const trendingEntities = await db
      .select({
        id: entities.id,
        type: entities.type,
        subtype: entities.subtype,
        name: entities.name,
        canonicalName: entities.canonicalName,
        slug: entities.slug,
        // Summary fields
        shortDescription: entitySummaries.shortDescription,
        imageUrl: entitySummaries.imageUrl,
        mentionCount: entitySummaries.mentionCount,
        trendingScore: entitySummaries.trendingScore,
        lastUpdated: entitySummaries.lastUpdated,
      })
      .from(entities)
      .innerJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(entitySummaries.trendingScore), desc(entitySummaries.mentionCount))
      .limit(limit)

    return {
      entities: trendingEntities.map(e => ({
        id: e.id,
        type: e.type,
        subtype: e.subtype || null,
        name: e.name,
        canonicalName: e.canonicalName,
        slug: e.slug,
        shortDescription: e.shortDescription,
        imageUrl: e.imageUrl,
        mentionCount: e.mentionCount,
        trendingScore: e.trendingScore,
        lastUpdated: e.lastUpdated,
      })),
      meta: {
        total: trendingEntities.length,
        limit,
        type: type || 'all',
      }
    }
  } catch (error) {
    console.error('Error fetching trending entities:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch trending entities'
    })
  }
})
