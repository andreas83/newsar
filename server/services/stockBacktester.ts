/**
 * Stock Backtester
 *
 * Computes forward-looking price changes for each historical anomaly event
 * and aggregates them into signal profiles per (ticker, event_type).
 *
 * Uses daily closing prices (Alpaca bars preferred, Finnhub fallback)
 * to find the Nth trading day after an event, naturally skipping weekends/holidays.
 */

import { getDatabase } from '../database/db'
import { stockBacktestResults, stockSignalProfiles, stockNewsCorrelations, stockPrices } from '../database/schema'
import { sql, eq, and, gte } from 'drizzle-orm'

const SPY_WATCHLIST_ID = 48

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

// Horizons: label -> trading days offset
const HORIZONS = [
  { label: '1d', days: 1 },
  { label: '3d', days: 3 },
  { label: '5d', days: 5 },
  { label: '1w', days: 5 },   // same as 5d (5 trading days = 1 week)
  { label: '2w', days: 10 },
  { label: '4w', days: 20 },
] as const

/**
 * Get the closing price N trading days after a given date for a watchlist item.
 * Uses daily bars ordered by date, offset by N to skip weekends/holidays naturally.
 */
async function getForwardPrice(
  watchlistId: number,
  eventDate: Date,
  tradingDaysForward: number
): Promise<number | null> {
  const dateStr = eventDate.toISOString().split('T')[0]

  // Get the Nth trading day's closing price after the event date.
  // We select one daily price per date (preferring alpaca, then latest),
  // ordered by date ASC, and offset to skip to the Nth trading day.
  const result = await getDb().execute(sql`
    WITH daily_closes AS (
      SELECT DISTINCT ON (DATE(fetched_at))
        price,
        DATE(fetched_at) as trade_date
      FROM stock_prices
      WHERE watchlist_id = ${watchlistId}
        AND DATE(fetched_at) > ${dateStr}::date
      ORDER BY DATE(fetched_at) ASC, source ASC, fetched_at DESC
    )
    SELECT price, trade_date
    FROM daily_closes
    ORDER BY trade_date ASC
    OFFSET ${tradingDaysForward - 1}
    LIMIT 1
  `)

  if (result.rows.length === 0) return null
  return parseFloat((result.rows[0] as any).price)
}

/**
 * Get the event-day closing price (baseline for % change calculations).
 */
async function getEventDayPrice(watchlistId: number, eventDate: Date): Promise<number | null> {
  const dateStr = eventDate.toISOString().split('T')[0]

  const result = await getDb().execute(sql`
    SELECT price FROM stock_prices
    WHERE watchlist_id = ${watchlistId}
      AND DATE(fetched_at) = ${dateStr}::date
    ORDER BY source ASC, fetched_at DESC
    LIMIT 1
  `)

  if (result.rows.length === 0) return null
  return parseFloat((result.rows[0] as any).price)
}

/**
 * Backtest all correlation events: compute forward prices and % changes.
 */
export async function backtestAllEvents(): Promise<{ processed: number; skipped: number; errors: number }> {
  // Fetch all correlations
  const correlations = await getDb().execute(sql`
    SELECT id, watchlist_id, event_type, event_date, price_after, metadata
    FROM stock_news_correlations
    ORDER BY event_date ASC
  `)

  let processed = 0
  let skipped = 0
  let errors = 0

  for (const row of correlations.rows as any[]) {
    const correlationId = parseInt(row.id)
    const watchlistId = parseInt(row.watchlist_id)
    const eventDate = new Date(row.event_date)
    const ticker = row.metadata?.ticker || '?'

    try {
      // Get event-day price as baseline
      const basePrice = parseFloat(row.price_after) || await getEventDayPrice(watchlistId, eventDate)

      if (!basePrice) {
        skipped++
        continue
      }

      // Compute forward prices at each horizon
      const [p1d, p3d, p5d, p2w, p4w] = await Promise.all([
        getForwardPrice(watchlistId, eventDate, 1),
        getForwardPrice(watchlistId, eventDate, 3),
        getForwardPrice(watchlistId, eventDate, 5),
        getForwardPrice(watchlistId, eventDate, 10),
        getForwardPrice(watchlistId, eventDate, 20),
      ])

      // Compute benchmark (SPY) forward prices
      const [spy1d, spy5d, spy2w, spy4w] = await Promise.all([
        getForwardPrice(SPY_WATCHLIST_ID, eventDate, 1),
        getForwardPrice(SPY_WATCHLIST_ID, eventDate, 5),
        getForwardPrice(SPY_WATCHLIST_ID, eventDate, 10),
        getForwardPrice(SPY_WATCHLIST_ID, eventDate, 20),
      ])

      // SPY baseline
      const spyBase = await getEventDayPrice(SPY_WATCHLIST_ID, eventDate)

      const pctChange = (future: number | null, base: number) =>
        future != null ? +((future - base) / base * 100).toFixed(4) : null

      const change1d = pctChange(p1d, basePrice)
      const change3d = pctChange(p3d, basePrice)
      const change5d = pctChange(p5d, basePrice)
      const change1w = change5d // same horizon
      const change2w = pctChange(p2w, basePrice)
      const change4w = pctChange(p4w, basePrice)

      const benchmarkChange1d = spyBase ? pctChange(spy1d, spyBase) : null
      const benchmarkChange5d = spyBase ? pctChange(spy5d, spyBase) : null
      const benchmarkChange2w = spyBase ? pctChange(spy2w, spyBase) : null
      const benchmarkChange4w = spyBase ? pctChange(spy4w, spyBase) : null

      // Upsert backtest result
      await getDb().execute(sql`
        INSERT INTO stock_backtest_results (
          correlation_id,
          price_1d, price_3d, price_5d, price_1w, price_2w, price_4w,
          change_1d, change_3d, change_5d, change_1w, change_2w, change_4w,
          benchmark_change_1d, benchmark_change_5d, benchmark_change_2w, benchmark_change_4w,
          updated_at
        ) VALUES (
          ${correlationId},
          ${p1d}, ${p3d}, ${p5d}, ${p5d}, ${p2w}, ${p4w},
          ${change1d}, ${change3d}, ${change5d}, ${change1w}, ${change2w}, ${change4w},
          ${benchmarkChange1d}, ${benchmarkChange5d}, ${benchmarkChange2w}, ${benchmarkChange4w},
          NOW()
        )
        ON CONFLICT (correlation_id) DO UPDATE SET
          price_1d = EXCLUDED.price_1d,
          price_3d = EXCLUDED.price_3d,
          price_5d = EXCLUDED.price_5d,
          price_1w = EXCLUDED.price_1w,
          price_2w = EXCLUDED.price_2w,
          price_4w = EXCLUDED.price_4w,
          change_1d = EXCLUDED.change_1d,
          change_3d = EXCLUDED.change_3d,
          change_5d = EXCLUDED.change_5d,
          change_1w = EXCLUDED.change_1w,
          change_2w = EXCLUDED.change_2w,
          change_4w = EXCLUDED.change_4w,
          benchmark_change_1d = EXCLUDED.benchmark_change_1d,
          benchmark_change_5d = EXCLUDED.benchmark_change_5d,
          benchmark_change_2w = EXCLUDED.benchmark_change_2w,
          benchmark_change_4w = EXCLUDED.benchmark_change_4w,
          updated_at = NOW()
      `)

      processed++

      if (processed % 50 === 0) {
        console.log(`[Backtest] Processed ${processed}/${correlations.rows.length}...`)
      }

    } catch (err) {
      errors++
      console.error(`[Backtest] Error processing correlation ${correlationId} (${ticker}):`, err)
    }
  }

  return { processed, skipped, errors }
}

/**
 * Compute signal profiles: aggregate backtest results per (watchlist_id, event_type).
 */
export async function computeSignalProfiles(): Promise<{ profiles: number }> {
  // Aggregate stats from backtest results joined with correlations
  const result = await getDb().execute(sql`
    SELECT
      c.watchlist_id,
      c.event_type,
      COUNT(*)::int as sample_count,
      -- Average changes
      AVG(b.change_1d) as avg_change_1d,
      AVG(b.change_3d) as avg_change_3d,
      AVG(b.change_5d) as avg_change_5d,
      AVG(b.change_1w) as avg_change_1w,
      AVG(b.change_2w) as avg_change_2w,
      AVG(b.change_4w) as avg_change_4w,
      -- Win rates (% positive)
      AVG(CASE WHEN b.change_1d > 0 THEN 1.0 ELSE 0.0 END) as win_rate_1d,
      AVG(CASE WHEN b.change_3d > 0 THEN 1.0 ELSE 0.0 END) as win_rate_3d,
      AVG(CASE WHEN b.change_5d > 0 THEN 1.0 ELSE 0.0 END) as win_rate_5d,
      AVG(CASE WHEN b.change_1w > 0 THEN 1.0 ELSE 0.0 END) as win_rate_1w,
      AVG(CASE WHEN b.change_2w > 0 THEN 1.0 ELSE 0.0 END) as win_rate_2w,
      AVG(CASE WHEN b.change_4w > 0 THEN 1.0 ELSE 0.0 END) as win_rate_4w,
      -- Stddevs
      STDDEV(b.change_1d) as stddev_1d,
      STDDEV(b.change_3d) as stddev_3d,
      STDDEV(b.change_5d) as stddev_5d,
      STDDEV(b.change_1w) as stddev_1w,
      STDDEV(b.change_2w) as stddev_2w,
      STDDEV(b.change_4w) as stddev_4w,
      -- Alpha vs SPY
      AVG(b.change_5d - COALESCE(b.benchmark_change_5d, 0)) as avg_alpha_5d,
      AVG(b.change_4w - COALESCE(b.benchmark_change_4w, 0)) as avg_alpha_4w
    FROM stock_news_correlations c
    JOIN stock_backtest_results b ON b.correlation_id = c.id
    WHERE b.change_5d IS NOT NULL
    GROUP BY c.watchlist_id, c.event_type
    HAVING COUNT(*) >= 2
  `)

  let profiles = 0

  for (const row of result.rows as any[]) {
    const sampleCount = parseInt(row.sample_count)
    const avgChange5d = parseFloat(row.avg_change_5d) || 0
    const stddev5d = parseFloat(row.stddev_5d) || 0

    // Confidence formula: min(1, count/10) * clamp(1 - stddev/|avg|, 0.2, 1.0)
    const countFactor = Math.min(1, sampleCount / 10)
    const consistencyFactor = Math.abs(avgChange5d) > 0.001
      ? Math.max(0.2, Math.min(1.0, 1 - stddev5d / Math.abs(avgChange5d)))
      : 0.2
    const profileConfidence = +(countFactor * consistencyFactor).toFixed(4)

    await getDb().execute(sql`
      INSERT INTO stock_signal_profiles (
        watchlist_id, event_type, sample_count,
        avg_change_1d, avg_change_3d, avg_change_5d, avg_change_1w, avg_change_2w, avg_change_4w,
        win_rate_1d, win_rate_3d, win_rate_5d, win_rate_1w, win_rate_2w, win_rate_4w,
        stddev_1d, stddev_3d, stddev_5d, stddev_1w, stddev_2w, stddev_4w,
        avg_alpha_5d, avg_alpha_4w,
        profile_confidence, updated_at
      ) VALUES (
        ${parseInt(row.watchlist_id)}, ${row.event_type}, ${sampleCount},
        ${parseFloat(row.avg_change_1d) || null}, ${parseFloat(row.avg_change_3d) || null},
        ${parseFloat(row.avg_change_5d) || null}, ${parseFloat(row.avg_change_1w) || null},
        ${parseFloat(row.avg_change_2w) || null}, ${parseFloat(row.avg_change_4w) || null},
        ${parseFloat(row.win_rate_1d) || null}, ${parseFloat(row.win_rate_3d) || null},
        ${parseFloat(row.win_rate_5d) || null}, ${parseFloat(row.win_rate_1w) || null},
        ${parseFloat(row.win_rate_2w) || null}, ${parseFloat(row.win_rate_4w) || null},
        ${parseFloat(row.stddev_1d) || null}, ${parseFloat(row.stddev_3d) || null},
        ${parseFloat(row.stddev_5d) || null}, ${parseFloat(row.stddev_1w) || null},
        ${parseFloat(row.stddev_2w) || null}, ${parseFloat(row.stddev_4w) || null},
        ${parseFloat(row.avg_alpha_5d) || null}, ${parseFloat(row.avg_alpha_4w) || null},
        ${profileConfidence}, NOW()
      )
      ON CONFLICT (watchlist_id, event_type) DO UPDATE SET
        sample_count = EXCLUDED.sample_count,
        avg_change_1d = EXCLUDED.avg_change_1d, avg_change_3d = EXCLUDED.avg_change_3d,
        avg_change_5d = EXCLUDED.avg_change_5d, avg_change_1w = EXCLUDED.avg_change_1w,
        avg_change_2w = EXCLUDED.avg_change_2w, avg_change_4w = EXCLUDED.avg_change_4w,
        win_rate_1d = EXCLUDED.win_rate_1d, win_rate_3d = EXCLUDED.win_rate_3d,
        win_rate_5d = EXCLUDED.win_rate_5d, win_rate_1w = EXCLUDED.win_rate_1w,
        win_rate_2w = EXCLUDED.win_rate_2w, win_rate_4w = EXCLUDED.win_rate_4w,
        stddev_1d = EXCLUDED.stddev_1d, stddev_3d = EXCLUDED.stddev_3d,
        stddev_5d = EXCLUDED.stddev_5d, stddev_1w = EXCLUDED.stddev_1w,
        stddev_2w = EXCLUDED.stddev_2w, stddev_4w = EXCLUDED.stddev_4w,
        avg_alpha_5d = EXCLUDED.avg_alpha_5d, avg_alpha_4w = EXCLUDED.avg_alpha_4w,
        profile_confidence = EXCLUDED.profile_confidence,
        updated_at = NOW()
    `)

    profiles++
  }

  return { profiles }
}
