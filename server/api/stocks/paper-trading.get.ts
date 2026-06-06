/**
 * Paper Trading API
 *
 * Routes:
 *   GET /api/stocks/paper-trading?action=portfolios    — List all portfolios
 *   GET /api/stocks/paper-trading?action=portfolio&id=1 — Portfolio detail + equity curve
 *   GET /api/stocks/paper-trading?action=trades&portfolio=1 — Trade history
 *   GET /api/stocks/paper-trading?action=comparison     — Side-by-side comparison
 */

import { getDatabase } from '../../database/db'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const action = (query.action as string) || 'portfolios'
  const db = getDatabase()

  if (action === 'portfolios') {
    const result = await db.execute(sql`
      SELECT
        pp.*,
        (SELECT COUNT(*) FROM paper_trades pt WHERE pt.portfolio_id = pp.id AND pt.status = 'open') as open_positions,
        CASE WHEN pp.total_trades > 0
          THEN ROUND((pp.winning_trades::numeric / pp.total_trades * 100)::numeric, 1)
          ELSE 0
        END as win_rate_pct,
        ROUND(((pp.current_value - pp.initial_capital) / pp.initial_capital * 100)::numeric, 2) as total_return_pct
      FROM paper_portfolios pp
      WHERE pp.is_active = true
      ORDER BY pp.id
    `)

    return result.rows
  }

  if (action === 'portfolio') {
    const id = parseInt(query.id as string)
    if (!id) return { error: 'Missing id parameter' }

    // Portfolio details
    const portResult = await db.execute(sql`
      SELECT * FROM paper_portfolios WHERE id = ${id}
    `)
    if (portResult.rows.length === 0) return { error: 'Portfolio not found' }

    // Equity curve (last 90 days)
    const snapshots = await db.execute(sql`
      SELECT snapshot_date, portfolio_value, capital, open_positions,
             daily_pnl, cumulative_pnl, drawdown, spy_value
      FROM paper_portfolio_snapshots
      WHERE portfolio_id = ${id}
      ORDER BY snapshot_date ASC
    `)

    // Open positions with current prices
    const positions = await db.execute(sql`
      SELECT
        pt.*,
        sw.ticker, sw.company_name, sw.sector,
        (SELECT sp.price FROM stock_prices sp
         WHERE sp.watchlist_id = pt.watchlist_id
         ORDER BY sp.fetched_at DESC LIMIT 1) as current_price
      FROM paper_trades pt
      JOIN stock_watchlist sw ON sw.id = pt.watchlist_id
      WHERE pt.portfolio_id = ${id} AND pt.status = 'open'
      ORDER BY pt.entry_date DESC
    `)

    // Calculate unrealized P&L for each position
    const positionsWithPnl = (positions.rows as any[]).map(p => {
      const currentPrice = parseFloat(p.current_price || p.entry_price)
      const entryPrice = parseFloat(p.entry_price)
      const shares = parseFloat(p.shares)
      const unrealizedPnl = p.direction === 'long'
        ? (currentPrice - entryPrice) * shares
        : (entryPrice - currentPrice) * shares
      const unrealizedPnlPct = (unrealizedPnl / parseFloat(p.position_size)) * 100

      return { ...p, current_price: currentPrice, unrealized_pnl: unrealizedPnl, unrealized_pnl_pct: unrealizedPnlPct }
    })

    // Performance metrics
    const closedStats = await db.execute(sql`
      SELECT
        COUNT(*) as total_closed,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
        AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
        AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss,
        AVG(pnl) as avg_pnl,
        SUM(pnl) as total_pnl,
        AVG(pnl_percent) as avg_pnl_pct
      FROM paper_trades
      WHERE portfolio_id = ${id} AND status = 'closed'
    `)

    return {
      portfolio: portResult.rows[0],
      equityCurve: snapshots.rows,
      openPositions: positionsWithPnl,
      closedStats: closedStats.rows[0],
    }
  }

  if (action === 'trades') {
    const portfolioId = parseInt(query.portfolio as string)
    if (!portfolioId) return { error: 'Missing portfolio parameter' }

    const limit = Math.min(parseInt(query.limit as string) || 50, 200)

    const trades = await db.execute(sql`
      SELECT
        pt.*,
        sw.ticker, sw.company_name, sw.sector
      FROM paper_trades pt
      JOIN stock_watchlist sw ON sw.id = pt.watchlist_id
      WHERE pt.portfolio_id = ${portfolioId}
      ORDER BY pt.created_at DESC
      LIMIT ${limit}
    `)

    return trades.rows
  }

  if (action === 'comparison') {
    // Side-by-side comparison of all portfolios
    const portfolios = await db.execute(sql`
      SELECT
        pp.id, pp.name, pp.strategy,
        pp.initial_capital, pp.current_value, pp.total_pnl,
        pp.total_trades, pp.winning_trades, pp.max_drawdown, pp.sharpe_ratio,
        ROUND(((pp.current_value - pp.initial_capital) / pp.initial_capital * 100)::numeric, 2) as total_return_pct,
        CASE WHEN pp.total_trades > 0
          THEN ROUND((pp.winning_trades::numeric / pp.total_trades * 100)::numeric, 1)
          ELSE 0
        END as win_rate_pct
      FROM paper_portfolios pp
      WHERE pp.is_active = true
      ORDER BY pp.id
    `)

    // Get equity curves for overlay chart
    const curves: Record<number, any[]> = {}
    for (const p of portfolios.rows as any[]) {
      const snap = await db.execute(sql`
        SELECT snapshot_date, portfolio_value, cumulative_pnl, drawdown, spy_value
        FROM paper_portfolio_snapshots
        WHERE portfolio_id = ${parseInt(p.id)}
        ORDER BY snapshot_date ASC
      `)
      curves[p.id] = snap.rows as any[]
    }

    return {
      portfolios: portfolios.rows,
      equityCurves: curves,
    }
  }

  return { error: `Unknown action: ${action}` }
})
