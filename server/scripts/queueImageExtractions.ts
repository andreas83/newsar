/**
 * Queue all pending articles for image extraction
 *
 * Run with: npx tsx server/scripts/queueImageExtractions.ts [limit]
 */

import { config } from 'dotenv'
import { queuePendingImageExtractions } from '../queues/feedQueue'

// Load environment variables
config()

async function main() {
  const limit = parseInt(process.argv[2]) || 500

  try {
    console.log(`\n🚀 Queuing up to ${limit} pending articles for image extraction...\n`)

    const jobs = await queuePendingImageExtractions(limit)

    console.log(`\n✅ Successfully queued ${jobs.length} articles for image extraction`)
    console.log('\n💡 Start the worker to process them:')
    console.log('   npm run worker:feed\n')

    process.exit(0)
  } catch (error) {
    console.error('\n❌ Failed to queue image extractions:', error)
    process.exit(1)
  }
}

main()
