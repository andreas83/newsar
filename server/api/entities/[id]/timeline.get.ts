import { getDatabase } from '../../../database/db.js'
import { entitySummaryHistory, entities } from '../../../database/schema.js'
import { eq, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const entityId = parseInt(getRouterParam(event, 'id') || '')

  if (!entityId || isNaN(entityId)) {
    throw createError({
      statusCode: 400,
      message: 'Valid entity ID is required'
    })
  }

  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 20, 50)
  const offset = parseInt(query.offset as string) || 0

  const db = getDatabase()

  // Verify entity exists and get name
  const [entity] = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1)

  if (!entity) {
    throw createError({
      statusCode: 404,
      message: 'Entity not found'
    })
  }

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(entitySummaryHistory)
    .where(eq(entitySummaryHistory.entityId, entityId))

  // Get paginated history entries
  const entries = await db
    .select()
    .from(entitySummaryHistory)
    .where(eq(entitySummaryHistory.entityId, entityId))
    .orderBy(desc(entitySummaryHistory.generatedAt))
    .limit(limit)
    .offset(offset)

  return {
    entityId,
    entityName: entity.name,
    entries: entries.map(e => ({
      id: e.id,
      changeNote: e.changeNote,
      summary: e.summary,
      shortDescription: e.shortDescription,
      mentionCount: e.mentionCount,
      trendingScore: e.trendingScore,
      articleContext: e.articleContext,
      generatedAt: e.generatedAt,
      archivedAt: e.archivedAt,
    })),
    pagination: {
      total: count,
      limit,
      offset,
      hasMore: offset + limit < count,
    }
  }
})
