import { getDatabase } from '~/server/database/db'
import { stories, storyMembers, articles, classifications, feeds, storyCoverage, storyEntities, entities, analyses, articleClaims, storyNarratives, storyRedirects } from '~/server/database/schema'
import { eq, desc, inArray, sql } from 'drizzle-orm'

const FRAMING_DISPLAY: Record<string, string> = {
  economic_impact: 'Economic Impact',
  human_rights: 'Human Rights',
  national_security: 'National Security',
  public_health: 'Public Health',
  environmental: 'Environmental',
  political_strategy: 'Political Strategy',
  human_interest: 'Human Interest',
  legal_judicial: 'Legal & Judicial',
  technology: 'Technology',
  conflict: 'Conflict',
  diplomatic: 'Diplomatic',
  social_justice: 'Social Justice',
}

/** Shortened outlet names for the narrow spots (chips, source lines) */
function shortOutletName(name: string | null): string {
  if (!name) return 'Unknown'
  return name.replace(/\s+-\s+World( News)?$/i, '').replace(/\s+\(.*\)$/, '')
}

interface NarrativeDevelopment { date: string; text: string; articleIds: number[] }
interface NarrativePerspective { outlet: string; feedIds: number[]; framing: string; articleIds: number[] }

const MAX_CLAIMS = 8
const MAX_CHAPTERS = 8

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const id = parseInt(event.context.params?.id || '0')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Story ID is required' })
  }

  try {
    const [story] = await db.select().from(stories).where(eq(stories.id, id)).limit(1)

    if (!story) {
      // Dissolved during reclustering: point the page at its successor
      const [redirect] = await db.select().from(storyRedirects).where(eq(storyRedirects.oldId, id)).limit(1)
      if (redirect) return { redirectTo: redirect.newId }
      throw createError({ statusCode: 404, statusMessage: 'Story not found' })
    }

    const [[coverage], [narrative], storyEntityList, storyArticles] = await Promise.all([
      db.select().from(storyCoverage).where(eq(storyCoverage.storyId, id)).limit(1),
      db.select().from(storyNarratives).where(eq(storyNarratives.storyId, id)).limit(1),
      db
        .select({
          id: entities.id,
          name: entities.name,
          type: entities.type,
          slug: entities.slug,
          relevance: storyEntities.relevance,
          isPrimary: storyEntities.isPrimary,
        })
        .from(storyEntities)
        .innerJoin(entities, eq(storyEntities.entityId, entities.id))
        .where(eq(storyEntities.storyId, id))
        .orderBy(desc(storyEntities.relevance)),
      db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          publishedAt: articles.publishedAt,
          feedId: articles.feedId,
          feedName: feeds.name,
          imageUrl: articles.imageUrl,
          imageLocalPath: articles.imageLocalPath,
          similarity: storyMembers.similarity,
          politicalBias: classifications.politicalBias,
          primaryFraming: classifications.primaryFraming,
          sensationalism: classifications.sensationalism,
          factOpinionRatio: classifications.factOpinionRatio,
          articleType: classifications.articleType,
          summary: analyses.summary,
        })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .leftJoin(classifications, eq(articles.id, classifications.articleId))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .leftJoin(analyses, eq(articles.id, analyses.articleId))
        .where(eq(storyMembers.storyId, id))
        .orderBy(articles.publishedAt),
    ])

    const articleIds = storyArticles.map(a => a.id)
    const feedIds = [...new Set(storyArticles.map(a => a.feedId))]

    const [feedRows, claimRows] = await Promise.all([
      feedIds.length > 0
        ? db
            .select({
              id: feeds.id,
              name: feeds.name,
              knownBias: feeds.knownBias,
              leanApplicable: feeds.leanApplicable,
              ownership: feeds.ownership,
              country: feeds.country,
            })
            .from(feeds)
            .where(inArray(feeds.id, feedIds))
        : Promise.resolve([]),
      articleIds.length > 0
        ? db
            .select({
              articleId: articleClaims.articleId,
              claimText: articleClaims.claimText,
              attribution: articleClaims.attribution,
              claimType: articleClaims.claimType,
              confidence: articleClaims.confidence,
            })
            .from(articleClaims)
            .where(inArray(articleClaims.articleId, articleIds))
        : Promise.resolve([]),
    ])

    const articleById = new Map(storyArticles.map(a => [a.id, a]))
    const articleRef = (articleId: number) => {
      const a = articleById.get(articleId)
      if (!a) return null
      return { id: a.id, title: a.title, url: a.url, feedId: a.feedId, outlet: shortOutletName(a.feedName), publishedAt: a.publishedAt }
    }

    // Outlets: who covered it, how much, and when
    const perspectiveByFeed = new Map<number, NarrativePerspective>()
    for (const p of (narrative?.perspectives as NarrativePerspective[] | undefined) || []) {
      for (const feedId of p.feedIds) perspectiveByFeed.set(feedId, p)
    }
    const outlets = feedRows
      .map((f) => {
        const own = storyArticles.filter(a => a.feedId === f.id)
        const perspective = perspectiveByFeed.get(f.id)
        const framingCounts: Record<string, number> = {}
        for (const a of own) {
          if (a.primaryFraming) framingCounts[a.primaryFraming] = (framingCounts[a.primaryFraming] || 0) + 1
        }
        const topFraming = Object.entries(framingCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
        // The outlet's typical headlines: the ones the narrative cites, else its newest
        const cited = (perspective?.articleIds || []).map(articleRef).filter(Boolean)
        const headlines = cited.length > 0
          ? cited
          : own.slice(-3).reverse().map(a => articleRef(a.id))
        return {
          feedId: f.id,
          name: f.name,
          shortName: shortOutletName(f.name),
          bias: f.knownBias,
          leanApplicable: f.leanApplicable,
          ownership: f.ownership,
          country: f.country,
          articleCount: own.length,
          firstAt: own[0]?.publishedAt || null,
          lastAt: own[own.length - 1]?.publishedAt || null,
          framing: perspective?.framing || null,
          topFraming: topFraming ? (FRAMING_DISPLAY[topFraming] || topFraming) : null,
          headlines,
        }
      })
      .sort((a, b) => b.articleCount - a.articleCount)

    // Daily activity, split by outlet so the chart shows who drove coverage when
    const activityMap = new Map<string, Record<number, number>>()
    for (const a of storyArticles) {
      if (!a.publishedAt) continue
      const day = new Date(a.publishedAt).toISOString().slice(0, 10)
      if (!activityMap.has(day)) activityMap.set(day, {})
      const byFeed = activityMap.get(day)!
      byFeed[a.feedId] = (byFeed[a.feedId] || 0) + 1
    }
    const activity: { date: string; count: number; byFeed: Record<number, number> }[] = []
    if (activityMap.size > 0) {
      // Fill gaps so quiet days show as quiet
      const days = [...activityMap.keys()].sort()
      const end = new Date(`${days[days.length - 1]}T00:00:00Z`)
      for (let d = new Date(`${days[0]}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10)
        const byFeed = activityMap.get(key) || {}
        activity.push({ date: key, count: Object.values(byFeed).reduce((s, n) => s + n, 0), byFeed })
      }
    }

    // Developments with their sources resolved
    const developments = ((narrative?.developments as NarrativeDevelopment[] | undefined) || []).map(d => ({
      date: d.date,
      text: d.text,
      sources: d.articleIds.map(articleRef).filter(Boolean),
    }))

    // Key claims: attributed quotes and figures first, one per wording, spread across outlets
    const seenClaims = new Set<string>()
    const claims = claimRows
      .filter(c => c.claimText && c.claimText.length > 20)
      .sort((a, b) => {
        const weight = (c: typeof a) => (c.attribution ? 0.3 : 0) + (c.claimType === 'quote' || c.claimType === 'statistic' ? 0.2 : 0) + (c.confidence || 0)
        return weight(b) - weight(a)
      })
      .filter((c) => {
        const key = c.claimText.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 60)
        if (seenClaims.has(key)) return false
        seenClaims.add(key)
        return true
      })
    const perOutletClaims = new Map<number, number>()
    const perSpeakerClaims = new Map<string, number>()
    const topClaims = claims
      .filter((c) => {
        const feedId = articleById.get(c.articleId)?.feedId ?? 0
        // "Zelensky" and "Volodymyr Zelenskyy" are one speaker: key on the last name's stem
        const speaker = (c.attribution || '').toLowerCase().split(/\s+/).pop()?.slice(0, 7) || ''
        if ((perOutletClaims.get(feedId) || 0) >= 3) return false
        if (speaker && (perSpeakerClaims.get(speaker) || 0) >= 2) return false
        perOutletClaims.set(feedId, (perOutletClaims.get(feedId) || 0) + 1)
        if (speaker) perSpeakerClaims.set(speaker, (perSpeakerClaims.get(speaker) || 0) + 1)
        return true
      })
      .slice(0, MAX_CLAIMS)
      .map(c => ({ ...c, source: articleRef(c.articleId) }))

    // Chapters: other stories about the same main entities, for the topic's history
    const chapterRows = storyEntityList.length > 0
      ? await db.execute(sql`
          WITH mine AS (
            SELECT entity_id, relevance FROM story_entities WHERE story_id = ${id}
          )
          SELECT s.id, s.representative_title, s.first_seen, s.last_updated, s.article_count, s.source_count,
                 n.headline, n.lede,
                 SUM(m.relevance * se.relevance) AS score
          FROM story_entities se
          JOIN mine m ON m.entity_id = se.entity_id
          JOIN stories s ON s.id = se.story_id
          LEFT JOIN story_narratives n ON n.story_id = s.id
          WHERE se.story_id <> ${id}
            AND s.article_count >= 3
            AND (${story.primaryLanguage}::text IS NULL OR s.primary_language = ${story.primaryLanguage})
          GROUP BY s.id, n.headline, n.lede
          HAVING COUNT(*) >= 2
          ORDER BY score DESC, s.last_updated DESC
          LIMIT ${MAX_CHAPTERS}
        `)
      : { rows: [] }
    const storyStart = new Date(story.firstSeen).getTime()
    const storyEnd = new Date(story.lastUpdated).getTime()
    const chapters = (chapterRows.rows as any[])
      .map((r) => {
        const start = new Date(r.first_seen).getTime()
        const end = new Date(r.last_updated).getTime()
        return {
          id: Number(r.id),
          title: r.headline || r.representative_title,
          lede: r.lede || null,
          firstSeen: r.first_seen,
          lastUpdated: r.last_updated,
          articleCount: Number(r.article_count),
          sourceCount: Number(r.source_count),
          relation: end < storyStart ? 'earlier' : start > storyEnd ? 'later' : 'overlapping',
        }
      })
      .sort((a, b) => new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime())

    // Framing distribution and quality averages
    const framingSummary: Record<string, number> = {}
    for (const a of storyArticles) {
      if (a.primaryFraming) framingSummary[a.primaryFraming] = (framingSummary[a.primaryFraming] || 0) + 1
    }
    const avg = (values: (number | null)[]) => {
      const present = values.filter((v): v is number => v !== null)
      return present.length > 0 ? present.reduce((s, v) => s + v, 0) / present.length : null
    }

    return {
      id: story.id,
      headline: narrative?.headline || story.representativeTitle || story.name,
      latestHeadline: story.representativeTitle,
      status: story.status,
      firstSeen: story.firstSeen,
      lastUpdated: story.lastUpdated,
      articleCount: storyArticles.length,
      sourceCount: story.sourceCount,
      primaryRegion: story.primaryRegion,
      topicLabel: story.topicLabel,
      narrative: narrative
        ? {
            lede: narrative.lede,
            background: narrative.background,
            agreements: narrative.agreements,
            disagreements: narrative.disagreements,
            openQuestions: narrative.openQuestions,
            generatedAt: narrative.generatedAt,
            articleCount: narrative.articleCount,
          }
        : null,
      developments,
      outlets,
      coverage: coverage || null,
      activity,
      claims: topClaims,
      entities: storyEntityList,
      chapters,
      framing: Object.entries(framingSummary)
        .map(([key, count]) => ({ key, label: FRAMING_DISPLAY[key] || key, count }))
        .sort((a, b) => b.count - a.count),
      avgSensationalism: avg(storyArticles.map(a => a.sensationalism)),
      avgFactuality: avg(storyArticles.map(a => a.factOpinionRatio)),
      articles: storyArticles.map(a => ({
        id: a.id,
        title: a.title,
        url: a.url,
        publishedAt: a.publishedAt,
        feedId: a.feedId,
        outlet: shortOutletName(a.feedName),
        imageUrl: a.imageUrl,
        imageLocalPath: a.imageLocalPath,
        politicalBias: a.politicalBias,
        framing: a.primaryFraming ? (FRAMING_DISPLAY[a.primaryFraming] || a.primaryFraming) : null,
        articleType: a.articleType,
        summary: a.summary ? a.summary.slice(0, 320) : null,
      })),
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Error fetching story details:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch story details' })
  }
})
