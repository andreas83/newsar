import { getFeedQueue } from '../../../queues/feedQueue'
import { calculateJobProcessingTime, formatDuration } from '../../../utils/jobMetrics'

export default defineEventHandler(async (event) => {
  const jobId = getRouterParam(event, 'id')
  const query = getQuery(event)
  const queueName = query.queue as string

  if (!jobId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Job ID is required',
    })
  }

  if (!queueName || !['feed'].includes(queueName)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Valid queue name is required (feed)',
    })
  }

  try {
    const queue = getFeedQueue()
    const job = await queue.getJob(jobId)

    if (!job) {
      throw createError({
        statusCode: 404,
        statusMessage: `Job ${jobId} not found in ${queueName} queue`,
      })
    }

    // Get job state and logs
    const state = await job.getState()
    let logs: any = { logs: [] }

    // Try to get logs if the method exists
    try {
      if (typeof job.getLogs === 'function') {
        logs = await job.getLogs()
      }
    } catch (error) {
      console.warn(`Could not fetch logs for job ${jobId}:`, error)
    }

    // Calculate processing time
    const processingTime = calculateJobProcessingTime(job)

    // Calculate wait time
    let waitTime: number | null = null
    if (job.processedOn && job.timestamp) {
      waitTime = job.processedOn - job.timestamp
    }

    // Get full stack trace if failed
    let stackTrace: string | null = null
    if (job.stacktrace && job.stacktrace.length > 0) {
      stackTrace = job.stacktrace.join('\n')
    }

    // Build detailed response
    return {
      id: job.id,
      name: job.name,
      queue: queueName,
      state,
      data: job.data,
      opts: {
        priority: job.opts.priority,
        attempts: job.opts.attempts,
        delay: job.opts.delay,
        removeOnComplete: job.opts.removeOnComplete,
        removeOnFail: job.opts.removeOnFail,
      },
      progress: job.progress,
      returnvalue: job.returnvalue,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stackTrace,
      timestamps: {
        created: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        delay: job.delay,
      },
      timing: {
        waitTime: waitTime ? formatDuration(waitTime) : null,
        waitTimeMs: waitTime,
        processingTime: processingTime ? formatDuration(processingTime) : null,
        processingTimeMs: processingTime,
        totalTime: (waitTime && processingTime) ? formatDuration(waitTime + processingTime) : null,
      },
      logs: {
        count: logs.logs?.length || 0,
        entries: logs.logs || [],
      },
      parent: job.parent ? {
        id: job.parent.id,
        queue: job.parent.queueKey,
      } : null,
    }
  } catch (error: any) {
    console.error(`Error fetching job ${jobId}:`, error)

    if (error.statusCode) throw error

    throw createError({
      statusCode: 500,
      statusMessage: `Failed to fetch job details: ${error.message}`,
    })
  }
})
