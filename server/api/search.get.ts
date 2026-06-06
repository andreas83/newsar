import { getDatabase } from '~/server/database/db'
import { articles, classifications, feeds, entities, articleEntities, entitySummaries, keywords as keywordsTable, stockWatchlist, stockPrices } from '~/server/database/schema'
import { eq, desc, or, ilike, sql, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const searchQuery = query.q as string || ''
  const searchType = query.type as string || 'all' // 'all', 'articles', 'entities', 'keywords', 'stocks'
  const limit = Math.min(parseInt(query.limit as string || '50'), 100)

  if (!searchQuery || searchQuery.length < 2) {
    return {
      articles: [],
      entities: [],
      keywords: [],
      stocks: [],
    }
  }

  try {
    const results: any = {
      articles: [],
      entities: [],
      keywords: [],
      stocks: [],
    }

    // Search articles with relevance scoring
    if (searchType === 'all' || searchType === 'articles') {
      const articleResults = await db
        .select({
          id: articles.id,
          title: articles.title,
          content: articles.content,
          fullContent: articles.fullContent,
          url: articles.url,
          author: articles.author,
          publishedAt: articles.publishedAt,
          feedName: feeds.name,
          bias: classifications.politicalBias,
          language: classifications.language,
          // Relevance score: title matches rank higher
          relevance: sql<number>`
            CASE
              WHEN LOWER(${articles.title}) LIKE LOWER(${'%' + searchQuery + '%'}) THEN 3
              WHEN LOWER(${articles.content}) LIKE LOWER(${'%' + searchQuery + '%'}) THEN 2
              WHEN LOWER(${articles.fullContent}) LIKE LOWER(${'%' + searchQuery + '%'}) THEN 1
              ELSE 0
            END
          `.as('relevance')
        })
        .from(articles)
        .leftJoin(classifications, eq(articles.id, classifications.articleId))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .where(
          or(
            ilike(articles.title, `%${searchQuery}%`),
            ilike(articles.content, `%${searchQuery}%`),
            ilike(articles.fullContent, `%${searchQuery}%`)
          )
        )
        .orderBy(desc(sql`relevance`), desc(articles.publishedAt))
        .limit(limit)

      // Also search for articles with matching keywords
      const keywordArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          content: articles.content,
          fullContent: articles.fullContent,
          url: articles.url,
          author: articles.author,
          publishedAt: articles.publishedAt,
          feedName: feeds.name,
          bias: classifications.politicalBias,
          language: classifications.language,
          relevance: sql<number>`4`.as('relevance') // Keyword matches rank highest
        })
        .from(articles)
        .innerJoin(keywordsTable, eq(articles.id, keywordsTable.articleId))
        .leftJoin(classifications, eq(articles.id, classifications.articleId))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .where(ilike(keywordsTable.keyword, `%${searchQuery}%`))
        .groupBy(
          articles.id,
          articles.title,
          articles.content,
          articles.fullContent,
          articles.url,
          articles.author,
          articles.publishedAt,
          feeds.name,
          classifications.politicalBias,
          classifications.language
        )
        .orderBy(desc(articles.publishedAt))
        .limit(limit)

      // Also search for articles with matching entities
      const entityArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          content: articles.content,
          fullContent: articles.fullContent,
          url: articles.url,
          author: articles.author,
          publishedAt: articles.publishedAt,
          feedName: feeds.name,
          bias: classifications.politicalBias,
          language: classifications.language,
          relevance: sql<number>`4`.as('relevance') // Entity matches rank highest
        })
        .from(articles)
        .innerJoin(articleEntities, eq(articles.id, articleEntities.articleId))
        .innerJoin(entities, eq(articleEntities.entityId, entities.id))
        .leftJoin(classifications, eq(articles.id, classifications.articleId))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .where(ilike(entities.name, `%${searchQuery}%`))
        .groupBy(
          articles.id,
          articles.title,
          articles.content,
          articles.fullContent,
          articles.url,
          articles.author,
          articles.publishedAt,
          feeds.name,
          classifications.politicalBias,
          classifications.language
        )
        .orderBy(desc(articles.publishedAt))
        .limit(limit)

      // Combine and deduplicate results, prioritizing by relevance
      const allArticles = [...keywordArticles, ...entityArticles, ...articleResults]
      const seenIds = new Set<number>()
      const uniqueArticles = allArticles.filter(article => {
        if (seenIds.has(article.id)) return false
        seenIds.add(article.id)
        return true
      })

      results.articles = uniqueArticles.slice(0, limit)
    }

    // Search entities
    if (searchType === 'all' || searchType === 'entities') {
      const entityResults = await db
        .select({
          id: entities.id,
          name: entities.name,
          type: entities.type,
          slug: entities.slug,
          canonicalName: entities.canonicalName,
          shortDescription: entitySummaries.shortDescription,
          imageUrl: entitySummaries.imageUrl,
          mentionCount: entitySummaries.mentionCount,
          trendingScore: entitySummaries.trendingScore,
          articleCount: sql<number>`COUNT(DISTINCT ${articleEntities.articleId})`,
        })
        .from(entities)
        .leftJoin(articleEntities, eq(entities.id, articleEntities.entityId))
        .leftJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
        .where(ilike(entities.name, `%${searchQuery}%`))
        .groupBy(
          entities.id, entities.name, entities.type, entities.slug, entities.canonicalName,
          entitySummaries.shortDescription, entitySummaries.imageUrl,
          entitySummaries.mentionCount, entitySummaries.trendingScore
        )
        .orderBy(desc(sql`COUNT(DISTINCT ${articleEntities.articleId})`))
        .limit(50)

      // Deduplicate by canonicalName + type, keeping the entry with the highest article count
      const seen = new Map<string, typeof entityResults[0]>()
      for (const entity of entityResults) {
        const key = `${entity.type}:${(entity.canonicalName || entity.name).toLowerCase()}`
        const existing = seen.get(key)
        if (!existing || Number(entity.articleCount) > Number(existing.articleCount)) {
          seen.set(key, entity)
        }
      }
      results.entities = Array.from(seen.values())
        .sort((a, b) => Number(b.articleCount) - Number(a.articleCount))
        .slice(0, 20)
    }

    // Search keywords
    if (searchType === 'all' || searchType === 'keywords') {
      const keywordResults = await db
        .select({
          keyword: keywordsTable.keyword,
          articleCount: sql<number>`COUNT(DISTINCT ${keywordsTable.articleId})`,
          avgRelevance: sql<number>`AVG(${keywordsTable.relevanceScore})`,
        })
        .from(keywordsTable)
        .where(ilike(keywordsTable.keyword, `%${searchQuery}%`))
        .groupBy(keywordsTable.keyword)
        .orderBy(desc(sql`COUNT(DISTINCT ${keywordsTable.articleId})`))
        .limit(20)

      results.keywords = keywordResults
    }

    // Search stocks
    if (searchType === 'all' || searchType === 'stocks') {
      const stockResults = await db
        .select({
          id: stockWatchlist.id,
          ticker: stockWatchlist.ticker,
          companyName: stockWatchlist.companyName,
          exchange: stockWatchlist.exchange,
          sector: stockWatchlist.sector,
          entityId: stockWatchlist.entityId,
          price: stockPrices.price,
          changePercent: stockPrices.changePercent,
          changeAmount: stockPrices.changeAmount,
        })
        .from(stockWatchlist)
        .leftJoin(
          stockPrices,
          and(
            eq(stockPrices.watchlistId, stockWatchlist.id),
            eq(stockPrices.fetchedAt, sql`(SELECT MAX(sp2.fetched_at) FROM stock_prices sp2 WHERE sp2.watchlist_id = ${stockWatchlist.id})`)
          )
        )
        .where(
          and(
            eq(stockWatchlist.isActive, true),
            or(
              ilike(stockWatchlist.ticker, `%${searchQuery}%`),
              ilike(stockWatchlist.companyName, `%${searchQuery}%`),
              ilike(stockWatchlist.sector, `%${searchQuery}%`)
            )
          )
        )
        .orderBy(
          sql`CASE WHEN UPPER(${stockWatchlist.ticker}) = UPPER(${searchQuery}) THEN 0 WHEN UPPER(${stockWatchlist.ticker}) LIKE UPPER(${searchQuery + '%'}) THEN 1 ELSE 2 END`,
          stockWatchlist.ticker
        )
        .limit(30)

      results.stocks = stockResults
    }

    return results
  } catch (error) {
    console.error('Error performing search:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Search failed',
    })
  }
})
