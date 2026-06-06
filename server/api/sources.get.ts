import { getDatabase } from '~/server/database/db'
import { feeds, articles } from '~/server/database/schema'
import { eq, sql, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    // Get feeds with article counts
    const sources = await db
      .select({
        id: feeds.id,
        name: feeds.name,
        url: feeds.url,
        category: feeds.category,
        knownBias: feeds.knownBias,
        region: feeds.region,
        isActive: feeds.isActive,
        lastFetchedAt: feeds.lastFetchedAt,
        articleCount: sql<number>`COUNT(${articles.id})`,
      })
      .from(feeds)
      .leftJoin(articles, eq(feeds.id, articles.feedId))
      .groupBy(
        feeds.id,
        feeds.name,
        feeds.url,
        feeds.category,
        feeds.knownBias,
        feeds.region,
        feeds.isActive,
        feeds.lastFetchedAt
      )
      .orderBy(desc(sql`COUNT(${articles.id})`))

    return sources
  } catch (error) {
    console.error('Error fetching sources:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch sources',
    })
  }
})
