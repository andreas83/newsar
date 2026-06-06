/**
 * News Volume Anomaly Detector
 *
 * Detects when mention volume for a stock-linked entity spikes above its
 * 30-day rolling baseline. No sentiment — purely structural signals:
 * mention count, source diversity, keyword shifts.
 *
 * Results are stored in the stock_news_correlations table.
 */

import { getDatabase } from '../database/db'
import { stockNewsCorrelations } from '../database/schema'
import { sql, and, eq } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

interface DailyMentions {
  entityId: number
  watchlistId: number
  ticker: string
  pubDate: string
  mentionCount: number
  sourceCount: number
  articleIds: number[]
}

interface Baseline {
  entityId: number
  avgDailyMentions: number
  avgDailySources: number
  stddevMentions: number
}

interface AnomalyEvent {
  watchlistId: number
  entityId: number
  ticker: string
  eventType: string
  eventDate: Date
  mentionCount: number
  sourceCount: number
  articleIds: number[]
  baseline: Baseline
  multiplier: number
  newKeywords: string[]
  priceBefore: number | null
  priceAfter: number | null
  priceChangePercent: number | null
}

interface DetectionResult {
  dateProcessed: string
  entitiesChecked: number
  anomaliesFound: number
  inserted: number
  skipped: number
}

/**
 * Get daily mention counts for all stock-linked entities on a target date
 */
async function getDailyMentions(targetDate: string): Promise<DailyMentions[]> {
  const result = await getDb().execute(sql`
    SELECT
      ae.entity_id,
      sw.id as watchlist_id,
      sw.ticker,
      DATE(a.published_at)::text as pub_date,
      COUNT(DISTINCT ae.article_id)::int as mention_count,
      COUNT(DISTINCT a.feed_id)::int as source_count,
      ARRAY_AGG(DISTINCT ae.article_id) as article_ids
    FROM article_entities ae
    JOIN articles a ON ae.article_id = a.id
    JOIN stock_watchlist sw ON sw.entity_id = ae.entity_id AND sw.is_active = true
    WHERE DATE(a.published_at) = ${targetDate}::date
      AND a.excluded = false
    GROUP BY ae.entity_id, sw.id, sw.ticker, DATE(a.published_at)
    HAVING COUNT(DISTINCT ae.article_id) >= 2
  `)

  return result.rows.map((r: any) => ({
    entityId: parseInt(r.entity_id),
    watchlistId: parseInt(r.watchlist_id),
    ticker: r.ticker,
    pubDate: r.pub_date,
    mentionCount: parseInt(r.mention_count),
    sourceCount: parseInt(r.source_count),
    articleIds: r.article_ids.map((id: any) => parseInt(id)),
  }))
}

/**
 * Compute 30-day rolling baseline for a set of entities
 */
async function getBaselines(entityIds: number[], targetDate: string): Promise<Map<number, Baseline>> {
  if (entityIds.length === 0) return new Map()

  // Build entity ID list for SQL IN clause
  const entityIdList = sql.join(entityIds.map(id => sql`${id}`), sql`, `)

  const result = await getDb().execute(sql`
    WITH daily_counts AS (
      SELECT
        ae.entity_id,
        DATE(a.published_at) as d,
        COUNT(DISTINCT ae.article_id)::int as cnt,
        COUNT(DISTINCT a.feed_id)::int as src_cnt
      FROM article_entities ae
      JOIN articles a ON ae.article_id = a.id
      WHERE a.published_at >= (${targetDate}::date - interval '31 days')
        AND a.published_at < ${targetDate}::date
        AND a.excluded = false
        AND ae.entity_id IN (${entityIdList})
      GROUP BY ae.entity_id, DATE(a.published_at)
    ),
    baselines AS (
      SELECT
        entity_id,
        COALESCE(SUM(cnt)::float / 30, 0) as avg_daily_mentions,
        COALESCE(SUM(src_cnt)::float / 30, 0) as avg_daily_sources,
        COALESCE(STDDEV(cnt), 0) as stddev_mentions
      FROM daily_counts
      GROUP BY entity_id
    )
    SELECT * FROM baselines
  `)

  const map = new Map<number, Baseline>()
  for (const row of result.rows as any[]) {
    map.set(parseInt(row.entity_id), {
      entityId: parseInt(row.entity_id),
      avgDailyMentions: parseFloat(row.avg_daily_mentions),
      avgDailySources: parseFloat(row.avg_daily_sources),
      stddevMentions: parseFloat(row.stddev_mentions),
    })
  }
  return map
}

/**
 * Detect new keywords appearing for an entity on the target date
 * that weren't seen in the prior 30 days
 */
async function detectKeywordShifts(entityId: number, targetDate: string): Promise<string[]> {
  const result = await getDb().execute(sql`
    SELECT k.keyword, COUNT(*)::int as cnt
    FROM keywords k
    JOIN article_entities ae ON k.article_id = ae.article_id
    JOIN articles a ON k.article_id = a.id
    WHERE ae.entity_id = ${entityId}
      AND DATE(a.published_at) = ${targetDate}::date
      AND k.category IN ('topic', 'event')
      AND k.keyword NOT IN (
        SELECT DISTINCT k2.keyword
        FROM keywords k2
        JOIN article_entities ae2 ON k2.article_id = ae2.article_id
        JOIN articles a2 ON k2.article_id = a2.id
        WHERE ae2.entity_id = ${entityId}
          AND a2.published_at >= (${targetDate}::date - interval '30 days')
          AND a2.published_at < ${targetDate}::date
          AND k2.category IN ('topic', 'event')
      )
    GROUP BY k.keyword
    ORDER BY cnt DESC
    LIMIT 10
  `)

  return result.rows.map((r: any) => r.keyword)
}

/**
 * Get price context for a stock on and before the target date
 */
async function getPriceContext(watchlistId: number, targetDate: string): Promise<{
  priceBefore: number | null
  priceAfter: number | null
  priceChangePercent: number | null
}> {
  // Price on target date (latest entry that day)
  const dayPrice = await getDb().execute(sql`
    SELECT price FROM stock_prices
    WHERE watchlist_id = ${watchlistId}
      AND DATE(fetched_at) = ${targetDate}::date
    ORDER BY fetched_at DESC LIMIT 1
  `)

  // Price on previous trading day
  const prevPrice = await getDb().execute(sql`
    SELECT price FROM stock_prices
    WHERE watchlist_id = ${watchlistId}
      AND fetched_at < ${targetDate}::date
    ORDER BY fetched_at DESC LIMIT 1
  `)

  const priceAfter = dayPrice.rows[0] ? parseFloat((dayPrice.rows[0] as any).price) : null
  const priceBefore = prevPrice.rows[0] ? parseFloat((prevPrice.rows[0] as any).price) : null

  let priceChangePercent: number | null = null
  if (priceBefore != null && priceAfter != null && priceBefore > 0) {
    priceChangePercent = +((priceAfter - priceBefore) / priceBefore * 100).toFixed(4)
  }

  return { priceBefore, priceAfter, priceChangePercent }
}

/**
 * Check if an anomaly already exists (avoid duplicates)
 */
async function anomalyExists(watchlistId: number, eventDate: string, eventType: string): Promise<boolean> {
  const result = await getDb().execute(sql`
    SELECT 1 FROM stock_news_correlations
    WHERE watchlist_id = ${watchlistId}
      AND DATE(event_date) = ${eventDate}::date
      AND event_type = ${eventType}
    LIMIT 1
  `)
  return result.rows.length > 0
}

/**
 * Detect anomalies for a single target date
 */
export async function detectAnomaliesForDate(targetDate: string): Promise<DetectionResult> {
  console.log(`[VolumeAnomaly] Processing ${targetDate}...`)

  // Step 1: Get daily mentions
  const dailyMentions = await getDailyMentions(targetDate)

  if (dailyMentions.length === 0) {
    console.log(`[VolumeAnomaly] No stock entity mentions on ${targetDate}`)
    return { dateProcessed: targetDate, entitiesChecked: 0, anomaliesFound: 0, inserted: 0, skipped: 0 }
  }

  console.log(`[VolumeAnomaly] ${dailyMentions.length} entities with mentions on ${targetDate}`)

  // Step 2: Compute baselines
  const entityIds = dailyMentions.map(d => d.entityId)
  const baselines = await getBaselines(entityIds, targetDate)

  // Step 3: Detect anomalies
  const anomalies: AnomalyEvent[] = []

  for (const mention of dailyMentions) {
    const baseline = baselines.get(mention.entityId)
    if (!baseline) continue

    // Skip entities with very sparse baseline (< 0.3 avg mentions/day ≈ < 9/month)
    if (baseline.avgDailyMentions < 0.3) continue

    const multiplier = baseline.avgDailyMentions > 0
      ? mention.mentionCount / baseline.avgDailyMentions
      : 0
    const sourceMultiplier = baseline.avgDailySources > 0
      ? mention.sourceCount / baseline.avgDailySources
      : 0

    const eventTypes: string[] = []

    if (multiplier >= 3) {
      eventTypes.push('volume_spike_3x')
    } else if (multiplier >= 2) {
      eventTypes.push('volume_spike_2x')
    }

    if (sourceMultiplier >= 2 && mention.sourceCount >= 3) {
      eventTypes.push('source_diversity_spike')
    }

    if (eventTypes.length === 0) continue

    // Step 4: Keyword shifts (only for anomaly entities)
    const newKeywords = await detectKeywordShifts(mention.entityId, targetDate)

    // Step 5: Price context
    const priceCtx = await getPriceContext(mention.watchlistId, targetDate)

    for (const eventType of eventTypes) {
      anomalies.push({
        watchlistId: mention.watchlistId,
        entityId: mention.entityId,
        ticker: mention.ticker,
        eventType,
        eventDate: new Date(targetDate),
        mentionCount: mention.mentionCount,
        sourceCount: mention.sourceCount,
        articleIds: mention.articleIds,
        baseline,
        multiplier,
        newKeywords,
        ...priceCtx,
      })
    }
  }

  console.log(`[VolumeAnomaly] ${anomalies.length} anomaly events detected`)

  // Step 6: Insert into stock_news_correlations
  let inserted = 0
  let skipped = 0

  for (const anomaly of anomalies) {
    const dateStr = anomaly.eventDate.toISOString().split('T')[0]

    if (await anomalyExists(anomaly.watchlistId, dateStr, anomaly.eventType)) {
      skipped++
      continue
    }

    await getDb().insert(stockNewsCorrelations).values({
      watchlistId: anomaly.watchlistId,
      entityId: anomaly.entityId,
      eventType: anomaly.eventType,
      eventDate: anomaly.eventDate,
      priceBefore: anomaly.priceBefore,
      priceAfter: anomaly.priceAfter,
      priceChangePercent: anomaly.priceChangePercent,
      mentionCountWindow: anomaly.mentionCount,
      avgSentiment: null, // intentionally unused
      articleIds: anomaly.articleIds,
      windowHours: 24,
      confidence: Math.min(1, anomaly.multiplier / 5), // normalize: 5x = confidence 1.0
      metadata: {
        baseline_avg: +anomaly.baseline.avgDailyMentions.toFixed(2),
        baseline_stddev: +anomaly.baseline.stddevMentions.toFixed(2),
        multiplier: +anomaly.multiplier.toFixed(2),
        source_count: anomaly.sourceCount,
        avg_source_count: +anomaly.baseline.avgDailySources.toFixed(2),
        new_keywords: anomaly.newKeywords,
        baseline_window_days: 30,
        ticker: anomaly.ticker,
      },
    })

    inserted++
    console.log(
      `[VolumeAnomaly] ${anomaly.ticker}: ${anomaly.eventType} ` +
      `(${anomaly.mentionCount} mentions, ${anomaly.multiplier.toFixed(1)}x baseline` +
      `${anomaly.priceChangePercent != null ? `, price ${anomaly.priceChangePercent > 0 ? '+' : ''}${anomaly.priceChangePercent.toFixed(2)}%` : ''}` +
      `${anomaly.newKeywords.length > 0 ? `, new: ${anomaly.newKeywords.slice(0, 3).join(', ')}` : ''})`
    )
  }

  // Optionally generate recommendations for newly inserted anomalies
  if (inserted > 0) {
    try {
      const { generateRecommendationsForDate } = await import('./stockSignalGenerator.js')
      await generateRecommendationsForDate(targetDate)
    } catch (err) {
      console.error(`[VolumeAnomaly] Signal generation failed (non-fatal):`, err)
    }
  }

  return {
    dateProcessed: targetDate,
    entitiesChecked: dailyMentions.length,
    anomaliesFound: anomalies.length,
    inserted,
    skipped,
  }
}

/**
 * Detect anomalies for a range of dates (for backfill)
 */
export async function detectAnomalies(daysBack: number = 1): Promise<DetectionResult[]> {
  const results: DetectionResult[] = []

  for (let i = daysBack; i >= 1; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]

    const result = await detectAnomaliesForDate(dateStr)
    results.push(result)
  }

  return results
}
