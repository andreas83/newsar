import { getDatabase } from '../../database/db.js'
import { entities, entitySummaries, articleEntities } from '../../database/schema.js'
import { eq, sql, desc, asc, and, ilike, gte } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = query.type as string
  const subtype = (query.subtype as string || '').trim() || undefined
  const search = (query.search as string || '').trim()
  const sort = (query.sort as string) || 'mentions'
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const limit = Math.min(Math.max(1, parseInt(query.limit as string) || 50), 100)

  // Validate entity type
  const validTypes = ['person', 'organization', 'location', 'event', 'topic']
  if (!type || !validTypes.includes(type)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid or missing entity type. Must be one of: person, organization, location, event, topic'
    })
  }

  // Validate sort
  const validSorts = ['mentions', 'trending', 'name']
  if (!validSorts.includes(sort)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid sort. Must be one of: mentions, trending, name'
    })
  }

  const db = getDatabase()
  const offset = (page - 1) * limit

  try {
    // Minimum mentions threshold for visibility (3+)
    const minMentions = Math.max(1, parseInt(query.minMentions as string) || 3)

    // Build WHERE conditions
    const conditions = [eq(entities.type, type)]
    if (subtype) {
      conditions.push(eq(entities.subtype, subtype))
    }
    if (search) {
      conditions.push(ilike(entities.name, `%${search}%`))
    }
    // Only show entities with at least minMentions article links
    conditions.push(sql`${entities.id} IN (
      SELECT entity_id FROM article_entities
      GROUP BY entity_id HAVING COUNT(*) >= ${minMentions}
    )`)

    const whereClause = and(...conditions)

    // Count total matching entities
    const countResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(entities)
      .where(whereClause)

    const total = Number(countResult[0]?.count) || 0
    const totalPages = Math.ceil(total / limit)

    // Build ORDER BY
    let orderBy
    switch (sort) {
      case 'trending':
        orderBy = [desc(sql`COALESCE(${entitySummaries.trendingScore}, 0)`), desc(sql`COALESCE(${entitySummaries.mentionCount}, 0)`)]
        break
      case 'name':
        orderBy = [asc(entities.name)]
        break
      case 'mentions':
      default:
        orderBy = [desc(sql`COALESCE(${entitySummaries.mentionCount}, 0)`), desc(sql`COALESCE(${entitySummaries.trendingScore}, 0)`)]
        break
    }

    // Fetch entities with LEFT JOIN on summaries
    const results = await db
      .select({
        id: entities.id,
        type: entities.type,
        subtype: entities.subtype,
        name: entities.name,
        slug: entities.slug,
        shortDescription: entitySummaries.shortDescription,
        imageUrl: entitySummaries.imageUrl,
        mentionCount: entitySummaries.mentionCount,
        trendingScore: entitySummaries.trendingScore,
      })
      .from(entities)
      .leftJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset)

    return {
      entities: results.map(e => ({
        id: e.id,
        type: e.type,
        subtype: e.subtype || null,
        name: e.name,
        slug: e.slug,
        shortDescription: e.shortDescription || null,
        imageUrl: e.imageUrl || null,
        mentionCount: e.mentionCount || 0,
        trendingScore: e.trendingScore || 0,
      })),
      meta: {
        total,
        totalPages,
        page,
        limit,
        type,
        subtype: subtype || null,
        search: search || null,
        sort,
      }
    }
  } catch (error) {
    console.error('Error browsing entities:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to browse entities'
    })
  }
})
