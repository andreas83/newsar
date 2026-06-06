/**
 * Historical stock price backfiller.
 * Primary: Alpaca Markets (200 req/min, multi-symbol batch, free).
 * Fallback: Alpha Vantage (25 req/day, single ticker).
 */

import { getDatabase } from '../database/db.js'
import { stockWatchlist, stockPrices } from '../database/schema.js'
import { eq, sql } from 'drizzle-orm'
import { isAlpacaAvailable, getDailyBars, getMultiDailyBars, type AlpacaBar } from '../utils/alpacaClient.js'
import { getDailyHistory, getRemainingDailyQuota } from '../utils/alphaVantageClient.js'

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return formatDate(d)
}

/**
 * Insert Alpaca bars into stock_prices for a given watchlist ID.
 */
async function insertAlpacaBars(watchlistId: number, bars: AlpacaBar[]): Promise<{ inserted: number; skipped: number }> {
  const db = getDatabase()
  let inserted = 0
  let skipped = 0

  for (const bar of bars) {
    try {
      await db.insert(stockPrices).values({
        watchlistId,
        price: bar.c,
        openPrice: bar.o,
        highPrice: bar.h,
        lowPrice: bar.l,
        previousClose: null,
        changeAmount: null,
        changePercent: null,
        volume: bar.v,
        marketStatus: 'closed',
        source: 'alpaca',
        fetchedAt: new Date(bar.t),
      }).onConflictDoNothing()
      inserted++
    } catch {
      skipped++
    }
  }

  if (inserted > 0) {
    await db.update(stockWatchlist)
      .set({ updatedAt: new Date() })
      .where(eq(stockWatchlist.id, watchlistId))
  }

  return { inserted, skipped }
}

/**
 * Backfill a single ticker using Alpaca.
 */
export async function backfillTicker(ticker: string, days: number = 365): Promise<{ inserted: number; skipped: number }> {
  const db = getDatabase()

  const [watchlistItem] = await db.select()
    .from(stockWatchlist)
    .where(eq(stockWatchlist.ticker, ticker))
    .limit(1)

  if (!watchlistItem) {
    throw new Error(`[Backfill] Ticker ${ticker} not found in watchlist`)
  }

  const start = daysAgo(days)
  const end = formatDate(new Date())

  if (isAlpacaAvailable()) {
    console.log(`[Backfill] Alpaca: fetching ${ticker} (${days} days)...`)
    const bars = await getDailyBars(ticker, start, end)
    const result = await insertAlpacaBars(watchlistItem.id, bars)
    console.log(`[Backfill] ${ticker}: ${result.inserted} inserted, ${result.skipped} skipped (${bars.length} bars)`)
    return result
  }

  // Fallback to Alpha Vantage
  console.log(`[Backfill] Alpha Vantage fallback: fetching ${ticker}...`)
  const outputSize = days > 100 ? 'full' : 'compact'
  const history = await getDailyHistory(ticker, outputSize)
  const entries = days > 0 ? history.slice(0, days) : history

  let inserted = 0
  let skipped = 0

  for (const entry of entries) {
    const fetchedAt = new Date(`${entry.date}T16:00:00-05:00`)
    try {
      await db.insert(stockPrices).values({
        watchlistId: watchlistItem.id,
        price: entry.close,
        openPrice: entry.open,
        highPrice: entry.high,
        lowPrice: entry.low,
        previousClose: null,
        changeAmount: null,
        changePercent: null,
        volume: entry.volume,
        marketStatus: 'closed',
        source: 'alphavantage',
        fetchedAt,
      }).onConflictDoNothing()
      inserted++
    } catch {
      skipped++
    }
  }

  if (inserted > 0) {
    await db.update(stockWatchlist)
      .set({ updatedAt: new Date() })
      .where(eq(stockWatchlist.id, watchlistItem.id))
  }

  console.log(`[Backfill] ${ticker}: ${inserted} inserted, ${skipped} skipped (${entries.length} entries)`)
  return { inserted, skipped }
}

/**
 * Backfill ALL active tickers using Alpaca multi-symbol batch requests.
 * Processes in batches of 100 symbols per request (Alpaca limit ~200).
 */
export async function backfillAll(days: number = 365): Promise<{ processed: number; totalInserted: number; failed: string[] }> {
  const db = getDatabase()

  const items = await db.select({
    id: stockWatchlist.id,
    ticker: stockWatchlist.ticker,
  })
    .from(stockWatchlist)
    .where(eq(stockWatchlist.isActive, true))

  if (items.length === 0) {
    console.log('[Backfill] No active tickers')
    return { processed: 0, totalInserted: 0, failed: [] }
  }

  const start = daysAgo(days)
  const end = formatDate(new Date())

  if (!isAlpacaAvailable()) {
    // Alpha Vantage fallback — slow, quota-limited
    console.log('[Backfill] Alpaca not configured, using Alpha Vantage (slow)')
    const quota = getRemainingDailyQuota()
    const toProcess = items.slice(0, quota)
    console.log(`[Backfill] Processing ${toProcess.length} of ${items.length} (AV quota: ${quota})`)

    let processed = 0
    const failed: string[] = []
    let totalInserted = 0

    for (const item of toProcess) {
      try {
        const result = await backfillTicker(item.ticker, days)
        totalInserted += result.inserted
        processed++
      } catch (error) {
        console.error(`[Backfill] ${item.ticker} failed:`, error instanceof Error ? error.message : error)
        failed.push(item.ticker)
      }
    }
    return { processed, totalInserted, failed }
  }

  // Alpaca multi-symbol batch — fast
  const BATCH_SIZE = 100
  const tickerToId = new Map(items.map(i => [i.ticker, i.id]))
  let processed = 0
  let totalInserted = 0
  const failed: string[] = []

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const tickers = batch.map(b => b.ticker)

    console.log(`[Backfill] Alpaca batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)}: ${tickers.length} tickers...`)

    try {
      const allBars = await getMultiDailyBars(tickers, start, end)

      for (const [ticker, bars] of Object.entries(allBars)) {
        const wid = tickerToId.get(ticker)
        if (!wid) continue

        if (bars.length === 0) {
          console.warn(`[Backfill] ${ticker}: no bars returned`)
          failed.push(ticker)
          continue
        }

        const result = await insertAlpacaBars(wid, bars)
        totalInserted += result.inserted
        processed++
        console.log(`[Backfill]   ${ticker}: ${result.inserted} bars`)
      }

      // Check for tickers that returned no data at all
      for (const ticker of tickers) {
        if (!allBars[ticker] || allBars[ticker].length === 0) {
          if (!failed.includes(ticker)) {
            failed.push(ticker)
          }
        }
      }
    } catch (error) {
      console.error(`[Backfill] Batch failed:`, error instanceof Error ? error.message : error)
      for (const t of tickers) failed.push(t)
    }
  }

  console.log(`\n[Backfill] Complete: ${processed} tickers, ${totalInserted} total bars inserted`)
  if (failed.length > 0) {
    console.log(`[Backfill] Failed/no data: ${failed.join(', ')}`)
  }

  return { processed, totalInserted, failed }
}
