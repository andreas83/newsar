#!/usr/bin/env tsx
/**
 * Scheduled Entity Summary Generation
 *
 * This script should be run periodically (e.g., via cron) to generate
 * AI summaries for top trending entities.
 *
 * Usage:
 *   tsx server/scripts/scheduleEntitySummaries.ts [limit]
 *
 * Example cron entry (run weekly on Sunday at 2 AM):
 *   0 2 * * 0 cd /var/www/newsar.codejungle.org && npm run entities:summarize
 *
 * Or with custom limit (top 50 entities):
 *   0 2 * * 0 cd /var/www/newsar.codejungle.org && tsx server/scripts/scheduleEntitySummaries.ts 50
 */

// Load environment variables
import { config } from 'dotenv'
config()

import { batchGenerateSummaries, updateEntityTrendingScores } from '../services/entitySummarizer.js'

const DEFAULT_LIMIT = 30

async function main() {
  const limit = parseInt(process.argv[2] || String(DEFAULT_LIMIT))

  console.log(`=== Scheduled Entity Summary Generation ===`)
  console.log(`Time: ${new Date().toISOString()}`)
  console.log(`Limit: ${limit} entities\n`)

  try {
    // Update trending scores
    console.log('Step 1: Updating trending scores...')
    await updateEntityTrendingScores()
    console.log('✅ Trending scores updated\n')

    // Generate summaries
    const concurrency = parseInt(process.argv[3] || '5')
    console.log(`Step 2: Generating summaries for top ${limit} entities (concurrency: ${concurrency})...`)
    const result = await batchGenerateSummaries(limit, false, concurrency)

    console.log('\n=== Summary Generation Complete ===')
    console.log(`✅ Processed: ${result.processed}`)
    console.log(`❌ Failed: ${result.failed}`)
    console.log(`📊 Total: ${result.total}`)
    console.log(`⏱️  Duration: ${Math.round((Date.now() - result.startTime) / 1000)}s`)

    if (result.failed > 0) {
      console.log('\n⚠️  Some entities failed to generate summaries')
      process.exit(1)
    }

    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error during scheduled generation:', error)
    process.exit(1)
  }
}

main()
