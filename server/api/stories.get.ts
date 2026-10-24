import { getDatabase } from '~/server/database/db'
import { leanGroup, outletShortName, sortOutlets } from '~/server/utils/outletColumns'
import { stories, storyEntities, entities, articles, feeds, keywords } from '~/server/database/schema'
import { eq, desc, sql, and, gte, inArray } from 'drizzle-orm'

// Days of history in each story's volume strip
const VOLUME_DAYS = 14

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const limit = Math.min(parseInt(query.limit as string || '20'), 50)
  const offset = Math.max(0, parseInt(query.offset as string || '0') || 0)
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
    const [results, [{ total }]] = await Promise.all([
      db
        .select({
          id: stories.id,
          title: sql<string>`COALESCE(${stories.name}, ${stories.representativeTitle})`,
          summary: stories.summary,
          status: stories.status,
          articleCount: stories.articleCount,
          sourceCount: stories.sourceCount,
          firstSeen: stories.firstSeen,
          lastUpdated: stories.lastUpdated,
          primaryRegion: stories.primaryRegion,
          primaryEntities: stories.primaryEntities,
        })
        .from(stories)
        .where(and(...conditions))
        .orderBy(orderByClause, desc(stories.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(stories)
        .where(and(...conditions)),
    ])

    // If no stories found and filtering by entity or keyword, return fallback articles
    if (results.length === 0 && offset === 0 && (entityId || keyword)) {
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
        fallbackArticles,
        stories: [],
        total: 0,
        outlets: [],
        days: [],
      }
    }

    // Columns: active outlets that published in the last 30 days
    const feedLanguageFilter = language !== 'all' ? sql`AND f.language = ${language}` : sql``
    const outletRows = await db.execute(sql`
      SELECT f.id, f.name, f.known_bias, f.lean_applicable, COUNT(a.id)::int AS n
      FROM feeds f
      JOIN articles a ON a.feed_id = f.id
        AND a.published_at > now() - interval '30 days'
        AND a.published_at <= now()
      WHERE f.is_active = 1 ${feedLanguageFilter}
      GROUP BY f.id
    `)
    const outlets = sortOutlets((outletRows.rows as any[])
      .map(r => ({
        id: r.id as number,
        name: r.name as string,
        shortName: outletShortName(r.name),
        bias: r.known_bias as number | null,
        group: leanGroup(r.known_bias, r.lean_applicable),
        weekCount: r.n as number,
      })))

    const storyIds = results.map(s => s.id)
    const counts = new Map<number, Record<number, number>>()
    const fresh = new Map<number, number[]>()
    const daily = new Map<number, number[]>()
    const images = new Map<number, { imageUrl: string | null; imageLocalPath: string | null }>()
    const fallbackEntities = new Map<number, Array<{ id: number; name: string; type: string }>>()
    const days: string[] = []

    if (storyIds.length > 0) {
      const idList = sql.join(storyIds.map(id => sql`${id}`), sql`, `)
      const needEntities = results
        .filter(r => !Array.isArray(r.primaryEntities) || (r.primaryEntities as any[]).length === 0)
        .map(r => r.id)

      const [countRows, dayRows, imageRows, entityRows] = await Promise.all([
        db.execute(sql`
          SELECT sm.story_id, a.feed_id, COUNT(*)::int AS n,
                 BOOL_OR(a.published_at > now() - interval '24 hours') AS fresh
          FROM story_members sm
          JOIN articles a ON a.id = sm.article_id
          WHERE sm.story_id IN (${idList})
          GROUP BY sm.story_id, a.feed_id
        `),
        // UTC calendar days, today last
        db.execute(sql`
          WITH days AS (
            SELECT ((now() AT TIME ZONE 'UTC')::date - g) AS day
            FROM generate_series(0, ${VOLUME_DAYS - 1}) g
          )
          SELECT s.id AS story_id, d.day::text AS day, COUNT(a.id)::int AS n
          FROM unnest(ARRAY[${idList}]::int[]) AS s(id)
          CROSS JOIN days d
          LEFT JOIN story_members sm ON sm.story_id = s.id
          LEFT JOIN articles a ON a.id = sm.article_id AND a.published_at::date = d.day
          GROUP BY s.id, d.day
          ORDER BY s.id, d.day
        `),
        // Newest member article that has a local image
        db.execute(sql`
          SELECT DISTINCT ON (sm.story_id) sm.story_id, a.image_url, a.image_local_path
          FROM story_members sm
          JOIN articles a ON a.id = sm.article_id
          WHERE sm.story_id IN (${idList}) AND a.image_local_path IS NOT NULL
          ORDER BY sm.story_id, sm.is_representative DESC, a.published_at DESC
        `),
        needEntities.length > 0
          ? db
              .select({ storyId: storyEntities.storyId, id: entities.id, name: entities.name, type: entities.type })
              .from(storyEntities)
              .innerJoin(entities, eq(storyEntities.entityId, entities.id))
              .where(inArray(storyEntities.storyId, needEntities))
              .orderBy(desc(storyEntities.relevance))
          : Promise.resolve([]),
      ])

      for (const r of countRows.rows as any[]) {
        const c = counts.get(r.story_id) || {}
        c[r.feed_id] = r.n
        counts.set(r.story_id, c)
        if (r.fresh) fresh.set(r.story_id, [...(fresh.get(r.story_id) || []), r.feed_id])
      }
      for (const r of dayRows.rows as any[]) {
        daily.set(r.story_id, [...(daily.get(r.story_id) || []), r.n])
        if (r.story_id === storyIds[0]) days.push(r.day)
      }
      for (const r of imageRows.rows as any[]) {
        images.set(r.story_id, { imageUrl: r.image_url, imageLocalPath: r.image_local_path })
      }
      for (const r of entityRows) {
        const list = fallbackEntities.get(r.storyId) || []
        if (list.length < 3) list.push({ id: r.id, name: r.name, type: r.type })
        fallbackEntities.set(r.storyId, list)
      }
    }

    const outletIds = new Set(outlets.map(o => o.id))

    return {
      total,
      outlets,
      days,
      stories: results.map((story) => {
        const c = counts.get(story.id) || {}
        const primary = Array.isArray(story.primaryEntities) ? (story.primaryEntities as any[]) : []
        return {
          id: story.id,
          title: story.title,
          summary: story.summary,
          status: story.status,
          articleCount: story.articleCount,
          sourceCount: story.sourceCount,
          firstSeen: story.firstSeen,
          lastUpdated: story.lastUpdated,
          primaryRegion: story.primaryRegion,
          entities: (primary.length ? primary : fallbackEntities.get(story.id) || [])
            .slice(0, 3)
            .map((e: any) => ({ id: e.id, name: e.name, type: e.type })),
          counts: c,
          // Articles from outlets that aren't columns (inactive feeds)
          otherCount: Object.entries(c).reduce((sum, [feedId, n]) => sum + (outletIds.has(Number(feedId)) ? 0 : n), 0),
          fresh: fresh.get(story.id) || [],
          daily: daily.get(story.id) || [],
          imageUrl: images.get(story.id)?.imageUrl || null,
          imageLocalPath: images.get(story.id)?.imageLocalPath || null,
        }
      }),
    }
  } catch (error) {
    console.error('Error fetching stories:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch stories',
    })
  }
})
