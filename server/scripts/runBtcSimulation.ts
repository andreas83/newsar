import { getDatabase } from '../database/db.js'
import { sql } from 'drizzle-orm'
import {
  updateOpenTrades,
  processMLSignals,
  processRandomSignals,
  processBuyAndHold,
  takeSnapshot,
} from '../services/btcSimulatorEngine.js'

async function main() {
  const snapshotOnly = process.argv.includes('snapshot')
  console.log(`[runBtcSimulation] Running BTC simulation${snapshotOnly ? ' (snapshot only)' : ''}...`)

  const db = getDatabase()
  const portfolios = await db.execute(sql`
    SELECT id, strategy FROM btc_sim_portfolios WHERE is_active = true ORDER BY id
  `)

  for (const p of portfolios.rows as any[]) {
    const id = parseInt(p.id)
    const strategy = p.strategy

    // Update open trades (check stop-loss, take-profit, expiry)
    const closeResult = await updateOpenTrades(id)
    if (closeResult.stopped + closeResult.profited + closeResult.expired > 0) {
      console.log(`  Portfolio #${id}: closed ${closeResult.stopped} stopped, ${closeResult.profited} profited, ${closeResult.expired} expired`)
    }

    // Process new signals (unless snapshot only)
    if (!snapshotOnly) {
      if (strategy === 'ml_model') {
        const result = await processMLSignals(id)
        if (result.opened) console.log(`  Portfolio #${id}: ML trade opened`)
      } else if (strategy === 'random') {
        const result = await processRandomSignals(id)
        if (result.opened) console.log(`  Portfolio #${id}: Random trade opened`)
      } else if (strategy === 'buy_and_hold') {
        const result = await processBuyAndHold(id)
        if (result.opened) console.log(`  Portfolio #${id}: Buy & Hold position opened`)
      }
    }

    // Take daily snapshot
    await takeSnapshot(id)
  }

  console.log('[runBtcSimulation] Done.')
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
