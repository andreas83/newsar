/**
 * BTC Price Collector
 *
 * Collects Bitcoin price data from CoinGecko and stores in btc_prices table.
 * Unlike stock collector, no market hours check — BTC trades 24/7.
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'
import { getCurrentPrice, getHistoricalDaily, getOHLC } from '../utils/coingeckoClient.js'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

/**
 * Fetch current BTC price from CoinGecko and insert into btc_prices.
 */
export async function collectPrice(): Promise<{ inserted: boolean; price: number }> {
  try {
    const quote = await getCurrentPrice()

    if (!quote.price || quote.price === 0) {
      console.warn('[BtcPriceCollector] No price data returned from CoinGecko')
      return { inserted: false, price: 0 }
    }

    const database = getDb()

    await database.execute(sql`
      INSERT INTO btc_prices (price, open_price, high_price, low_price, volume_24h, market_cap, change_percent_24h, source, fetched_at)
      VALUES (
        ${quote.price},
        ${null},
        ${quote.high24h ?? null},
        ${quote.low24h ?? null},
        ${quote.volume24h ?? null},
        ${quote.marketCap ?? null},
        ${quote.changePercent24h ?? null},
        ${'coingecko'},
        NOW()
      )
    `)

    console.log(`[BtcPriceCollector] Collected price: $${quote.price.toLocaleString()}`)
    return { inserted: true, price: quote.price }
  } catch (error) {
    console.error('[BtcPriceCollector] Error collecting price:', error instanceof Error ? error.message : error)
    return { inserted: false, price: 0 }
  }
}

/**
 * Backfill historical BTC price data from CoinGecko.
 *
 * Fetches daily market_chart data (price, volume, market_cap arrays) and OHLC
 * candlestick data, then merges them by matching timestamps within the same day.
 * Skips rows where a record with the same fetched_at date already exists.
 *
 * @param days - Number of days of history to backfill
 */
export async function backfillHistory(days: number): Promise<{ inserted: number; skipped: number }> {
  console.log(`[BtcPriceCollector] Backfilling ${days} days of BTC history...`)

  const database = getDb()
  let inserted = 0
  let skipped = 0

  try {
    // Fetch daily market chart data (price, volume, market_cap)
    const dailyData = await getHistoricalDaily(days)
    console.log(`[BtcPriceCollector] Fetched ${dailyData.length} daily data points`)

    // Fetch OHLC candlestick data
    const ohlcData = await getOHLC(days)
    console.log(`[BtcPriceCollector] Fetched ${ohlcData.length} OHLC candles`)

    // Build a lookup map of OHLC data keyed by date string (YYYY-MM-DD)
    const ohlcByDate = new Map<string, { open: number; high: number; low: number; close: number }>()
    for (const candle of ohlcData) {
      const dateKey = new Date(candle.timestamp).toISOString().slice(0, 10)
      // Keep the last OHLC entry for each day (daily candle)
      ohlcByDate.set(dateKey, {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })
    }

    // Get existing dates to avoid duplicates
    const existingRows = await database.execute(sql`
      SELECT DISTINCT fetched_at::date AS d FROM btc_prices
    `)
    const existingDates = new Set(
      ((existingRows as any).rows ?? existingRows).map((r: any) =>
        new Date(r.d).toISOString().slice(0, 10)
      )
    )
    console.log(`[BtcPriceCollector] Found ${existingDates.size} existing dates in btc_prices`)

    // Insert each daily data point, merging with OHLC where available
    for (const point of dailyData) {
      const fetchedAt = new Date(point.timestamp)
      const dateKey = fetchedAt.toISOString().slice(0, 10)

      if (existingDates.has(dateKey)) {
        skipped++
        continue
      }

      const ohlc = ohlcByDate.get(dateKey)

      try {
        await database.execute(sql`
          INSERT INTO btc_prices (price, open_price, high_price, low_price, volume_24h, market_cap, change_percent_24h, source, fetched_at)
          VALUES (
            ${ohlc ? ohlc.close : point.price},
            ${ohlc?.open ?? null},
            ${ohlc?.high ?? null},
            ${ohlc?.low ?? null},
            ${point.volume},
            ${point.marketCap},
            ${null},
            ${'coingecko'},
            ${fetchedAt}
          )
        `)
        inserted++
      } catch (error) {
        console.warn(`[BtcPriceCollector] Skipping ${dateKey}:`, error instanceof Error ? error.message : error)
        skipped++
      }
    }

    console.log(`[BtcPriceCollector] Backfill complete: ${inserted} inserted, ${skipped} skipped`)
    return { inserted, skipped }
  } catch (error) {
    console.error('[BtcPriceCollector] Backfill error:', error instanceof Error ? error.message : error)
    return { inserted, skipped }
  }
}

/**
 * Get the most recent BTC price from the btc_prices table.
 */
export async function getLatestPrice(): Promise<{ price: number; fetchedAt: Date } | null> {
  const database = getDb()

  try {
    const rows = await database.execute(sql`
      SELECT price, fetched_at
      FROM btc_prices
      ORDER BY fetched_at DESC
      LIMIT 1
    `)

    const result = (rows as any).rows ?? rows
    if (!result || result.length === 0) {
      return null
    }

    const row = result[0]
    return {
      price: Number(row.price),
      fetchedAt: new Date(row.fetched_at),
    }
  } catch (error) {
    console.error('[BtcPriceCollector] Error fetching latest price:', error instanceof Error ? error.message : error)
    return null
  }
}
