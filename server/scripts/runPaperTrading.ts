/**
 * Paper Trading Runner
 *
 * Daily script that processes new signals, updates open positions,
 * and takes portfolio snapshots.
 *
 * Usage:
 *   tsx server/scripts/runPaperTrading.ts           # Full run (signals + update + snapshot)
 *   tsx server/scripts/runPaperTrading.ts snapshot   # Snapshot only
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'
import {
  processNewSignals,
  updateOpenTrades,
  takeSnapshot,
  getPerformanceMetrics,
} from '../services/paperTradingEngine'

async function main() {
  const mode = process.argv[2] || 'full'
  const db = getDatabase()

  // Load all active portfolios
  const portfolios = await db.execute(sql`
    SELECT id, name, strategy FROM paper_portfolios WHERE is_active = true ORDER BY id
  `)

  if (portfolios.rows.length === 0) {
    console.log('[PaperTrading] No active portfolios found. Run paper:init first.')
    process.exit(1)
  }

  console.log(`[PaperTrading] Processing ${portfolios.rows.length} portfolios (mode: ${mode})`)
  console.log('='.repeat(60))

  for (const row of portfolios.rows as any[]) {
    const portfolioId = parseInt(row.id)
    const strategy = row.strategy
    const name = row.name

    console.log(`\n--- ${name} (${strategy}) ---`)

    if (mode === 'full') {
      // 1. Process new signals (skip for buy_and_hold)
      if (strategy !== 'buy_and_hold') {
        console.log('  Processing new signals...')
        const signalResult = await processNewSignals(portfolioId, strategy)
        console.log(`  → Opened: ${signalResult.opened}, Skipped: ${signalResult.skipped}`)
      }

      // 2. Update open positions (check stops, TP, expiry)
      // Skip stop/TP for buy_and_hold
      if (strategy !== 'buy_and_hold') {
        console.log('  Updating open positions...')
        const updateResult = await updateOpenTrades(portfolioId)
        console.log(
          `  → Stopped: ${updateResult.stopped}, Profited: ${updateResult.profited}, ` +
          `Expired: ${updateResult.expired}`
        )
      }
    }

    // 3. Take daily snapshot (always)
    console.log('  Taking snapshot...')
    await takeSnapshot(portfolioId)

    // 4. Print performance summary
    const metrics = await getPerformanceMetrics(portfolioId)
    console.log(`  Performance:`)
    console.log(`    Total Return: ${metrics.totalReturn.toFixed(2)}%`)
    console.log(`    Win Rate: ${(metrics.winRate * 100).toFixed(1)}% (${metrics.totalTrades} trades)`)
    console.log(`    Open Positions: ${metrics.openPositions}`)
    console.log(`    Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%`)
    if (metrics.sharpe != null) {
      console.log(`    Sharpe Ratio: ${metrics.sharpe.toFixed(2)}`)
    }
    if (metrics.profitFactor != null) {
      console.log(`    Profit Factor: ${metrics.profitFactor.toFixed(2)}`)
    }
  }

  // Print comparison table
  console.log('\n' + '='.repeat(60))
  console.log('STRATEGY COMPARISON')
  console.log('='.repeat(60))
  console.log(
    'Strategy'.padEnd(25) + 'Return'.padStart(10) + 'WinRate'.padStart(10) +
    'Sharpe'.padStart(10) + 'MaxDD'.padStart(10)
  )
  console.log('-'.repeat(65))

  for (const row of portfolios.rows as any[]) {
    const m = await getPerformanceMetrics(parseInt(row.id))
    const sharpeStr = m.sharpe != null ? m.sharpe.toFixed(2) : '—'
    console.log(
      row.name.slice(0, 24).padEnd(25) +
      (m.totalReturn.toFixed(2) + '%').padStart(10) +
      ((m.winRate * 100).toFixed(1) + '%').padStart(10) +
      sharpeStr.padStart(10) +
      (m.maxDrawdown.toFixed(2) + '%').padStart(10)
    )
  }

  console.log('\n[PaperTrading] Done.')
  process.exit(0)
}

main().catch(err => {
  console.error('[PaperTrading] Error:', err)
  process.exit(1)
})
