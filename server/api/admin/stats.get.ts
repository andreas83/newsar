import { getDatabase } from '~/server/database/db'
import { articles, feeds, classifications, articleEmbeddings, analyses, keywords, entities, entityRelationships, entitySummaries } from '~/server/database/schema'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    // Count in SQL; loading whole tables into memory just to count them pushed the
    // process past the 4 GB heap limit and crashed the app.
    const count = async (query: ReturnType<typeof sql>) =>
      Number(((await db.execute(query)).rows[0] as any)?.count || 0)

    const [
      totalArticles,
      extractedArticles,
      pendingClassification,
      classifiedArticles,
      embeddingsGenerated,
      analyzedArticles,
      totalFeeds,
      activeFeeds,
      totalKeywords,
      uniqueKeywords,
      totalEntities,
      entitiesByType,
      entityRelationshipsCount,
      totalEntitySummaries,
      entitiesWithSummaries,
      storyStats,
    ] = await Promise.all([
      count(sql`SELECT COUNT(*) AS count FROM ${articles}`),
      count(sql`SELECT COUNT(*) AS count FROM ${articles} WHERE ${articles.contentExtracted} = true`),
      count(sql`SELECT COUNT(*) AS count FROM ${articles} WHERE ${articles.processingStatus} = 'pending'`),
      count(sql`SELECT COUNT(*) AS count FROM ${classifications}`),
      count(sql`SELECT COUNT(*) AS count FROM ${articleEmbeddings}`),
      count(sql`SELECT COUNT(*) AS count FROM ${analyses}`),
      count(sql`SELECT COUNT(*) AS count FROM ${feeds}`),
      count(sql`SELECT COUNT(*) AS count FROM ${feeds} WHERE ${feeds.isActive} = 1`),
      count(sql`SELECT COUNT(*) AS count FROM ${keywords}`),
      count(sql`SELECT COUNT(DISTINCT keyword) AS count FROM keywords`),
      count(sql`SELECT COUNT(*) AS count FROM ${entities}`),
      db.execute(sql`
        SELECT
          LOWER(type) as type,
          COUNT(*) as count
        FROM entities
        WHERE LOWER(type) IN ('person', 'organization', 'location', 'event', 'topic')
        GROUP BY LOWER(type)
      `),
      count(sql`SELECT COUNT(*) AS count FROM ${entityRelationships}`),
      count(sql`SELECT COUNT(*) AS count FROM ${entitySummaries}`),
      count(sql`SELECT COUNT(*) AS count FROM ${entitySummaries} WHERE ${entitySummaries.summary} IS NOT NULL`),
      db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'trending') AS trending,
          COUNT(*) FILTER (WHERE status = 'emerging') AS emerging
        FROM stories
      `),
    ])

    const entityCounts: Record<string, number> = {
      person: 0,
      organization: 0,
      location: 0,
      event: 0,
      topic: 0,
    }
    for (const row of entitiesByType.rows) {
      const r = row as any
      const type = r.type as string
      if (type in entityCounts) {
        entityCounts[type] = Number(r.count)
      }
    }

    const entitiesNeedingSummaries = totalEntities - entitiesWithSummaries
    const storyRow = storyStats.rows[0] as any
    const totalStories = Number(storyRow?.total || 0)
    const trendingStories = Number(storyRow?.trending || 0)
    const emergingStories = Number(storyRow?.emerging || 0)

    return {
      totalArticles,
      extractedArticles,
      classifiedArticles,
      pendingClassification,
      embeddingsGenerated,
      analyzedArticles,
      totalFeeds,
      activeFeeds,
      totalKeywords,
      uniqueKeywords,
      totalEntities,
      entityCounts,
      entityRelationshipsCount,
      // New entity summary stats
      totalEntitySummaries,
      entitiesWithSummaries,
      entitiesNeedingSummaries,
      entitySummaryCoverage: totalEntities > 0 ? Math.round((entitiesWithSummaries / totalEntities) * 100) : 0,
      // Story stats
      totalStories,
      trendingStories,
      emergingStories,
    }
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch admin stats',
    })
  }
})
