/**
 * BTC Price API
 * GET /api/bitcoin/prices?range=7d|30d|90d|1y
 * Default: current price + 7d sparkline + 24h stats
 */
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const range = (query.range as string) || '7d'
  const db = getDatabase()

  // Map range to days
  const rangeDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
  const days = rangeDays[range] || 7

  // Current price (latest)
  const latestResult = await db.execute(sql`
    SELECT price, open_price, high_price, low_price, volume_24h, market_cap,
           change_percent_24h, fetched_at
    FROM btc_prices
    ORDER BY fetched_at DESC LIMIT 1
  `)

  const latest = latestResult.rows[0] as any || null

  // Price history for chart
  const historyResult = await db.execute(sql`
    SELECT DISTINCT ON (DATE(fetched_at))
      price, open_price, high_price, low_price, volume_24h,
      fetched_at
    FROM btc_prices
    WHERE fetched_at > NOW() - ${days + ' days'}::interval
    ORDER BY DATE(fetched_at) ASC, fetched_at DESC
  `)

  // 24h stats
  const statsResult = await db.execute(sql`
    SELECT
      MIN(price) as low_24h,
      MAX(price) as high_24h
    FROM btc_prices
    WHERE fetched_at > NOW() - INTERVAL '24 hours'
  `)
  const stats = statsResult.rows[0] as any

  return {
    current: latest ? {
      price: parseFloat(latest.price),
      openPrice: parseFloat(latest.open_price) || null,
      highPrice: parseFloat(latest.high_price) || null,
      lowPrice: parseFloat(latest.low_price) || null,
      volume24h: parseFloat(latest.volume_24h) || null,
      marketCap: parseFloat(latest.market_cap) || null,
      changePercent24h: parseFloat(latest.change_percent_24h) || null,
      fetchedAt: latest.fetched_at,
    } : null,
    stats: {
      high24h: parseFloat(stats?.high_24h) || null,
      low24h: parseFloat(stats?.low_24h) || null,
    },
    history: historyResult.rows.map((r: any) => ({
      price: parseFloat(r.price),
      open: parseFloat(r.open_price) || null,
      high: parseFloat(r.high_price) || null,
      low: parseFloat(r.low_price) || null,
      volume: parseFloat(r.volume_24h) || null,
      date: r.fetched_at,
    })),
    range,
  }
})
