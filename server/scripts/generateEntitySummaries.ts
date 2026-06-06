// Load environment variables first
import { config } from 'dotenv'
config()

import {
  batchGenerateSummaries,
  updateEntityTrendingScores,
  getEntitiesNeedingSummary
} from '../services/entitySummarizer.js'

async function main() {
  const limit = parseInt(process.argv[2] || '20')
  const concurrency = parseInt(process.argv[3] || '5')

  console.log('=== Entity Summary Generation Script ===')
  console.log(`Limit: ${limit}, Concurrency: ${concurrency}\n`)

  try {
    // First, update trending scores for all entities
    console.log('Step 1: Updating trending scores...')
    await updateEntityTrendingScores()
    console.log('✅ Trending scores updated\n')

    // Get entities that need summaries
    console.log('Step 2: Finding entities that need summaries...')
    const entityIds = await getEntitiesNeedingSummary(limit)
    console.log(`Found ${entityIds.length} entities that need summaries\n`)

    if (entityIds.length === 0) {
      console.log('No entities need summary generation. Exiting.')
      process.exit(0)
    }

    // Generate summaries in batches
    console.log('Step 3: Generating AI summaries...')
    console.log(`Processing up to ${limit} entities with concurrency ${concurrency}\n`)

    const result = await batchGenerateSummaries(limit, false, concurrency)

    console.log('\n✅ Entity summary generation complete!')
    console.log(`Processed: ${result.processed}, Failed: ${result.failed}, Total: ${result.total}`)
    console.log(`Duration: ${Math.round((Date.now() - result.startTime) / 1000)}s`)

  } catch (error) {
    console.error('❌ Error generating entity summaries:', error)
    process.exit(1)
  }

  process.exit(0)
}

main()
