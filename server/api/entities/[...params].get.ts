import { getDatabase } from '../../database/db.js'
import { entities, entitySummaries, entitySummaryHistory, articleEntities, articles, storyMembers, stories } from '../../database/schema.js'
import { eq, desc, and, ne, sql } from 'drizzle-orm'
import { getStockDataForEntity } from '../../services/stockEntityMapper.js'

export default defineEventHandler(async (event) => {
  const params = getRouterParam(event, 'params')

  // Parse params: expecting format ["type", "slug"]
  const pathParts = params ? params.split('/') : []

  if (pathParts.length !== 2) {
    throw createError({
      statusCode: 400,
      message: 'Invalid URL format. Expected: /api/entities/[type]/[slug]'
    })
  }

  const [type, slug] = pathParts

  // Validate entity type
  const validTypes = ['person', 'organization', 'location', 'event', 'topic']
  if (!type || !validTypes.includes(type)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid entity type. Must be one of: person, organization, location, event, topic'
    })
  }

  if (!slug) {
    throw createError({
      statusCode: 400,
      message: 'Entity slug is required'
    })
  }

  const db = getDatabase()

  try {
    // Get entity with summary
    const [entity] = await db
      .select({
        id: entities.id,
        type: entities.type,
        subtype: entities.subtype,
        name: entities.name,
        canonicalName: entities.canonicalName,
        slug: entities.slug,
        metadata: entities.metadata,
        createdAt: entities.createdAt,
        // Summary fields
        summary: entitySummaries.summary,
        shortDescription: entitySummaries.shortDescription,
        imageUrl: entitySummaries.imageUrl,
        wikiUrl: entitySummaries.wikiUrl,
        mentionCount: entitySummaries.mentionCount,
        trendingScore: entitySummaries.trendingScore,
        lastUpdated: entitySummaries.lastUpdated,
      })
      .from(entities)
      .leftJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
      .where(and(
        eq(entities.type, type),
        eq(entities.slug, slug)
      ))
      .limit(1)

    if (!entity) {
      throw createError({
        statusCode: 404,
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} not found`
      })
    }

    // Get recent articles mentioning this entity (last 10)
    const recentArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        publishedAt: articles.publishedAt,
        imageUrl: articles.imageUrl,
        feedName: sql<string>`NULL`, // Will be joined later if needed
        storyId: storyMembers.storyId,
        storyStatus: stories.status,
        // Entity-specific fields
        relevanceScore: articleEntities.relevanceScore,
        sentiment: articleEntities.sentiment,
      })
      .from(articleEntities)
      .innerJoin(articles, eq(articleEntities.articleId, articles.id))
      .leftJoin(storyMembers, eq(articles.id, storyMembers.articleId))
      .leftJoin(stories, eq(storyMembers.storyId, stories.id))
      .where(eq(articleEntities.entityId, entity.id))
      .orderBy(desc(articles.publishedAt))
      .limit(10)

    // Get related entities (entities that co-occur in the same articles)
    const relatedEntitiesRaw = await db.execute(sql`
      SELECT
        e.id,
        e.type,
        e.subtype,
        e.name,
        e.slug,
        es.short_description,
        es.mention_count,
        es.trending_score,
        COUNT(DISTINCT ae2.article_id) as co_occurrence_count
      FROM article_entities ae1
      INNER JOIN article_entities ae2 ON ae1.article_id = ae2.article_id
      INNER JOIN entities e ON ae2.entity_id = e.id
      LEFT JOIN entity_summaries es ON e.id = es.entity_id
      WHERE ae1.entity_id = ${entity.id}
        AND ae2.entity_id != ${entity.id}
      GROUP BY e.id, e.type, e.subtype, e.name, e.slug, es.short_description, es.mention_count, es.trending_score
      ORDER BY co_occurrence_count DESC, es.mention_count DESC
      LIMIT 10
    `)

    // Get mention velocity (last 7 days vs previous 7 days)
    const velocityResult = await db.execute(sql`
      WITH mention_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '7 days') as mentions_last_7d,
          COUNT(*) FILTER (WHERE a.published_at >= NOW() - INTERVAL '14 days'
                           AND a.published_at < NOW() - INTERVAL '7 days') as mentions_prev_7d
        FROM article_entities ae
        INNER JOIN articles a ON ae.article_id = a.id
        WHERE ae.entity_id = ${entity.id}
      )
      SELECT
        mentions_last_7d,
        mentions_prev_7d,
        CASE
          WHEN mentions_prev_7d > 0
          THEN ((mentions_last_7d::float - mentions_prev_7d::float) / mentions_prev_7d::float * 100)
          ELSE 0
        END as velocity_change_percent
      FROM mention_stats
    `)

    const velocity = velocityResult.rows[0] as any

    // Get summary history count for timeline feature
    const [historyCountResult] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(entitySummaryHistory)
      .where(eq(entitySummaryHistory.entityId, entity.id))

    const historyCount = historyCountResult?.count || 0

    // Get stock data if this is an organization entity
    let stockData = null
    if (type === 'organization') {
      try {
        stockData = await getStockDataForEntity(entity.id)
      } catch (e) {
        // Stock data is optional, don't fail the request
      }
    }

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        subtype: entity.subtype || null,
        name: entity.name,
        canonicalName: entity.canonicalName,
        slug: entity.slug,
        metadata: entity.metadata,
        createdAt: entity.createdAt,
      },
      summary: {
        summary: entity.summary,
        shortDescription: entity.shortDescription,
        imageUrl: entity.imageUrl,
        wikiUrl: entity.wikiUrl,
        mentionCount: entity.mentionCount,
        trendingScore: entity.trendingScore,
        lastUpdated: entity.lastUpdated,
        historyCount,
      },
      recentArticles: recentArticles.map(a => ({
        id: a.id,
        title: a.title,
        url: a.url,
        publishedAt: a.publishedAt,
        imageUrl: a.imageUrl,
        storyId: a.storyId,
        storyStatus: a.storyStatus,
        relevanceScore: a.relevanceScore,
        sentiment: a.sentiment,
      })),
      relatedEntities: relatedEntitiesRaw.rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        subtype: r.subtype || null,
        name: r.name,
        slug: r.slug,
        shortDescription: r.short_description,
        mentionCount: r.mention_count,
        trendingScore: r.trending_score,
        coOccurrenceCount: r.co_occurrence_count,
      })),
      stats: {
        totalMentions: entity.mentionCount || 0,
        mentionsLast7Days: velocity?.mentions_last_7d || 0,
        mentionsPrev7Days: velocity?.mentions_prev_7d || 0,
        velocityChangePercent: velocity?.velocity_change_percent || 0,
        trendingScore: entity.trendingScore || 0,
      },
      stockData,
    }
  } catch (error) {
    console.error(`Error fetching entity ${type}/${slug}:`, error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch entity details'
    })
  }
})
