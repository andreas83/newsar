import { getDatabase } from '~/server/database/db'
import { articleEmbeddings, articles, classifications, feeds } from '~/server/database/schema'
import { eq, sql } from 'drizzle-orm'
import { generateEmbedding } from '~/server/utils/ollama'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const searchText = query.q as string || ''
  const limit = Math.min(parseInt(query.limit as string || '10'), 30)

  if (!searchText || searchText.length < 2) {
    return { articles: [], error: null }
  }

  try {
    // Generate embedding for the search query
    let queryEmbedding: number[]
    try {
      queryEmbedding = await generateEmbedding(searchText)
    } catch (embeddingError) {
      console.error('Embedding generation failed:', embeddingError)
      return {
        articles: [],
        error: 'Semantic search is temporarily unavailable. The embedding service could not be reached.',
      }
    }

    const embeddingStr = `[${queryEmbedding.join(',')}]`

    // Search pgvector for nearest neighbors using cosine distance
    const results = await db
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
      .orderBy(sql`${articleEmbeddings.embedding} <=> ${embeddingStr}::vector`)
      .limit(limit)

    return { articles: results, error: null }
  } catch (error) {
    console.error('Error performing semantic search:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Semantic search failed',
    })
  }
})
