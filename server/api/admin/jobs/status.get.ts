import { getFeedQueue } from '../../../queues/feedQueue'

export default defineEventHandler(async (event) => {
  try {
    const feedQueue = getFeedQueue()

    // Get job counts for feed queue
    const feedCounts = await feedQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    )

    // Get recent jobs (last 10 of each type)
    const [
      feedWaiting,
      feedActive,
      feedFailed,
      feedCompleted,
      feedDelayed,
    ] = await Promise.all([
      feedQueue.getJobs(['waiting'], 0, 9),
      feedQueue.getJobs(['active'], 0, 9),
      feedQueue.getJobs(['failed'], 0, 9),
      feedQueue.getJobs(['completed'], 0, 19),
      feedQueue.getJobs(['delayed'], 0, 9),
    ])

    // Get queue status (paused/resumed)
    const feedPaused = await feedQueue.isPaused()

    // Get worker info
    const feedWorkers = await feedQueue.getWorkers()

    // Detect stale queues (no activity for too long)
    const now = Date.now()
    const feedHealth = checkQueueHealth({
      counts: feedCounts,
      workers: feedWorkers.length,
      paused: feedPaused,
      lastCompleted: feedCompleted[0]?.finishedOn,
      lastActive: feedActive[0]?.processedOn,
      now,
    })

    return {
      queues: {
        feed: {
          name: 'Feed Processing',
          paused: feedPaused,
          workers: feedWorkers.length,
          counts: feedCounts,
          health: feedHealth,
          recentJobs: {
            waiting: feedWaiting.map(formatJob),
            active: feedActive.map(formatJob),
            failed: feedFailed.map(formatJob),
            completed: feedCompleted.map(formatJob),
            delayed: feedDelayed.map(formatJob),
          },
        },
      },
      timestamp: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error('Error fetching job status:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch job status',
    })
  }
})

function formatJob(job: any) {
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    progress: job.progress,
    attempts: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    returnvalue: job.returnvalue,
  }
}

interface QueueHealthParams {
  counts: any
  workers: number
  paused: boolean
  lastCompleted?: number
  lastActive?: number
  now: number
}

function checkQueueHealth(params: QueueHealthParams) {
  const { counts, workers, paused, lastCompleted, lastActive, now } = params
  const alerts: Array<{ level: 'error' | 'warning' | 'info'; message: string }> = []

  // Critical: No workers running
  if (workers === 0) {
    alerts.push({
      level: 'error',
      message: 'No workers connected - jobs will not be processed'
    })
  }

  // Critical: Queue is paused
  if (paused) {
    alerts.push({
      level: 'error',
      message: 'Queue is paused - resume to continue processing'
    })
  }

  // Warning: Jobs waiting but no activity
  const hasWaitingJobs = counts.waiting > 0 || counts.delayed > 0
  const lastActivityTime = Math.max(lastCompleted || 0, lastActive || 0)
  const timeSinceActivity = now - lastActivityTime

  if (hasWaitingJobs && workers > 0 && !paused) {
    // No activity in 10 minutes while jobs are waiting
    if (timeSinceActivity > 10 * 60 * 1000) {
      alerts.push({
        level: 'error',
        message: `No job activity for ${Math.round(timeSinceActivity / 60000)} minutes with ${counts.waiting} jobs waiting`
      })
    }
    // No activity in 5 minutes while jobs are waiting
    else if (timeSinceActivity > 5 * 60 * 1000) {
      alerts.push({
        level: 'warning',
        message: `No job activity for ${Math.round(timeSinceActivity / 60000)} minutes`
      })
    }
  }

  // Warning: High failure rate
  const totalProcessed = counts.completed + counts.failed
  if (totalProcessed > 10 && counts.failed / totalProcessed > 0.2) {
    const failureRate = Math.round((counts.failed / totalProcessed) * 100)
    alerts.push({
      level: 'warning',
      message: `High failure rate: ${failureRate}% of jobs failing`
    })
  }

  // Info: All healthy
  if (alerts.length === 0) {
    const status = hasWaitingJobs ? 'Processing jobs' : 'Idle - no jobs waiting'
    return {
      status: 'healthy',
      alerts: [{
        level: 'info' as const,
        message: status
      }],
      lastActivityTime,
      timeSinceActivity,
    }
  }

  return {
    status: alerts.some(a => a.level === 'error') ? 'error' : 'warning',
    alerts,
    lastActivityTime,
    timeSinceActivity,
  }
}
