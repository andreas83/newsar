/**
 * Queue pending articles for classification via BullMQ
 *
 * Run with: npx tsx server/scripts/queueClassifications.ts [limit]
 */

import { config } from 'dotenv'
import { queuePendingClassifications } from '../queues/feedQueue'

config()

async function main() {
  const limit = parseInt(process.argv[2]) || 200

  try {
    console.log(`\nQueuing up to ${limit} pending articles for classification...\n`)

    const jobs = await queuePendingClassifications(limit)

    console.log(`\nQueued ${jobs.length} articles for classification`)
    process.exit(0)
  } catch (error) {
    console.error('\nFailed to queue classifications:', error)
    process.exit(1)
  }
}

main()
