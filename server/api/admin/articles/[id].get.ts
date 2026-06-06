import { getDatabase } from '~/server/database/db'
import { articles, classifications, articleEntities, entities, keywords, analyses, articleEmbeddings, feeds } from '~/server/database/schema'
import { eq, ne, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const id = parseInt(event.context.params?.id || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Article ID is required',
    })
  }

  try {
    // Get article
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, id))
      .limit(1)

    if (!article) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Article not found',
      })
    }

    // Get classification
    const [classification] = await db
      .select()
      .from(classifications)
      .where(eq(classifications.articleId, id))
      .limit(1)

    // Get entities
    const articleEntityLinks = await db
      .select()
      .from(articleEntities)
      .where(eq(articleEntities.articleId, id))

    const articleEntitiesList = await Promise.all(
      articleEntityLinks.map(async (link) => {
        const [entity] = await db
          .select()
          .from(entities)
          .where(eq(entities.id, link.entityId))
          .limit(1)

        return {
          ...entity,
          relevance: link.relevanceScore,
          mentions: link.mentionCount,
        }
      })
    )

    // Get keywords
    const articleKeywords = await db
      .select()
      .from(keywords)
      .where(eq(keywords.articleId, id))

    const keywordsList = articleKeywords.map((k) => ({
      id: k.id,
      keyword: k.keyword,
      relevance: k.relevanceScore,
      category: k.category,
    }))

    // Get analysis
    const [analysis] = await db
      .select()
      .from(analyses)
      .where(eq(analyses.articleId, id))
      .limit(1)

    // Get feed info
    const [feed] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.id, article.feedId))
      .limit(1)

    // Get similar articles using embeddings (cosine similarity)
    const [currentEmbedding] = await db
      .select()
      .from(articleEmbeddings)
      .where(eq(articleEmbeddings.articleId, id))
      .limit(1)

    let similarArticles = []
    if (currentEmbedding) {
      // Find similar articles using cosine similarity
      // 1 - (embedding <=> current_embedding) gives similarity (0-1 range)
      const similarResults = await db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          publishedAt: articles.publishedAt,
          feedName: feeds.name,
          feedId: articles.feedId,
          imageUrl: articles.imageUrl,
          similarity: sql<number>`1 - (${articleEmbeddings.embedding} <=> ${currentEmbedding.embedding})`,
        })
        .from(articles)
        .innerJoin(articleEmbeddings, eq(articles.id, articleEmbeddings.articleId))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .where(ne(articles.id, id))
        .orderBy(sql`${articleEmbeddings.embedding} <=> ${currentEmbedding.embedding}`)
        .limit(5)

      similarArticles = similarResults.map(r => ({
        id: r.id,
        title: r.title,
        url: r.url,
        publishedAt: r.publishedAt,
        feedName: r.feedName,
        feedId: r.feedId,
        imageUrl: r.imageUrl,
        similarity: r.similarity,
      }))
    }

    return {
      ...article,
      classification,
      entities: articleEntitiesList,
      keywords: keywordsList,
      analysis,
      feedName: feed?.name,
      feedId: article.feedId,
      similarArticles,
    }
  } catch (error) {
    console.error('Error fetching article details:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch article details',
    })
  }
})
