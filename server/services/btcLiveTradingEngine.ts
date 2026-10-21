/**
 * BTC Live Trading Engine
 *
 * Executes real market orders on Binance (testnet by default) based on ML predictions.
 * Mirrors btcSimulatorEngine.ts structure but adds exchange interaction and safety guards.
 *
 * Safety guards (checked before every trade):
 * 1. Kill switch (isActive flag)
 * 2. API key validation
 * 3. Daily loss limit — auto-halt if exceeded
 * 4. Exchange connectivity — fetchBalance() test
 * 5. Max position size cap
 * 6. Testnet by default (BINANCE_LIVE_TRADING=false)
 * 7. Full audit log — every action recorded
 *
 * Spot-only: bearish signals are logged but skipped (no short selling).
 */
import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'
import { getBinanceClient, isLiveEnvironment, getEnvironmentLabel, TRADING_PAIR } from '../utils/binanceClient'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() { if (!db) db = getDatabase(); return db }

const RISK_PER_TRADE = parseFloat(process.env.BTC_LIVE_RISK_PER_TRADE || '0.10')
const STOP_LOSS_PCT = parseFloat(process.env.BTC_LIVE_STOP_LOSS_PCT || '0.05')
const TAKE_PROFIT_PCT = parseFloat(process.env.BTC_LIVE_TAKE_PROFIT_PCT || '0.15')
const MAX_POSITION_USD = parseFloat(process.env.BTC_LIVE_MAX_POSITION_USD || '1000')
const DAILY_LOSS_LIMIT = parseFloat(process.env.BTC_LIVE_DAILY_LOSS_LIMIT_USD || '500')
const SIGNAL_EXPIRY_DAYS = 14

// ─── Audit Log ───────────────────────────────────────────────

export async function auditLog(portfolioId: number, action: string, details: any, tradeId?: number): Promise<void> {
  const env = getEnvironmentLabel().toLowerCase()
  await getDb().execute(sql`
    INSERT INTO btc_live_audit_log (portfolio_id, action, trade_id, environment, details)
    VALUES (${portfolioId}, ${action}, ${tradeId ?? null}, ${env}, ${JSON.stringify(details)}::jsonb)
  `)
}

// ─── Exchange Helpers ────────────────────────────────────────

export async function getExchangeBalance(): Promise<{ usdt: number; btc: number } | null> {
  try {
    const exchange = getBinanceClient()
    const balance = await exchange.fetchBalance()
    const free = balance.free as Record<string, any> || {}
    return {
      usdt: parseFloat(free['USDC'] || '0'),
      btc: parseFloat(free['BTC'] || '0'),
    }
  } catch (e: any) {
    console.error('[LiveTrading] fetchBalance failed:', e.message)
    return null
  }
}

export async function getExchangeBtcPrice(): Promise<number | null> {
  try {
    const exchange = getBinanceClient()
    const ticker = await exchange.fetchTicker(TRADING_PAIR)
    return ticker.last ?? null
  } catch (e: any) {
    console.warn('[LiveTrading] fetchTicker failed, falling back to btc_prices:', e.message)
    // Fall back to local price data
    const result = await getDb().execute(sql`
      SELECT price FROM btc_prices ORDER BY fetched_at DESC LIMIT 1
    `)
    if (result.rows.length === 0) return null
    return parseFloat((result.rows[0] as any).price)
  }
}

// ─── Safety Guards ───────────────────────────────────────────

export async function checkSafetyGuards(portfolioId: number): Promise<{ safe: boolean; reason?: string }> {
  // 1. Check portfolio isActive flag
  const portResult = await getDb().execute(sql`
    SELECT is_active, halt_reason, daily_pnl_today, daily_pnl_date
    FROM btc_live_portfolio WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return { safe: false, reason: 'Portfolio not found' }
  const port = portResult.rows[0] as any

  if (!port.is_active) {
    return { safe: false, reason: `Trading halted: ${port.halt_reason || 'kill switch active'}` }
  }

  // 2. API key validation
  const apiKey = process.env.BINANCE_API_KEY || ''
  if (!apiKey) {
    await haltPortfolio(portfolioId, 'No BINANCE_API_KEY configured')
    return { safe: false, reason: 'No BINANCE_API_KEY configured' }
  }

  // 3. Daily loss limit
  const today = new Date().toISOString().split('T')[0]
  const dailyPnl = port.daily_pnl_date === today ? parseFloat(port.daily_pnl_today || '0') : 0
  if (dailyPnl < -DAILY_LOSS_LIMIT) {
    await haltPortfolio(portfolioId, `Daily loss limit exceeded: $${Math.abs(dailyPnl).toFixed(2)} > $${DAILY_LOSS_LIMIT}`)
    return { safe: false, reason: `Daily loss limit exceeded ($${Math.abs(dailyPnl).toFixed(2)})` }
  }

  // 4. Exchange connectivity
  const balance = await getExchangeBalance()
  if (!balance) {
    return { safe: false, reason: 'Cannot connect to exchange' }
  }

  return { safe: true }
}

async function haltPortfolio(portfolioId: number, reason: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE btc_live_portfolio SET is_active = false, halt_reason = ${reason}, updated_at = NOW()
    WHERE id = ${portfolioId}
  `)
  await auditLog(portfolioId, 'safety_halt', { reason })
  console.error(`[LiveTrading] HALTED portfolio #${portfolioId}: ${reason}`)
}

// ─── Portfolio Management ────────────────────────────────────

export async function getOrCreatePortfolio(): Promise<number> {
  const env = getEnvironmentLabel().toLowerCase()
  const existing = await getDb().execute(sql`
    SELECT id FROM btc_live_portfolio WHERE environment = ${env} LIMIT 1
  `)
  if (existing.rows.length > 0) return parseInt((existing.rows[0] as any).id)

  // Seed initial capital from actual exchange balance
  const balance = await getExchangeBalance()
  const initialCapital = balance ? balance.usdt : 0

  const result = await getDb().execute(sql`
    INSERT INTO btc_live_portfolio (name, environment, initial_capital, allocated_capital, current_capital, current_value)
    VALUES (${'Live BTC ' + env.charAt(0).toUpperCase() + env.slice(1)}, ${env}, ${initialCapital}, ${initialCapital}, ${initialCapital}, ${initialCapital})
    RETURNING id
  `)
  const id = parseInt((result.rows[0] as any).id)
  await auditLog(id, 'portfolio_created', { environment: env, initialCapital })
  console.log(`[LiveTrading] Created portfolio #${id} (${env}) with $${initialCapital.toFixed(2)}`)
  return id
}

export async function resetDailyPnl(portfolioId: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const result = await getDb().execute(sql`
    SELECT daily_pnl_date FROM btc_live_portfolio WHERE id = ${portfolioId}
  `)
  if (result.rows.length === 0) return
  const currentDate = (result.rows[0] as any).daily_pnl_date

  if (currentDate !== today) {
    await getDb().execute(sql`
      UPDATE btc_live_portfolio SET daily_pnl_today = 0, daily_pnl_date = ${today}, updated_at = NOW()
      WHERE id = ${portfolioId}
    `)
    console.log(`[LiveTrading] Reset daily PnL for new day: ${today}`)
  }
}

export async function syncBalanceFromExchange(portfolioId: number): Promise<void> {
  const balance = await getExchangeBalance()
  if (!balance) return

  const portResult = await getDb().execute(sql`
    SELECT current_capital FROM btc_live_portfolio WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return
  const recordedCapital = parseFloat((portResult.rows[0] as any).current_capital)

  // Log discrepancy if > 1% difference (ignoring open positions)
  const openResult = await getDb().execute(sql`
    SELECT COALESCE(SUM(position_size), 0) as open_value FROM btc_live_trades
    WHERE portfolio_id = ${portfolioId} AND status = 'open'
  `)
  const openValue = parseFloat((openResult.rows[0] as any).open_value || '0')
  const expectedExchangeUsdt = recordedCapital // Free USDT should approximate current_capital when no positions
  const discrepancy = Math.abs(balance.usdt + openValue - recordedCapital - openValue)

  if (discrepancy > recordedCapital * 0.01 && recordedCapital > 0) {
    await auditLog(portfolioId, 'balance_discrepancy', {
      exchangeUsdt: balance.usdt,
      exchangeBtc: balance.btc,
      recordedCapital,
      openPositionValue: openValue,
      discrepancy,
    })
    console.warn(`[LiveTrading] Balance discrepancy: exchange USDT=${balance.usdt.toFixed(2)}, recorded capital=${recordedCapital.toFixed(2)}, open=${openValue.toFixed(2)}`)
  }

  await auditLog(portfolioId, 'balance_sync', {
    exchangeUsdt: balance.usdt,
    exchangeBtc: balance.btc,
  })
}

// ─── Trade Execution ─────────────────────────────────────────

export async function getOpenTrade(portfolioId: number): Promise<any | null> {
  const result = await getDb().execute(sql`
    SELECT * FROM btc_live_trades
    WHERE portfolio_id = ${portfolioId} AND status = 'open'
    LIMIT 1
  `)
  return result.rows.length > 0 ? result.rows[0] : null
}

async function openMarketBuy(
  portfolioId: number,
  btcAmount: number,
  currentPrice: number,
  predictionId?: number
): Promise<{ success: boolean; tradeId?: number; error?: string }> {
  const env = getEnvironmentLabel().toLowerCase()

  try {
    const exchange = getBinanceClient()
    const order = await exchange.createMarketBuyOrder(TRADING_PAIR, btcAmount)

    const filledPrice = order.average || order.price || currentPrice
    const filledAmount = order.filled || btcAmount
    const fee = order.fee?.cost || 0
    const positionSize = filledPrice * filledAmount

    const stopLoss = filledPrice * (1 - STOP_LOSS_PCT)
    const takeProfit = filledPrice * (1 + TAKE_PROFIT_PCT)

    const result = await getDb().execute(sql`
      INSERT INTO btc_live_trades (
        portfolio_id, prediction_id, direction, entry_price, entry_date,
        btc_amount, position_size, entry_fee, stop_loss, take_profit,
        status, entry_order_id, exchange_environment, exchange_metadata
      ) VALUES (
        ${portfolioId}, ${predictionId ?? null}, 'long', ${filledPrice}, NOW(),
        ${filledAmount}, ${positionSize}, ${fee}, ${stopLoss}, ${takeProfit},
        'open', ${order.id}, ${env}, ${JSON.stringify({
          orderId: order.id,
          clientOrderId: order.clientOrderId,
          timestamp: order.timestamp,
          status: order.status,
          filled: order.filled,
          average: order.average,
          fee: order.fee,
        })}::jsonb
      ) RETURNING id
    `)
    const tradeId = parseInt((result.rows[0] as any).id)

    // Deduct position from available capital
    await getDb().execute(sql`
      UPDATE btc_live_portfolio
      SET current_capital = current_capital - ${positionSize},
          total_fees = total_fees + ${fee},
          updated_at = NOW()
      WHERE id = ${portfolioId}
    `)

    await auditLog(portfolioId, 'trade_open', {
      orderId: order.id,
      direction: 'long',
      btcAmount: filledAmount,
      price: filledPrice,
      positionSize,
      fee,
      stopLoss,
      takeProfit,
      predictionId,
    }, tradeId)

    console.log(`[LiveTrading] Opened LONG ${filledAmount.toFixed(6)} BTC @ $${filledPrice.toFixed(0)} (order: ${order.id})`)
    return { success: true, tradeId }
  } catch (e: any) {
    await auditLog(portfolioId, 'trade_open_failed', { error: e.message, btcAmount, currentPrice })
    console.error(`[LiveTrading] Market buy failed:`, e.message)
    return { success: false, error: e.message }
  }
}

async function closeTradeMarket(tradeId: number, reason: string): Promise<{ success: boolean; error?: string }> {
  const tradeResult = await getDb().execute(sql`
    SELECT id, portfolio_id, direction, entry_price, btc_amount, position_size, entry_fee
    FROM btc_live_trades WHERE id = ${tradeId} AND status = 'open'
  `)
  if (tradeResult.rows.length === 0) return { success: false, error: 'Trade not found or already closed' }
  const trade = tradeResult.rows[0] as any
  const portfolioId = parseInt(trade.portfolio_id)
  const env = getEnvironmentLabel().toLowerCase()

  try {
    const exchange = getBinanceClient()
    let btcAmount = parseFloat(trade.btc_amount)

    // Use actual exchange balance if it's slightly less than recorded amount
    // (Binance deducts fees in BTC, leaving less than what was recorded)
    const balance = await getExchangeBalance()
    if (balance && balance.btc > 0 && balance.btc < btcAmount) {
      const deficit = btcAmount - balance.btc
      const deficitPct = deficit / btcAmount
      if (deficitPct < 0.02) {
        // Within 2% — likely fee rounding, use actual balance
        console.log(`[LiveTrading] Adjusting sell amount from ${btcAmount.toFixed(8)} to ${balance.btc.toFixed(8)} (fee rounding: ${(deficitPct * 100).toFixed(3)}%)`)
        btcAmount = balance.btc
      }
    }

    const order = await exchange.createMarketSellOrder(TRADING_PAIR, btcAmount)

    const filledPrice = order.average || order.price || 0
    const fee = order.fee?.cost || 0
    const entryPrice = parseFloat(trade.entry_price)
    const positionSize = parseFloat(trade.position_size)

    const pnl = (filledPrice - entryPrice) * btcAmount - fee - parseFloat(trade.entry_fee || '0')
    const pnlPercent = (pnl / positionSize) * 100
    const isWin = pnl > 0

    await getDb().execute(sql`
      UPDATE btc_live_trades
      SET exit_price = ${filledPrice}, exit_date = NOW(), pnl = ${pnl},
          pnl_percent = ${pnlPercent}, exit_fee = ${fee}, status = 'closed',
          exit_reason = ${reason}, exit_order_id = ${order.id},
          exchange_metadata = COALESCE(exchange_metadata, '{}'::jsonb) || ${JSON.stringify({
            exitOrderId: order.id,
            exitTimestamp: order.timestamp,
            exitFilled: order.filled,
            exitAverage: order.average,
            exitFee: order.fee,
          })}::jsonb
      WHERE id = ${tradeId}
    `)

    await getDb().execute(sql`
      UPDATE btc_live_portfolio
      SET current_capital = current_capital + ${positionSize + pnl},
          total_trades = total_trades + 1,
          winning_trades = winning_trades + ${isWin ? 1 : 0},
          total_pnl = total_pnl + ${pnl},
          total_fees = total_fees + ${fee},
          daily_pnl_today = daily_pnl_today + ${pnl},
          updated_at = NOW()
      WHERE id = ${portfolioId}
    `)

    await auditLog(portfolioId, 'trade_close', {
      orderId: order.id,
      exitPrice: filledPrice,
      pnl,
      pnlPercent,
      fee,
      reason,
    }, tradeId)

    console.log(`[LiveTrading] Closed trade #${tradeId}: P&L=$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) — ${reason}`)
    return { success: true }
  } catch (e: any) {
    await auditLog(portfolioId, 'trade_close_failed', { error: e.message, tradeId, reason })
    console.error(`[LiveTrading] Market sell failed:`, e.message)
    return { success: false, error: e.message }
  }
}

// ─── Signal Processing ───────────────────────────────────────

export async function processMLSignals(portfolioId: number): Promise<{ opened: boolean; reason?: string }> {
  const openTrade = await getOpenTrade(portfolioId)
  if (openTrade) return { opened: false, reason: 'Position already open' }

  const currentPrice = await getExchangeBtcPrice()
  if (!currentPrice) return { opened: false, reason: 'No price data' }

  // Get latest active prediction
  const pred = await getDb().execute(sql`
    SELECT * FROM btc_predictions
    WHERE status = 'active' AND direction != 'neutral' AND confidence > 0.1
    ORDER BY prediction_date DESC LIMIT 1
  `)
  if (pred.rows.length === 0) return { opened: false, reason: 'No active predictions' }
  const prediction = pred.rows[0] as any

  // Spot-only: skip bearish signals
  if (prediction.direction === 'bearish') {
    await auditLog(portfolioId, 'signal_skipped', {
      direction: prediction.direction,
      confidence: prediction.confidence,
      reason: 'Bearish signal skipped (spot-only, no shorts)',
    })
    console.log(`[LiveTrading] Skipped bearish signal (spot-only, no shorts)`)
    return { opened: false, reason: 'Bearish signal skipped (spot-only)' }
  }

  const portResult = await getDb().execute(sql`
    SELECT current_capital FROM btc_live_portfolio WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return { opened: false, reason: 'Portfolio not found' }
  const capital = parseFloat((portResult.rows[0] as any).current_capital)

  // Position sizing with max cap
  const positionSize = Math.min(capital * RISK_PER_TRADE, MAX_POSITION_USD)
  if (positionSize < 10) return { opened: false, reason: `Position too small: $${positionSize.toFixed(2)}` }

  const btcAmount = positionSize / currentPrice

  const result = await openMarketBuy(portfolioId, btcAmount, currentPrice, parseInt(prediction.id))
  if (result.success) {
    console.log(`[LiveTrading] ML signal: Opened LONG BTC @ ~$${currentPrice.toFixed(0)}, ${btcAmount.toFixed(6)} BTC ($${positionSize.toFixed(0)})`)
    return { opened: true }
  }
  return { opened: false, reason: result.error || 'Order failed' }
}

// ─── Open Trade Management ───────────────────────────────────

export async function updateOpenTrades(portfolioId: number): Promise<{ stopped: number; profited: number; expired: number }> {
  const currentPrice = await getExchangeBtcPrice()
  if (!currentPrice) return { stopped: 0, profited: 0, expired: 0 }

  const openResult = await getDb().execute(sql`
    SELECT * FROM btc_live_trades WHERE portfolio_id = ${portfolioId} AND status = 'open'
  `)

  let stopped = 0, profited = 0, expired = 0
  for (const trade of openResult.rows as any[]) {
    const stopLoss = trade.stop_loss ? parseFloat(trade.stop_loss) : null
    const takeProfit = trade.take_profit ? parseFloat(trade.take_profit) : null

    // Stop loss
    if (stopLoss && currentPrice <= stopLoss) {
      const result = await closeTradeMarket(parseInt(trade.id), 'stop_loss')
      if (result.success) stopped++
      continue
    }

    // Take profit
    if (takeProfit && currentPrice >= takeProfit) {
      const result = await closeTradeMarket(parseInt(trade.id), 'take_profit')
      if (result.success) profited++
      continue
    }

    // Signal expiry
    const daysSinceEntry = (Date.now() - new Date(trade.entry_date).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceEntry >= SIGNAL_EXPIRY_DAYS) {
      const result = await closeTradeMarket(parseInt(trade.id), 'signal_expired')
      if (result.success) expired++
      continue
    }
  }
  return { stopped, profited, expired }
}

// ─── Snapshot ────────────────────────────────────────────────

export async function takeSnapshot(portfolioId: number): Promise<void> {
  const portResult = await getDb().execute(sql`
    SELECT current_capital, initial_capital, total_pnl FROM btc_live_portfolio WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return
  const portfolio = portResult.rows[0] as any

  const capital = parseFloat(portfolio.current_capital)
  const initialCapital = parseFloat(portfolio.initial_capital)
  const currentPrice = await getExchangeBtcPrice()

  // Calculate unrealized P&L
  const openResult = await getDb().execute(sql`
    SELECT direction, entry_price, btc_amount, position_size FROM btc_live_trades
    WHERE portfolio_id = ${portfolioId} AND status = 'open'
  `)

  let unrealizedPnl = 0
  let openPositionValue = 0
  for (const trade of openResult.rows as any[]) {
    if (!currentPrice) continue
    const entryPrice = parseFloat(trade.entry_price)
    const btcAmount = parseFloat(trade.btc_amount)
    const posSize = parseFloat(trade.position_size)
    unrealizedPnl += (currentPrice - entryPrice) * btcAmount // long only
    openPositionValue += posSize
  }

  const portfolioValue = capital + unrealizedPnl + openPositionValue
  const cumulativePnl = portfolioValue - initialCapital

  const peakResult = await getDb().execute(sql`
    SELECT MAX(portfolio_value) as peak FROM btc_live_snapshots WHERE portfolio_id = ${portfolioId}
  `)
  const peak = Math.max(parseFloat((peakResult.rows[0] as any)?.peak || '0') || initialCapital, portfolioValue)
  const drawdown = peak > 0 ? ((peak - portfolioValue) / peak) * 100 : 0

  const prevResult = await getDb().execute(sql`
    SELECT portfolio_value FROM btc_live_snapshots WHERE portfolio_id = ${portfolioId}
    ORDER BY snapshot_date DESC LIMIT 1
  `)
  const prevValue = prevResult.rows.length > 0 ? parseFloat((prevResult.rows[0] as any).portfolio_value) : initialCapital
  const dailyPnl = portfolioValue - prevValue
  const today = new Date().toISOString().split('T')[0]

  // Get exchange balance for reconciliation
  const exchangeBalance = await getExchangeBalance()
  const exchangeUsdt = exchangeBalance?.usdt ?? null

  await getDb().execute(sql`
    INSERT INTO btc_live_snapshots (
      portfolio_id, snapshot_date, capital, portfolio_value,
      exchange_balance, open_positions, daily_pnl, cumulative_pnl, drawdown, btc_price
    ) VALUES (
      ${portfolioId}, ${today}::date, ${capital}, ${portfolioValue},
      ${exchangeUsdt}, ${openResult.rows.length}, ${dailyPnl}, ${cumulativePnl}, ${drawdown}, ${currentPrice}
    )
    ON CONFLICT (portfolio_id, snapshot_date) DO UPDATE SET
      capital = EXCLUDED.capital, portfolio_value = EXCLUDED.portfolio_value,
      exchange_balance = EXCLUDED.exchange_balance,
      open_positions = EXCLUDED.open_positions, daily_pnl = EXCLUDED.daily_pnl,
      cumulative_pnl = EXCLUDED.cumulative_pnl, drawdown = EXCLUDED.drawdown,
      btc_price = EXCLUDED.btc_price
  `)

  await getDb().execute(sql`
    UPDATE btc_live_portfolio
    SET current_value = ${portfolioValue}, max_drawdown = GREATEST(max_drawdown, ${drawdown}), updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(`[LiveTrading] Snapshot ${today}: value=$${portfolioValue.toFixed(0)}, PnL=$${cumulativePnl.toFixed(0)}, DD=${drawdown.toFixed(2)}%`)
}

// ─── Emergency Controls ──────────────────────────────────────

export async function emergencyCloseAll(portfolioId: number): Promise<{ closed: number; errors: number }> {
  const openResult = await getDb().execute(sql`
    SELECT id FROM btc_live_trades WHERE portfolio_id = ${portfolioId} AND status = 'open'
  `)

  let closed = 0, errors = 0
  for (const trade of openResult.rows as any[]) {
    const result = await closeTradeMarket(parseInt(trade.id), 'emergency_close')
    if (result.success) closed++
    else errors++
  }

  await auditLog(portfolioId, 'emergency_close_all', { closed, errors })
  console.log(`[LiveTrading] Emergency close: ${closed} closed, ${errors} errors`)
  return { closed, errors }
}

export async function toggleKillSwitch(portfolioId: number, active: boolean, reason?: string): Promise<void> {
  await getDb().execute(sql`
    UPDATE btc_live_portfolio
    SET is_active = ${active}, halt_reason = ${active ? null : (reason || 'Manual kill switch')}, updated_at = NOW()
    WHERE id = ${portfolioId}
  `)
  await auditLog(portfolioId, 'kill_switch', { active, reason })
  console.log(`[LiveTrading] Kill switch: trading ${active ? 'ENABLED' : 'DISABLED'}${reason ? ` (${reason})` : ''}`)
}
