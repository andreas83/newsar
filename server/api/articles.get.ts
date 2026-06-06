import { getDatabase } from '~/server/database/db'
import { articles, classifications, feeds, keywords as keywordsTable, articleEntities, entities } from '~/server/database/schema'
import { eq, desc, and, sql, or, ilike, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const language = query.language as string || 'all'
  const bias = query.bias as string || 'all'
  const search = query.search as string || ''
  const feedId = query.feed ? parseInt(query.feed as string) : null
  const dateRange = query.dateRange as string || 'all'
  const limit = Math.min(parseInt(query.limit as string || '50'), 100)

  try {
    // Build where conditions
    const conditions = []

    // Only show articles with extracted content, not excluded
    conditions.push(eq(articles.contentExtracted, true))
    conditions.push(eq(articles.excluded, false))

    // Feed filter
    if (feedId) {
      conditions.push(eq(articles.feedId, feedId))
    }

    // Language filter
    if (language !== 'all') {
      conditions.push(eq(classifications.language, language))
    }

    // Date range filter
    if (dateRange !== 'all') {
      const now = new Date()
      let since: Date
      switch (dateRange) {
        case '24h':
          since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          break
        case '7d':
          since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case '30d':
          since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        default:
          since = new Date(0)
      }
      conditions.push(sql`${articles.publishedAt} >= ${since}`)
    }

    // Bias filter
    if (bias !== 'all') {
      const biasRanges: Record<string, [number, number]> = {
        'left': [-1, -0.6],
        'center-left': [-0.6, -0.2],
        'center': [-0.2, 0.2],
        'center-right': [0.2, 0.6],
        'right': [0.6, 1],
      }

      const range = biasRanges[bias]
      if (range) {
        conditions.push(
          and(
            sql`${classifications.politicalBias} >= ${range[0]}`,
            sql`${classifications.politicalBias} <= ${range[1]}`
          )
        )
      }
    }

    // Search filter
    if (search) {
      conditions.push(
        or(
          ilike(articles.title, `%${search}%`),
          ilike(articles.content, `%${search}%`)
        )
      )
    }

    // Fetch articles with classification and feed info
    const results = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        summary: articles.fullContent,
        url: articles.url,
        author: articles.author,
        publishedAt: articles.publishedAt,
        feedName: feeds.name,
        bias: classifications.politicalBias,
        language: classifications.language,
        imageUrl: articles.imageUrl,
        imageLocalPath: articles.imageLocalPath,
        imageFetchStatus: articles.imageFetchStatus,
      })
      .from(articles)
      .leftJoin(classifications, eq(articles.id, classifications.articleId))
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
      .where(and(...conditions))
      .orderBy(desc(articles.publishedAt))
      .limit(limit)

    // Batch-fetch keywords and entities for all articles (avoids N+1 queries)
    const articleIds = results.map(a => a.id)

    if (articleIds.length === 0) {
      return []
    }

    // Run batch queries in parallel: keywords, entity links
    const [allKeywords, allEntityLinks] = await Promise.all([
      db
        .select({
          articleId: keywordsTable.articleId,
          keyword: keywordsTable.keyword,
          relevanceScore: keywordsTable.relevanceScore,
        })
        .from(keywordsTable)
        .where(inArray(keywordsTable.articleId, articleIds))
        .orderBy(desc(keywordsTable.relevanceScore)),
      db
        .select({
          articleId: articleEntities.articleId,
          entityId: articleEntities.entityId,
          relevanceScore: articleEntities.relevanceScore,
        })
        .from(articleEntities)
        .where(inArray(articleEntities.articleId, articleIds))
        .orderBy(desc(articleEntities.relevanceScore)),
    ])

    // Build keyword lookup map (top 5 per article)
    const keywordsByArticle = new Map<number, string[]>()
    for (const k of allKeywords) {
      if (!k.keyword) continue
      const existing = keywordsByArticle.get(k.articleId) || []
      if (existing.length < 5) {
        existing.push(k.keyword)
        keywordsByArticle.set(k.articleId, existing)
      }
    }

    // Build entity links lookup map (top 5 per article)
    const entityLinksByArticle = new Map<number, number[]>()
    for (const link of allEntityLinks) {
      const existing = entityLinksByArticle.get(link.articleId) || []
      if (existing.length < 5) {
        existing.push(link.entityId)
        entityLinksByArticle.set(link.articleId, existing)
      }
    }

    // Collect all unique entity IDs and batch-fetch entity names
    const allEntityIds = [...new Set(allEntityLinks.map(l => l.entityId))]
    const entityNameMap = new Map<number, string>()
    if (allEntityIds.length > 0) {
      const allEntities = await db
        .select({
          id: entities.id,
          name: entities.name,
        })
        .from(entities)
        .where(inArray(entities.id, allEntityIds))
      for (const e of allEntities) {
        entityNameMap.set(e.id, e.name)
      }
    }

    // Map enriched data back to articles
    const articlesWithDetails = results.map(article => ({
      ...article,
      keywords: keywordsByArticle.get(article.id) || [],
      entities: (entityLinksByArticle.get(article.id) || [])
        .map(entityId => entityNameMap.get(entityId))
        .filter(Boolean),
    }))

    return articlesWithDetails
  } catch (error) {
    console.error('Error fetching articles:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch articles',
    })
  }
})
