import { getDatabase } from '../../database/db.js'
import { sql } from 'drizzle-orm'

const ENTITY_TYPES = ['person', 'organization', 'location', 'event', 'topic']

// Aggregate stats over ~1M article_entities rows; they move slowly, so cache
// for 10 minutes and serve stale while revalidating in the background.
export default defineCachedEventHandler(async () => {
  const db = getDatabase()

  try {
    // One grouped query per metric (instead of 7 queries per type), run in parallel
    const [summaryRows, totalRows, articleRows, velocityRows, imageRows, subtypeRows] = await Promise.all([
      db.execute(sql`
        SELECT e.type,
          COUNT(DISTINCT e.id) AS count,
          COUNT(DISTINCT e.id) FILTER (WHERE es.trending_score > 0.3) AS trending_count
        FROM entities e
        INNER JOIN entity_summaries es ON es.entity_id = e.id
        GROUP BY e.type
      `),
      db.execute(sql`SELECT type, COUNT(*) AS count FROM entities GROUP BY type`),
      db.execute(sql`
        SELECT e.type, COUNT(DISTINCT ae.article_id) AS total
        FROM article_entities ae
        INNER JOIN entities e ON ae.entity_id = e.id
        GROUP BY e.type
      `),
      // Mentions in last 7 days vs previous 7 days
      db.execute(sql`
        SELECT e.type,
          COUNT(DISTINCT ae.article_id) FILTER (WHERE a.published_at >= NOW() - INTERVAL '7 days') AS mentions_last_7d,
          COUNT(DISTINCT ae.article_id) FILTER (WHERE a.published_at < NOW() - INTERVAL '7 days') AS mentions_prev_7d
        FROM article_entities ae
        INNER JOIN entities e ON ae.entity_id = e.id
        INNER JOIN articles a ON ae.article_id = a.id
        WHERE a.published_at >= NOW() - INTERVAL '14 days'
        GROUP BY e.type
      `),
      // Representative image from the top trending entity (with an image) of each type
      db.execute(sql`
        SELECT DISTINCT ON (e.type) e.type, es.image_url
        FROM entities e
        INNER JOIN entity_summaries es ON es.entity_id = e.id
        WHERE es.image_url IS NOT NULL
        ORDER BY e.type, es.trending_score DESC NULLS LAST
      `),
      db.execute(sql`
        SELECT type, subtype, COUNT(*) AS count
        FROM entities
        WHERE subtype IS NOT NULL
        GROUP BY type, subtype
        ORDER BY count DESC
      `),
    ])

    const byType = (rows: any[]) => new Map(rows.map((r: any) => [r.type, r]))
    const summaries = byType(summaryRows.rows)
    const totals = byType(totalRows.rows)
    const articleTotals = byType(articleRows.rows)
    const velocities = byType(velocityRows.rows)
    const images = byType(imageRows.rows)

    const categories = ENTITY_TYPES.map((type) => {
      const last7 = Number(velocities.get(type)?.mentions_last_7d) || 0
      const prev7 = Number(velocities.get(type)?.mentions_prev_7d) || 0
      return {
        type,
        label: type.charAt(0).toUpperCase() + type.slice(1) + 's',
        count: Number(summaries.get(type)?.count) || 0,
        totalCount: Number(totals.get(type)?.count) || 0,
        trendingCount: Number(summaries.get(type)?.trending_count) || 0,
        totalArticles: Number(articleTotals.get(type)?.total) || 0,
        velocity: prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : 0,
        mentionsLast7Days: last7,
        mentionsPrev7Days: prev7,
        imageUrl: images.get(type)?.image_url || null,
        subtypes: subtypeRows.rows
          .filter((r: any) => r.type === type)
          .map((r: any) => ({ subtype: r.subtype, count: Number(r.count) || 0 })),
      }
    })

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
}, { name: 'entity-categories', maxAge: 600, swr: true })
