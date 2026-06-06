import { getDatabase } from '~/server/database/db'
import {
  articles,
  classifications,
  feeds,
  stories,
  storyCoverage,
  storyEntities,
  storyMembers,
  entities,
  keywords as keywordsTable,
} from '~/server/database/schema'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)
  const language = query.language as string || 'all'

  // Helper to build language filter condition for stories
  const storyLanguageFilter = language !== 'all'
    ? sql`AND EXISTS (
        SELECT 1 FROM story_members sm
        JOIN articles a ON sm.article_id = a.id
        JOIN classifications c ON c.article_id = a.id
        WHERE sm.story_id = ${stories.id}
        AND c.language = ${language}
      )`
    : sql``

  try {
    // 1. Get hero story (top trending story, or best active story if no trending)
    let [heroStory] = await db
      .select({
        id: stories.id,
        title: stories.representativeTitle,
        name: stories.name,
        description: stories.description,
        summary: stories.summary,
        status: stories.status,
        articleCount: stories.articleCount,
        sourceCount: stories.sourceCount,
        sourceDiversityScore: stories.sourceDiversityScore,
        trendingScore: stories.trendingScore,
        lastUpdated: stories.lastUpdated,
      })
      .from(stories)
      .where(sql`${stories.status} = 'trending' ${storyLanguageFilter}`)
      .orderBy(desc(stories.trendingScore))
      .limit(1)

    // Fallback to best active story if no trending story exists
    if (!heroStory) {
      ;[heroStory] = await db
        .select({
          id: stories.id,
          title: stories.representativeTitle,
          name: stories.name,
          description: stories.description,
          summary: stories.summary,
          status: stories.status,
          articleCount: stories.articleCount,
          sourceCount: stories.sourceCount,
          sourceDiversityScore: stories.sourceDiversityScore,
          trendingScore: stories.trendingScore,
          lastUpdated: stories.lastUpdated,
        })
        .from(stories)
        .where(sql`${stories.status} IN ('emerging', 'active') ${storyLanguageFilter}`)
        .orderBy(desc(stories.trendingScore))
        .limit(1)
    }

    // Get coverage and entities for hero story
    let heroStoryWithDetails = null
    if (heroStory) {
      const [coverage] = await db
        .select()
        .from(storyCoverage)
        .where(eq(storyCoverage.storyId, heroStory.id))
        .limit(1)

      const storyEntitiesData = await db
        .select({
          entityId: storyEntities.entityId,
          isPrimary: storyEntities.isPrimary,
        })
        .from(storyEntities)
        .where(eq(storyEntities.storyId, heroStory.id))
        .orderBy(desc(storyEntities.relevance))
        .limit(5)

      // Batch-fetch all entities for the hero story (avoids N+1 queries)
      const heroEntityIds = storyEntitiesData.map(link => link.entityId)
      let storyEntitiesList: any[] = []
      if (heroEntityIds.length > 0) {
        const allHeroEntities = await db
          .select()
          .from(entities)
          .where(inArray(entities.id, heroEntityIds))
        // Preserve ordering from storyEntitiesData (by relevance desc)
        const entityMap = new Map(allHeroEntities.map(e => [e.id, e]))
        storyEntitiesList = heroEntityIds.map(id => entityMap.get(id)).filter(Boolean)
      }

      // Fetch representative article image (fall back to any article with image)
      let [representativeArticle] = await db
        .select({
          imageUrl: articles.imageUrl,
          imageLocalPath: articles.imageLocalPath,
        })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .where(
          and(
            eq(storyMembers.storyId, heroStory.id),
            eq(storyMembers.isRepresentative, true)
          )
        )
        .limit(1)

      if (!representativeArticle?.imageLocalPath) {
        const [anyWithImage] = await db
          .select({
            imageUrl: articles.imageUrl,
            imageLocalPath: articles.imageLocalPath,
          })
          .from(storyMembers)
          .innerJoin(articles, eq(storyMembers.articleId, articles.id))
          .where(
            and(
              eq(storyMembers.storyId, heroStory.id),
              sql`${articles.imageLocalPath} IS NOT NULL`
            )
          )
          .limit(1)
        if (anyWithImage) representativeArticle = anyWithImage
      }

      heroStoryWithDetails = {
        ...heroStory,
        leftCount: coverage?.leftCount || 0,
        centerCount: coverage?.centerCount || 0,
        rightCount: coverage?.rightCount || 0,
        entities: storyEntitiesList.filter(Boolean),
        imageUrl: representativeArticle?.imageUrl || null,
        imageLocalPath: representativeArticle?.imageLocalPath || null,
      }
    }

    // 2. Get active feeds (filtered by language if specified)
    const feedConditions: any[] = [eq(feeds.isActive, 1)]
    if (language !== 'all') {
      feedConditions.push(eq(feeds.language, language))
    }

    const activeFeeds = await db
      .select({
        id: feeds.id,
        name: feeds.name,
        category: feeds.category,
        region: feeds.region,
        knownBias: feeds.knownBias,
        language: feeds.language,
      })
      .from(feeds)
      .where(and(...feedConditions))
      .orderBy(feeds.name)

    // 3. Get latest 3 articles from each feed
    const articlesByFeed = await Promise.all(
      activeFeeds.map(async (feed) => {
        const feedArticles = await db
          .select({
            id: articles.id,
            title: articles.title,
            content: articles.content,
            url: articles.url,
            author: articles.author,
            publishedAt: articles.publishedAt,
            imageUrl: articles.imageUrl,
            imageLocalPath: articles.imageLocalPath,
            imageFetchStatus: articles.imageFetchStatus,
            bias: classifications.politicalBias,
            language: classifications.language,
          })
          .from(articles)
          .leftJoin(classifications, eq(articles.id, classifications.articleId))
          .where(
            and(
              eq(articles.feedId, feed.id),
              eq(articles.contentExtracted, true),
              eq(articles.excluded, false)
            )
          )
          .orderBy(
            sql`CASE WHEN ${articles.imageLocalPath} IS NOT NULL THEN 0 ELSE 1 END`,
            desc(articles.publishedAt)
          )
          .limit(3)

        return { feed, articles: feedArticles }
      })
    )

    // Collect all article IDs across all feeds for batch keyword fetch
    const allDashboardArticleIds = articlesByFeed.flatMap(f => f.articles.map(a => a.id))

    // Batch-fetch keywords for all articles in one query (avoids N+1)
    const keywordsByArticleMap = new Map<number, string[]>()
    if (allDashboardArticleIds.length > 0) {
      const allKeywordsData = await db
        .select({
          articleId: keywordsTable.articleId,
          keyword: keywordsTable.keyword,
          relevanceScore: keywordsTable.relevanceScore,
        })
        .from(keywordsTable)
        .where(inArray(keywordsTable.articleId, allDashboardArticleIds))
        .orderBy(desc(keywordsTable.relevanceScore))

      for (const k of allKeywordsData) {
        if (!k.keyword) continue
        const existing = keywordsByArticleMap.get(k.articleId) || []
        if (existing.length < 3) {
          existing.push(k.keyword)
          keywordsByArticleMap.set(k.articleId, existing)
        }
      }
    }

    // Map keywords back to articles
    const articlesBySource = articlesByFeed.map(({ feed, articles: feedArticles }) => ({
      feed,
      articles: feedArticles.map(article => ({
        ...article,
        keywords: keywordsByArticleMap.get(article.id) || [],
      })),
    }))

    // Filter out sources with no articles
    const filteredArticlesBySource = articlesBySource.filter(
      source => source.articles.length > 0
    )

    // 4. Get trending stories for sidebar (top 5, excluding hero)
    const trendingStories = await db
      .select({
        id: stories.id,
        title: stories.representativeTitle,
        name: stories.name,
        status: stories.status,
        articleCount: stories.articleCount,
        sourceCount: stories.sourceCount,
        trendingScore: stories.trendingScore,
        lastUpdated: stories.lastUpdated,
      })
      .from(stories)
      .where(
        heroStory
          ? sql`${stories.id} != ${heroStory.id} AND ${stories.status} IN ('trending', 'emerging', 'active') ${storyLanguageFilter}`
          : sql`${stories.status} IN ('trending', 'emerging', 'active') ${storyLanguageFilter}`
      )
      .orderBy(desc(stories.trendingScore))
      .limit(5)

    return {
      heroStory: heroStoryWithDetails,
      articlesBySource: filteredArticlesBySource,
      trendingStories,
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch dashboard data',
    })
  }
})
