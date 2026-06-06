import { getFeedQueue } from '../../../queues/feedQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { queue: queueName, action, jobId } = body

  try {
    const queue = getFeedQueue()

    let result

    switch (action) {
      case 'pause':
        await queue.pause()
        result = { message: `Queue ${queueName} paused successfully` }
        break

      case 'resume':
        await queue.resume()
        result = { message: `Queue ${queueName} resumed successfully` }
        break

      case 'clean-completed':
        const completed = await queue.clean(0, 1000, 'completed')
        result = { message: `Cleaned ${completed.length} completed jobs`, count: completed.length }
        break

      case 'clean-failed':
        const failed = await queue.clean(0, 1000, 'failed')
        result = { message: `Cleaned ${failed.length} failed jobs`, count: failed.length }
        break

      case 'retry-failed':
        const failedJobs = await queue.getFailed(0, 100)
        const retried = await Promise.all(failedJobs.map((job) => job.retry()))
        result = { message: `Retried ${retried.length} failed jobs`, count: retried.length }
        break

      case 'remove-job':
        if (!jobId) {
          throw createError({ statusCode: 400, statusMessage: 'jobId is required' })
        }
        const job = await queue.getJob(jobId)
        if (job) {
          await job.remove()
          result = { message: `Job ${jobId} removed successfully` }
        } else {
          throw createError({ statusCode: 404, statusMessage: 'Job not found' })
        }
        break

      case 'retry-job':
        if (!jobId) {
          throw createError({ statusCode: 400, statusMessage: 'jobId is required' })
        }
        const retryJob = await queue.getJob(jobId)
        if (retryJob) {
          await retryJob.retry()
          result = { message: `Job ${jobId} queued for retry` }
        } else {
          throw createError({ statusCode: 404, statusMessage: 'Job not found' })
        }
        break

      case 'obliterate':
        // WARNING: This removes ALL jobs and empties the queue
        await queue.obliterate()
        result = { message: `Queue ${queueName} obliterated (all jobs removed)` }
        break

      default:
        throw createError({
          statusCode: 400,
          statusMessage: `Unknown action: ${action}`,
        })
    }

    return {
      success: true,
      ...result,
    }
  } catch (error: any) {
    console.error(`Error performing ${action} on ${queueName} queue:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to perform queue action',
    })
  }
})
