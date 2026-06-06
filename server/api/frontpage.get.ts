import { getDatabase } from '~/server/database/db'
import {
  articles,
  analyses,
  classifications,
  feeds,
  stories,
  storyCoverage,
  storyEntities,
  storyMembers,
  entities,
  entitySummaries,
} from '~/server/database/schema'
import { eq, desc, and, sql, inArray, gt, ne } from 'drizzle-orm'

// Category mapping from framing values to display categories
const FRAMING_TO_CATEGORY: Record<string, { displayName: string; icon: string }> = {
  conflict: { displayName: 'Conflict & Security', icon: 'i-heroicons-shield-exclamation' },
  national_security: { displayName: 'Conflict & Security', icon: 'i-heroicons-shield-exclamation' },
  economic_impact: { displayName: 'Economy & Business', icon: 'i-heroicons-banknotes' },
  political_strategy: { displayName: 'Politics', icon: 'i-heroicons-building-library' },
  diplomatic: { displayName: 'Diplomacy & World', icon: 'i-heroicons-globe-americas' },
  human_interest: { displayName: 'Society', icon: 'i-heroicons-user-group' },
  human_rights: { displayName: 'Society', icon: 'i-heroicons-user-group' },
  social_justice: { displayName: 'Society', icon: 'i-heroicons-user-group' },
  environmental: { displayName: 'Health & Environment', icon: 'i-heroicons-heart' },
  public_health: { displayName: 'Health & Environment', icon: 'i-heroicons-heart' },
}

// All unique display categories in display order
const CATEGORY_ORDER = [
  'Politics',
  'Conflict & Security',
  'Economy & Business',
  'Diplomacy & World',
  'Society',
  'Health & Environment',
]

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)
  const language = (query.language as string) || 'all'

  // Language filter: only return stories containing articles in the requested language.
  // Uses both feed language AND classification language to avoid misclassified articles
  // (e.g. French articles incorrectly classified as English).
  const storyLanguageFilter = language !== 'all'
    ? sql`AND EXISTS (
        SELECT 1 FROM story_members sm
        JOIN articles a ON sm.article_id = a.id
        JOIN feeds f ON a.feed_id = f.id
        JOIN classifications c ON c.article_id = a.id
        WHERE sm.story_id = ${stories.id}
        AND c.language = ${language}
        AND f.language = ${language}
      )`
    : sql``

  try {
    // 1. HERO STORY - top trending/active story with full details
    let [heroStory] = await db
      .select({
        id: stories.id,
        title: stories.representativeTitle,
        description: stories.description,
        summary: stories.summary,
        status: stories.status,
        articleCount: stories.articleCount,
        sourceCount: stories.sourceCount,
        trendingScore: stories.trendingScore,
        lastUpdated: stories.lastUpdated,
      })
      .from(stories)
      .where(sql`${stories.status} = 'trending' ${storyLanguageFilter}`)
      .orderBy(desc(stories.trendingScore))
      .limit(1)

    if (!heroStory) {
      ;[heroStory] = await db
        .select({
          id: stories.id,
          title: stories.representativeTitle,
          description: stories.description,
          summary: stories.summary,
          status: stories.status,
          articleCount: stories.articleCount,
          sourceCount: stories.sourceCount,
          trendingScore: stories.trendingScore,
          lastUpdated: stories.lastUpdated,
        })
        .from(stories)
        .where(sql`${stories.status} IN ('emerging', 'active') ${storyLanguageFilter}`)
        .orderBy(desc(stories.trendingScore))
        .limit(1)
    }

    let heroStoryWithDetails = null
    if (heroStory) {
      // Get coverage
      const [coverage] = await db
        .select()
        .from(storyCoverage)
        .where(eq(storyCoverage.storyId, heroStory.id))
        .limit(1)

      // Get entities
      const heroEntityLinks = await db
        .select({ entityId: storyEntities.entityId })
        .from(storyEntities)
        .where(eq(storyEntities.storyId, heroStory.id))
        .orderBy(desc(storyEntities.relevance))
        .limit(5)

      const heroEntityIds = heroEntityLinks.map(l => l.entityId)
      let heroEntities: any[] = []
      if (heroEntityIds.length > 0) {
        const entityRows = await db
          .select({
            id: entities.id,
            name: entities.name,
            type: entities.type,
            slug: entities.slug,
          })
          .from(entities)
          .where(inArray(entities.id, heroEntityIds))

        // Get image URLs from summaries
        const entitySummaryRows = await db
          .select({ entityId: entitySummaries.entityId, imageUrl: entitySummaries.imageUrl })
          .from(entitySummaries)
          .where(inArray(entitySummaries.entityId, heroEntityIds))

        const imageMap = new Map(entitySummaryRows.map(s => [s.entityId, s.imageUrl]))
        const entityMap = new Map(entityRows.map(e => [e.id, { ...e, imageUrl: imageMap.get(e.id) || null }]))
        heroEntities = heroEntityIds.map(id => entityMap.get(id)).filter(Boolean)
      }

      // Get representative image
      let [repArticle] = await db
        .select({ imageUrl: articles.imageUrl, imageLocalPath: articles.imageLocalPath })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .where(and(eq(storyMembers.storyId, heroStory.id), eq(storyMembers.isRepresentative, true)))
        .limit(1)

      if (!repArticle?.imageLocalPath) {
        const [anyWithImage] = await db
          .select({ imageUrl: articles.imageUrl, imageLocalPath: articles.imageLocalPath })
          .from(storyMembers)
          .innerJoin(articles, eq(storyMembers.articleId, articles.id))
          .where(and(eq(storyMembers.storyId, heroStory.id), sql`${articles.imageLocalPath} IS NOT NULL`))
          .limit(1)
        if (anyWithImage) repArticle = anyWithImage
      }

      heroStoryWithDetails = {
        ...heroStory,
        leftCount: coverage?.leftCount || 0,
        centerCount: coverage?.centerCount || 0,
        rightCount: coverage?.rightCount || 0,
        entities: heroEntities,
        imageUrl: repArticle?.imageUrl || null,
        imageLocalPath: repArticle?.imageLocalPath || null,
      }
    }

    // 2. CATEGORY STORIES - stories grouped by dominant framing
    const activeStories = await db
      .select({
        storyId: stories.id,
        title: stories.representativeTitle,
        status: stories.status,
        articleCount: stories.articleCount,
        trendingScore: stories.trendingScore,
        lastUpdated: stories.lastUpdated,
      })
      .from(stories)
      .where(
        heroStory
          ? sql`${stories.status} IN ('trending', 'emerging', 'active') AND ${stories.id} != ${heroStory.id} AND ${stories.articleCount} >= 2 ${storyLanguageFilter}`
          : sql`${stories.status} IN ('trending', 'emerging', 'active') AND ${stories.articleCount} >= 2 ${storyLanguageFilter}`
      )
      .orderBy(desc(stories.trendingScore))
      .limit(50)

    // Fetch framing distribution for these stories
    const activeStoryIds = activeStories.map(s => s.storyId)
    let storyCoverageMap = new Map<number, { framingDistribution: any }>()
    if (activeStoryIds.length > 0) {
      const coverageRows = await db
        .select({ storyId: storyCoverage.storyId, framingDistribution: storyCoverage.framingDistribution })
        .from(storyCoverage)
        .where(inArray(storyCoverage.storyId, activeStoryIds))
      storyCoverageMap = new Map(coverageRows.map(r => [r.storyId, r]))
    }

    // Get images for category stories
    let storyImageMap = new Map<number, { imageUrl: string | null; imageLocalPath: string | null }>()
    if (activeStoryIds.length > 0) {
      const imageRows = await db
        .select({
          storyId: storyMembers.storyId,
          imageUrl: articles.imageUrl,
          imageLocalPath: articles.imageLocalPath,
        })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .where(
          and(
            inArray(storyMembers.storyId, activeStoryIds),
            sql`${articles.imageLocalPath} IS NOT NULL`
          )
        )
        .orderBy(desc(articles.publishedAt))

      // Keep first (most recent) image per story
      for (const row of imageRows) {
        if (!storyImageMap.has(row.storyId)) {
          storyImageMap.set(row.storyId, { imageUrl: row.imageUrl, imageLocalPath: row.imageLocalPath })
        }
      }
    }

    // Get entities for category stories
    let storyEntityMap = new Map<number, any[]>()
    if (activeStoryIds.length > 0) {
      const seLinks = await db
        .select({
          storyId: storyEntities.storyId,
          entityId: storyEntities.entityId,
        })
        .from(storyEntities)
        .where(inArray(storyEntities.storyId, activeStoryIds))
        .orderBy(desc(storyEntities.relevance))

      const allEntityIds = [...new Set(seLinks.map(l => l.entityId))]
      let entityLookup = new Map<number, any>()
      if (allEntityIds.length > 0) {
        const eRows = await db
          .select({ id: entities.id, name: entities.name, type: entities.type, slug: entities.slug })
          .from(entities)
          .where(inArray(entities.id, allEntityIds))
        entityLookup = new Map(eRows.map(e => [e.id, e]))
      }

      for (const link of seLinks) {
        const existing = storyEntityMap.get(link.storyId) || []
        if (existing.length < 3) {
          const entity = entityLookup.get(link.entityId)
          if (entity) existing.push(entity)
        }
        storyEntityMap.set(link.storyId, existing)
      }
    }

    // Group stories by their dominant framing category
    const categoryMap = new Map<string, any[]>()

    for (const story of activeStories) {
      const coverage = storyCoverageMap.get(story.storyId)
      const framing = coverage?.framingDistribution as Record<string, number> | null

      let dominantCategory = 'Politics' // Default
      if (framing) {
        let maxCount = 0
        for (const [key, count] of Object.entries(framing)) {
          if (key === 'unclassified') continue
          const mapped = FRAMING_TO_CATEGORY[key]
          if (mapped && (count as number) > maxCount) {
            maxCount = count as number
            dominantCategory = mapped.displayName
          }
        }
      }

      const existing = categoryMap.get(dominantCategory) || []
      if (existing.length < 3) {
        const image = storyImageMap.get(story.storyId)
        existing.push({
          id: story.storyId,
          title: story.title,
          status: story.status,
          articleCount: story.articleCount,
          imageUrl: image?.imageUrl || null,
          imageLocalPath: image?.imageLocalPath || null,
          entities: storyEntityMap.get(story.storyId) || [],
          lastUpdated: story.lastUpdated,
        })
        categoryMap.set(dominantCategory, existing)
      }
    }

    // Build ordered category sections
    const categoryStories = CATEGORY_ORDER
      .filter(cat => categoryMap.has(cat))
      .map(cat => {
        // Find the icon for this category
        const entry = Object.values(FRAMING_TO_CATEGORY).find(v => v.displayName === cat)
        return {
          category: cat.toLowerCase().replace(/ & /g, '_').replace(/ /g, '_'),
          displayName: cat,
          icon: entry?.icon || 'i-heroicons-newspaper',
          stories: categoryMap.get(cat) || [],
        }
      })
      .filter(cat => cat.stories.length > 0)
      .slice(0, 6)

    // 3. TRENDING ENTITIES - top 8 with images
    const trendingEntities = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        slug: entities.slug,
        shortDescription: entitySummaries.shortDescription,
        imageUrl: entitySummaries.imageUrl,
        trendingScore: entitySummaries.trendingScore,
      })
      .from(entitySummaries)
      .innerJoin(entities, eq(entitySummaries.entityId, entities.id))
      .where(gt(entitySummaries.trendingScore, 0))
      .orderBy(desc(entitySummaries.trendingScore))
      .limit(8)

    // 4. PERSPECTIVE SHOWCASE - story with best left/right diversity
    let perspectiveStory = null

    const [diverseStory] = await db
      .select({
        storyId: storyCoverage.storyId,
        leftCount: storyCoverage.leftCount,
        centerCount: storyCoverage.centerCount,
        rightCount: storyCoverage.rightCount,
      })
      .from(storyCoverage)
      .innerJoin(stories, eq(storyCoverage.storyId, stories.id))
      .where(
        and(
          gt(storyCoverage.leftCount, 0),
          gt(storyCoverage.rightCount, 0),
          sql`${stories.articleCount} >= 4`,
          sql`${stories.status} IN ('trending', 'emerging', 'active') ${storyLanguageFilter}`
        )
      )
      .orderBy(desc(sql`${storyCoverage.leftCount} + ${storyCoverage.centerCount} + ${storyCoverage.rightCount}`))
      .limit(1)

    if (diverseStory) {
      const [storyData] = await db
        .select({
          id: stories.id,
          title: stories.representativeTitle,
          description: stories.description,
        })
        .from(stories)
        .where(eq(stories.id, diverseStory.storyId))
        .limit(1)

      if (storyData) {
        // Get representative articles for each bias bucket
        const storyArticles = await db
          .select({
            articleId: articles.id,
            title: articles.title,
            feedName: feeds.name,
            bias: classifications.politicalBias,
          })
          .from(storyMembers)
          .innerJoin(articles, eq(storyMembers.articleId, articles.id))
          .innerJoin(feeds, eq(articles.feedId, feeds.id))
          .leftJoin(classifications, eq(articles.id, classifications.articleId))
          .where(eq(storyMembers.storyId, diverseStory.storyId))
          .orderBy(desc(articles.publishedAt))

        // Get analysis summaries
        const articleIds = storyArticles.map(a => a.articleId)
        let analysisByArticle = new Map<number, string>()
        if (articleIds.length > 0) {
          const analysisRows = await db
            .select({ articleId: analyses.articleId, summary: analyses.summary })
            .from(analyses)
            .where(inArray(analyses.articleId, articleIds))
          analysisByArticle = new Map(analysisRows.map(a => [a.articleId, a.summary || '']))
        }

        // Pick one article per bias bucket
        let leftArticle = null
        let centerArticle = null
        let rightArticle = null

        for (const a of storyArticles) {
          const bias = a.bias ?? 0
          const entry = {
            id: a.articleId,
            title: a.title,
            feedName: a.feedName,
            excerpt: (analysisByArticle.get(a.articleId) || '').slice(0, 200),
            politicalBias: bias,
          }
          if (bias < -0.2 && !leftArticle) leftArticle = entry
          else if (bias >= -0.2 && bias <= 0.2 && !centerArticle) centerArticle = entry
          else if (bias > 0.2 && !rightArticle) rightArticle = entry
        }

        perspectiveStory = {
          id: storyData.id,
          title: storyData.title,
          description: storyData.description,
          leftArticle,
          centerArticle,
          rightArticle,
          leftCount: diverseStory.leftCount,
          centerCount: diverseStory.centerCount,
          rightCount: diverseStory.rightCount,
        }
      }
    }

    // 5. TRENDING STORIES sidebar (top 5, excluding hero)
    const trendingStories = await db
      .select({
        id: stories.id,
        title: stories.representativeTitle,
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

    // 6. RECENT ARTICLES - latest individual articles, language-filtered
    const recentArticleConditions = [
      sql`${articles.contentExtracted} = true`,
      sql`${articles.excluded} = false`,
      sql`${articles.publishedAt} IS NOT NULL`,
    ]
    if (language !== 'all') {
      recentArticleConditions.push(sql`${classifications.language} = ${language}`)
      recentArticleConditions.push(sql`${feeds.language} = ${language}`)
    }

    const recentArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        publishedAt: articles.publishedAt,
        imageUrl: articles.imageUrl,
        imageLocalPath: articles.imageLocalPath,
        feedName: feeds.name,
        feedBias: feeds.knownBias,
        politicalBias: classifications.politicalBias,
        primaryFraming: classifications.primaryFraming,
      })
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .leftJoin(classifications, eq(articles.id, classifications.articleId))
      .where(and(...recentArticleConditions))
      .orderBy(desc(articles.publishedAt))
      .limit(12)

    return {
      heroStory: heroStoryWithDetails,
      categoryStories,
      trendingEntities,
      perspectiveStory,
      trendingStories,
      recentArticles,
    }
  } catch (error) {
    console.error('[Frontpage] Error fetching data:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch frontpage data',
    })
  }
})
