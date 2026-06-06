/**
 * Paper Trading Engine
 *
 * Simulates trades based on stock signal recommendations.
 * Supports multiple portfolios with different strategies (ML, heuristic, benchmark).
 *
 * Position sizing: Risk 2% of capital per trade, sized by stop-loss distance.
 * Stop loss: 2x ATR below entry (long) or above (short).
 * Take profit: 3:1 reward/risk ratio.
 * Max 10 concurrent positions, max 20% in one sector.
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

const RISK_PER_TRADE = 0.02     // 2% of capital
const MAX_POSITIONS = 10
const MAX_SECTOR_PCT = 0.20     // 20% max in one sector
const REWARD_RISK_RATIO = 3     // 3:1 reward/risk
const SIGNAL_EXPIRY_DAYS = 7    // Close trades after 7 days

interface Portfolio {
  id: number
  name: string
  strategy: string
  currentCapital: number
  currentValue: number
  initialCapital: number
}

interface OpenTrade {
  id: number
  portfolioId: number
  watchlistId: number
  direction: string
  entryPrice: number
  entryDate: Date
  shares: number
  positionSize: number
  stopLoss: number | null
  takeProfit: number | null
  ticker: string
  sector: string | null
}

/**
 * Get the latest price for a watchlist item.
 */
async function getLatestPrice(watchlistId: number): Promise<number | null> {
  const result = await getDb().execute(sql`
    SELECT price FROM stock_prices
    WHERE watchlist_id = ${watchlistId}
    ORDER BY fetched_at DESC
    LIMIT 1
  `)
  if (result.rows.length === 0) return null
  return parseFloat((result.rows[0] as any).price)
}

/**
 * Get ATR (Average True Range) for position sizing and stop loss.
 * Uses 14-day ATR approximation from daily price data.
 */
async function getATR(watchlistId: number): Promise<number | null> {
  const result = await getDb().execute(sql`
    WITH daily AS (
      SELECT DISTINCT ON (DATE(fetched_at))
        price, high_price, low_price, previous_close,
        DATE(fetched_at) as trade_date
      FROM stock_prices
      WHERE watchlist_id = ${watchlistId}
        AND fetched_at > NOW() - INTERVAL '30 days'
      ORDER BY DATE(fetched_at) DESC, source ASC, fetched_at DESC
    ),
    tr AS (
      SELECT
        GREATEST(
          COALESCE(high_price, price) - COALESCE(low_price, price),
          ABS(COALESCE(high_price, price) - COALESCE(previous_close, price)),
          ABS(COALESCE(low_price, price) - COALESCE(previous_close, price))
        ) as true_range
      FROM daily
      ORDER BY trade_date DESC
      LIMIT 14
    )
    SELECT AVG(true_range) as atr FROM tr
  `)
  if (result.rows.length === 0) return null
  const atr = parseFloat((result.rows[0] as any).atr)
  return isNaN(atr) ? null : atr
}

/**
 * Get open positions for a portfolio.
 */
async function getOpenTrades(portfolioId: number): Promise<OpenTrade[]> {
  const result = await getDb().execute(sql`
    SELECT
      t.id, t.portfolio_id, t.watchlist_id, t.direction,
      t.entry_price, t.entry_date, t.shares, t.position_size,
      t.stop_loss, t.take_profit,
      sw.ticker, sw.sector
    FROM paper_trades t
    JOIN stock_watchlist sw ON sw.id = t.watchlist_id
    WHERE t.portfolio_id = ${portfolioId}
      AND t.status = 'open'
    ORDER BY t.entry_date ASC
  `)

  return (result.rows as any[]).map(r => ({
    id: parseInt(r.id),
    portfolioId: parseInt(r.portfolio_id),
    watchlistId: parseInt(r.watchlist_id),
    direction: r.direction,
    entryPrice: parseFloat(r.entry_price),
    entryDate: new Date(r.entry_date),
    shares: parseFloat(r.shares),
    positionSize: parseFloat(r.position_size),
    stopLoss: r.stop_loss ? parseFloat(r.stop_loss) : null,
    takeProfit: r.take_profit ? parseFloat(r.take_profit) : null,
    ticker: r.ticker,
    sector: r.sector,
  }))
}

/**
 * Open a trade based on a recommendation signal.
 */
export async function openTrade(
  portfolioId: number,
  recommendationId: number
): Promise<{ opened: boolean; reason?: string }> {
  // Load portfolio
  const portResult = await getDb().execute(sql`
    SELECT id, name, strategy, current_capital, current_value, initial_capital
    FROM paper_portfolios
    WHERE id = ${portfolioId} AND is_active = true
  `)
  if (portResult.rows.length === 0) return { opened: false, reason: 'Portfolio not found' }
  const portfolio = portResult.rows[0] as any

  const capital = parseFloat(portfolio.current_capital)
  const initialCapital = parseFloat(portfolio.initial_capital)

  // Load recommendation
  const recResult = await getDb().execute(sql`
    SELECT
      r.id, r.watchlist_id, r.signal_direction, r.signal_strength,
      r.short_term_expected_change, r.event_date, r.event_type,
      r.model_source, r.ml_prob_up_5d, r.ml_expected_change_5d,
      sw.ticker, sw.sector
    FROM stock_recommendations r
    JOIN stock_watchlist sw ON sw.id = r.watchlist_id
    WHERE r.id = ${recommendationId}
  `)
  if (recResult.rows.length === 0) return { opened: false, reason: 'Recommendation not found' }
  const rec = recResult.rows[0] as any

  const direction = rec.signal_direction === 'bearish' ? 'short' : 'long'
  if (rec.signal_direction === 'neutral') {
    return { opened: false, reason: 'Neutral signal, skipping' }
  }

  // Check max positions
  const openTrades = await getOpenTrades(portfolioId)
  if (openTrades.length >= MAX_POSITIONS) {
    return { opened: false, reason: `Max positions reached (${MAX_POSITIONS})` }
  }

  // Check if already have position in this ticker
  if (openTrades.some(t => t.watchlistId === parseInt(rec.watchlist_id))) {
    return { opened: false, reason: `Already have position in ${rec.ticker}` }
  }

  // Check sector concentration
  const sector = rec.sector || 'Unknown'
  const sectorExposure = openTrades
    .filter(t => t.sector === sector)
    .reduce((sum, t) => sum + t.positionSize, 0)
  if (sectorExposure / capital > MAX_SECTOR_PCT) {
    return { opened: false, reason: `Sector concentration limit reached for ${sector}` }
  }

  // Get current price
  const currentPrice = await getLatestPrice(parseInt(rec.watchlist_id))
  if (!currentPrice) return { opened: false, reason: 'No price data available' }

  // Get ATR for stop loss sizing
  const atr = await getATR(parseInt(rec.watchlist_id))
  const stopDistance = atr ? atr * 2 : currentPrice * 0.05 // 2x ATR or 5% fallback

  // Position sizing: risk 2% of capital
  const riskAmount = capital * RISK_PER_TRADE
  const shares = Math.floor(riskAmount / stopDistance)
  if (shares < 1) return { opened: false, reason: 'Position too small' }

  const positionSize = shares * currentPrice
  if (positionSize > capital * 0.3) {
    return { opened: false, reason: 'Position would exceed 30% of capital' }
  }

  // Stop loss and take profit
  let stopLoss: number
  let takeProfit: number

  if (direction === 'long') {
    stopLoss = currentPrice - stopDistance
    takeProfit = currentPrice + (stopDistance * REWARD_RISK_RATIO)
  } else {
    stopLoss = currentPrice + stopDistance
    takeProfit = currentPrice - (stopDistance * REWARD_RISK_RATIO)
  }

  const entryDate = new Date()
  const metadata = {
    signalStrength: parseFloat(rec.signal_strength),
    eventType: rec.event_type,
    modelSource: rec.model_source || 'heuristic',
    mlProbUp5d: rec.ml_prob_up_5d ? parseFloat(rec.ml_prob_up_5d) : null,
    atr: atr,
  }

  await getDb().execute(sql`
    INSERT INTO paper_trades (
      portfolio_id, watchlist_id, recommendation_id,
      direction, entry_price, entry_date, shares, position_size,
      stop_loss, take_profit, status, metadata
    ) VALUES (
      ${portfolioId}, ${parseInt(rec.watchlist_id)}, ${recommendationId},
      ${direction}, ${currentPrice}, ${entryDate}, ${shares}, ${positionSize},
      ${stopLoss}, ${takeProfit}, 'open', ${JSON.stringify(metadata)}::jsonb
    )
  `)

  // Deduct from capital
  await getDb().execute(sql`
    UPDATE paper_portfolios
    SET current_capital = current_capital - ${positionSize},
        updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(
    `[PaperTrading] ${portfolio.name}: Opened ${direction} ${rec.ticker} ` +
    `@ $${currentPrice.toFixed(2)}, ${shares} shares ($${positionSize.toFixed(0)}) ` +
    `SL=$${stopLoss.toFixed(2)} TP=$${takeProfit.toFixed(2)}`
  )

  return { opened: true }
}

/**
 * Close a specific trade.
 */
async function closeTrade(
  tradeId: number,
  exitPrice: number,
  exitReason: string
): Promise<void> {
  const tradeResult = await getDb().execute(sql`
    SELECT id, portfolio_id, direction, entry_price, shares, position_size
    FROM paper_trades
    WHERE id = ${tradeId} AND status = 'open'
  `)
  if (tradeResult.rows.length === 0) return
  const trade = tradeResult.rows[0] as any

  const entryPrice = parseFloat(trade.entry_price)
  const shares = parseFloat(trade.shares)
  const positionSize = parseFloat(trade.position_size)
  const direction = trade.direction

  // Calculate P&L
  let pnl: number
  if (direction === 'long') {
    pnl = (exitPrice - entryPrice) * shares
  } else {
    pnl = (entryPrice - exitPrice) * shares
  }
  const pnlPercent = (pnl / positionSize) * 100

  await getDb().execute(sql`
    UPDATE paper_trades
    SET exit_price = ${exitPrice},
        exit_date = NOW(),
        pnl = ${pnl},
        pnl_percent = ${pnlPercent},
        status = 'closed',
        exit_reason = ${exitReason}
    WHERE id = ${tradeId}
  `)

  // Return capital + P&L to portfolio
  const portfolioId = parseInt(trade.portfolio_id)
  const isWin = pnl > 0

  await getDb().execute(sql`
    UPDATE paper_portfolios
    SET current_capital = current_capital + ${positionSize + pnl},
        total_trades = total_trades + 1,
        winning_trades = winning_trades + ${isWin ? 1 : 0},
        total_pnl = total_pnl + ${pnl},
        updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(
    `[PaperTrading] Closed trade #${tradeId}: ` +
    `P&L=$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) — ${exitReason}`
  )
}

/**
 * Update all open trades: check stop loss, take profit, and signal expiry.
 */
export async function updateOpenTrades(portfolioId: number): Promise<{
  stopped: number; profited: number; expired: number
}> {
  const openTrades = await getOpenTrades(portfolioId)
  let stopped = 0, profited = 0, expired = 0

  for (const trade of openTrades) {
    const currentPrice = await getLatestPrice(trade.watchlistId)
    if (!currentPrice) continue

    // Check stop loss
    if (trade.stopLoss) {
      const isStoppedOut = trade.direction === 'long'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss

      if (isStoppedOut) {
        await closeTrade(trade.id, trade.stopLoss, 'stop_loss')
        stopped++
        continue
      }
    }

    // Check take profit
    if (trade.takeProfit) {
      const isTakingProfit = trade.direction === 'long'
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit

      if (isTakingProfit) {
        await closeTrade(trade.id, trade.takeProfit, 'take_profit')
        profited++
        continue
      }
    }

    // Check signal expiry (7 days)
    const daysSinceEntry = (Date.now() - trade.entryDate.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceEntry >= SIGNAL_EXPIRY_DAYS) {
      await closeTrade(trade.id, currentPrice, 'signal_expired')
      expired++
      continue
    }
  }

  return { stopped, profited, expired }
}

/**
 * Take a daily snapshot of portfolio value for equity curve tracking.
 */
export async function takeSnapshot(portfolioId: number): Promise<void> {
  // Get portfolio
  const portResult = await getDb().execute(sql`
    SELECT current_capital, initial_capital, total_pnl
    FROM paper_portfolios WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) return
  const portfolio = portResult.rows[0] as any

  const capital = parseFloat(portfolio.current_capital)
  const initialCapital = parseFloat(portfolio.initial_capital)

  // Calculate unrealized P&L from open positions
  const openTrades = await getOpenTrades(portfolioId)
  let unrealizedPnl = 0

  for (const trade of openTrades) {
    const currentPrice = await getLatestPrice(trade.watchlistId)
    if (!currentPrice) continue

    if (trade.direction === 'long') {
      unrealizedPnl += (currentPrice - trade.entryPrice) * trade.shares
    } else {
      unrealizedPnl += (trade.entryPrice - currentPrice) * trade.shares
    }
  }

  const portfolioValue = capital + unrealizedPnl +
    openTrades.reduce((sum, t) => sum + t.positionSize, 0)
  const cumulativePnl = portfolioValue - initialCapital

  // Calculate drawdown from peak
  const peakResult = await getDb().execute(sql`
    SELECT MAX(portfolio_value) as peak
    FROM paper_portfolio_snapshots
    WHERE portfolio_id = ${portfolioId}
  `)
  const peak = Math.max(
    parseFloat((peakResult.rows[0] as any)?.peak || '0') || initialCapital,
    portfolioValue
  )
  const drawdown = peak > 0 ? ((peak - portfolioValue) / peak) * 100 : 0

  // Get SPY value for benchmark (normalized to start at 100000)
  let spyValue: number | null = null
  const spyResult = await getDb().execute(sql`
    SELECT price FROM stock_prices
    WHERE watchlist_id = (SELECT id FROM stock_watchlist WHERE ticker = 'SPY' LIMIT 1)
    ORDER BY fetched_at DESC LIMIT 1
  `)
  if (spyResult.rows.length > 0) {
    spyValue = parseFloat((spyResult.rows[0] as any).price)
  }

  // Get previous snapshot for daily P&L
  const prevResult = await getDb().execute(sql`
    SELECT portfolio_value FROM paper_portfolio_snapshots
    WHERE portfolio_id = ${portfolioId}
    ORDER BY snapshot_date DESC LIMIT 1
  `)
  const prevValue = prevResult.rows.length > 0
    ? parseFloat((prevResult.rows[0] as any).portfolio_value)
    : initialCapital
  const dailyPnl = portfolioValue - prevValue

  const today = new Date().toISOString().split('T')[0]

  await getDb().execute(sql`
    INSERT INTO paper_portfolio_snapshots (
      portfolio_id, snapshot_date, capital, portfolio_value,
      open_positions, daily_pnl, cumulative_pnl, drawdown, spy_value
    ) VALUES (
      ${portfolioId}, ${today}::date, ${capital}, ${portfolioValue},
      ${openTrades.length}, ${dailyPnl}, ${cumulativePnl}, ${drawdown}, ${spyValue}
    )
    ON CONFLICT (portfolio_id, snapshot_date) DO UPDATE SET
      capital = EXCLUDED.capital,
      portfolio_value = EXCLUDED.portfolio_value,
      open_positions = EXCLUDED.open_positions,
      daily_pnl = EXCLUDED.daily_pnl,
      cumulative_pnl = EXCLUDED.cumulative_pnl,
      drawdown = EXCLUDED.drawdown,
      spy_value = EXCLUDED.spy_value
  `)

  // Update portfolio value and max drawdown
  await getDb().execute(sql`
    UPDATE paper_portfolios
    SET current_value = ${portfolioValue},
        max_drawdown = GREATEST(max_drawdown, ${drawdown}),
        updated_at = NOW()
    WHERE id = ${portfolioId}
  `)

  console.log(
    `[PaperTrading] Snapshot ${today}: Portfolio #${portfolioId} ` +
    `value=$${portfolioValue.toFixed(0)}, PnL=$${cumulativePnl.toFixed(0)}, ` +
    `drawdown=${drawdown.toFixed(2)}%, positions=${openTrades.length}`
  )
}

/**
 * Get performance metrics for a portfolio.
 */
export async function getPerformanceMetrics(portfolioId: number): Promise<{
  totalReturn: number
  winRate: number
  sharpe: number | null
  maxDrawdown: number
  totalTrades: number
  openPositions: number
  avgWin: number | null
  avgLoss: number | null
  profitFactor: number | null
}> {
  const portResult = await getDb().execute(sql`
    SELECT * FROM paper_portfolios WHERE id = ${portfolioId}
  `)
  if (portResult.rows.length === 0) {
    return {
      totalReturn: 0, winRate: 0, sharpe: null, maxDrawdown: 0,
      totalTrades: 0, openPositions: 0, avgWin: null, avgLoss: null, profitFactor: null,
    }
  }
  const p = portResult.rows[0] as any

  const totalTrades = parseInt(p.total_trades) || 0
  const winningTrades = parseInt(p.winning_trades) || 0
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0
  const totalReturn = ((parseFloat(p.current_value) - parseFloat(p.initial_capital)) / parseFloat(p.initial_capital)) * 100

  // Sharpe ratio from daily snapshots
  const snapshots = await getDb().execute(sql`
    SELECT daily_pnl FROM paper_portfolio_snapshots
    WHERE portfolio_id = ${portfolioId}
    ORDER BY snapshot_date ASC
  `)

  let sharpe: number | null = null
  if (snapshots.rows.length >= 10) {
    const dailyPnls = (snapshots.rows as any[]).map(r => parseFloat(r.daily_pnl) || 0)
    const avgDaily = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length
    const stdDaily = Math.sqrt(
      dailyPnls.reduce((sum, x) => sum + (x - avgDaily) ** 2, 0) / dailyPnls.length
    )
    if (stdDaily > 0) {
      sharpe = (avgDaily / stdDaily) * Math.sqrt(252) // Annualized
    }
  }

  // Win/loss stats
  const tradeStats = await getDb().execute(sql`
    SELECT
      AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
      AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss,
      SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as gross_profit,
      SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END) as gross_loss
    FROM paper_trades
    WHERE portfolio_id = ${portfolioId} AND status = 'closed'
  `)

  const stats = tradeStats.rows[0] as any
  const avgWin = stats.avg_win ? parseFloat(stats.avg_win) : null
  const avgLoss = stats.avg_loss ? parseFloat(stats.avg_loss) : null
  const grossProfit = parseFloat(stats.gross_profit || '0')
  const grossLoss = parseFloat(stats.gross_loss || '0')
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null

  const openTrades = await getOpenTrades(portfolioId)

  return {
    totalReturn,
    winRate,
    sharpe,
    maxDrawdown: parseFloat(p.max_drawdown) || 0,
    totalTrades,
    openPositions: openTrades.length,
    avgWin,
    avgLoss,
    profitFactor,
  }
}

/**
 * Process new recommendations and open trades for a portfolio.
 */
export async function processNewSignals(
  portfolioId: number,
  strategy: string
): Promise<{ opened: number; skipped: number }> {
  // Get unprocessed recommendations based on strategy
  const sourceFilter = strategy === 'ml_model' ? 'ml_model' : 'heuristic'

  // ML uses |prob-0.5|*2 as strength, so 0.60 probability = 0.20 strength.
  // Heuristic uses a composite score centered around 0.5, so 0.55 is meaningful.
  const strengthThreshold = strategy === 'ml_model' ? 0.20 : 0.55

  const recs = await getDb().execute(sql`
    SELECT r.id
    FROM stock_recommendations r
    LEFT JOIN paper_trades pt ON pt.recommendation_id = r.id AND pt.portfolio_id = ${portfolioId}
    WHERE r.status = 'active'
      AND r.signal_direction != 'neutral'
      AND r.signal_strength > ${strengthThreshold}
      AND r.model_source = ${sourceFilter}
      AND pt.id IS NULL
    ORDER BY r.signal_strength DESC
    LIMIT 5
  `)

  let opened = 0
  let skipped = 0

  for (const rec of recs.rows as any[]) {
    const result = await openTrade(portfolioId, parseInt(rec.id))
    if (result.opened) {
      opened++
    } else {
      skipped++
      if (result.reason) {
        console.log(`[PaperTrading] Skipped: ${result.reason}`)
      }
    }
  }

  return { opened, skipped }
}
