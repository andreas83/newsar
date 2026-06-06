import { getDatabase } from '../../database/db.js'
import { entities, entitySummaries, articleEntities, articles } from '../../database/schema.js'
import { eq, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const entityId = parseInt(query.id as string)

  if (!entityId || isNaN(entityId)) {
    throw createError({
      statusCode: 400,
      message: 'Entity ID is required and must be a number'
    })
  }

  const db = getDatabase()

  try {
    // Get entity with summary (lightweight for hover preview)
    const [entity] = await db
      .select({
        id: entities.id,
        type: entities.type,
        name: entities.name,
        slug: entities.slug,
        // Summary fields
        shortDescription: entitySummaries.shortDescription,
        imageUrl: entitySummaries.imageUrl,
        wikiUrl: entitySummaries.wikiUrl,
        mentionCount: entitySummaries.mentionCount,
        trendingScore: entitySummaries.trendingScore,
      })
      .from(entities)
      .leftJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
      .where(eq(entities.id, entityId))
      .limit(1)

    if (!entity) {
      throw createError({
        statusCode: 404,
        message: 'Entity not found'
      })
    }

    // Get quick stats
    const statsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '7 days') as mentions_7d,
        COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '24 hours') as mentions_24h
      FROM article_entities ae
      INNER JOIN articles a ON ae.article_id = a.id
      WHERE ae.entity_id = ${entityId}
    `)

    const stats = statsResult.rows[0] as any

    // Get 3 most recent articles (for preview)
    const recentArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        publishedAt: articles.publishedAt,
      })
      .from(articleEntities)
      .innerJoin(articles, eq(articleEntities.articleId, articles.id))
      .where(eq(articleEntities.entityId, entityId))
      .orderBy(desc(articles.publishedAt))
      .limit(3)

    return {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      slug: entity.slug,
      shortDescription: entity.shortDescription,
      imageUrl: entity.imageUrl,
      wikiUrl: entity.wikiUrl,
      stats: {
        totalMentions: entity.mentionCount || 0,
        mentions7d: stats?.mentions_7d || 0,
        mentions24h: stats?.mentions_24h || 0,
        trendingScore: entity.trendingScore || 0,
      },
      recentArticles: recentArticles.map(a => ({
        id: a.id,
        title: a.title,
        publishedAt: a.publishedAt,
      }))
    }
  } catch (error) {
    console.error(`Error fetching entity preview for ID ${entityId}:`, error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch entity preview'
    })
  }
})
