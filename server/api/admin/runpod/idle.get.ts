/**
 * Get idle monitor status and timing information
 * Also supports forcing an idle check
 */

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const forceCheck = query.forceCheck === 'true'

    // Check if RunPod is enabled
    const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

    if (!runpodEnabled) {
      return {
        enabled: false,
        message: 'RunPod on-demand management is disabled',
      }
    }

    // Get manager and monitor instances
    const { getRunPodManager } = await import('../../../services/runpodManager')
    const { getPodIdleMonitor } = await import('../../../services/podIdleMonitor')

    const manager = getRunPodManager()
    const monitor = getPodIdleMonitor()

    if (!manager) {
      return {
        enabled: false,
        error: 'RunPod manager not initialized',
      }
    }

    const currentPod = manager.getCurrentPod()
    const monitorStatus = monitor.getStatus()

    // Calculate idle timing
    let idleTiming = null

    if (currentPod) {
      const timeSinceActivity = manager.getTimeSinceLastActivity()
      const idleTimeoutMs = parseInt(process.env.RUNPOD_POD_IDLE_TIMEOUT || '900000')
      const timeUntilTermination = idleTimeoutMs - timeSinceActivity
      const idlePercent = (timeSinceActivity / idleTimeoutMs) * 100

      idleTiming = {
        timeSinceActivity: {
          ms: timeSinceActivity,
          minutes: (timeSinceActivity / 60000).toFixed(1),
          formatted: formatDuration(timeSinceActivity),
        },
        timeUntilTermination: {
          ms: Math.max(0, timeUntilTermination),
          minutes: Math.max(0, timeUntilTermination / 60000).toFixed(1),
          formatted: timeUntilTermination > 0 ? formatDuration(timeUntilTermination) : 'Overdue',
        },
        idleTimeout: {
          ms: idleTimeoutMs,
          minutes: (idleTimeoutMs / 60000).toFixed(0),
        },
        idlePercent: Math.min(100, idlePercent).toFixed(1),
        isIdle: manager.isIdle(),
        willTerminate: timeSinceActivity >= idleTimeoutMs,
      }
    }

    // Force check if requested
    let checkResult = null
    if (forceCheck) {
      console.log('[API] Forcing idle check via API request')
      try {
        await monitor.forceCheck()
        checkResult = {
          success: true,
          message: 'Idle check completed',
        }
      } catch (error) {
        checkResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }

    return {
      enabled: true,
      monitor: {
        running: monitorStatus.running,
        enabled: monitorStatus.enabled,
        checkInterval: {
          ms: monitorStatus.checkIntervalMs,
          minutes: monitorStatus.checkIntervalMs ? (monitorStatus.checkIntervalMs / 60000).toFixed(0) : null,
        },
        isChecking: monitorStatus.isChecking,
      },
      pod: currentPod ? {
        id: currentPod.id,
        status: currentPod.status,
        lastActivity: new Date(currentPod.lastActivityAt).toISOString(),
        jobsProcessed: currentPod.jobsProcessed,
      } : null,
      idle: idleTiming,
      forceCheck: checkResult,
    }
  } catch (error) {
    console.error('[API] Failed to get idle monitor status:', error)
    return {
      enabled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
})

/**
 * Format duration into human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  } else {
    return `${seconds}s`
  }
}
