import { getDatabase } from '~/server/database/db'
import { articles } from '~/server/database/schema'
import { desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const page = parseInt((query.page as string) || '1')
  const pageSize = parseInt((query.pageSize as string) || '20')
  const offset = (page - 1) * pageSize

  try {
    // Get total count
    const allArticles = await db.select().from(articles)
    const total = allArticles.length

    // Get paginated articles
    const paginatedArticles = await db
      .select()
      .from(articles)
      .orderBy(desc(articles.publishedAt))
      .limit(pageSize)
      .offset(offset)

    return {
      articles: paginatedArticles,
      total,
      page,
      pageSize,
    }
  } catch (error) {
    console.error('Error fetching articles:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch articles',
    })
  }
})
