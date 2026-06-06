import { getDatabase } from '~/server/database/db'
import { articleEmbeddings, articles, classifications, feeds } from '~/server/database/schema'
import { eq, sql, and, ne } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const articleId = parseInt(query.id as string)
  const limit = Math.min(parseInt(query.limit as string || '10'), 20)
  const minSimilarity = parseFloat(query.minSimilarity as string || '0.7')

  if (!articleId || isNaN(articleId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Article ID is required (?id=123)',
    })
  }

  try {
    // Get the source article's embedding
    const [sourceEmbedding] = await db
      .select({ embedding: articleEmbeddings.embedding })
      .from(articleEmbeddings)
      .where(eq(articleEmbeddings.articleId, articleId))
      .limit(1)

    if (!sourceEmbedding) {
      return []
    }

    // Use pgvector cosine distance operator for efficient similarity search
    const embeddingStr = `[${sourceEmbedding.embedding.join(',')}]`

    const similarArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        url: articles.url,
        publishedAt: articles.publishedAt,
        feedName: feeds.name,
        bias: classifications.politicalBias,
        language: classifications.language,
        imageUrl: articles.imageUrl,
        imageLocalPath: articles.imageLocalPath,
        similarity: sql<number>`1 - (${articleEmbeddings.embedding} <=> ${embeddingStr}::vector)`.as('similarity'),
      })
      .from(articleEmbeddings)
      .innerJoin(articles, eq(articleEmbeddings.articleId, articles.id))
      .leftJoin(classifications, eq(articles.id, classifications.articleId))
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
      .where(
        and(
          ne(articleEmbeddings.articleId, articleId),
          sql`1 - (${articleEmbeddings.embedding} <=> ${embeddingStr}::vector) >= ${minSimilarity}`
        )
      )
      .orderBy(sql`${articleEmbeddings.embedding} <=> ${embeddingStr}::vector`)
      .limit(limit)

    return similarArticles
  } catch (error) {
    console.error('Error finding similar articles:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to find similar articles',
    })
  }
})
