/**
 * Stock price collection service.
 * Fetches live quotes from Finnhub for all active watchlist tickers.
 */

import { getDatabase } from '../database/db.js'
import { stockWatchlist, stockPrices } from '../database/schema.js'
import { eq, desc, sql } from 'drizzle-orm'
import { getQuote, type FinnhubQuote } from '../utils/finnhubClient.js'

/**
 * Check if US stock market is currently open (Mon-Fri 9:30-16:00 ET).
 */
export function isUSMarketOpen(): boolean {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const hours = et.getHours()
  const minutes = et.getMinutes()
  const timeInMinutes = hours * 60 + minutes

  // Weekday only
  if (day === 0 || day === 6) return false

  // 9:30 AM - 4:00 PM ET
  return timeInMinutes >= 570 && timeInMinutes < 960
}

/**
 * Determine current market status string.
 */
function getMarketStatusLabel(): string {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const hours = et.getHours()
  const minutes = et.getMinutes()
  const timeInMinutes = hours * 60 + minutes

  if (day === 0 || day === 6) return 'closed'
  if (timeInMinutes >= 570 && timeInMinutes < 960) return 'open'
  if (timeInMinutes >= 240 && timeInMinutes < 570) return 'pre_market'
  if (timeInMinutes >= 960 && timeInMinutes < 1200) return 'after_hours'
  return 'closed'
}

/**
 * Collect price for a single ticker and insert into stock_prices.
 */
export async function collectPrice(watchlistId: number, ticker: string): Promise<boolean> {
  const db = getDatabase()

  try {
    const quote: FinnhubQuote = await getQuote(ticker)

    // Finnhub returns 0 for c if ticker not found
    if (!quote.c || quote.c === 0) {
      console.warn(`[StockCollector] No price data for ${ticker}`)
      return false
    }

    const now = new Date()

    await db.insert(stockPrices).values({
      watchlistId,
      price: quote.c,
      openPrice: quote.o || null,
      highPrice: quote.h || null,
      lowPrice: quote.l || null,
      previousClose: quote.pc || null,
      changeAmount: quote.d || null,
      changePercent: quote.dp || null,
      volume: null, // Finnhub quote endpoint doesn't include volume
      marketStatus: getMarketStatusLabel(),
      source: 'finnhub',
      fetchedAt: now,
    })

    // Update last_price_at on watchlist
    await db.update(stockWatchlist)
      .set({ lastPriceAt: now, updatedAt: now })
      .where(eq(stockWatchlist.id, watchlistId))

    return true
  } catch (error) {
    console.error(`[StockCollector] Error collecting ${ticker}:`, error instanceof Error ? error.message : error)
    return false
  }
}

/**
 * Batch-fetch prices for all active watchlist tickers.
 */
export async function collectAllPrices(): Promise<{ collected: number; failed: number; total: number }> {
  const db = getDatabase()

  const items = await db.select({
    id: stockWatchlist.id,
    ticker: stockWatchlist.ticker,
  })
    .from(stockWatchlist)
    .where(eq(stockWatchlist.isActive, true))

  console.log(`[StockCollector] Collecting prices for ${items.length} tickers...`)

  let collected = 0
  let failed = 0

  for (const item of items) {
    const ok = await collectPrice(item.id, item.ticker)
    if (ok) collected++
    else failed++
  }

  console.log(`[StockCollector] Done: ${collected} collected, ${failed} failed, ${items.length} total`)
  return { collected, failed, total: items.length }
}

/**
 * Get collection status statistics.
 */
export async function getCollectionStatus() {
  const db = getDatabase()

  const [totals] = await db.select({
    totalTickers: sql<number>`COUNT(*)::int`,
    activeTickers: sql<number>`COUNT(*) FILTER (WHERE ${stockWatchlist.isActive})::int`,
    mappedTickers: sql<number>`COUNT(*) FILTER (WHERE ${stockWatchlist.entityId} IS NOT NULL)::int`,
    withPrices: sql<number>`COUNT(*) FILTER (WHERE ${stockWatchlist.lastPriceAt} IS NOT NULL)::int`,
  }).from(stockWatchlist)

  const [priceStats] = await db.select({
    totalPricePoints: sql<number>`COUNT(*)::int`,
    latestFetch: sql<string>`MAX(${stockPrices.fetchedAt})`,
    oldestFetch: sql<string>`MIN(${stockPrices.fetchedAt})`,
  }).from(stockPrices)

  return {
    ...totals,
    ...priceStats,
    marketStatus: getMarketStatusLabel(),
    isMarketOpen: isUSMarketOpen(),
  }
}
