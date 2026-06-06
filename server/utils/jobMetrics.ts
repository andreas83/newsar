import type { Job, Queue } from 'bullmq'

export interface JobTypeStats {
  type: string
  total: number
  active: number
  waiting: number
  failed: number
  completed: number
  avgProcessingTime: number
  minProcessingTime: number
  maxProcessingTime: number
  successRate: number
  failureRate: number
}

export interface ProcessingTimeStats {
  overall: {
    avg: number
    min: number
    max: number
    median: number
  }
  byType: Record<string, {
    avg: number
    min: number
    max: number
    count: number
  }>
}

export interface QueueHealthMetrics {
  oldestWaitingJobAge: number | null
  stalledJobsCount: number
  backlogSize: number
  queueGrowthRate: number
  avgWaitTime: number
}

export interface ThroughputMetrics {
  jobsPerMinute: number
  jobsPerHour: number
  completionRate: number
  failureRate: number
  lastHourCompleted: number
  lastHourFailed: number
}

/**
 * Calculate processing time for a single job
 */
export function calculateJobProcessingTime(job: any): number | null {
  if (!job.processedOn || !job.finishedOn) return null
  return job.finishedOn - job.processedOn
}

/**
 * Calculate processing time statistics
 */
export function calculateProcessingTimeStats(jobs: any[]): ProcessingTimeStats {
  const times: number[] = []
  const byType: Record<string, number[]> = {}

  for (const job of jobs) {
    const time = calculateJobProcessingTime(job)
    if (time !== null && time > 0) {
      times.push(time)

      if (!byType[job.name]) {
        byType[job.name] = []
      }
      byType[job.name].push(time)
    }
  }

  const calculateStats = (arr: number[]) => {
    if (arr.length === 0) return { avg: 0, min: 0, max: 0, median: 0, count: 0 }

    const sorted = [...arr].sort((a, b) => a - b)
    return {
      avg: arr.reduce((a, b) => a + b, 0) / arr.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)],
      count: arr.length,
    }
  }

  const overall = calculateStats(times)

  const byTypeStats: Record<string, any> = {}
  for (const [type, typeTimes] of Object.entries(byType)) {
    const stats = calculateStats(typeTimes)
    byTypeStats[type] = {
      avg: stats.avg,
      min: stats.min,
      max: stats.max,
      count: stats.count,
    }
  }

  return {
    overall: {
      avg: overall.avg,
      min: overall.min,
      max: overall.max,
      median: overall.median,
    },
    byType: byTypeStats,
  }
}

/**
 * Calculate job type breakdown
 */
export async function calculateJobTypeStats(queue: Queue): Promise<JobTypeStats[]> {
  const [waiting, active, failed, completed] = await Promise.all([
    queue.getJobs(['waiting'], 0, 1000),
    queue.getJobs(['active'], 0, 1000),
    queue.getJobs(['failed'], 0, 1000),
    queue.getJobs(['completed'], 0, 500),
  ])

  const allJobs = [...waiting, ...active, ...failed, ...completed]
  const typeMap = new Map<string, {
    total: number
    active: number
    waiting: number
    failed: number
    completed: number
    processingTimes: number[]
  }>()

  // Group jobs by type
  for (const job of allJobs) {
    if (!typeMap.has(job.name)) {
      typeMap.set(job.name, {
        total: 0,
        active: 0,
        waiting: 0,
        failed: 0,
        completed: 0,
        processingTimes: [],
      })
    }

    const stats = typeMap.get(job.name)!
    stats.total++

    const state = await job.getState()
    if (state === 'active') stats.active++
    else if (state === 'waiting') stats.waiting++
    else if (state === 'failed') stats.failed++
    else if (state === 'completed') {
      stats.completed++
      const time = calculateJobProcessingTime(job)
      if (time !== null) stats.processingTimes.push(time)
    }
  }

  // Calculate statistics for each type
  const result: JobTypeStats[] = []
  for (const [type, stats] of typeMap.entries()) {
    const times = stats.processingTimes
    const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0
    const minTime = times.length > 0 ? Math.min(...times) : 0
    const maxTime = times.length > 0 ? Math.max(...times) : 0
    const totalFinished = stats.completed + stats.failed
    const successRate = totalFinished > 0 ? (stats.completed / totalFinished) * 100 : 0
    const failureRate = totalFinished > 0 ? (stats.failed / totalFinished) * 100 : 0

    result.push({
      type,
      total: stats.total,
      active: stats.active,
      waiting: stats.waiting,
      failed: stats.failed,
      completed: stats.completed,
      avgProcessingTime: avgTime,
      minProcessingTime: minTime,
      maxProcessingTime: maxTime,
      successRate,
      failureRate,
    })
  }

  return result.sort((a, b) => b.total - a.total)
}

/**
 * Calculate queue health metrics
 */
export async function calculateQueueHealth(queue: Queue): Promise<QueueHealthMetrics> {
  const waiting = await queue.getJobs(['waiting'], 0, 100)
  const stalled = await queue.getJobs(['active'], 0, 100)

  // Find oldest waiting job
  let oldestAge: number | null = null
  if (waiting.length > 0) {
    const now = Date.now()
    const oldestJob = waiting.reduce((oldest, job) =>
      job.timestamp < oldest.timestamp ? job : oldest
    )
    oldestAge = now - oldestJob.timestamp
  }

  // Detect stalled jobs (active for more than 10 minutes)
  const stalledCount = stalled.filter(job => {
    if (!job.processedOn) return false
    const activeTime = Date.now() - job.processedOn
    return activeTime > 600000 // 10 minutes
  }).length

  // Get backlog size
  const counts = await queue.getJobCounts('waiting', 'delayed')
  const backlogSize = counts.waiting + counts.delayed

  // Calculate average wait time from recent completed jobs
  const completed = await queue.getJobs(['completed'], 0, 50)
  let avgWaitTime = 0
  let waitTimeCount = 0
  for (const job of completed) {
    if (job.processedOn && job.timestamp) {
      avgWaitTime += job.processedOn - job.timestamp
      waitTimeCount++
    }
  }
  avgWaitTime = waitTimeCount > 0 ? avgWaitTime / waitTimeCount : 0

  return {
    oldestWaitingJobAge: oldestAge,
    stalledJobsCount: stalledCount,
    backlogSize,
    queueGrowthRate: 0, // Would need historical data
    avgWaitTime,
  }
}

/**
 * Calculate throughput metrics
 */
export async function calculateThroughput(queue: Queue): Promise<ThroughputMetrics> {
  // Get completed and failed jobs from last hour
  const oneHourAgo = Date.now() - (60 * 60 * 1000)
  const completed = await queue.getJobs(['completed'], 0, 1000)
  const failed = await queue.getJobs(['failed'], 0, 500)

  const lastHourCompleted = completed.filter(job =>
    job.finishedOn && job.finishedOn > oneHourAgo
  ).length

  const lastHourFailed = failed.filter(job =>
    job.finishedOn && job.finishedOn > oneHourAgo
  ).length

  const totalLastHour = lastHourCompleted + lastHourFailed

  const jobsPerMinute = totalLastHour / 60
  const jobsPerHour = totalLastHour

  const completionRate = totalLastHour > 0 ? (lastHourCompleted / totalLastHour) * 100 : 0
  const failureRate = totalLastHour > 0 ? (lastHourFailed / totalLastHour) * 100 : 0

  return {
    jobsPerMinute,
    jobsPerHour,
    completionRate,
    failureRate,
    lastHourCompleted,
    lastHourFailed,
  }
}

/**
 * Categorize errors
 */
export function categorizeErrors(failedJobs: any[]): Record<string, { count: number; examples: string[] }> {
  const categories: Record<string, { count: number; examples: string[] }> = {}

  for (const job of failedJobs) {
    if (!job.failedReason) continue

    const error = job.failedReason.toLowerCase()
    let category = 'Other'

    if (error.includes('timeout') || error.includes('timed out')) {
      category = 'Timeout'
    } else if (error.includes('econnrefused') || error.includes('enotfound') || error.includes('network')) {
      category = 'Network'
    } else if (error.includes('validation') || error.includes('invalid')) {
      category = 'Validation'
    } else if (error.includes('permission') || error.includes('unauthorized') || error.includes('forbidden')) {
      category = 'Permission'
    } else if (error.includes('not found') || error.includes('404')) {
      category = 'Not Found'
    } else if (error.includes('database') || error.includes('sql')) {
      category = 'Database'
    } else if (error.includes('memory') || error.includes('heap')) {
      category = 'Memory'
    }

    if (!categories[category]) {
      categories[category] = { count: 0, examples: [] }
    }

    categories[category].count++
    if (categories[category].examples.length < 3) {
      categories[category].examples.push(job.failedReason.substring(0, 100))
    }
  }

  return categories
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}
