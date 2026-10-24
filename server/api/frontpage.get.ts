import { getDatabase } from '~/server/database/db'
import { leanGroup, outletShortName, sortOutlets } from '~/server/utils/outletColumns'
import {
  articles,
  classifications,
  feeds,
  stories,
  storyCoverage,
  storyEntities,
  storyMembers,
  storyNarratives,
  entities,
  entitySummaries,
} from '~/server/database/schema'
import { eq, desc, and, sql, inArray } from 'drizzle-orm'

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

// Rows in the coverage matrix (stories × outlets)
const MATRIX_ROWS = 10
// Days of history in each story's volume strip
const VOLUME_DAYS = 7

// Narrated headline when the story has one, else the newest article's title
const storyTitle = sql<string>`COALESCE(${stories.name}, ${stories.representativeTitle})`

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
  const feedLanguageFilter = language !== 'all' ? sql`AND f.language = ${language}` : sql``

  try {
    // 1. HERO STORY - top trending/active story with full details
    let [heroStory] = await db
      .select({
        id: stories.id,
        title: storyTitle,
        description: stories.description,
        summary: stories.summary,
        status: stories.status,
        articleCount: stories.articleCount,
        sourceCount: stories.sourceCount,
        trendingScore: stories.trendingScore,
        firstSeen: stories.firstSeen,
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
          title: storyTitle,
          description: stories.description,
          summary: stories.summary,
          status: stories.status,
          articleCount: stories.articleCount,
          sourceCount: stories.sourceCount,
          trendingScore: stories.trendingScore,
          firstSeen: stories.firstSeen,
          lastUpdated: stories.lastUpdated,
        })
        .from(stories)
        .where(sql`${stories.status} IN ('emerging', 'active') ${storyLanguageFilter}`)
        .orderBy(desc(stories.trendingScore))
        .limit(1)
    }

    // 2. OUTLETS - active feeds that published in the volume window; the matrix columns
    const outletRows = await db.execute(sql`
      SELECT f.id, f.name, f.known_bias, f.lean_applicable, f.ownership, f.country,
             COUNT(a.id)::int AS week_count,
             COUNT(a.id) FILTER (WHERE a.published_at > now() - interval '24 hours')::int AS day_count
      FROM feeds f
      JOIN articles a ON a.feed_id = f.id
        AND a.published_at > now() - make_interval(days => ${VOLUME_DAYS})
        AND a.published_at <= now()
        AND a.excluded = false
      WHERE f.is_active = 1 ${feedLanguageFilter}
      GROUP BY f.id
      ORDER BY week_count DESC
    `)
    const outlets = sortOutlets((outletRows.rows as any[])
      .map(r => ({
        id: r.id as number,
        name: r.name as string,
        shortName: outletShortName(r.name),
        bias: r.known_bias as number | null,
        leanApplicable: r.lean_applicable as boolean,
        ownership: r.ownership as string | null,
        country: r.country as string | null,
        group: leanGroup(r.known_bias, r.lean_applicable),
        weekCount: r.week_count as number,
        dayCount: r.day_count as number,
      })))

    // 3. ACTIVE STORIES - matrix rows first, the rest fill the sections
    const activeStories = await db
      .select({
        storyId: stories.id,
        title: storyTitle,
        status: stories.status,
        articleCount: stories.articleCount,
        sourceCount: stories.sourceCount,
        trendingScore: stories.trendingScore,
        firstSeen: stories.firstSeen,
        lastUpdated: stories.lastUpdated,
      })
      .from(stories)
      .where(
        heroStory
          ? sql`${stories.status} IN ('trending', 'emerging', 'active') AND ${stories.id} != ${heroStory.id} AND ${stories.articleCount} >= 2 ${storyLanguageFilter}`
          : sql`${stories.status} IN ('trending', 'emerging', 'active') AND ${stories.articleCount} >= 2 ${storyLanguageFilter}`
      )
      .orderBy(desc(stories.trendingScore))
      .limit(60)

    const matrixStories = activeStories.slice(0, MATRIX_ROWS)
    const sectionPool = activeStories.slice(MATRIX_ROWS)

    // Per-outlet counts and daily volume for the hero + matrix stories
    const coverageIds = [...(heroStory ? [heroStory.id] : []), ...matrixStories.map(s => s.storyId)]
    const outletCounts = new Map<number, Record<number, number>>()
    const outletLatest = new Map<number, Record<number, string>>()
    // Outlets that published on the story in the last 24h
    const outletFresh = new Map<number, number[]>()
    const dailyVolume = new Map<number, number[]>()
    const volumeDays: string[] = []

    if (coverageIds.length > 0) {
      const idList = sql.join(coverageIds.map(id => sql`${id}`), sql`, `)
      const [countRows, dayRows] = await Promise.all([
        db.execute(sql`
          SELECT sm.story_id, a.feed_id, COUNT(*)::int AS n, MAX(a.published_at) AS latest,
                 BOOL_OR(a.published_at > now() - interval '24 hours') AS fresh
          FROM story_members sm
          JOIN articles a ON a.id = sm.article_id
          WHERE sm.story_id IN (${idList})
          GROUP BY sm.story_id, a.feed_id
        `),
        // Days are UTC calendar days, today last
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
      ])

      for (const r of countRows.rows as any[]) {
        const counts = outletCounts.get(r.story_id) || {}
        counts[r.feed_id] = r.n
        outletCounts.set(r.story_id, counts)
        const latest = outletLatest.get(r.story_id) || {}
        latest[r.feed_id] = r.latest
        outletLatest.set(r.story_id, latest)
        if (r.fresh) {
          const fresh = outletFresh.get(r.story_id) || []
          fresh.push(r.feed_id)
          outletFresh.set(r.story_id, fresh)
        }
      }
      for (const r of dayRows.rows as any[]) {
        const days = dailyVolume.get(r.story_id) || []
        days.push(r.n)
        dailyVolume.set(r.story_id, days)
        if (r.story_id === coverageIds[0]) volumeDays.push(r.day)
      }
    }

    // 4. HERO DETAILS - coverage, entities, image, narrative
    let heroStoryWithDetails = null
    if (heroStory) {
      const [[coverage], heroEntityLinks, [narrative]] = await Promise.all([
        db.select().from(storyCoverage).where(eq(storyCoverage.storyId, heroStory.id)).limit(1),
        db
          .select({ entityId: storyEntities.entityId })
          .from(storyEntities)
          .where(eq(storyEntities.storyId, heroStory.id))
          .orderBy(desc(storyEntities.relevance))
          .limit(5),
        db
          .select({
            lede: storyNarratives.lede,
            perspectives: storyNarratives.perspectives,
            disagreements: storyNarratives.disagreements,
            generatedAt: storyNarratives.generatedAt,
          })
          .from(storyNarratives)
          .where(eq(storyNarratives.storyId, heroStory.id))
          .limit(1),
      ])

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
        const entityMap = new Map(entityRows.map(e => [e.id, e]))
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
          .orderBy(desc(articles.publishedAt))
          .limit(1)
        if (anyWithImage) repArticle = anyWithImage
      }

      const perspectives = ((narrative?.perspectives as any[]) || [])
        .filter(p => p?.outlet && p?.framing)
        .map(p => ({ outlet: p.outlet as string, feedIds: (p.feedIds || []) as number[], framing: p.framing as string }))

      heroStoryWithDetails = {
        ...heroStory,
        leftCount: coverage?.leftCount || 0,
        centerCount: coverage?.centerCount || 0,
        rightCount: coverage?.rightCount || 0,
        unratedCount: coverage?.unratedCount || 0,
        entities: heroEntities,
        imageUrl: repArticle?.imageUrl || null,
        imageLocalPath: repArticle?.imageLocalPath || null,
        outletCounts: outletCounts.get(heroStory.id) || {},
        outletFresh: outletFresh.get(heroStory.id) || [],
        daily: dailyVolume.get(heroStory.id) || [],
        narrative: narrative
          ? {
              lede: narrative.lede,
              perspectives,
              disagreement: ((narrative.disagreements as string[]) || [])[0] || null,
              generatedAt: narrative.generatedAt,
            }
          : null,
      }
    }

    // 5. COVERAGE MATRIX rows
    const coverageMatrix = {
      days: volumeDays,
      outlets,
      stories: matrixStories.map(s => ({
        id: s.storyId,
        title: s.title,
        status: s.status,
        articleCount: s.articleCount,
        firstSeen: s.firstSeen,
        lastUpdated: s.lastUpdated,
        counts: outletCounts.get(s.storyId) || {},
        latest: outletLatest.get(s.storyId) || {},
        fresh: outletFresh.get(s.storyId) || [],
        daily: dailyVolume.get(s.storyId) || [],
      })),
    }

    // 6. SECTION STORIES - the remaining stories grouped by dominant framing
    const sectionIds = sectionPool.map(s => s.storyId)
    const storyCoverageMap = new Map<number, { framingDistribution: any }>()
    const storyImageMap = new Map<number, { imageUrl: string | null; imageLocalPath: string | null }>()
    const storyEntityMap = new Map<number, any[]>()

    if (sectionIds.length > 0) {
      const [coverageRows, imageRows, seLinks] = await Promise.all([
        db
          .select({ storyId: storyCoverage.storyId, framingDistribution: storyCoverage.framingDistribution })
          .from(storyCoverage)
          .where(inArray(storyCoverage.storyId, sectionIds)),
        db
          .select({
            storyId: storyMembers.storyId,
            imageUrl: articles.imageUrl,
            imageLocalPath: articles.imageLocalPath,
          })
          .from(storyMembers)
          .innerJoin(articles, eq(storyMembers.articleId, articles.id))
          .where(and(inArray(storyMembers.storyId, sectionIds), sql`${articles.imageLocalPath} IS NOT NULL`))
          .orderBy(desc(articles.publishedAt)),
        db
          .select({ storyId: storyEntities.storyId, entityId: storyEntities.entityId })
          .from(storyEntities)
          .where(inArray(storyEntities.storyId, sectionIds))
          .orderBy(desc(storyEntities.relevance)),
      ])

      for (const r of coverageRows) storyCoverageMap.set(r.storyId, r)

      // Keep first (most recent) image per story
      for (const row of imageRows) {
        if (!storyImageMap.has(row.storyId)) {
          storyImageMap.set(row.storyId, { imageUrl: row.imageUrl, imageLocalPath: row.imageLocalPath })
        }
      }

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

    const categoryMap = new Map<string, any[]>()

    for (const story of sectionPool) {
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

    const categoryStories = CATEGORY_ORDER
      .filter(cat => categoryMap.has(cat))
      .map(cat => {
        const entry = Object.values(FRAMING_TO_CATEGORY).find(v => v.displayName === cat)
        return {
          category: cat.toLowerCase().replace(/ & /g, '_').replace(/ /g, '_'),
          displayName: cat,
          icon: entry?.icon || 'i-heroicons-newspaper',
          stories: categoryMap.get(cat) || [],
        }
      })
      .filter(cat => cat.stories.length > 0)

    // 7. IN THE NEWS - people and organisations by articles in the last 48h,
    // compared with the 48h before. Needs 2+ outlets so one feed can't push a name up.
    const [peopleRows, totalsRows, [storyTotal]] = await Promise.all([
      db.execute(sql`
        WITH mentions AS (
          SELECT ae.entity_id, a.feed_id,
                 a.published_at > now() - interval '48 hours' AS recent
          FROM article_entities ae
          JOIN articles a ON a.id = ae.article_id
          JOIN feeds f ON f.id = a.feed_id
          WHERE a.published_at > now() - interval '96 hours'
            AND a.excluded = false
            AND ae.relevance_score >= 0.5
            ${feedLanguageFilter}
        )
        SELECT e.id, e.name, e.type, e.slug, es.image_url, es.short_description,
               COUNT(*) FILTER (WHERE m.recent)::int AS recent,
               COUNT(*) FILTER (WHERE NOT m.recent)::int AS previous,
               COUNT(DISTINCT m.feed_id) FILTER (WHERE m.recent)::int AS outlets
        FROM mentions m
        JOIN entities e ON e.id = m.entity_id
        LEFT JOIN entity_summaries es ON es.entity_id = e.id
        WHERE e.type IN ('person', 'organization')
        GROUP BY e.id, es.image_url, es.short_description
        HAVING COUNT(DISTINCT m.feed_id) FILTER (WHERE m.recent) >= 2
        ORDER BY recent DESC
        LIMIT 8
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS articles, COUNT(DISTINCT a.feed_id)::int AS outlets
        FROM articles a
        JOIN feeds f ON f.id = a.feed_id
        WHERE a.published_at > now() - interval '24 hours' AND a.published_at <= now()
          AND a.excluded = false AND f.is_active = 1
          ${feedLanguageFilter}
      `),
      db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(stories)
        .where(sql`${stories.status} IN ('trending', 'emerging', 'active') ${storyLanguageFilter}`),
    ])

    const inTheNews = (peopleRows.rows as any[]).map(r => ({
      id: r.id as number,
      name: r.name as string,
      type: r.type as string,
      slug: r.slug as string | null,
      imageUrl: r.image_url as string | null,
      shortDescription: r.short_description as string | null,
      recent: r.recent as number,
      previous: r.previous as number,
      outlets: r.outlets as number,
    }))

    // 8. LATEST ARTICLES - the wire, language-filtered
    const recentArticleConditions = [
      sql`${articles.contentExtracted} = true`,
      sql`${articles.excluded} = false`,
      sql`${articles.publishedAt} IS NOT NULL`,
      sql`${articles.publishedAt} <= now()`,
    ]
    if (language !== 'all') {
      recentArticleConditions.push(sql`${classifications.language} = ${language}`)
      recentArticleConditions.push(sql`${feeds.language} = ${language}`)
    }

    const recentArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        publishedAt: articles.publishedAt,
        feedId: articles.feedId,
        feedName: feeds.name,
        storyId: storyMembers.storyId,
      })
      .from(articles)
      .innerJoin(feeds, eq(articles.feedId, feeds.id))
      .leftJoin(classifications, eq(articles.id, classifications.articleId))
      .leftJoin(storyMembers, eq(storyMembers.articleId, articles.id))
      .where(and(...recentArticleConditions))
      .orderBy(desc(articles.publishedAt))
      .limit(12)

    const totals = (totalsRows.rows as any[])[0] || { articles: 0, outlets: 0 }

    return {
      stats: {
        articles24h: totals.articles as number,
        outlets24h: totals.outlets as number,
        outletsTotal: outlets.length,
        activeStories: storyTotal?.n || 0,
      },
      heroStory: heroStoryWithDetails,
      coverageMatrix,
      categoryStories,
      inTheNews,
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
