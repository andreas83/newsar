import { config } from 'dotenv'
config()

import { backfillTicker, backfillAll } from '../services/stockHistoryBackfiller.js'
import { isAlpacaAvailable } from '../utils/alpacaClient.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  const ticker = process.argv[2]
  const days = parseInt(process.argv[3] || '365')

  console.log('=== Stock History Backfill ===')
  console.log(`Provider: ${isAlpacaAvailable() ? 'Alpaca Markets (fast)' : 'Alpha Vantage (slow)'}`)
  console.log(`Days: ${days}\n`)

  if (ticker) {
    console.log(`Backfilling ${ticker}...`)
    const result = await backfillTicker(ticker, days)
    console.log(`Done: ${result.inserted} inserted, ${result.skipped} skipped`)
  } else {
    console.log(`Backfilling all active tickers...`)
    const result = await backfillAll(days)
    console.log(`\nDone: ${result.processed} processed, ${result.totalInserted} total bars`)
    if (result.failed.length > 0) {
      console.log(`Failed: ${result.failed.join(', ')}`)
    }
  }

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
