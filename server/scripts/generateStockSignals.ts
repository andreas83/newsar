import { config } from 'dotenv'
config()

import { generateRecommendations, generateMLRecommendations } from '../services/stockSignalGenerator.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  const daysBack = parseInt(process.argv[2] || '7')

  console.log('=== Stock Signal Generator ===')
  console.log(`Looking back ${daysBack} day(s) for unprocessed anomalies\n`)

  // 1. Generate heuristic recommendations
  console.log('--- Heuristic Signals ---')
  const result = await generateRecommendations(daysBack)
  console.log(`  Generated: ${result.generated}`)
  console.log(`  Skipped (no profile): ${result.skipped}`)

  // 2. Generate ML recommendations (separate rows with model_source='ml_model')
  console.log('\n--- ML Model Signals ---')
  const mlResult = await generateMLRecommendations(daysBack)
  console.log(`  Generated: ${mlResult.generated}`)
  if (mlResult.errors > 0) {
    console.log(`  Errors: ${mlResult.errors}`)
  }

  console.log(`\nTotal: ${result.generated + mlResult.generated} signals generated`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
