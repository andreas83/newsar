/**
 * BTC Simulator API
 *
 * GET /api/bitcoin/simulator?action=leaderboard  — 3 strategies side-by-side
 * GET /api/bitcoin/simulator?action=portfolio&id=N — Portfolio detail with equity curve
 * GET /api/bitcoin/simulator?action=trades&portfolio=N — Trade history
 */
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const action = (query.action as string) || 'leaderboard'
  const db = getDatabase()

  if (action === 'leaderboard') {
    const portfolios = await db.execute(sql`
      SELECT
        p.id, p.name, p.strategy, p.initial_capital, p.current_capital,
        p.current_value, p.total_trades, p.winning_trades, p.total_pnl,
        p.max_drawdown, p.sharpe_ratio
      FROM btc_sim_portfolios p
      WHERE p.is_active = true
      ORDER BY p.current_value DESC
    `)

    // Get equity curves for all portfolios
    const equityCurves: Record<number, any[]> = {}
    for (const p of portfolios.rows as any[]) {
      const id = parseInt(p.id)
      const snapshots = await db.execute(sql`
        SELECT snapshot_date, portfolio_value, btc_price
        FROM btc_sim_snapshots
        WHERE portfolio_id = ${id}
        ORDER BY snapshot_date ASC
      `)
      equityCurves[id] = snapshots.rows
    }

    return {
      portfolios: portfolios.rows.map((p: any, idx: number) => ({
        id: parseInt(p.id),
        name: p.name,
        strategy: p.strategy,
        initialCapital: parseFloat(p.initial_capital),
        currentValue: parseFloat(p.current_value),
        totalReturn: ((parseFloat(p.current_value) - parseFloat(p.initial_capital)) / parseFloat(p.initial_capital)) * 100,
        totalTrades: parseInt(p.total_trades) || 0,
        winRate: (parseInt(p.total_trades) || 0) > 0
          ? ((parseInt(p.winning_trades) || 0) / parseInt(p.total_trades) * 100)
          : 0,
        maxDrawdown: parseFloat(p.max_drawdown) || 0,
        sharpeRatio: parseFloat(p.sharpe_ratio) || null,
        totalPnl: parseFloat(p.total_pnl) || 0,
        rank: idx + 1,
      })),
      equityCurves,
    }
  }

  if (action === 'portfolio') {
    const id = parseInt(query.id as string)
    if (!id) return { error: 'Portfolio ID required' }

    const portResult = await db.execute(sql`
      SELECT * FROM btc_sim_portfolios WHERE id = ${id}
    `)
    if (portResult.rows.length === 0) return { error: 'Portfolio not found' }

    const openTrades = await db.execute(sql`
      SELECT t.*, bp.price as current_price
      FROM btc_sim_trades t
      LEFT JOIN LATERAL (
        SELECT price FROM btc_prices ORDER BY fetched_at DESC LIMIT 1
      ) bp ON true
      WHERE t.portfolio_id = ${id} AND t.status = 'open'
    `)

    const snapshots = await db.execute(sql`
      SELECT snapshot_date, portfolio_value, btc_price, daily_pnl, drawdown
      FROM btc_sim_snapshots WHERE portfolio_id = ${id}
      ORDER BY snapshot_date ASC
    `)

    return {
      portfolio: portResult.rows[0],
      openPositions: openTrades.rows.map((t: any) => ({
        ...t,
        unrealizedPnl: t.current_price && t.entry_price
          ? (t.direction === 'long'
            ? (parseFloat(t.current_price) - parseFloat(t.entry_price)) * parseFloat(t.btc_amount)
            : (parseFloat(t.entry_price) - parseFloat(t.current_price)) * parseFloat(t.btc_amount))
          : 0,
      })),
      equityCurve: snapshots.rows,
    }
  }

  if (action === 'trades') {
    const portfolioId = parseInt(query.portfolio as string)
    if (!portfolioId) return { error: 'Portfolio ID required' }

    const trades = await db.execute(sql`
      SELECT * FROM btc_sim_trades
      WHERE portfolio_id = ${portfolioId}
      ORDER BY entry_date DESC
      LIMIT 100
    `)

    return trades.rows
  }

  return { error: `Unknown action: ${action}` }
})
