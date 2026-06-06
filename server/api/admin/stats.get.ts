import { getDatabase } from '~/server/database/db'
import { articles, feeds, classifications, articleEmbeddings, analyses, keywords, entities, entityRelationships, entitySummaries, stories } from '~/server/database/schema'
import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    // Get total articles
    const allArticles = await db.select().from(articles)
    const totalArticles = allArticles.length

    // Get extracted articles
    const extractedArticles = allArticles.filter((a) => a.contentExtracted).length

    // Get classified articles
    const allClassifications = await db.select().from(classifications)
    const classifiedArticles = allClassifications.length
    const pendingClassification = allArticles.filter(
      (a) => a.processingStatus === 'pending'
    ).length

    // Get embeddings
    const allEmbeddings = await db.select().from(articleEmbeddings)
    const embeddingsGenerated = allEmbeddings.length

    // Get analyses
    const allAnalyses = await db.select().from(analyses)
    const analyzedArticles = allAnalyses.length

    // Get feeds
    const allFeeds = await db.select().from(feeds)
    const totalFeeds = allFeeds.length
    const activeFeeds = allFeeds.filter((f) => f.isActive === 1).length

    // Get keywords
    const allKeywords = await db.select().from(keywords)
    const totalKeywords = allKeywords.length
    const uniqueKeywordsResult = await db.execute(sql`SELECT COUNT(DISTINCT keyword) as count FROM keywords`)
    const uniqueKeywords = Number((uniqueKeywordsResult.rows[0] as any).count || 0)

    // Get entities
    const allEntities = await db.select().from(entities)
    const totalEntities = allEntities.length
    const entitiesByType = await db.execute(sql`
      SELECT
        LOWER(type) as type,
        COUNT(*) as count
      FROM entities
      WHERE LOWER(type) IN ('person', 'organization', 'location', 'event', 'topic')
      GROUP BY LOWER(type)
    `)
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

    // Get entity relationships count
    const entityRelationshipsResult = await db.select({ count: sql<number>`count(*)` }).from(entityRelationships)
    const entityRelationshipsCount = Number(entityRelationshipsResult[0]?.count || 0)

    // Get entity summaries
    const allEntitySummaries = await db.select().from(entitySummaries)
    const totalEntitySummaries = allEntitySummaries.length
    const entitiesWithSummaries = allEntitySummaries.filter(s => s.summary !== null).length
    const entitiesNeedingSummaries = totalEntities - entitiesWithSummaries

    // Get stories
    const allStories = await db.select().from(stories)
    const totalStories = allStories.length
    const trendingStories = allStories.filter(s => s.status === 'trending').length
    const emergingStories = allStories.filter(s => s.status === 'emerging').length

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
