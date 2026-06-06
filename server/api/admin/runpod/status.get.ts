/**
 * Get RunPod manager status
 * Returns current pod state, configuration, and metrics
 */

export default defineEventHandler(async (event) => {
  try {
    // Check if RunPod is enabled
    const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

    if (!runpodEnabled) {
      return {
        enabled: false,
        message: 'RunPod on-demand management is disabled',
      }
    }

    // Get manager instance
    const { getRunPodManager } = await import('../../../services/runpodManager')
    const manager = getRunPodManager()

    if (!manager) {
      return {
        enabled: false,
        error: 'RunPod manager not initialized',
      }
    }

    // Get status
    const status = await manager.getStatus()

    // Get idle monitor status
    const { getPodIdleMonitor } = await import('../../../services/podIdleMonitor')
    const idleMonitor = getPodIdleMonitor()
    const idleMonitorStatus = idleMonitor.getStatus()

    // Calculate additional metrics
    let currentPod = manager.getCurrentPod()

    // If no local state, try to discover running pods from RunPod API
    if (!currentPod) {
      console.log('[API] No local pod state, attempting discovery from RunPod API...')
      const discovered = await manager.discoverRunningPods()
      if (discovered) {
        currentPod = manager.getCurrentPod()
        console.log('[API] Pod discovered and synced to local state:', currentPod?.id)
      }
    }

    let podMetrics = null

    if (currentPod) {
      const uptimeMs = Date.now() - currentPod.createdAt
      const uptimeHours = uptimeMs / (1000 * 60 * 60)
      const estimatedCost = uptimeHours * 0.40 // $0.40/hr for RTX 4090

      const idleMs = manager.getTimeSinceLastActivity()
      const idleMinutes = idleMs / (1000 * 60)
      const idleTimeoutMinutes = (status.idleTimeoutMs || 900000) / (1000 * 60)

      podMetrics = {
        id: currentPod.id,
        status: currentPod.status,
        url: currentPod.url,
        uptime: {
          ms: uptimeMs,
          hours: uptimeHours.toFixed(2),
          formatted: formatUptime(uptimeMs),
        },
        idle: {
          ms: idleMs,
          minutes: idleMinutes.toFixed(1),
          formatted: formatDuration(idleMs),
          percentage: ((idleMinutes / idleTimeoutMinutes) * 100).toFixed(0),
        },
        jobs: {
          processed: currentPod.jobsProcessed,
        },
        cost: {
          session: estimatedCost.toFixed(2),
          hourly: 0.40,
        },
        createdAt: new Date(currentPod.createdAt).toISOString(),
        lastActivityAt: new Date(currentPod.lastActivityAt).toISOString(),
      }
    }

    return {
      enabled: true,
      status: status.enabled,
      pod: podMetrics,
      config: {
        maxPods: status.maxCostPerDay,
        idleTimeoutMinutes: status.idleTimeoutMs ? (status.idleTimeoutMs / 60000).toFixed(0) : null,
        maxCostPerDay: status.maxCostPerDay,
      },
      costs: {
        today: (status.dailyCost || 0).toFixed(2),
        limit: status.maxCostPerDay,
        percentage: status.maxCostPerDay ? ((status.dailyCost || 0) / status.maxCostPerDay * 100).toFixed(0) : 0,
      },
      idleMonitor: {
        running: idleMonitorStatus.running,
        checkIntervalMinutes: idleMonitorStatus.checkIntervalMs ? (idleMonitorStatus.checkIntervalMs / 60000).toFixed(0) : null,
      },
    }
  } catch (error) {
    console.error('[API] Failed to get RunPod status:', error)
    return {
      enabled: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
})

/**
 * Format uptime into human-readable string
 */
function formatUptime(ms: number): string {
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

/**
 * Format duration into human-readable string
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / (1000 * 60))
  const seconds = Math.floor((ms % (1000 * 60)) / 1000)

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  } else {
    return `${seconds}s`
  }
}
