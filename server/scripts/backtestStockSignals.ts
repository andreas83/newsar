import { config } from 'dotenv'
config()

import { backtestAllEvents, computeSignalProfiles } from '../services/stockBacktester.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  console.log('=== Stock Signal Backtester ===\n')

  // Step 1: Backtest all events
  console.log('Step 1: Computing forward price changes for all anomaly events...')
  const backtest = await backtestAllEvents()
  console.log(`  Processed: ${backtest.processed}`)
  console.log(`  Skipped (no price data): ${backtest.skipped}`)
  console.log(`  Errors: ${backtest.errors}\n`)

  // Step 2: Compute signal profiles
  console.log('Step 2: Aggregating signal profiles per (ticker, event_type)...')
  const profiles = await computeSignalProfiles()
  console.log(`  Profiles created/updated: ${profiles.profiles}\n`)

  console.log('Done.')

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
