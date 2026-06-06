import { getFeedQueue } from '../../../queues/feedQueue'
import {
  calculateJobTypeStats,
  calculateQueueHealth,
  calculateThroughput,
  calculateProcessingTimeStats,
  categorizeErrors,
} from '../../../utils/jobMetrics'

export default defineEventHandler(async (event) => {
  try {
    const feedQueue = getFeedQueue()

    // Get completed jobs for processing time stats
    const [feedCompleted, feedFailed] = await Promise.all([
      feedQueue.getJobs(['completed'], 0, 200),
      feedQueue.getJobs(['failed'], 0, 100),
    ])

    // Calculate processing time statistics
    const feedProcessingStats = calculateProcessingTimeStats(feedCompleted)

    // Calculate job type breakdown
    const feedTypeStats = await calculateJobTypeStats(feedQueue)

    // Calculate queue health metrics
    const feedHealth = await calculateQueueHealth(feedQueue)

    // Calculate throughput metrics
    const feedThroughput = await calculateThroughput(feedQueue)

    // Categorize errors
    const feedErrorCategories = categorizeErrors(feedFailed)

    return {
      feed: {
        processingTime: feedProcessingStats,
        jobTypes: feedTypeStats,
        health: feedHealth,
        throughput: feedThroughput,
        errors: feedErrorCategories,
      },
      timestamp: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error('Error fetching job stats:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch job statistics',
    })
  }
})
