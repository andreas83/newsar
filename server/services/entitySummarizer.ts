import { generateChatCompletion } from '../utils/ollama.js'
import { getDatabase } from '../database/db.js'
import { entities, articleEntities, articles, entitySummaries, entitySummaryHistory } from '../database/schema.js'
import { eq, desc, sql } from 'drizzle-orm'

export interface EntitySummary {
  summary: string
  shortDescription: string
  success: boolean
  error?: string
}

/**
 * Generate AI summary for an entity based on recent articles
 */
export async function generateEntitySummary(
  entityId: number,
  entityType: string,
  entityName: string
): Promise<EntitySummary> {
  const db = getDatabase()

  try {
    // Get recent articles mentioning this entity (last 30 days, max 10 articles)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentArticles = await db
      .select({
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
        publishedAt: articles.publishedAt,
      })
      .from(articleEntities)
      .innerJoin(articles, eq(articleEntities.articleId, articles.id))
      .where(eq(articleEntities.entityId, entityId))
      .orderBy(desc(articles.publishedAt))
      .limit(10)

    if (recentArticles.length === 0) {
      return {
        summary: '',
        shortDescription: '',
        success: false,
        error: 'No articles found for entity'
      }
    }

    // Build context from articles (use fullContent if available, fallback to content)
    const context = recentArticles
      .map((a, idx) => {
        const content = a.fullContent || a.content || ''
        return `Article ${idx + 1}:
Title: ${a.title}
Snippet: ${content.substring(0, 400)}...`
      })
      .join('\n\n')

    const typeDescriptions = {
      person: 'this person',
      organization: 'this organization',
      location: 'this location or place',
      event: 'this event',
      topic: 'this topic or concept'
    }

    const prompt = `Based on these recent news articles, write a comprehensive summary about "${entityName}" (${typeDescriptions[entityType as keyof typeof typeDescriptions] || 'this entity'}).

Recent Articles:
${context}

Write:
1. A one-line description (max 100 characters) - just the essential facts
2. A detailed summary (150-200 words) covering:
   - Who/what they are (background/context)
   - Why they're newsworthy right now
   - Recent events or developments
   - Current relevance or significance
   - Use neutral, factual tone

Respond with ONLY a JSON object in this exact format:
{
  "shortDescription": "one line description here",
  "summary": "detailed summary paragraph here"
}

Only return the JSON, nothing else.`

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: 0.3, // Low temperature for factual summaries
      maxTokens: 1000, // Increased to avoid truncation
      format: 'json'
    })

    try {
      // Strip markdown code blocks if present (```json ... ```)
      let cleanedResponse = response.trim()
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
      }

      const result = JSON.parse(cleanedResponse)

      if (!result.shortDescription || !result.summary) {
        throw new Error('Missing required fields in response')
      }

      return {
        summary: result.summary,
        shortDescription: result.shortDescription,
        success: true
      }
    } catch (parseError) {
      console.error('Failed to parse entity summary JSON:', response.substring(0, 200))
      return {
        summary: '',
        shortDescription: '',
        success: false,
        error: 'Failed to parse summary response'
      }
    }
  } catch (error) {
    console.error(`Error generating summary for entity ${entityId}:`, error)
    return {
      summary: '',
      shortDescription: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Generate a change note comparing old and new summaries
 */
async function generateChangeNote(entityName: string, oldSummary: string, newSummary: string): Promise<string> {
  try {
    const prompt = `Here are two versions of a summary about "${entityName}". What new facts or events appear in the newer version that weren't in the older one?

OLDER VERSION:
${oldSummary}

NEWER VERSION:
${newSummary}

Write 1-2 sentences stating ONLY the new facts, events, or developments — like a news ticker. Do NOT reference "the summary" or "the new version". Just state what happened.
Example good output: "Appointed as interim CEO in March. Faced corruption charges in federal court."
Example bad output: "The new summary adds information about their appointment as CEO."`

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: 0.3,
      maxTokens: 200,
    })

    return response.trim()
  } catch (error) {
    console.error(`Failed to generate change note for ${entityName}:`, error)
    return 'Summary updated with new information.'
  }
}

/**
 * Get a snapshot of recent articles driving the current entity summary
 */
async function getArticleContextSnapshot(entityId: number): Promise<{ articleIds: number[]; articleTitles: string[]; dateRange: { from: string | null; to: string | null } }> {
  const db = getDatabase()

  const recentArticles = await db
    .select({
      id: articles.id,
      title: articles.title,
      publishedAt: articles.publishedAt,
    })
    .from(articleEntities)
    .innerJoin(articles, eq(articleEntities.articleId, articles.id))
    .where(eq(articleEntities.entityId, entityId))
    .orderBy(desc(articles.publishedAt))
    .limit(10)

  return {
    articleIds: recentArticles.map(a => a.id),
    articleTitles: recentArticles.map(a => a.title),
    dateRange: {
      from: recentArticles.length > 0 ? (recentArticles[recentArticles.length - 1].publishedAt?.toISOString() ?? null) : null,
      to: recentArticles.length > 0 ? (recentArticles[0].publishedAt?.toISOString() ?? null) : null,
    }
  }
}

/**
 * Update or create entity summary in database
 */
export async function updateEntitySummary(entityId: number): Promise<void> {
  const db = getDatabase()

  // Get entity details
  const [entity] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1)

  if (!entity) {
    throw new Error(`Entity ${entityId} not found`)
  }

  console.log(`Generating summary for ${entity.type}: ${entity.name}`)

  // Generate summary
  const summaryResult = await generateEntitySummary(
    entityId,
    entity.type,
    entity.name
  )

  if (!summaryResult.success) {
    throw new Error(summaryResult.error || 'Summary generation failed')
  }

  // Count total mentions
  const mentionCountResult = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(articleEntities)
    .where(eq(articleEntities.entityId, entityId))

  const mentionCount = mentionCountResult[0]?.count || 0

  // Archive old summary if it exists and text differs
  const [existingSummary] = await db
    .select()
    .from(entitySummaries)
    .where(eq(entitySummaries.entityId, entityId))
    .limit(1)

  if (existingSummary?.summary && existingSummary.summary !== summaryResult.summary) {
    // Generate change note and article context in parallel
    const [changeNote, articleContext] = await Promise.all([
      generateChangeNote(entity.name, existingSummary.summary, summaryResult.summary),
      getArticleContextSnapshot(entityId),
    ])

    await db.insert(entitySummaryHistory).values({
      entityId,
      summary: existingSummary.summary,
      shortDescription: existingSummary.shortDescription,
      changeNote,
      mentionCount: existingSummary.mentionCount,
      trendingScore: existingSummary.trendingScore,
      articleContext,
      generatedAt: existingSummary.generatedAt || existingSummary.lastUpdated,
    })

    console.log(`  Archived previous summary for ${entity.name}`)
  }

  // Upsert summary
  await db
    .insert(entitySummaries)
    .values({
      entityId,
      summary: summaryResult.summary,
      shortDescription: summaryResult.shortDescription,
      mentionCount,
      lastUpdated: new Date(),
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: entitySummaries.entityId,
      set: {
        summary: summaryResult.summary,
        shortDescription: summaryResult.shortDescription,
        mentionCount,
        lastUpdated: new Date(),
        generatedAt: new Date(),
      }
    })

  console.log(`✅ Summary generated for ${entity.name}`)
}

/**
 * Get entities that need summary generation
 * Prioritizes: 1) No summary, 2) Stale summaries, 3) By mention count
 */
export async function getEntitiesNeedingSummary(limit: number = 20, force: boolean = false): Promise<number[]> {
  const db = getDatabase()

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  if (force) {
    // Force mode: Get top entities by mention count regardless of summary status
    const topEntities = await db
      .select({
        entityId: articleEntities.entityId,
      })
      .from(articleEntities)
      .groupBy(articleEntities.entityId)
      .having(sql`COUNT(*) >= 2`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(limit)

    return topEntities.map(e => e.entityId)
  }

  // Normal mode: Prioritize unsummarized entities first, then stale ones
  // This ensures if you've done top 500, next batch gets entities 501-600, not re-does top 500
  const entitiesNeedingSummary = await db
    .select({
      entityId: articleEntities.entityId,
      mentionCount: sql<number>`COUNT(*)::int`,
      lastUpdated: entitySummaries.lastUpdated,
    })
    .from(articleEntities)
    .leftJoin(entitySummaries, eq(articleEntities.entityId, entitySummaries.entityId))
    .groupBy(articleEntities.entityId, entitySummaries.lastUpdated)
    .having(sql`COUNT(*) >= 2`) // At least 2 mentions
    .orderBy(
      sql`CASE WHEN ${entitySummaries.lastUpdated} IS NULL THEN 0 ELSE 1 END`, // No summary first
      sql`CASE WHEN ${entitySummaries.lastUpdated} < ${sevenDaysAgo} THEN 0 ELSE 1 END`, // Then stale
      desc(sql`COUNT(*)`) // Then by mention count
    )
    .limit(limit)

  // Only return entities that actually need updates
  const needsUpdate = entitiesNeedingSummary
    .filter(e => !e.lastUpdated || e.lastUpdated < sevenDaysAgo)
    .map(e => e.entityId)

  return needsUpdate
}

/**
 * Batch generate summaries for multiple entities
 * @param limit - Maximum number of entities to process
 * @param force - Force regeneration even if summary exists
 * @param concurrency - Number of entities to process in parallel (default 5)
 */
export async function batchGenerateSummaries(limit: number = 10, force: boolean = false, concurrency: number = 5): Promise<{ processed: number; failed: number; total: number; startTime: number }> {
  const startTime = Date.now()
  const entityIds = await getEntitiesNeedingSummary(limit, force)

  console.log(`Generating summaries for ${entityIds.length} entities${force ? ' (forced)' : ''} (concurrency: ${concurrency})...`)

  let processed = 0
  let failed = 0

  // Process in batches of `concurrency`
  for (let i = 0; i < entityIds.length; i += concurrency) {
    const batch = entityIds.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map(entityId => updateEntitySummary(entityId))
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processed++
      } else {
        console.error(`Failed to generate summary:`, result.reason)
        failed++
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const total = processed + failed
    const rate = total > 0 ? Math.round(total / (elapsed / 60)) : 0
    console.log(`Progress: ${total}/${entityIds.length} (${processed} ok, ${failed} failed) - ${elapsed}s elapsed - ${rate}/min`)

    // Small delay between batches (rate limiter handles backpressure)
    if (i + concurrency < entityIds.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`✅ Batch summary generation complete: ${processed} succeeded, ${failed} failed in ${duration}s`)

  return {
    processed,
    failed,
    total: entityIds.length,
    startTime
  }
}

/**
 * Update trending scores for entities based on recent mention velocity
 *
 * Scoring formula combines:
 * - Volume: log-scaled 24h mention count (rewards high activity without saturating)
 * - Velocity: ratio of 24h vs 7d daily average (detects spikes)
 * - Recency weight: entities with 0 mentions in 24h decay to 0
 */
export async function updateEntityTrendingScores(): Promise<void> {
  const db = getDatabase()

  const twentyFourHoursAgo = new Date()
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  // Step 1: Reset ALL trending scores to 0 so stale entities decay
  await db
    .update(entitySummaries)
    .set({ trendingScore: 0 })

  // Step 2: Calculate and set new scores for entities with recent activity
  // Formula: 0.6 * volume_score + 0.4 * velocity_score
  //   volume_score  = ln(1 + mentions_24h) / ln(1 + max_mentions_24h)  → 0..1 log-scaled
  //   velocity_score = min(mentions_24h / (mentions_7d / 7), 3) / 3    → 0..1 capped spike ratio
  const trendingScores = await db.execute(sql`
    WITH recent_mentions AS (
      SELECT
        ae.entity_id,
        COUNT(*) FILTER (WHERE a.published_at >= ${twentyFourHoursAgo}) as mentions_24h,
        COUNT(*) FILTER (WHERE a.published_at >= ${sevenDaysAgo}) as mentions_7d
      FROM article_entities ae
      INNER JOIN articles a ON ae.article_id = a.id
      WHERE a.published_at >= ${sevenDaysAgo}
      GROUP BY ae.entity_id
    ),
    max_24h AS (
      SELECT GREATEST(MAX(mentions_24h), 1) as max_val FROM recent_mentions
    )
    SELECT
      rm.entity_id,
      rm.mentions_24h,
      rm.mentions_7d,
      LEAST(
        0.6 * (ln(1 + rm.mentions_24h::real) / ln(1 + m.max_val::real))
        + 0.4 * LEAST(rm.mentions_24h::real / GREATEST(rm.mentions_7d::real / 7.0, 0.1), 3.0) / 3.0,
        1.0
      ) as trending_score
    FROM recent_mentions rm, max_24h m
    WHERE rm.mentions_24h > 0
  `)

  // Update only entities with recent activity (others stay at 0 from step 1)
  for (const row of trendingScores.rows as any[]) {
    await db
      .update(entitySummaries)
      .set({
        trendingScore: row.trending_score,
      })
      .where(eq(entitySummaries.entityId, row.entity_id))
  }

  console.log(`✅ Updated trending scores for ${trendingScores.rows.length} entities (all others reset to 0)`)
}
