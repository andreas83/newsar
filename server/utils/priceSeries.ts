/**
 * One definition of "the price of X on day N".
 *
 * `stock_prices` has no unique key per day — it holds many intraday rows per
 * ticker from two sources (finnhub, alpaca). Turning that into a daily series
 * therefore requires a specific convention, and until this module existed the
 * same `DISTINCT ON (DATE(fetched_at)) … ORDER BY … source ASC, fetched_at DESC`
 * was written out in five places. They had already drifted: the anomaly detector
 * captured its baseline price with no source preference while the backtester and
 * validator preferred alpaca, so the same event could produce two different
 * "actual" returns depending on which code asked.
 *
 * The convention, in one place:
 *   - one row per calendar day
 *   - prefer the alphabetically-first source (alpaca over finnhub) for
 *     consistency with the historical backfill
 *   - within a source, the latest fetch of that day wins (the closing print)
 *
 * "Trading days" means rows that exist in the series, so weekends and holidays
 * are skipped naturally without a market calendar.
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

/** Normalise a Date or ISO string to YYYY-MM-DD. */
export function toDateString(date: Date | string): string {
  return date instanceof Date
    ? date.toISOString().split('T')[0]
    : String(date).split('T')[0]
}

/** Closing price on a specific calendar day, or null if the market was shut. */
export async function getPriceOnDate(
  watchlistId: number,
  date: Date | string,
): Promise<number | null> {
  const dateStr = toDateString(date)
  const result = await getDb().execute(sql`
    SELECT price FROM stock_prices
    WHERE watchlist_id = ${watchlistId}
      AND DATE(fetched_at) = ${dateStr}::date
    ORDER BY source ASC, fetched_at DESC
    LIMIT 1
  `)
  if (result.rows.length === 0) return null
  const price = parseFloat((result.rows[0] as any).price)
  return Number.isFinite(price) ? price : null
}

/**
 * Closing price `tradingDaysForward` trading days after `date`.
 * `tradingDaysForward = 1` is the next day the ticker traded.
 */
export async function getForwardPrice(
  watchlistId: number,
  date: Date | string,
  tradingDaysForward: number,
): Promise<number | null> {
  if (tradingDaysForward < 1) return getPriceOnDate(watchlistId, date)
  const dateStr = toDateString(date)
  const result = await getDb().execute(sql`
    WITH daily_closes AS (
      SELECT DISTINCT ON (DATE(fetched_at))
        price, DATE(fetched_at) AS trade_date
      FROM stock_prices
      WHERE watchlist_id = ${watchlistId}
        AND DATE(fetched_at) > ${dateStr}::date
      ORDER BY DATE(fetched_at) ASC, source ASC, fetched_at DESC
    )
    SELECT price FROM daily_closes
    ORDER BY trade_date ASC
    OFFSET ${tradingDaysForward - 1}
    LIMIT 1
  `)
  if (result.rows.length === 0) return null
  const price = parseFloat((result.rows[0] as any).price)
  return Number.isFinite(price) ? price : null
}

/**
 * Percent change from the day-of price to `tradingDaysForward` trading days later.
 * Null when either leg is missing — an unknown outcome, never a zero.
 */
export async function getForwardChangePct(
  watchlistId: number,
  date: Date | string,
  tradingDaysForward: number,
  basePrice?: number | null,
): Promise<number | null> {
  const base = basePrice ?? await getPriceOnDate(watchlistId, date)
  if (base == null || !(base > 0)) return null

  const forward = await getForwardPrice(watchlistId, date, tradingDaysForward)
  if (forward == null) return null

  return +(((forward - base) / base) * 100).toFixed(4)
}

/**
 * Most recent price on record.
 *
 * `maxAgeHours` guards against marking positions at a stale print: without it a
 * delisted or halted ticker keeps reporting its last known price forever, and
 * stop-losses keep evaluating against it.
 */
export async function getLatestPrice(
  watchlistId: number,
  maxAgeHours?: number,
): Promise<number | null> {
  const result = await getDb().execute(sql`
    SELECT price, fetched_at FROM stock_prices
    WHERE watchlist_id = ${watchlistId}
    ORDER BY fetched_at DESC
    LIMIT 1
  `)
  if (result.rows.length === 0) return null

  const row = result.rows[0] as any
  if (maxAgeHours != null) {
    const ageHours = (Date.now() - new Date(row.fetched_at).getTime()) / 3_600_000
    if (ageHours > maxAgeHours) return null
  }

  const price = parseFloat(row.price)
  return Number.isFinite(price) ? price : null
}

/** Average True Range over the last `period` daily bars. */
export async function getATR(
  watchlistId: number,
  period: number = 14,
  lookbackDays: number = 30,
): Promise<number | null> {
  const result = await getDb().execute(sql`
    WITH daily AS (
      SELECT DISTINCT ON (DATE(fetched_at))
        price, high_price, low_price, previous_close,
        DATE(fetched_at) AS trade_date
      FROM stock_prices
      WHERE watchlist_id = ${watchlistId}
        AND fetched_at > NOW() - (${lookbackDays} || ' days')::interval
      ORDER BY DATE(fetched_at) DESC, source ASC, fetched_at DESC
    ),
    tr AS (
      SELECT GREATEST(
        COALESCE(high_price, price) - COALESCE(low_price, price),
        ABS(COALESCE(high_price, price) - COALESCE(previous_close, price)),
        ABS(COALESCE(low_price, price) - COALESCE(previous_close, price))
      ) AS true_range
      FROM daily
      ORDER BY trade_date DESC
      LIMIT ${period}
    )
    SELECT AVG(true_range) AS atr FROM tr
  `)
  if (result.rows.length === 0) return null
  const atr = parseFloat((result.rows[0] as any).atr)
  return Number.isFinite(atr) ? atr : null
}
