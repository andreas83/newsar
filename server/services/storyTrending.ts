/**
 * Story Trending Score Calculator
 * Calculates trending scores for stories based on multiple factors
 */

import { getDatabase } from '../database/db'
import { stories, storyMembers, articles, storyCoverage, classifications, articleEntities, entities } from '../database/schema'
import { eq, sql, inArray, desc } from 'drizzle-orm'
import { normalizeGeoPov } from './geoNormalizer'

interface TrendingFactors {
  articleCount: number
  sourceCount: number
  sourceDiversityScore: number
  ageInHours: number
  hoursSinceUpdate: number
  freshness: number // 0-1, how recent the last update was
  velocity: number // articles per hour since first seen
}

/**
 * Calculate trending score for a story
 * Score is from 0 to 100, higher = more trending
 */
export function calculateTrendingScore(factors: TrendingFactors): number {
  const {
    articleCount,
    sourceCount,
    sourceDiversityScore,
    ageInHours,
    hoursSinceUpdate,
    freshness,
    velocity,
  } = factors

  // Weight factors (totals to 1.0)
  const weights = {
    volume: 0.25, // Article count matters
    diversity: 0.20, // Source diversity is important
    recency: 0.30, // Recent updates score higher
    velocity: 0.25, // Fast-growing stories score higher
  }

  // Normalize article count (logarithmic scale, caps at 50 articles)
  const volumeScore = Math.min(Math.log10(articleCount + 1) / Math.log10(51), 1) * 100

  // Source diversity score is already 0-1, multiply by source count up to 10
  const diversityScore = sourceDiversityScore * Math.min(sourceCount / 10, 1) * 100

  // Recency score: fresher = better, decay over 7 days
  const recencyScore = freshness * 100

  // Velocity score: more articles per hour = higher score
  // Cap at 2 articles/hour for trending status
  const velocityScore = Math.min(velocity / 2, 1) * 100

  // Calculate weighted score
  const rawScore =
    weights.volume * volumeScore +
    weights.diversity * diversityScore +
    weights.recency * recencyScore +
    weights.velocity * velocityScore

  // Apply hard time-decay: stories lose relevance exponentially after 7 days
  // Half-life of ~3 days for the decay portion
  const daysSinceUpdate = hoursSinceUpdate / 24
  const decayMultiplier = daysSinceUpdate <= 7
    ? 1.0
    : Math.max(0.05, Math.exp(-0.05 * (daysSinceUpdate - 7)))

  const trendingScore = rawScore * decayMultiplier

  return Math.round(trendingScore * 10) / 10 // Round to 1 decimal
}

/**
 * Determine story status based on trending score, age, and freshness
 */
export function determineStoryStatus(
  trendingScore: number,
  ageInHours: number,
  velocity: number,
  hoursSinceUpdate: number = ageInHours
): 'emerging' | 'trending' | 'active' | 'declining' {
  // Emerging: new stories (< 24 hours) with good velocity
  if (ageInHours < 24 && velocity > 0.5 && trendingScore > 40) {
    return 'emerging'
  }

  // Trending: high score stories with recent activity (updated within 72 hours)
  if (trendingScore >= 60 && hoursSinceUpdate < 72) {
    return 'trending'
  }

  // Active: moderate score with recent activity
  if (trendingScore >= 30 && hoursSinceUpdate < 168) {
    return 'active'
  }

  // Declining: no recent updates (7+ days) or very low score
  if (hoursSinceUpdate > 168 || trendingScore < 15) {
    return 'declining'
  }

  // Default: active
  return 'active'
}

/**
 * Update trending score for a single story
 */
export async function updateStoryTrendingScore(storyId: number): Promise<{
  score: number
  status: string
}> {
  const db = getDatabase()

  // Get story details
  const [story] = await db
    .select()
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)

  if (!story) {
    throw new Error(`Story ${storyId} not found`)
  }

  const now = new Date()
  const firstSeen = new Date(story.firstSeen!)
  const lastUpdated = new Date(story.lastUpdated!)

  const ageInHours = (now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60)
  const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60)

  // Calculate freshness (1 = just updated, decays to 0 over 7 days)
  const freshness = Math.max(0, 1 - hoursSinceUpdate / (7 * 24))

  // Calculate velocity (articles per hour since creation)
  const velocity = ageInHours > 0 ? (story.articleCount || 0) / ageInHours : 0

  const factors: TrendingFactors = {
    articleCount: story.articleCount || 0,
    sourceCount: story.sourceCount || 0,
    sourceDiversityScore: story.sourceDiversityScore || 0,
    ageInHours,
    hoursSinceUpdate,
    freshness,
    velocity,
  }

  const trendingScore = calculateTrendingScore(factors)
  const status = determineStoryStatus(trendingScore, ageInHours, velocity, hoursSinceUpdate)

  // Update the story
  await db
    .update(stories)
    .set({
      trendingScore,
      status,
      updatedAt: now,
    })
    .where(eq(stories.id, storyId))

  console.log(`Updated story ${storyId}: score=${trendingScore}, status=${status}`)

  return { score: trendingScore, status }
}

/**
 * Update trending scores for all stories
 */
export async function updateAllStoryTrendingScores(): Promise<{
  updated: number
  trending: number
  emerging: number
  active: number
  declining: number
}> {
  const db = getDatabase()

  // Get all stories
  const allStories = await db.select({ id: stories.id }).from(stories)

  const stats = {
    updated: 0,
    trending: 0,
    emerging: 0,
    active: 0,
    declining: 0,
  }

  console.log(`Updating trending scores for ${allStories.length} stories...`)

  // Get stories that need topic metadata populated
  const storiesNeedingMetadata = await db
    .select({ id: stories.id })
    .from(stories)
    .where(sql`${stories.topicLabel} IS NULL`)

  if (storiesNeedingMetadata.length > 0) {
    console.log(`Populating topic metadata for ${storiesNeedingMetadata.length} stories...`)
    for (const story of storiesNeedingMetadata) {
      await updateStoryTopicMetadata(story.id)
    }
  }

  for (const story of allStories) {
    const result = await updateStoryTrendingScore(story.id)
    stats.updated++

    // Count by status
    if (result.status === 'trending') stats.trending++
    else if (result.status === 'emerging') stats.emerging++
    else if (result.status === 'active') stats.active++
    else if (result.status === 'declining') stats.declining++
  }

  console.log(`Trending score update complete:`, stats)

  return stats
}

/**
 * Update topic metadata for a story (topic_label, primary_region, primary_entities, time_span_hours)
 * Computes from article entities and classifications if not already set.
 */
export async function updateStoryTopicMetadata(storyId: number): Promise<void> {
  const db = getDatabase()

  // Get article IDs for this story
  const members = await db
    .select({ articleId: storyMembers.articleId })
    .from(storyMembers)
    .where(eq(storyMembers.storyId, storyId))

  if (members.length === 0) return

  const articleIds = members.map(m => m.articleId)

  // Get entities with relevance scores for these articles
  const entityLinks = await db
    .select({
      entityId: articleEntities.entityId,
      name: entities.name,
      type: entities.type,
      relevanceScore: articleEntities.relevanceScore,
    })
    .from(articleEntities)
    .innerJoin(entities, eq(articleEntities.entityId, entities.id))
    .where(inArray(articleEntities.articleId, articleIds))

  // Aggregate entity weights
  const entityAgg = new Map<number, { name: string; type: string; totalWeight: number }>()
  for (const link of entityLinks) {
    const existing = entityAgg.get(link.entityId)
    if (existing) {
      existing.totalWeight += link.relevanceScore
    } else {
      entityAgg.set(link.entityId, {
        name: link.name,
        type: link.type,
        totalWeight: link.relevanceScore,
      })
    }
  }

  // Top 5 entities by aggregate weight
  const sorted = Array.from(entityAgg.entries())
    .sort((a, b) => b[1].totalWeight - a[1].totalWeight)
    .slice(0, 5)

  const primaryEntities = sorted.map(([id, e]) => ({ id, name: e.name, type: e.type }))
  const topicLabel = primaryEntities.slice(0, 3).map(e => e.name).join(' / ') || null

  // Primary region from geoPov
  const classRows = await db
    .select({ geoPov: classifications.geoPov })
    .from(classifications)
    .where(inArray(classifications.articleId, articleIds))

  const regionCounts = new Map<string, number>()
  for (const row of classRows) {
    if (!row.geoPov) continue
    const norm = await normalizeGeoPov(row.geoPov)
    if (norm) {
      regionCounts.set(norm.country, (regionCounts.get(norm.country) || 0) + 1)
    }
  }

  let primaryRegion: string | null = null
  let maxCount = 0
  for (const [region, count] of regionCounts) {
    if (count > maxCount) {
      maxCount = count
      primaryRegion = region
    }
  }

  // Time span
  const articleDates = await db
    .select({ publishedAt: articles.publishedAt })
    .from(articles)
    .where(inArray(articles.id, articleIds))

  const timestamps = articleDates
    .map(a => a.publishedAt?.getTime())
    .filter((t): t is number => t !== undefined && t !== null)
    .sort((a, b) => a - b)

  const timeSpanHours = timestamps.length >= 2
    ? (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60)
    : 0

  // Update story
  await db
    .update(stories)
    .set({
      topicLabel,
      primaryRegion,
      primaryEntities: primaryEntities.length > 0 ? primaryEntities : null,
      timeSpanHours,
    })
    .where(eq(stories.id, storyId))
}

/**
 * Generate a representative title for a story based on its articles
 */
export async function generateStoryTitle(storyId: number): Promise<string | null> {
  const db = getDatabase()

  // Get the most recent article title from the story
  const [member] = await db
    .select({
      title: articles.title,
    })
    .from(storyMembers)
    .innerJoin(articles, eq(storyMembers.articleId, articles.id))
    .where(eq(storyMembers.storyId, storyId))
    .orderBy(sql`${articles.publishedAt} DESC`)
    .limit(1)

  return member?.title || null
}

/**
 * Update representative titles for all stories
 */
export async function updateAllStoryTitles(): Promise<number> {
  const db = getDatabase()
  const allStories = await db.select({ id: stories.id }).from(stories)

  let updated = 0

  for (const story of allStories) {
    const title = await generateStoryTitle(story.id)

    if (title) {
      await db
        .update(stories)
        .set({ representativeTitle: title })
        .where(eq(stories.id, story.id))

      updated++
    }
  }

  console.log(`Updated titles for ${updated} stories`)
  return updated
}

/**
 * Update last_updated timestamps for all stories based on most recent article
 * This fixes stories where last_updated was never updated after creation
 */
export async function updateAllStoryTimestamps(): Promise<number> {
  const db = getDatabase()

  // Get most recent article published_at for each story
  const result = await db.execute(sql`
    UPDATE stories s
    SET last_updated = subq.max_published
    FROM (
      SELECT sm.story_id, MAX(a.published_at) as max_published
      FROM story_members sm
      JOIN articles a ON sm.article_id = a.id
      GROUP BY sm.story_id
    ) subq
    WHERE s.id = subq.story_id
    AND (s.last_updated IS NULL OR s.last_updated < subq.max_published)
  `)

  const count = Number(result.rowCount) || 0
  console.log(`Updated last_updated for ${count} stories`)
  return count
}

/**
 * Update coverage bias distribution for all stories
 * Computes left/center/right article counts from classifications
 */
export async function updateAllStoryCoverage(): Promise<number> {
  const db = getDatabase()

  const result = await db.execute(sql`
    INSERT INTO story_coverage (story_id, left_count, center_count, right_count, total_sources, coverage_diversity_score, last_updated)
    SELECT
      s.id AS story_id,
      COALESCE(SUM(CASE WHEN c.political_bias <= -0.2 THEN 1 ELSE 0 END), 0) AS left_count,
      COALESCE(SUM(CASE WHEN c.political_bias > -0.2 AND c.political_bias < 0.2 THEN 1 ELSE 0 END), 0) AS center_count,
      COALESCE(SUM(CASE WHEN c.political_bias >= 0.2 THEN 1 ELSE 0 END), 0) AS right_count,
      COUNT(DISTINCT a.feed_id) AS total_sources,
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE 1.0 - (
          GREATEST(
            COALESCE(SUM(CASE WHEN c.political_bias <= -0.2 THEN 1 ELSE 0 END), 0)::float,
            COALESCE(SUM(CASE WHEN c.political_bias > -0.2 AND c.political_bias < 0.2 THEN 1 ELSE 0 END), 0)::float,
            COALESCE(SUM(CASE WHEN c.political_bias >= 0.2 THEN 1 ELSE 0 END), 0)::float
          ) / COUNT(*)::float
        )
      END AS coverage_diversity_score,
      NOW() AS last_updated
    FROM stories s
    JOIN story_members sm ON sm.story_id = s.id
    JOIN articles a ON a.id = sm.article_id
    LEFT JOIN classifications c ON c.article_id = a.id
    GROUP BY s.id
    ON CONFLICT (story_id) DO UPDATE SET
      left_count = EXCLUDED.left_count,
      center_count = EXCLUDED.center_count,
      right_count = EXCLUDED.right_count,
      total_sources = EXCLUDED.total_sources,
      coverage_diversity_score = EXCLUDED.coverage_diversity_score,
      last_updated = EXCLUDED.last_updated
  `)

  const count = Number(result.rowCount) || 0
  console.log(`Updated coverage for ${count} stories`)
  return count
}

/**
 * Update framing distribution, avg sensationalism, and avg factuality for all stories
 * Computes from classifications table where feature_extraction_done = true
 */
export async function updateAllStoryFramingCoverage(): Promise<number> {
  const db = getDatabase()

  // Get all story IDs
  const allStories = await db.select({ id: stories.id }).from(stories)

  let updated = 0

  for (const story of allStories) {
    // Get classifications for articles in this story
    const storyClassifications = await db
      .select({
        primaryFraming: classifications.primaryFraming,
        sensationalism: classifications.sensationalism,
        factOpinionRatio: classifications.factOpinionRatio,
        featureExtractionDone: classifications.featureExtractionDone,
      })
      .from(storyMembers)
      .innerJoin(articles, eq(storyMembers.articleId, articles.id))
      .innerJoin(classifications, eq(articles.id, classifications.articleId))
      .where(eq(storyMembers.storyId, story.id))

    // Only compute if at least some articles have features extracted
    const withFeatures = storyClassifications.filter(c => c.featureExtractionDone)
    if (withFeatures.length === 0) continue

    // Compute framing distribution
    const framingDistribution: Record<string, number> = {}
    for (const c of withFeatures) {
      const framing = c.primaryFraming || 'unclassified'
      framingDistribution[framing] = (framingDistribution[framing] || 0) + 1
    }

    // Compute avg sensationalism
    const withSensationalism = withFeatures.filter(c => c.sensationalism !== null)
    const avgSensationalism = withSensationalism.length > 0
      ? withSensationalism.reduce((sum, c) => sum + (c.sensationalism || 0), 0) / withSensationalism.length
      : null

    // Compute avg factuality
    const withFactuality = withFeatures.filter(c => c.factOpinionRatio !== null)
    const avgFactuality = withFactuality.length > 0
      ? withFactuality.reduce((sum, c) => sum + (c.factOpinionRatio || 0), 0) / withFactuality.length
      : null

    // Update story_coverage row (upsert)
    await db.execute(sql`
      INSERT INTO story_coverage (story_id, framing_distribution, avg_sensationalism, avg_factuality, last_updated,
        left_count, center_count, right_count, total_sources, coverage_diversity_score)
      VALUES (${story.id}, ${JSON.stringify(framingDistribution)}::jsonb, ${avgSensationalism}, ${avgFactuality}, NOW(),
        0, 0, 0, 0, 0)
      ON CONFLICT (story_id) DO UPDATE SET
        framing_distribution = ${JSON.stringify(framingDistribution)}::jsonb,
        avg_sensationalism = ${avgSensationalism},
        avg_factuality = ${avgFactuality},
        last_updated = NOW()
    `)

    updated++
  }

  console.log(`Updated framing coverage for ${updated} stories`)
  return updated
}
