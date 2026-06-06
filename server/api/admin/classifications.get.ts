import { getDatabase } from '~/server/database/db'
import { articles, classifications, articleEntities } from '~/server/database/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    // Get all classifications
    const allClassifications = await db
      .select()
      .from(classifications)

    // Enrich with article titles and entity counts
    const enriched = await Promise.all(
      allClassifications.map(async (classification) => {
        // Get article title
        const [article] = await db
          .select({ title: articles.title })
          .from(articles)
          .where(eq(articles.id, classification.articleId))
          .limit(1)

        // Get entity count
        const entities = await db
          .select()
          .from(articleEntities)
          .where(eq(articleEntities.articleId, classification.articleId))

        return {
          ...classification,
          articleTitle: article?.title || 'Unknown',
          entityCount: entities.length,
        }
      })
    )

    return enriched
  } catch (error) {
    console.error('Error fetching classifications:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch classifications',
    })
  }
})
