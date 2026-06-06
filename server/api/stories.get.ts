import { getDatabase } from '~/server/database/db'
import { stories, storyCoverage, storyEntities, entities, storyMembers, articles, classifications, feeds, keywords, articleClaims } from '~/server/database/schema'
import { eq, desc, sql, and, gte, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const limit = Math.min(parseInt(query.limit as string || '20'), 50)
  const sortBy = query.sortBy as string || 'trending' // 'trending', 'recent', 'diverse', 'largest'
  const language = query.language as string || 'all'
  const dateRange = query.dateRange as string || 'all'
  const region = query.region as string || 'all'
  const entityId = query.entity as string || ''
  const keyword = query.keyword as string || ''
  const view = query.view as string || 'list'

  try {
    // Determine sort order
    let orderByClause
    switch (sortBy) {
      case 'recent':
        orderByClause = desc(stories.lastUpdated)
        break
      case 'diverse':
        orderByClause = desc(stories.sourceDiversityScore)
        break
      case 'largest':
        orderByClause = desc(stories.articleCount)
        break
      case 'trending':
      default:
        orderByClause = desc(stories.trendingScore)
        break
    }

    // Build where conditions
    const conditions: any[] = [inArray(stories.status, ['active', 'emerging', 'trending', 'declining'])]

    // Date range filter on stories.lastUpdated
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
      conditions.push(gte(stories.lastUpdated, since))
    }

    // Region filter
    if (region !== 'all') {
      conditions.push(eq(stories.primaryRegion, region))
    }

    // Language filter: use primaryLanguage column if available, fall back to EXISTS subquery
    if (language !== 'all') {
      conditions.push(
        sql`(${stories.primaryLanguage} = ${language} OR (${stories.primaryLanguage} IS NULL AND EXISTS (
          SELECT 1 FROM story_members sm
          JOIN articles a ON sm.article_id = a.id
          JOIN classifications c ON c.article_id = a.id
          WHERE sm.story_id = ${stories.id}
          AND c.language = ${language}
        )))`
      )
    }

    // Entity filter
    if (entityId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM story_entities se
          WHERE se.story_id = ${stories.id}
          AND se.entity_id = ${parseInt(entityId)}
        )`
      )
    }

    // Keyword filter
    if (keyword) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM story_members sm
          JOIN keywords k ON k.article_id = sm.article_id
          WHERE sm.story_id = ${stories.id}
          AND k.keyword = ${keyword}
        )`
      )
    }

    // For regions view, return grouped data
    if (view === 'regions') {
      const regionGroups = await db
        .select({
          region: stories.primaryRegion,
          storyCount: sql<string>`COUNT(*)`,
          totalArticles: sql<string>`SUM(${stories.articleCount})`,
          maxTrending: sql<number>`MAX(${stories.trendingScore})`,
        })
        .from(stories)
        .where(and(...conditions))
        .groupBy(stories.primaryRegion)
        .orderBy(sql`COUNT(*) DESC`)

      return {
        view: 'regions',
        groups: regionGroups.map(g => ({
          region: g.region || 'Unknown',
          storyCount: parseInt(g.storyCount),
          totalArticles: parseInt(g.totalArticles),
          maxTrending: g.maxTrending,
        })),
      }
    }

    // For persons/organizations view, return entities grouped by story count
    if (view === 'persons' || view === 'organizations') {
      const entityType = view === 'persons' ? 'person' : 'organization'
      const entityGroups = await db
        .select({
          entityId: entities.id,
          entityName: entities.name,
          entitySlug: entities.slug,
          storyCount: sql<string>`COUNT(DISTINCT ${storyEntities.storyId})`,
          totalArticles: sql<string>`COALESCE(SUM(${stories.articleCount}), 0)`,
          maxTrending: sql<number>`MAX(${stories.trendingScore})`,
        })
        .from(storyEntities)
        .innerJoin(entities, eq(storyEntities.entityId, entities.id))
        .innerJoin(stories, and(
          eq(storyEntities.storyId, stories.id),
          ...conditions
        ))
        .where(eq(entities.type, entityType))
        .groupBy(entities.id, entities.name, entities.slug)
        .orderBy(sql`COUNT(DISTINCT ${storyEntities.storyId}) DESC`)
        .limit(50)

      return {
        view,
        groups: entityGroups.map(g => ({
          entityId: g.entityId,
          name: g.entityName,
          slug: g.entitySlug,
          storyCount: parseInt(g.storyCount),
          totalArticles: parseInt(g.totalArticles),
          maxTrending: g.maxTrending,
        })),
      }
    }

    // For keywords view, return keywords grouped by story count
    if (view === 'keywords') {
      const keywordGroups = await db
        .select({
          keyword: keywords.keyword,
          category: keywords.category,
          storyCount: sql<string>`COUNT(DISTINCT sm.story_id)`,
          articleCount: sql<string>`COUNT(DISTINCT ${keywords.articleId})`,
        })
        .from(keywords)
        .innerJoin(
          sql`story_members sm`,
          sql`sm.article_id = ${keywords.articleId}`
        )
        .innerJoin(stories, and(
          sql`${stories.id} = sm.story_id`,
          ...conditions
        ))
        .where(eq(keywords.category, 'topic'))
        .groupBy(keywords.keyword, keywords.category)
        .orderBy(sql`COUNT(DISTINCT sm.story_id) DESC`)
        .limit(50)

      return {
        view: 'keywords',
        groups: keywordGroups.map(g => ({
          keyword: g.keyword,
          category: g.category,
          storyCount: parseInt(g.storyCount),
          articleCount: parseInt(g.articleCount),
        })),
      }
    }

    // Fetch stories with coverage data
    const results = await db
      .select({
        id: stories.id,
        name: stories.name,
        representativeTitle: stories.representativeTitle,
        description: stories.description,
        summary: stories.summary,
        status: stories.status,
        trendingScore: stories.trendingScore,
        articleCount: stories.articleCount,
        sourceCount: stories.sourceCount,
        sourceDiversityScore: stories.sourceDiversityScore,
        firstSeen: stories.firstSeen,
        lastUpdated: stories.lastUpdated,
        topicLabel: stories.topicLabel,
        primaryRegion: stories.primaryRegion,
        primaryEntities: stories.primaryEntities,
        timeSpanHours: stories.timeSpanHours,
        clusterVersion: stories.clusterVersion,
        leftCount: storyCoverage.leftCount,
        centerCount: storyCoverage.centerCount,
        rightCount: storyCoverage.rightCount,
        coverageDiversityScore: storyCoverage.coverageDiversityScore,
        framingDistribution: storyCoverage.framingDistribution,
        avgSensationalism: storyCoverage.avgSensationalism,
        avgFactuality: storyCoverage.avgFactuality,
      })
      .from(stories)
      .leftJoin(storyCoverage, eq(stories.id, storyCoverage.storyId))
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit)

    // If no stories found and filtering by entity or keyword, return fallback articles
    if (results.length === 0 && (entityId || keyword)) {
      const articleConditions: any[] = []

      if (entityId) {
        articleConditions.push(
          sql`EXISTS (
            SELECT 1 FROM article_entities ae
            WHERE ae.article_id = ${articles.id}
            AND ae.entity_id = ${parseInt(entityId)}
          )`
        )
      }

      if (keyword) {
        articleConditions.push(
          sql`EXISTS (
            SELECT 1 FROM keywords k
            WHERE k.article_id = ${articles.id}
            AND k.keyword = ${keyword}
          )`
        )
      }

      const fallbackArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          imageUrl: articles.imageUrl,
          imageLocalPath: articles.imageLocalPath,
          publishedAt: articles.publishedAt,
          feedName: feeds.name,
        })
        .from(articles)
        .innerJoin(feeds, eq(articles.feedId, feeds.id))
        .where(and(...articleConditions))
        .orderBy(desc(articles.publishedAt))
        .limit(limit)

      return {
        fallbackArticles: fallbackArticles,
        stories: [],
      }
    }

    // Batch fetch top claims for all stories (avoids N+1)
    const storyIds = results.map(s => s.id)
    const allClaims = storyIds.length > 0
      ? await db
          .select({
            storyId: storyMembers.storyId,
            claimText: articleClaims.claimText,
            claimType: articleClaims.claimType,
            attribution: articleClaims.attribution,
            confidence: articleClaims.confidence,
          })
          .from(articleClaims)
          .innerJoin(storyMembers, eq(articleClaims.articleId, storyMembers.articleId))
          .where(inArray(storyMembers.storyId, storyIds))
          .orderBy(desc(articleClaims.confidence))
      : []

    // Group claims by story, keep top 3 per story
    const claimsByStory = new Map<number, Array<{ claimText: string; claimType: string | null; attribution: string | null }>>()
    for (const claim of allClaims) {
      const list = claimsByStory.get(claim.storyId) || []
      if (list.length < 3) {
        list.push({ claimText: claim.claimText, claimType: claim.claimType, attribution: claim.attribution })
        claimsByStory.set(claim.storyId, list)
      }
    }

    // Fetch entities and representative image for each story
    const storiesWithEntities = await Promise.all(
      results.map(async (story) => {
        // Use cached primaryEntities for v2 stories, fall back to DB query for v1
        let storyEntityList: Array<{ id: number; name: string; type: string }>
        if (story.primaryEntities && Array.isArray(story.primaryEntities) && (story.primaryEntities as any[]).length > 0) {
          storyEntityList = (story.primaryEntities as Array<{ id: number; name: string; type: string }>).slice(0, 3)
        } else {
          storyEntityList = await db
            .select({
              id: entities.id,
              name: entities.name,
              type: entities.type,
            })
            .from(storyEntities)
            .innerJoin(entities, eq(storyEntities.entityId, entities.id))
            .where(eq(storyEntities.storyId, story.id))
            .orderBy(desc(storyEntities.relevance))
            .limit(3)
        }

        // Fetch representative article with image
        const representativeArticle = await db
          .select({
            imageUrl: articles.imageUrl,
            imageLocalPath: articles.imageLocalPath,
          })
          .from(storyMembers)
          .innerJoin(articles, eq(storyMembers.articleId, articles.id))
          .where(
            and(
              eq(storyMembers.storyId, story.id),
              eq(storyMembers.isRepresentative, true)
            )
          )
          .limit(1)

        return {
          ...story,
          entities: storyEntityList,
          imageUrl: representativeArticle[0]?.imageUrl || null,
          imageLocalPath: representativeArticle[0]?.imageLocalPath || null,
          claims: claimsByStory.get(story.id) || [],
        }
      })
    )

    return storiesWithEntities
  } catch (error) {
    console.error('Error fetching stories:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch stories',
    })
  }
})
