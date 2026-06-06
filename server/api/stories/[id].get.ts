import { getDatabase } from '~/server/database/db'
import { stories, storyMembers, articles, classifications, feeds, storyCoverage, storyEntities, entities, analyses, keywords, articleClaims } from '~/server/database/schema'
import { eq, desc, inArray, and, gte, lt } from 'drizzle-orm'

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

const FRAMING_COLORS: Record<string, string> = {
  economic_impact: 'emerald',
  human_rights: 'purple',
  national_security: 'red',
  public_health: 'teal',
  environmental: 'green',
  political_strategy: 'orange',
  human_interest: 'pink',
  legal_judicial: 'indigo',
  technology: 'cyan',
  conflict: 'rose',
  diplomatic: 'blue',
  social_justice: 'violet',
}

interface TimelineArticle {
  id: number
  title: string
  url: string
  feedName: string | null
  publishedAt: Date | string | null
  summary: string | null
  sentiment: number | null
  politicalBias: number | null
  primaryFraming: string | null
  sensationalism: number | null
  factOpinionRatio: number | null
  sourceCountCited: number | null
  articleType: string | null
  similarity: number | null
  imageUrl: string | null
  imageLocalPath: string | null
  feedId: number
}

interface FramingGroup {
  framing: string
  displayName: string
  color: string
  articles: TimelineArticle[]
  totalCount: number
  avgSentiment: number | null
}

interface PeriodClaim {
  claimText: string
  attribution: string | null
  claimType: string | null
  confidence: number | null
  articleId: number
  articleTitle: string
}

interface TimelinePeriod {
  periodStart: string
  periodEnd: string
  headline: string
  totalArticles: number
  sourceCount: number
  topKeywords: { keyword: string; count: number; avgRelevance: number }[]
  framingGroups: FramingGroup[]
  claims: PeriodClaim[]
}

function computeBucketSize(spanMs: number): { type: '12h' | 'day' | 'week' | 'month'; ms: number } {
  const days = spanMs / (1000 * 60 * 60 * 24)
  if (days <= 3) return { type: '12h', ms: 12 * 60 * 60 * 1000 }
  if (days <= 14) return { type: 'day', ms: 24 * 60 * 60 * 1000 }
  if (days <= 90) return { type: 'week', ms: 7 * 24 * 60 * 60 * 1000 }
  return { type: 'month', ms: 30 * 24 * 60 * 60 * 1000 }
}

function getBucketStart(date: Date, bucketType: string): Date {
  const d = new Date(date)
  if (bucketType === '12h') {
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() < 12 ? 0 : 12)
  } else if (bucketType === 'day') {
    d.setHours(0, 0, 0, 0)
  } else if (bucketType === 'week') {
    d.setHours(0, 0, 0, 0)
    const dayOfWeek = d.getDay()
    d.setDate(d.getDate() - dayOfWeek)
  } else {
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
  }
  return d
}

function getBucketEnd(bucketStart: Date, bucketType: string): Date {
  const d = new Date(bucketStart)
  if (bucketType === '12h') {
    d.setHours(d.getHours() + 12)
  } else if (bucketType === 'day') {
    d.setDate(d.getDate() + 1)
  } else if (bucketType === 'week') {
    d.setDate(d.getDate() + 7)
  } else {
    d.setMonth(d.getMonth() + 1)
  }
  return d
}

/** Select top N articles per group with source diversity */
function selectTopArticles(articleList: TimelineArticle[], maxCount: number): TimelineArticle[] {
  if (articleList.length <= maxCount) return articleList

  const sorted = [...articleList].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
  const selected: TimelineArticle[] = []
  const usedFeeds = new Set<number>()

  for (const article of sorted) {
    if (selected.length >= maxCount) break
    if (!usedFeeds.has(article.feedId)) {
      selected.push(article)
      usedFeeds.add(article.feedId)
    }
  }

  if (selected.length < maxCount) {
    for (const article of sorted) {
      if (selected.length >= maxCount) break
      if (!selected.find(s => s.id === article.id)) {
        selected.push(article)
      }
    }
  }

  return selected
}

/** Group articles by framing and return sorted framing groups */
function buildFramingGroups(articleList: TimelineArticle[], maxArticlesPerGroup: number = 3): FramingGroup[] {
  const groupMap = new Map<string, TimelineArticle[]>()

  for (const article of articleList) {
    const framing = article.primaryFraming || 'unclassified'
    if (!groupMap.has(framing)) {
      groupMap.set(framing, [])
    }
    groupMap.get(framing)!.push(article)
  }

  const groups: FramingGroup[] = []

  for (const [framing, articles] of groupMap) {
    const topArticles = selectTopArticles(articles, maxArticlesPerGroup)
    const withSentiment = articles.filter(a => a.sentiment !== null)
    const avgSentiment = withSentiment.length > 0
      ? withSentiment.reduce((sum, a) => sum + (a.sentiment || 0), 0) / withSentiment.length
      : null

    groups.push({
      framing,
      displayName: FRAMING_DISPLAY[framing] || framing.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      color: FRAMING_COLORS[framing] || 'gray',
      articles: topArticles,
      totalCount: articles.length,
      avgSentiment,
    })
  }

  // Sort by count descending
  groups.sort((a, b) => b.totalCount - a.totalCount)

  return groups
}

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const id = parseInt(event.context.params?.id || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Story ID is required',
    })
  }

  const query = getQuery(event)
  const periodStart = query.periodStart as string | undefined
  const periodEnd = query.periodEnd as string | undefined

  try {
    // Get story
    const [story] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, id))
      .limit(1)

    if (!story) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Story not found',
      })
    }

    // Get coverage data
    const [coverage] = await db
      .select()
      .from(storyCoverage)
      .where(eq(storyCoverage.storyId, id))
      .limit(1)

    // Get story entities
    const storyEntityList = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        relevance: storyEntities.relevance,
        isPrimary: storyEntities.isPrimary,
        articleCount: storyEntities.articleCount,
      })
      .from(storyEntities)
      .innerJoin(entities, eq(storyEntities.entityId, entities.id))
      .where(eq(storyEntities.storyId, id))
      .orderBy(desc(storyEntities.relevance))

    // If periodStart/periodEnd provided, return full articles for that period only
    if (periodStart && periodEnd) {
      const periodArticles = await db
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
          sourceCountCited: classifications.sourceCountCited,
          articleType: classifications.articleType,
          summary: analyses.summary,
          sentiment: analyses.sentiment,
        })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .leftJoin(classifications, eq(articles.id, classifications.articleId))
        .leftJoin(feeds, eq(articles.feedId, feeds.id))
        .leftJoin(analyses, eq(articles.id, analyses.articleId))
        .where(and(
          eq(storyMembers.storyId, id),
          gte(articles.publishedAt, new Date(periodStart)),
          lt(articles.publishedAt, new Date(periodEnd))
        ))
        .orderBy(desc(articles.publishedAt))

      return {
        periodArticles,
        periodStart,
        periodEnd,
      }
    }

    // Get all articles with feature fields
    const storyArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        publishedAt: articles.publishedAt,
        feedId: articles.feedId,
        feedName: feeds.name,
        isRepresentative: storyMembers.isRepresentative,
        similarity: storyMembers.similarity,
        imageUrl: articles.imageUrl,
        imageLocalPath: articles.imageLocalPath,
        politicalBias: classifications.politicalBias,
        primaryFraming: classifications.primaryFraming,
        sensationalism: classifications.sensationalism,
        factOpinionRatio: classifications.factOpinionRatio,
        sourceCountCited: classifications.sourceCountCited,
        articleType: classifications.articleType,
        summary: analyses.summary,
        sentiment: analyses.sentiment,
      })
      .from(storyMembers)
      .innerJoin(articles, eq(storyMembers.articleId, articles.id))
      .leftJoin(classifications, eq(articles.id, classifications.articleId))
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
      .leftJoin(analyses, eq(articles.id, analyses.articleId))
      .where(eq(storyMembers.storyId, id))
      .orderBy(desc(articles.publishedAt))

    // Compute time span
    const dates = storyArticles
      .map(a => a.publishedAt ? new Date(a.publishedAt).getTime() : null)
      .filter((d): d is number => d !== null)

    if (dates.length === 0) {
      return {
        ...story,
        coverage,
        entities: storyEntityList,
        timeline: { bucketType: 'day', periods: [] },
        framingSummary: {},
        avgSensationalism: null,
        avgFactuality: null,
        totalArticleCounts: { total: 0 },
      }
    }

    const minDate = Math.min(...dates)
    const maxDate = Math.max(...dates)
    const span = maxDate - minDate
    const bucket = computeBucketSize(span)

    // Group articles into time buckets
    const bucketMap = new Map<string, typeof storyArticles>()

    for (const article of storyArticles) {
      if (!article.publishedAt) continue
      const articleDate = new Date(article.publishedAt)
      const bucketStart = getBucketStart(articleDate, bucket.type)
      const key = bucketStart.toISOString()

      if (!bucketMap.has(key)) {
        bucketMap.set(key, [])
      }
      bucketMap.get(key)!.push(article)
    }

    // Collect all article IDs for keyword and claims batch fetch
    const allArticleIds = storyArticles.map(a => a.id)

    // Batch fetch claims for all articles
    const allClaims = allArticleIds.length > 0
      ? await db
          .select({
            articleId: articleClaims.articleId,
            claimText: articleClaims.claimText,
            attribution: articleClaims.attribution,
            claimType: articleClaims.claimType,
            confidence: articleClaims.confidence,
          })
          .from(articleClaims)
          .where(inArray(articleClaims.articleId, allArticleIds))
      : []

    // Build claims lookup by article ID
    const claimsByArticle = new Map<number, typeof allClaims>()
    for (const claim of allClaims) {
      if (!claimsByArticle.has(claim.articleId)) {
        claimsByArticle.set(claim.articleId, [])
      }
      claimsByArticle.get(claim.articleId)!.push(claim)
    }

    // Build article title lookup
    const articleTitleMap = new Map<number, string>()
    for (const a of storyArticles) {
      articleTitleMap.set(a.id, a.title)
    }

    // Collect top article IDs for keyword batch fetch
    const allTopArticleIds: number[] = []

    // Build periods with framing groups
    const periods: TimelinePeriod[] = []

    for (const [bucketStartStr, bucketArticles] of bucketMap) {
      const bucketStart = new Date(bucketStartStr)
      const bucketEnd = getBucketEnd(bucketStart, bucket.type)

      // Build framing groups
      const framingGroups = buildFramingGroups(bucketArticles as TimelineArticle[], 3)

      // Track top article IDs for keyword fetch
      const periodTopIds = framingGroups.flatMap(g => g.articles.map(a => a.id))
      allTopArticleIds.push(...periodTopIds)

      // Unique sources
      const uniqueFeeds = new Set(bucketArticles.map(a => a.feedId))

      // Pick headline from most representative article
      const representative = bucketArticles.find(a => a.isRepresentative) || bucketArticles[0]

      // Collect claims for this period's articles
      const periodClaims: PeriodClaim[] = []
      for (const article of bucketArticles) {
        const artClaims = claimsByArticle.get(article.id) || []
        for (const claim of artClaims) {
          periodClaims.push({
            claimText: claim.claimText,
            attribution: claim.attribution,
            claimType: claim.claimType,
            confidence: claim.confidence,
            articleId: article.id,
            articleTitle: article.title,
          })
        }
      }
      // Sort claims by confidence, take top 5 per period
      periodClaims.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

      periods.push({
        periodStart: bucketStart.toISOString(),
        periodEnd: bucketEnd.toISOString(),
        headline: representative?.title || '',
        totalArticles: bucketArticles.length,
        sourceCount: uniqueFeeds.size,
        topKeywords: [],
        framingGroups,
        claims: periodClaims.slice(0, 5),
      })
    }

    // Sort periods newest-first
    periods.sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())

    // Batch fetch keywords for all top articles
    if (allTopArticleIds.length > 0) {
      const topKeywords = await db
        .select({
          articleId: keywords.articleId,
          keyword: keywords.keyword,
          relevanceScore: keywords.relevanceScore,
        })
        .from(keywords)
        .where(inArray(keywords.articleId, allTopArticleIds))

      const keywordsByArticle = new Map<number, typeof topKeywords>()
      for (const kw of topKeywords) {
        if (!keywordsByArticle.has(kw.articleId)) {
          keywordsByArticle.set(kw.articleId, [])
        }
        keywordsByArticle.get(kw.articleId)!.push(kw)
      }

      for (const period of periods) {
        const periodArticleIds = period.framingGroups.flatMap(g => g.articles.map(a => a.id))

        const keywordAgg = new Map<string, { count: number; totalRelevance: number }>()

        for (const artId of periodArticleIds) {
          const artKeywords = keywordsByArticle.get(artId) || []
          for (const kw of artKeywords) {
            const existing = keywordAgg.get(kw.keyword)
            if (existing) {
              existing.count++
              existing.totalRelevance += kw.relevanceScore
            } else {
              keywordAgg.set(kw.keyword, { count: 1, totalRelevance: kw.relevanceScore })
            }
          }
        }

        period.topKeywords = Array.from(keywordAgg.entries())
          .map(([keyword, data]) => ({
            keyword,
            count: data.count,
            avgRelevance: data.totalRelevance / data.count,
          }))
          .sort((a, b) => (b.count * b.avgRelevance) - (a.count * a.avgRelevance))
          .slice(0, 5)
      }
    }

    // Compute framing summary across all articles
    const framingSummary: Record<string, number> = {}
    for (const a of storyArticles) {
      const framing = a.primaryFraming || 'unclassified'
      framingSummary[framing] = (framingSummary[framing] || 0) + 1
    }

    // Compute average sensationalism and factuality
    const withSensationalism = storyArticles.filter(a => a.sensationalism !== null)
    const avgSensationalism = withSensationalism.length > 0
      ? withSensationalism.reduce((sum, a) => sum + (a.sensationalism || 0), 0) / withSensationalism.length
      : null

    const withFactuality = storyArticles.filter(a => a.factOpinionRatio !== null)
    const avgFactuality = withFactuality.length > 0
      ? withFactuality.reduce((sum, a) => sum + (a.factOpinionRatio || 0), 0) / withFactuality.length
      : null

    return {
      ...story,
      coverage,
      entities: storyEntityList,
      timeline: {
        bucketType: bucket.type,
        periods,
      },
      framingSummary,
      avgSensationalism,
      avgFactuality,
      framingDisplay: FRAMING_DISPLAY,
      framingColors: FRAMING_COLORS,
      totalArticleCounts: {
        total: storyArticles.length,
      },
    }
  } catch (error: any) {
    if (error.statusCode) throw error
    console.error('Error fetching story details:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch story details',
    })
  }
})
