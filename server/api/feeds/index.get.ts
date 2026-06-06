import { getDatabase } from '~/server/database/db'
import { feeds, articles } from '~/server/database/schema'
import { desc, eq, sql, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    const allFeeds = await db
      .select()
      .from(feeds)
      .orderBy(desc(feeds.createdAt))

    // Get statistics for each feed
    const feedsWithStats = await Promise.all(
      allFeeds.map(async (feed) => {
        // Get article counts by status
        const stats = await db
          .select({
            total: sql<number>`count(*)::int`,
            extracted: sql<number>`count(case when ${articles.contentExtracted} = true then 1 end)::int`,
            failed: sql<number>`count(case when ${articles.extractionStatus} = 'failed' then 1 end)::int`,
            avgLength: sql<number>`avg(case when ${articles.fullContent} is not null then length(${articles.fullContent}) end)::int`,
          })
          .from(articles)
          .where(eq(articles.feedId, feed.id))

        return {
          ...feed,
          stats: {
            totalArticles: stats[0]?.total || 0,
            extractedArticles: stats[0]?.extracted || 0,
            failedExtractions: stats[0]?.failed || 0,
            avgContentLength: stats[0]?.avgLength || 0,
          },
        }
      })
    )

    return {
      success: true,
      data: feedsWithStats,
      count: feedsWithStats.length,
    }
  } catch (error) {
    console.error('Error fetching feeds:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch feeds',
    })
  }
})
