/**
 * Queue all pending articles for content extraction
 *
 * Run with: npx tsx server/scripts/queueExtractions.ts [limit]
 */

import { config } from 'dotenv'
import { queuePendingExtractions } from '../queues/feedQueue'

// Load environment variables
config()

async function main() {
  const limit = parseInt(process.argv[2]) || 500

  try {
    console.log(`\n🚀 Queuing up to ${limit} pending articles for extraction...\n`)

    const jobs = await queuePendingExtractions(limit)

    console.log(`\n✅ Successfully queued ${jobs.length} articles for extraction`)
    console.log('\n💡 Start the worker to process them:')
    console.log('   npm run worker:feed\n')

    process.exit(0)
  } catch (error) {
    console.error('\n❌ Failed to queue extractions:', error)
    process.exit(1)
  }
}

main()
