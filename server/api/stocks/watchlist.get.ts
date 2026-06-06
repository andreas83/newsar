import { getDatabase } from '~/server/database/db'
import { stockWatchlist, stockPrices } from '~/server/database/schema'
import { eq, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sector = query.sector as string | undefined
  const db = getDatabase()

  try {
    // Get all active watchlist items with their latest price + 7-day sparkline
    const items = await db.execute(sql`
      SELECT
        w.id,
        w.ticker,
        w.company_name,
        w.exchange,
        w.sector,
        w.entity_id,
        w.last_price_at,
        e.slug as entity_slug,
        p.price,
        p.open_price,
        p.high_price,
        p.low_price,
        p.previous_close,
        p.change_amount,
        p.change_percent,
        p.volume,
        p.market_status,
        p.fetched_at,
        spark.prices as sparkline
      FROM stock_watchlist w
      LEFT JOIN entities e ON w.entity_id = e.id
      LEFT JOIN LATERAL (
        SELECT * FROM stock_prices sp
        WHERE sp.watchlist_id = w.id
        ORDER BY sp.fetched_at DESC
        LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(sub.price ORDER BY sub.fetched_at ASC) as prices
        FROM (
          SELECT sp2.price, sp2.fetched_at
          FROM stock_prices sp2
          WHERE sp2.watchlist_id = w.id
            AND sp2.fetched_at >= NOW() - INTERVAL '8 days'
          ORDER BY sp2.fetched_at DESC
          LIMIT 10
        ) sub
      ) spark ON true
      WHERE w.is_active = true
      ${sector ? sql`AND w.sector = ${sector}` : sql``}
      ORDER BY w.sector, w.ticker
    `)

    // Get unique sectors for filtering
    const sectorsResult = await db.execute(sql`
      SELECT DISTINCT sector FROM stock_watchlist
      WHERE is_active = true AND sector IS NOT NULL
      ORDER BY sector
    `)

    return {
      items: items.rows.map((r: any) => ({
        id: r.id,
        ticker: r.ticker,
        companyName: r.company_name,
        exchange: r.exchange,
        sector: r.sector,
        entityId: r.entity_id,
        entitySlug: r.entity_slug,
        price: r.price,
        openPrice: r.open_price,
        highPrice: r.high_price,
        lowPrice: r.low_price,
        previousClose: r.previous_close,
        changeAmount: r.change_amount,
        changePercent: r.change_percent,
        volume: r.volume,
        marketStatus: r.market_status,
        fetchedAt: r.fetched_at,
        lastPriceAt: r.last_price_at,
        sparkline: r.sparkline || [],
      })),
      sectors: sectorsResult.rows.map((r: any) => r.sector),
    }
  } catch (error) {
    console.error('Error fetching stock watchlist:', error)
    throw createError({ statusCode: 500, message: 'Failed to fetch stock watchlist' })
  }
})
