/**
 * BTC Simulator Engine
 *
 * Paper trading engine for Bitcoin with three strategies:
 * 1. ML Model — trades based on btc_predictions
 * 2. Random — seeded PRNG: hash(seed * 31 + dayOfYear) % 100
 * 3. Buy & Hold — single long position on day 1
 *
 * Position rules:
 * - Max 1 open position at a time (single asset)
 * - Risk 10% of capital per trade
 * - Stop loss: 5%
 * - Take profit: 15% (3:1 ratio)
 * - Signal expiry: 14 days
 * - Fractional BTC amounts
 */
import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() { if (!db) db = getDatabase(); return db }

const RISK_PER_TRADE = 0.10
const STOP_LOSS_PCT = 0.05
const TAKE_PROFIT_PCT = 0.15
const SIGNAL_EXPIRY_DAYS = 14

async function getLatestBtcPrice(): Promise<number | null> {
  const result = await getDb().execute(sql`
    SELECT price FROM btc_prices ORDER BY fetched_at DESC LIMIT 1
  `)
  if (result.rows.length === 0) return null
  return parseFloat((result.rows[0] as any).price)
}

async function getOpenTrade(portfolioId: number): Promise<any | null> {
  const result = await getDb().execute(sql`
    SELECT * FROM btc_sim_trades
    WHERE portfolio_id = ${portfolioId} AND status = 'open'
    LIMIT 1
  `)
  return result.rows.length > 0 ? result.rows[0] : null
}

async function closeTrade(tradeId: number, exitPrice: number, exitReason: string): Promise<void> {
  const tradeResult = await getDb().execute(sql`
    SELECT id, portfolio_id, direction, entry_price, btc_amount, position_size
    FROM btc_sim_trades WHERE id = ${tradeId} AND status = 'open'
  `)
  if (tradeResult.rows.length === 0) return
  const trade = tradeResult.rows[0] as any

  const entryPrice = parseFloat(trade.entry_price)
  const btcAmount = parseFloat(trade.btc_amount)
  const positionSize = parseFloat(trade.position_size)
  const direction = trade.direction

  let pnl: number
  if (direction === 'long') {
    pnl = (exitPrice - entryPrice) * btcAmount
  } else {
    pnl = (entryPrice - exitPrice) * btcAmount
  }
  const pnlPercent = (pnl / positionSize) * 100

  await getDb().execute(sql`
    UPDATE btc_sim_trades
    SET exit_price = ${exitPrice}, exit_date = NOW(), pnl = ${pnl},
        pnl_percent = ${pnlPercent}, status = 'closed', exit_reason = ${exitReason}
    WHERE id = ${tradeId}
  `)

  const portfolioId = parseInt(trade.portfolio_id)
  const isWin = pnl > 0
  await getDb().execute(sql`
    UPDATE btc_sim_portfolios
    SET current_capital = current_capital + ${positionSize + pnl},
        total_trades = total_trades + 1,
        winning_trades = winning_trades + ${isWin ? 1 : 0},
        total_pnl = total_pnl + ${pnl},
        updated_at = NOW()
    WHERE id = ${portfolioId}
  `)
  console.log(`[BtcSim] Closed trade #${tradeId}: P&L=$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) — ${exitReason}`)
}

export async function updateOpenTrades(portfolioId: number): Promise<{ stopped: number; profited: number; expired: number }> {
  // Buy & hold is the benchmark: it never stops out, takes profit or expires.
  // Without this guard the 14-day expiry closed the position and froze the
  // equity curve in cash, so the benchmark stopped tracking BTC.
  const strategyResult = await getDb().execute(sql`
    SELECT strategy FROM btc_sim_portfolios WHERE id = ${portfolioId}
  `)
  if ((strategyResult.rows[0] as any)?.strategy === 'buy_and_hold') {
    return { stopped: 0, profited: 0, expired: 0 }
  }

  const currentPrice = await getLatestBtcPrice()
  if (!currentPrice) return { stopped: 0, profited: 0, expired: 0 }

  const openResult = await getDb().execute(sql`
    SELECT * FROM btc_sim_trades WHERE portfolio_id = ${portfolioId} AND status = 'open'
  `)

  let stopped = 0, profited = 0, expired = 0
  for (const trade of openResult.rows as any[]) {
    const stopLoss = trade.stop_loss ? parseFloat(trade.stop_loss) : null
    const takeProfit = trade.take_profit ? parseFloat(trade.take_profit) : null
    const direction = trade.direction

    if (stopLoss) {
      const isStoppedOut = direction === 'long' ? currentPrice <= stopLoss : currentPrice >= stopLoss
      if (isStoppedOut) { await closeTrade(parseInt(trade.id), stopLoss, 'stop_loss'); stopped++; continue }
    }
    if (takeProfit) {
      const isTakingProfit = direction === 'long' ? currentPrice >= takeProfit : currentPrice <= takeProfit
      if (isTakingProfit) { await closeTrade(parseInt(trade.id), takeProfit, 'take_profit'); profited++; continue }
    }
    const daysSinceEntry = (Date.now() - new Date(trade.entry_date).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceEntry >= SIGNAL_EXPIRY_DAYS) { await closeTrade(parseInt(trade.id), currentPrice, 'signal_expired'); expired++; continue }
  }
  return { stopped, profited, expired }
}

export async function processMLSignals(portfolioId: number): Promise<{ opened: boolean; reason?: string }> {
  const openTrade = await getOpenTrade(portfolioId)
  if (openTrade) return { opened: false, reason: 'Position already open' }

  const currentPrice = await getLatestBtcPrice()
  if (!currentPrice) return { opened: false, reason: 'No price data' }

  // Get latest active prediction
  const pred = await getDb().execute(sql`
    SELECT * FROM btc_predictions
    WHERE status = 'active' AND direction != 'neutral' AND confidence > 0.1
    ORDER BY prediction_date DESC LIMIT 1
  `)
  if (pred.rows.length === 0) return { opened: false, reason: 'No active predictions' }
  const prediction = pred.rows[0] as any

  const portResult = await getDb().execute(sql`
    SELECT current_capital FROM btc_sim_portfolios WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return { opened: false, reason: 'Portfolio not found' }
  const capital = parseFloat((portResult.rows[0] as any).current_capital)

  const direction = prediction.direction === 'bearish' ? 'short' : 'long'
  const positionSize = capital * RISK_PER_TRADE
  const btcAmount = positionSize / currentPrice

  const stopLoss = direction === 'long' ? currentPrice * (1 - STOP_LOSS_PCT) : currentPrice * (1 + STOP_LOSS_PCT)
  const takeProfit = direction === 'long' ? currentPrice * (1 + TAKE_PROFIT_PCT) : currentPrice * (1 - TAKE_PROFIT_PCT)

  await getDb().execute(sql`
    INSERT INTO btc_sim_trades (
      portfolio_id, prediction_id, direction, entry_price, entry_date,
      btc_amount, position_size, stop_loss, take_profit, status
    ) VALUES (
      ${portfolioId}, ${parseInt(prediction.id)}, ${direction}, ${currentPrice}, NOW(),
      ${btcAmount}, ${positionSize}, ${stopLoss}, ${takeProfit}, 'open'
    )
  `)

  await getDb().execute(sql`
    UPDATE btc_sim_portfolios SET current_capital = current_capital - ${positionSize}, updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(`[BtcSim] ML: Opened ${direction} BTC @ $${currentPrice.toFixed(0)}, ${btcAmount.toFixed(6)} BTC ($${positionSize.toFixed(0)})`)
  return { opened: true }
}

export async function processRandomSignals(portfolioId: number): Promise<{ opened: boolean; reason?: string }> {
  const openTrade = await getOpenTrade(portfolioId)
  if (openTrade) return { opened: false, reason: 'Position already open' }

  const portResult = await getDb().execute(sql`
    SELECT current_capital, random_seed FROM btc_sim_portfolios WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return { opened: false, reason: 'Portfolio not found' }
  const capital = parseFloat((portResult.rows[0] as any).current_capital)
  const seed = parseInt((portResult.rows[0] as any).random_seed) || 42

  const now = new Date()
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24))
  const roll = Math.abs((seed * 31 + dayOfYear * 17) % 100)

  // 20% buy, 20% sell, 60% hold
  if (roll >= 40) return { opened: false, reason: 'Random: hold' }

  const currentPrice = await getLatestBtcPrice()
  if (!currentPrice) return { opened: false, reason: 'No price data' }

  const direction = roll < 20 ? 'long' : 'short'
  const positionSize = capital * RISK_PER_TRADE
  const btcAmount = positionSize / currentPrice
  const stopLoss = direction === 'long' ? currentPrice * (1 - STOP_LOSS_PCT) : currentPrice * (1 + STOP_LOSS_PCT)
  const takeProfit = direction === 'long' ? currentPrice * (1 + TAKE_PROFIT_PCT) : currentPrice * (1 - TAKE_PROFIT_PCT)

  await getDb().execute(sql`
    INSERT INTO btc_sim_trades (
      portfolio_id, direction, entry_price, entry_date,
      btc_amount, position_size, stop_loss, take_profit, status
    ) VALUES (
      ${portfolioId}, ${direction}, ${currentPrice}, NOW(),
      ${btcAmount}, ${positionSize}, ${stopLoss}, ${takeProfit}, 'open'
    )
  `)

  await getDb().execute(sql`
    UPDATE btc_sim_portfolios SET current_capital = current_capital - ${positionSize}, updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(`[BtcSim] Random: Opened ${direction} BTC @ $${currentPrice.toFixed(0)}, ${btcAmount.toFixed(6)} BTC`)
  return { opened: true }
}

export async function processBuyAndHold(portfolioId: number): Promise<{ opened: boolean; reason?: string }> {
  const openTrade = await getOpenTrade(portfolioId)
  if (openTrade) return { opened: false, reason: 'Already holding' }

  // Check if we've ever traded (buy & hold = one trade only)
  const tradeCount = await getDb().execute(sql`
    SELECT COUNT(*)::int as cnt FROM btc_sim_trades WHERE portfolio_id = ${portfolioId}
  `)
  if (parseInt((tradeCount.rows[0] as any).cnt) > 0) return { opened: false, reason: 'Buy & hold already executed' }

  const currentPrice = await getLatestBtcPrice()
  if (!currentPrice) return { opened: false, reason: 'No price data' }

  const portResult = await getDb().execute(sql`
    SELECT current_capital FROM btc_sim_portfolios WHERE id = ${portfolioId}
  `)
  const capital = parseFloat((portResult.rows[0] as any).current_capital)

  // Invest 95% of capital
  const positionSize = capital * 0.95
  const btcAmount = positionSize / currentPrice

  await getDb().execute(sql`
    INSERT INTO btc_sim_trades (
      portfolio_id, direction, entry_price, entry_date,
      btc_amount, position_size, status, metadata
    ) VALUES (
      ${portfolioId}, 'long', ${currentPrice}, NOW(),
      ${btcAmount}, ${positionSize}, 'open',
      '{"strategy": "buy_and_hold"}'::jsonb
    )
  `)

  await getDb().execute(sql`
    UPDATE btc_sim_portfolios SET current_capital = current_capital - ${positionSize}, updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(`[BtcSim] Buy&Hold: Bought ${btcAmount.toFixed(6)} BTC @ $${currentPrice.toFixed(0)} ($${positionSize.toFixed(0)})`)
  return { opened: true }
}

export async function takeSnapshot(portfolioId: number): Promise<void> {
  const portResult = await getDb().execute(sql`
    SELECT current_capital, initial_capital, total_pnl FROM btc_sim_portfolios WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return
  const portfolio = portResult.rows[0] as any

  const capital = parseFloat(portfolio.current_capital)
  const initialCapital = parseFloat(portfolio.initial_capital)
  const currentPrice = await getLatestBtcPrice()

  // Calculate unrealized P&L
  const openResult = await getDb().execute(sql`
    SELECT direction, entry_price, btc_amount, position_size FROM btc_sim_trades
    WHERE portfolio_id = ${portfolioId} AND status = 'open'
  `)

  let unrealizedPnl = 0
  let openPositionValue = 0
  for (const trade of openResult.rows as any[]) {
    if (!currentPrice) continue
    const entryPrice = parseFloat(trade.entry_price)
    const btcAmount = parseFloat(trade.btc_amount)
    const posSize = parseFloat(trade.position_size)
    if (trade.direction === 'long') {
      unrealizedPnl += (currentPrice - entryPrice) * btcAmount
    } else {
      unrealizedPnl += (entryPrice - currentPrice) * btcAmount
    }
    openPositionValue += posSize
  }

  const portfolioValue = capital + unrealizedPnl + openPositionValue
  const cumulativePnl = portfolioValue - initialCapital

  const peakResult = await getDb().execute(sql`
    SELECT MAX(portfolio_value) as peak FROM btc_sim_snapshots WHERE portfolio_id = ${portfolioId}
  `)
  const peak = Math.max(parseFloat((peakResult.rows[0] as any)?.peak || '0') || initialCapital, portfolioValue)
  const drawdown = peak > 0 ? ((peak - portfolioValue) / peak) * 100 : 0

  const prevResult = await getDb().execute(sql`
    SELECT portfolio_value FROM btc_sim_snapshots WHERE portfolio_id = ${portfolioId}
    ORDER BY snapshot_date DESC LIMIT 1
  `)
  const prevValue = prevResult.rows.length > 0 ? parseFloat((prevResult.rows[0] as any).portfolio_value) : initialCapital
  const dailyPnl = portfolioValue - prevValue
  const today = new Date().toISOString().split('T')[0]

  await getDb().execute(sql`
    INSERT INTO btc_sim_snapshots (
      portfolio_id, snapshot_date, capital, portfolio_value,
      open_positions, daily_pnl, cumulative_pnl, drawdown, btc_price
    ) VALUES (
      ${portfolioId}, ${today}::date, ${capital}, ${portfolioValue},
      ${openResult.rows.length}, ${dailyPnl}, ${cumulativePnl}, ${drawdown}, ${currentPrice}
    )
    ON CONFLICT (portfolio_id, snapshot_date) DO UPDATE SET
      capital = EXCLUDED.capital, portfolio_value = EXCLUDED.portfolio_value,
      open_positions = EXCLUDED.open_positions, daily_pnl = EXCLUDED.daily_pnl,
      cumulative_pnl = EXCLUDED.cumulative_pnl, drawdown = EXCLUDED.drawdown,
      btc_price = EXCLUDED.btc_price
  `)

  await getDb().execute(sql`
    UPDATE btc_sim_portfolios
    SET current_value = ${portfolioValue}, max_drawdown = GREATEST(max_drawdown, ${drawdown}), updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(`[BtcSim] Snapshot ${today}: Portfolio #${portfolioId} value=$${portfolioValue.toFixed(0)}, PnL=$${cumulativePnl.toFixed(0)}, DD=${drawdown.toFixed(2)}%`)
}
