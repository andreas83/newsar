import { getDatabase } from '../database/db'
import { keywords, articles } from '../database/schema'
import { eq, sql, desc, and, gte } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)
  const limit = parseInt(query.limit as string) || 20

  try {
    // Get trending keywords from recent articles (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const trendingKeywords = await db
      .select({
        keyword: keywords.keyword,
        category: keywords.category,
        count: sql<number>`COUNT(DISTINCT ${keywords.articleId})`,
        avgRelevance: sql<number>`AVG(${keywords.relevanceScore})`,
      })
      .from(keywords)
      .innerJoin(articles, eq(keywords.articleId, articles.id))
      .where(
        gte(articles.publishedAt, sevenDaysAgo)
      )
      .groupBy(keywords.keyword, keywords.category)
      .orderBy(desc(sql`COUNT(DISTINCT ${keywords.articleId})`))
      .limit(limit)

    // Calculate bubble sizes based on count and relevance
    const maxCount = Math.max(...trendingKeywords.map(k => Number(k.count)), 1)

    const bubbles = trendingKeywords.map(item => {
      const count = Number(item.count)
      const avgRelevance = Number(item.avgRelevance)

      // Size calculation: normalize count (1-10 scale) and boost by relevance
      const normalizedCount = (count / maxCount) * 8 + 2
      const size = Math.round(normalizedCount * (0.8 + avgRelevance * 0.4))

      return {
        keyword: item.keyword,
        category: item.category,
        count,
        size: Math.min(size, 10), // Cap at 10
        relevance: Math.round(avgRelevance * 100) / 100,
      }
    })

    return {
      bubbles,
      timestamp: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error('Error fetching trending keywords:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch trending keywords',
    })
  }
})
