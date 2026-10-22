import { config } from 'dotenv'
config()

import { validateRecommendations } from '../services/stockSignalGenerator.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  console.log('=== Stock Signal Validator ===\n')

  const result = await validateRecommendations()

  console.log(`\nSummary:`)
  console.log(`  Validated (4w window closed): ${result.validated}`)
  console.log(`  Partial (5d only, will retry):  ${result.partial}`)
  console.log(`  No price data: ${result.noData}`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
