/**
 * BTC Live Trading — Cron Entry Point
 *
 * Daily at 12:00 UTC (after price collection and signal generation).
 * Mirrors runBtcSimulation.ts but executes real market orders via Binance.
 *
 * Cron: 0 12 * * * cd /var/www/newsar.codejungle.org && npm run btc:live-run >> /var/log/btc-live-trading.log 2>&1
 */
import { config } from 'dotenv'
config()

import { getEnvironmentLabel, isLiveEnvironment } from '../utils/binanceClient.js'
import {
  getOrCreatePortfolio,
  resetDailyPnl,
  checkSafetyGuards,
  syncBalanceFromExchange,
  updateOpenTrades,
  processMLSignals,
  takeSnapshot,
  auditLog,
} from '../services/btcLiveTradingEngine.js'

async function main() {
  const env = getEnvironmentLabel()
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[runBtcLiveTrading] ${new Date().toISOString()}`)
  console.log(`[runBtcLiveTrading] Environment: ${env}`)
  if (isLiveEnvironment()) {
    console.log(`[runBtcLiveTrading] ⚠ WARNING: LIVE TRADING MODE — REAL MONEY ⚠`)
  }
  console.log(`${'='.repeat(60)}\n`)

  // 1. Get or create portfolio
  const portfolioId = await getOrCreatePortfolio()
  console.log(`[runBtcLiveTrading] Portfolio #${portfolioId}`)

  // 2. Reset daily PnL if new calendar day
  await resetDailyPnl(portfolioId)

  // 3. Check safety guards
  const safety = await checkSafetyGuards(portfolioId)
  if (!safety.safe) {
    console.log(`[runBtcLiveTrading] Safety check FAILED: ${safety.reason}`)
    console.log(`[runBtcLiveTrading] Taking snapshot and exiting.`)
    await takeSnapshot(portfolioId)
    await auditLog(portfolioId, 'run_aborted', { reason: safety.reason })
    process.exit(0)
  }
  console.log(`[runBtcLiveTrading] Safety checks passed.`)

  // 4. Sync balance from exchange
  await syncBalanceFromExchange(portfolioId)

  // 5. Update open trades (check stop-loss, take-profit, expiry)
  const closeResult = await updateOpenTrades(portfolioId)
  if (closeResult.stopped + closeResult.profited + closeResult.expired > 0) {
    console.log(`[runBtcLiveTrading] Closed trades: ${closeResult.stopped} stopped, ${closeResult.profited} profited, ${closeResult.expired} expired`)
  }

  // 6. Process ML signals — open new position if signal available
  const signalResult = await processMLSignals(portfolioId)
  if (signalResult.opened) {
    console.log(`[runBtcLiveTrading] New position opened.`)
  } else {
    console.log(`[runBtcLiveTrading] No new position: ${signalResult.reason}`)
  }

  // 7. Take daily snapshot
  await takeSnapshot(portfolioId)

  await auditLog(portfolioId, 'run_completed', {
    closedTrades: closeResult,
    signalResult,
  })

  console.log(`[runBtcLiveTrading] Done.`)
  process.exit(0)
}

main().catch(e => {
  console.error('[runBtcLiveTrading] Fatal error:', e)
  process.exit(1)
})
