import { config } from 'dotenv'
config()

import { collectAllPrices, getCollectionStatus } from '../services/stockPriceCollector.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  console.log('=== Stock Price Collection ===')
  console.log(`Time: ${new Date().toISOString()}\n`)

  const status = await getCollectionStatus()
  console.log(`Market status: ${status.marketStatus}`)
  console.log(`Active tickers: ${status.activeTickers}\n`)

  if (status.activeTickers === 0) {
    console.log('No active tickers. Run stocks:seed first.')
    process.exit(0)
  }

  const result = await collectAllPrices()

  console.log(`\nCollection complete:`)
  console.log(`  Collected: ${result.collected}`)
  console.log(`  Failed: ${result.failed}`)
  console.log(`  Total: ${result.total}`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
