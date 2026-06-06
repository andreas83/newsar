import { getDatabase } from '~/server/database/db'
import { articles, classifications, feeds, articleEntities, entities, keywords, analyses, stories, storyMembers, articleClaims } from '~/server/database/schema'
import { eq, and, ne } from 'drizzle-orm'

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
    // Get article with feed info
    const [article] = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
        url: articles.url,
        author: articles.author,
        publishedAt: articles.publishedAt,
        storyId: articles.storyId,
        feedId: articles.feedId,
        feedName: feeds.name,
        feedBias: feeds.knownBias,
        imageUrl: articles.imageUrl,
        imageLocalPath: articles.imageLocalPath,
        imageFetchStatus: articles.imageFetchStatus,
      })
      .from(articles)
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
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

    // Get entities with OSINT role classification
    const articleEntityLinks = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        subtype: entities.subtype,
        slug: entities.slug,
        relevance: articleEntities.relevanceScore,
        mentions: articleEntities.mentionCount,
        sentiment: articleEntities.sentiment,
        role: articleEntities.role, // OSINT: protagonist, antagonist, neutral, context
      })
      .from(articleEntities)
      .innerJoin(entities, eq(articleEntities.entityId, entities.id))
      .where(eq(articleEntities.articleId, id))
      .orderBy(articleEntities.relevanceScore)
      .then(rows => rows.reverse()) // Sort by relevance descending

    // Get keywords with full details
    const articleKeywords = await db
      .select({
        keyword: keywords.keyword,
        relevance: keywords.relevanceScore,
        category: keywords.category,
      })
      .from(keywords)
      .where(eq(keywords.articleId, id))
      .orderBy(keywords.relevanceScore)
      .then(rows => rows.reverse()) // Sort by relevance descending

    // Get analysis
    const [analysis] = await db
      .select()
      .from(analyses)
      .where(eq(analyses.articleId, id))
      .limit(1)

    // Get extracted claims
    const claims = await db
      .select({
        id: articleClaims.id,
        claimText: articleClaims.claimText,
        attribution: articleClaims.attribution,
        claimType: articleClaims.claimType,
        confidence: articleClaims.confidence,
      })
      .from(articleClaims)
      .where(eq(articleClaims.articleId, id))
      .orderBy(articleClaims.confidence)
      .then(rows => rows.reverse())

    // Get story info if article is part of a story
    let story = null
    let relatedArticles = []

    if (article.storyId) {
      const [storyData] = await db
        .select()
        .from(stories)
        .where(eq(stories.id, article.storyId))
        .limit(1)

      story = storyData

      // Get other articles in the same story
      relatedArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          publishedAt: articles.publishedAt,
          feedName: feeds.name,
          bias: classifications.politicalBias,
        })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .leftJoin(classifications, eq(articles.id, classifications.articleId))
        .where(
          and(
            eq(storyMembers.storyId, article.storyId),
            ne(articles.id, id)
          )
        )
        .limit(5)
    }

    // Calculate reading time and other metrics
    const contentText = article.fullContent || article.content || ''
    const wordCount = contentText.split(/\s+/).filter(word => word.length > 0).length
    const readingTimeMinutes = Math.ceil(wordCount / 250) // ~250 words per minute

    // Calculate content length category
    const contentLength = wordCount < 300 ? 'short' : wordCount < 800 ? 'medium' : 'long'

    // Calculate quality score (0-1 composite)
    const qualityScore = [
      classification ? 0.25 : 0,
      analysis?.summary ? 0.25 : 0,
      articleEntityLinks.length > 0 ? 0.25 : 0,
      articleKeywords.length > 0 ? 0.25 : 0,
    ].reduce((a, b) => a + b, 0)

    return {
      ...article,
      classification,
      entities: articleEntityLinks,
      keywords: articleKeywords,
      claims,
      analysis,
      story,
      relatedArticles,
      // Calculated metrics
      readingTimeMinutes,
      contentLength,
      qualityScore,
      wordCount,
    }
  } catch (error) {
    console.error('Error fetching article details:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch article details',
    })
  }
})
