import { getDatabase } from '../../database/db.js'
import { entities, entitySummaries, articleEntities, articles } from '../../database/schema.js'
import { eq, sql, desc, and, gte } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    const entityTypes = ['person', 'organization', 'location', 'event', 'topic']
    const categories = []

    for (const type of entityTypes) {
      // Get count of entities with summaries
      const countResult = await db
        .select({
          count: sql<number>`COUNT(DISTINCT ${entities.id})`.as('count'),
        })
        .from(entities)
        .innerJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
        .where(eq(entities.type, type))

      const count = Number(countResult[0]?.count) || 0

      // Get total count of ALL entities of this type (not just those with summaries)
      const totalCountResult = await db
        .select({
          count: sql<number>`COUNT(*)`.as('count'),
        })
        .from(entities)
        .where(eq(entities.type, type))

      const totalCount = Number(totalCountResult[0]?.count) || 0

      // Get trending count (entities with trending score > 0.3)
      const trendingResult = await db
        .select({
          count: sql<number>`COUNT(DISTINCT ${entities.id})`.as('count'),
        })
        .from(entities)
        .innerJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
        .where(and(
          eq(entities.type, type),
          sql`${entitySummaries.trendingScore} > 0.3`
        ))

      const trendingCount = Number(trendingResult[0]?.count) || 0

      // Get total articles mentioning this entity type
      const articlesResult = await db.execute(sql`
        SELECT COUNT(DISTINCT ae.article_id) as total
        FROM article_entities ae
        INNER JOIN entities e ON ae.entity_id = e.id
        WHERE e.type = ${type}
      `)

      const totalArticles = Number(articlesResult.rows[0]?.total) || 0

      // Calculate velocity (mentions in last 7 days vs previous 7 days)
      const velocityResult = await db.execute(sql`
        WITH mention_stats AS (
          SELECT
            COUNT(DISTINCT ae.article_id) FILTER (
              WHERE a.published_at >= NOW() - INTERVAL '7 days'
            ) as mentions_last_7d,
            COUNT(DISTINCT ae.article_id) FILTER (
              WHERE a.published_at >= NOW() - INTERVAL '14 days'
                AND a.published_at < NOW() - INTERVAL '7 days'
            ) as mentions_prev_7d
          FROM article_entities ae
          INNER JOIN entities e ON ae.entity_id = e.id
          INNER JOIN articles a ON ae.article_id = a.id
          WHERE e.type = ${type}
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

      const velocity = velocityResult.rows[0]

      // Get a representative image from the top trending entity
      const topEntity = await db
        .select({
          imageUrl: entitySummaries.imageUrl,
        })
        .from(entities)
        .innerJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
        .where(eq(entities.type, type))
        .orderBy(desc(entitySummaries.trendingScore))
        .limit(1)

      // Get subtype breakdown for this entity type
      const subtypeResult = await db.execute(sql`
        SELECT subtype, COUNT(*) as count
        FROM entities
        WHERE type = ${type} AND subtype IS NOT NULL
        GROUP BY subtype
        ORDER BY count DESC
      `)
      const subtypes = subtypeResult.rows.map((r: any) => ({
        subtype: r.subtype,
        count: Number(r.count) || 0,
      }))

      categories.push({
        type,
        label: type.charAt(0).toUpperCase() + type.slice(1) + 's',
        count,
        totalCount,
        trendingCount,
        totalArticles,
        velocity: Number(velocity?.velocity_change_percent) || 0,
        mentionsLast7Days: Number(velocity?.mentions_last_7d) || 0,
        mentionsPrev7Days: Number(velocity?.mentions_prev_7d) || 0,
        imageUrl: topEntity[0]?.imageUrl || null,
        subtypes,
      })
    }

    return {
      categories,
      meta: {
        total: categories.reduce((sum, cat) => sum + cat.count, 0),
        timestamp: new Date().toISOString(),
      }
    }
  } catch (error) {
    console.error('Error fetching entity categories:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch entity categories'
    })
  }
})
