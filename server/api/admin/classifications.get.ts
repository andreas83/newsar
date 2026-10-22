import { getDatabase } from '~/server/database/db'
import { articles, classifications, articleEntities } from '~/server/database/schema'
import { desc, eq, getTableColumns, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    // Newest classifications only (default 100): one query with a join and an aggregate,
    // instead of loading the whole table plus two queries per row
    const limit = Math.min(parseInt((getQuery(event).limit as string) || '100'), 1000)
    const enriched = await db
      .select({
        ...getTableColumns(classifications),
        articleTitle: sql<string>`COALESCE(${articles.title}, 'Unknown')`,
        entityCount: sql<number>`(SELECT COUNT(*)::int FROM ${articleEntities} WHERE ${articleEntities.articleId} = ${classifications.articleId})`,
      })
      .from(classifications)
      .leftJoin(articles, eq(articles.id, classifications.articleId))
      .orderBy(desc(classifications.createdAt))
      .limit(limit)

    return enriched
  } catch (error) {
    console.error('Error fetching classifications:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch classifications',
    })
  }
})
