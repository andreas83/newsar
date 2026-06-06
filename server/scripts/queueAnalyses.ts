/**
 * Queue pending articles for analysis via BullMQ
 *
 * Run with: npx tsx server/scripts/queueAnalyses.ts [limit]
 */

import { config } from 'dotenv'
import { queuePendingAnalyses } from '../queues/feedQueue'

config()

async function main() {
  const limit = parseInt(process.argv[2]) || 200

  try {
    console.log(`\nQueuing up to ${limit} pending articles for analysis...\n`)

    const jobs = await queuePendingAnalyses(limit)

    console.log(`\nQueued ${jobs.length} articles for analysis`)
    process.exit(0)
  } catch (error) {
    console.error('\nFailed to queue analyses:', error)
    process.exit(1)
  }
}

main()
