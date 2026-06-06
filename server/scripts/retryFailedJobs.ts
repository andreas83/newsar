// Load environment variables first
import { config } from 'dotenv'
config()

import { Queue } from 'bullmq'
import { getRedisClient } from '../utils/redis.js'

const queueName = process.env.BULLMQ_QUEUE_NAME || 'newsar-jobs'

async function retryFailedJobs() {
  const queue = new Queue(queueName, {
    connection: getRedisClient(),
  })

  console.log('🔄 Retrying all failed jobs...')

  try {
    // Get all failed jobs
    const failedJobs = await queue.getFailed()
    console.log(`Found ${failedJobs.length} failed jobs`)

    // Retry each failed job
    let retriedCount = 0
    for (const job of failedJobs) {
      await job.retry()
      retriedCount++
      console.log(`  ✅ Retried job ${job.id} (${job.name})`)
    }

    console.log(`\n✅ Successfully retried ${retriedCount} jobs`)
  } catch (error) {
    console.error('❌ Error retrying jobs:', error)
    throw error
  } finally {
    await queue.close()
    process.exit(0)
  }
}

retryFailedJobs()
