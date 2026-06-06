import { getDatabase } from '~/server/database/db'
import { keywords, articles } from '~/server/database/schema'
import { eq, sql, desc, gte } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)
  const limit = parseInt(query.limit as string) || 10

  try {
    // Get trending keywords from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Get trending keywords with counts and stats
    const trendingKeywords = await db
      .select({
        id: sql<number>`MIN(${keywords.id})`,
        keyword: keywords.keyword,
        category: keywords.category,
        articleCount: sql<number>`COUNT(DISTINCT ${keywords.articleId})`,
        avgRelevance: sql<number>`AVG(${keywords.relevanceScore})`,
        sourceCount: sql<number>`COUNT(DISTINCT ${articles.feedId})`,
        latestPublishedAt: sql<Date>`MAX(${articles.publishedAt})`,
      })
      .from(keywords)
      .innerJoin(articles, eq(keywords.articleId, articles.id))
      .where(gte(articles.publishedAt, sevenDaysAgo))
      .groupBy(keywords.keyword, keywords.category)
      .orderBy(desc(sql`COUNT(DISTINCT ${keywords.articleId})`))
      .limit(limit)

    // Calculate trending scores and format
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    const topicsWithStats = trendingKeywords.map((item) => {
      const articleCount = Number(item.articleCount)
      const sourceCount = Number(item.sourceCount)
      const avgRelevance = Number(item.avgRelevance)

      // Calculate trending score (recency + volume + diversity)
      const hoursSinceLatest = (now - new Date(item.latestPublishedAt).getTime()) / (1000 * 60 * 60)
      const recencyScore = Math.max(0, 1 - hoursSinceLatest / 48) // Decay over 48 hours
      const volumeScore = Math.min(articleCount / 50, 1) // Cap at 50 articles
      const diversityScore = Math.min(sourceCount / 10, 1) // Cap at 10 sources

      const trendingScore = (recencyScore * 0.4 + volumeScore * 0.3 + diversityScore * 0.3) * 100
      const trendingPercent = Math.round(recencyScore * volumeScore * 100) // Simplified trending indicator

      return {
        id: Number(item.id),
        keyword: item.keyword,
        category: item.category || 'general',
        articleCount,
        sourceCount,
        avgRelevance: Math.round(avgRelevance * 100) / 100,
        trendingScore: Math.round(trendingScore),
        trendingPercent,
        sourceDiversity: Math.round(diversityScore * 100),
        latestPublishedAt: item.latestPublishedAt,
      }
    })

    // Group by category
    const categorized: Record<string, typeof topicsWithStats> = {}
    const categoryOrder = ['event', 'entity', 'topic', 'technology', 'location', 'general']

    for (const topic of topicsWithStats) {
      const cat = topic.category || 'general'
      if (!categorized[cat]) {
        categorized[cat] = []
      }
      categorized[cat].push(topic)
    }

    // Sort categories by predefined order
    const sortedCategories = categoryOrder
      .filter(cat => categorized[cat]?.length > 0)
      .map(cat => ({
        name: cat,
        label: getCategoryLabel(cat),
        topics: categorized[cat],
      }))

    // Add any remaining categories
    Object.keys(categorized).forEach(cat => {
      if (!categoryOrder.includes(cat)) {
        sortedCategories.push({
          name: cat,
          label: getCategoryLabel(cat),
          topics: categorized[cat],
        })
      }
    })

    return {
      topics: topicsWithStats,
      categories: sortedCategories,
      relationships: [],
      timestamp: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error('Error fetching homepage topics:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch homepage topics',
    })
  }
})

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    event: 'Events',
    entity: 'People & Organizations',
    topic: 'Topics',
    general: 'General',
    technology: 'Tech & Science',
    location: 'Locations',
    'geographic region': 'Regions',
    sport: 'Sports',
    concept: 'Concepts',
    action: 'Actions',
    law: 'Law & Policy',
    project: 'Projects',
  }
  return labels[category] || category.charAt(0).toUpperCase() + category.slice(1)
}
