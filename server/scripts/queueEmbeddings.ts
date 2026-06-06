/**
 * Queue pending articles for embedding generation via BullMQ
 *
 * Run with: npx tsx server/scripts/queueEmbeddings.ts [limit]
 */

import { config } from 'dotenv'
import { queuePendingEmbeddings } from '../queues/feedQueue'

config()

async function main() {
  const limit = parseInt(process.argv[2]) || 200

  try {
    console.log(`\nQueuing up to ${limit} pending articles for embedding generation...\n`)

    const jobs = await queuePendingEmbeddings(limit)

    console.log(`\nQueued ${jobs.length} articles for embedding generation`)
    process.exit(0)
  } catch (error) {
    console.error('\nFailed to queue embeddings:', error)
    process.exit(1)
  }
}

main()
