/**
 * BTC Live Trading API — Read Endpoints
 *
 * GET /api/bitcoin/live-trading?action=status     — Portfolio overview + safety status
 * GET /api/bitcoin/live-trading?action=trades     — Trade history
 * GET /api/bitcoin/live-trading?action=equity     — Equity curve snapshots
 * GET /api/bitcoin/live-trading?action=audit&limit=50 — Recent audit log
 */
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'
import { getExchangeBalance, getExchangeBtcPrice } from '~/server/services/btcLiveTradingEngine'
import { getEnvironmentLabel } from '~/server/utils/binanceClient'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const action = (query.action as string) || 'status'
  const db = getDatabase()
  const env = getEnvironmentLabel().toLowerCase()

  if (action === 'status') {
    const portResult = await db.execute(sql`
      SELECT * FROM btc_live_portfolio WHERE environment = ${env} LIMIT 1
    `)
    if (portResult.rows.length === 0) {
      return {
        environment: env,
        portfolio: null,
        message: 'No portfolio found. Run npm run btc:live-run to create one.',
      }
    }
    const portfolio = portResult.rows[0] as any
    const portfolioId = parseInt(portfolio.id)

    // Open position with unrealized PnL
    const currentPrice = await getExchangeBtcPrice()
    const openResult = await db.execute(sql`
      SELECT * FROM btc_live_trades
      WHERE portfolio_id = ${portfolioId} AND status = 'open'
    `)

    const openPositions = (openResult.rows as any[]).map(t => {
      const entryPrice = parseFloat(t.entry_price)
      const btcAmount = parseFloat(t.btc_amount)
      const unrealizedPnl = currentPrice ? (currentPrice - entryPrice) * btcAmount : 0
      const unrealizedPnlPct = currentPrice ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0
      return {
        ...t,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPct,
      }
    })

    // Exchange balance
    let exchangeBalance = null
    try { exchangeBalance = await getExchangeBalance() } catch { /* ignore */ }

    // Safety status
    const dailyLossLimit = parseFloat(process.env.BTC_LIVE_DAILY_LOSS_LIMIT_USD || '500')
    const maxPositionUsd = parseFloat(process.env.BTC_LIVE_MAX_POSITION_USD || '1000')
    const dailyPnl = portfolio.daily_pnl_date === new Date().toISOString().split('T')[0]
      ? parseFloat(portfolio.daily_pnl_today || '0')
      : 0

    const initialCapital = parseFloat(portfolio.initial_capital)
    const currentValue = parseFloat(portfolio.current_value)
    const totalTrades = parseInt(portfolio.total_trades) || 0
    const winningTrades = parseInt(portfolio.winning_trades) || 0

    return {
      environment: env,
      portfolio: {
        id: portfolioId,
        name: portfolio.name,
        initialCapital,
        currentCapital: parseFloat(portfolio.current_capital),
        currentValue,
        totalReturn: initialCapital > 0 ? ((currentValue - initialCapital) / initialCapital) * 100 : 0,
        totalPnl: parseFloat(portfolio.total_pnl) || 0,
        totalFees: parseFloat(portfolio.total_fees) || 0,
        totalTrades,
        winningTrades,
        winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
        maxDrawdown: parseFloat(portfolio.max_drawdown) || 0,
        isActive: portfolio.is_active,
        haltReason: portfolio.halt_reason,
      },
      openPositions,
      currentBtcPrice: currentPrice,
      exchangeBalance,
      safety: {
        isActive: portfolio.is_active,
        haltReason: portfolio.halt_reason,
        dailyPnl,
        dailyLossLimit,
        dailyLossRemaining: dailyLossLimit + dailyPnl, // positive = headroom remaining
        maxPositionUsd,
        hasApiKey: !!(process.env.BINANCE_API_KEY),
      },
    }
  }

  if (action === 'trades') {
    const portResult = await db.execute(sql`
      SELECT id FROM btc_live_portfolio WHERE environment = ${env} LIMIT 1
    `)
    if (portResult.rows.length === 0) return []

    const portfolioId = parseInt((portResult.rows[0] as any).id)
    const trades = await db.execute(sql`
      SELECT * FROM btc_live_trades
      WHERE portfolio_id = ${portfolioId}
      ORDER BY entry_date DESC
      LIMIT 100
    `)
    return trades.rows
  }

  if (action === 'equity') {
    const portResult = await db.execute(sql`
      SELECT id FROM btc_live_portfolio WHERE environment = ${env} LIMIT 1
    `)
    if (portResult.rows.length === 0) return []

    const portfolioId = parseInt((portResult.rows[0] as any).id)
    const snapshots = await db.execute(sql`
      SELECT snapshot_date, capital, portfolio_value, exchange_balance,
             open_positions, daily_pnl, cumulative_pnl, drawdown, btc_price
      FROM btc_live_snapshots
      WHERE portfolio_id = ${portfolioId}
      ORDER BY snapshot_date ASC
    `)
    return snapshots.rows
  }

  if (action === 'audit') {
    const limit = parseInt(query.limit as string) || 50
    const portResult = await db.execute(sql`
      SELECT id FROM btc_live_portfolio WHERE environment = ${env} LIMIT 1
    `)
    if (portResult.rows.length === 0) return []

    const portfolioId = parseInt((portResult.rows[0] as any).id)
    const logs = await db.execute(sql`
      SELECT * FROM btc_live_audit_log
      WHERE portfolio_id = ${portfolioId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    return logs.rows
  }

  return { error: `Unknown action: ${action}` }
})
