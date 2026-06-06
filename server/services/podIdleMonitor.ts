/**
 * Pod Idle Monitor Service
 * Monitors pod activity and automatically terminates pods after idle timeout
 *
 * This service runs on an interval (default: every 2 minutes) and checks:
 * 1. If a pod is currently running
 * 2. How long since last activity
 * 3. If there are pending Ollama jobs in the queue
 * 4. If idle timeout threshold is exceeded
 *
 * When conditions are met, it gracefully terminates the pod to save costs.
 */

import { getRunPodManager } from './runpodManager'
import { getFeedQueue } from '../queues/feedQueue'

export interface IdleMonitorConfig {
  checkIntervalMs?: number
  enabled?: boolean
}

const DEFAULT_CONFIG: IdleMonitorConfig = {
  checkIntervalMs: 2 * 60 * 1000, // Check every 2 minutes
  enabled: true,
}

/**
 * Pod Idle Monitor
 */
export class PodIdleMonitor {
  private config: IdleMonitorConfig
  private intervalId: NodeJS.Timeout | null = null
  private isChecking = false

  constructor(config: IdleMonitorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start monitoring
   */
  start() {
    if (this.intervalId) {
      console.log('[PodIdleMonitor] Already running')
      return
    }

    if (!this.config.enabled) {
      console.log('[PodIdleMonitor] Disabled via configuration')
      return
    }

    console.log(`[PodIdleMonitor] Starting with ${this.config.checkIntervalMs}ms interval`)

    // Run immediately
    this.checkIdle()

    // Then run on interval
    this.intervalId = setInterval(
      () => this.checkIdle(),
      this.config.checkIntervalMs
    )
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[PodIdleMonitor] Stopped')
    }
  }

  /**
   * Check if pod should be terminated due to idle
   */
  private async checkIdle() {
    // Prevent concurrent checks
    if (this.isChecking) {
      return
    }

    this.isChecking = true

    try {
      const manager = getRunPodManager()

      // Check if manager is enabled
      if (!manager.isEnabled()) {
        return
      }

      const currentPod = manager.getCurrentPod()

      // No pod running, nothing to do
      if (!currentPod) {
        return
      }

      // Pod not in a terminable state
      if (currentPod.status === 'PENDING' || currentPod.status === 'STARTING' || currentPod.status === 'TERMINATING') {
        return
      }

      // Check if pod is idle
      const isIdle = manager.isIdle()

      if (!isIdle) {
        // Not idle yet
        const timeSinceActivity = manager.getTimeSinceLastActivity()
        const minutesSinceActivity = (timeSinceActivity / 60000).toFixed(1)

        // Only log if pod has been idle for more than 5 minutes
        if (timeSinceActivity > 5 * 60 * 1000) {
          console.log(`[PodIdleMonitor] Pod ${currentPod.id} idle for ${minutesSinceActivity}m (threshold: 15m)`)
        }
        return
      }

      // Pod is idle, but check if there are pending Ollama jobs
      const hasPendingJobs = await this.checkPendingOllamaJobs()

      if (hasPendingJobs) {
        console.log(`[PodIdleMonitor] Pod ${currentPod.id} is idle but has pending Ollama jobs, keeping alive`)
        return
      }

      // Pod is idle and no pending jobs, safe to terminate
      console.log(`[PodIdleMonitor] Pod ${currentPod.id} has been idle for 15+ minutes with no pending jobs, terminating...`)

      try {
        await manager.terminatePod()
        console.log(`[PodIdleMonitor] Pod ${currentPod.id} terminated successfully`)

        // Log cost savings
        const uptime = (Date.now() - currentPod.createdAt) / 1000 / 3600
        console.log(`[PodIdleMonitor] Session stats:`)
        console.log(`  - Uptime: ${uptime.toFixed(2)} hours`)
        console.log(`  - Jobs processed: ${currentPod.jobsProcessed}`)
        console.log(`  - Est. cost: $${(uptime * 0.40).toFixed(2)}`)
      } catch (error) {
        console.error(`[PodIdleMonitor] Failed to terminate pod ${currentPod.id}:`, error)
      }
    } catch (error) {
      console.error('[PodIdleMonitor] Error during idle check:', error)
    } finally {
      this.isChecking = false
    }
  }

  /**
   * Check if there are pending Ollama jobs in queues
   */
  private async checkPendingOllamaJobs(): Promise<boolean> {
    try {
      // Check feed queue for Ollama job types
      const feedQueue = getFeedQueue()

      const ollamaJobTypes = [
        'classify-article',
        'generate-embedding',
        'analyze-article',
      ]

      // Get waiting and active counts for each Ollama job type
      for (const jobType of ollamaJobTypes) {
        const waitingJobs = await feedQueue.getJobCounts('waiting')
        const activeJobs = await feedQueue.getJobCounts('active')

        const totalJobs = waitingJobs.waiting + activeJobs.active

        if (totalJobs > 0) {
          console.log(`[PodIdleMonitor] Found ${totalJobs} pending jobs in feed queue`)
          return true
        }
      }

      return false
    } catch (error) {
      console.error('[PodIdleMonitor] Error checking pending jobs:', error)
      // Err on the side of caution - if we can't check, assume there are jobs
      return true
    }
  }

  /**
   * Get monitor status
   */
  getStatus() {
    return {
      running: !!this.intervalId,
      enabled: this.config.enabled,
      checkIntervalMs: this.config.checkIntervalMs,
      isChecking: this.isChecking,
    }
  }

  /**
   * Force an immediate idle check (for testing/debugging)
   */
  async forceCheck() {
    console.log('[PodIdleMonitor] Force checking idle status...')
    await this.checkIdle()
  }
}

/**
 * Singleton instance
 */
let podIdleMonitorInstance: PodIdleMonitor | null = null

export function getPodIdleMonitor(config?: IdleMonitorConfig): PodIdleMonitor {
  if (!podIdleMonitorInstance) {
    podIdleMonitorInstance = new PodIdleMonitor(config)
  }
  return podIdleMonitorInstance
}

export function resetPodIdleMonitor() {
  if (podIdleMonitorInstance) {
    podIdleMonitorInstance.stop()
  }
  podIdleMonitorInstance = null
}
