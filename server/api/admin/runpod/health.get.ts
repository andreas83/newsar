/**
 * Check RunPod pod and Ollama health
 * Tests connectivity and model availability
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
        healthy: false,
        error: 'RunPod manager not initialized',
      }
    }

    const currentPod = manager.getCurrentPod()

    if (!currentPod) {
      return {
        enabled: true,
        healthy: false,
        pod: null,
        message: 'No pod currently running',
      }
    }

    // Check pod status
    const podHealthy = currentPod.status === 'READY' || currentPod.status === 'ACTIVE' || currentPod.status === 'IDLE'

    // Check Ollama health
    let ollamaHealthy = false
    let ollamaModels = []
    let ollamaError = null

    try {
      ollamaHealthy = await manager.checkOllamaHealth()

      // Get model list if healthy
      if (ollamaHealthy && currentPod.url) {
        const response = await fetch(`${currentPod.url}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        })

        if (response.ok) {
          const data = await response.json()
          ollamaModels = data.models?.map((m: any) => m.name) || []
        }
      }
    } catch (error) {
      ollamaError = error instanceof Error ? error.message : 'Unknown error'
    }

    // Check required models
    const requiredModels = ['qwen2.5:14b-instruct-q5_K_M', 'nomic-embed-text']
    const hasRequiredModels = requiredModels.every(required =>
      ollamaModels.some(model => model.includes(required.split(':')[0]))
    )

    return {
      enabled: true,
      healthy: podHealthy && ollamaHealthy && hasRequiredModels,
      pod: {
        id: currentPod.id,
        status: currentPod.status,
        url: currentPod.url,
        healthy: podHealthy,
        uptime: {
          ms: Date.now() - currentPod.createdAt,
          formatted: formatDuration(Date.now() - currentPod.createdAt),
        },
      },
      ollama: {
        healthy: ollamaHealthy,
        models: ollamaModels,
        hasRequiredModels,
        requiredModels,
        error: ollamaError,
      },
      checks: {
        podRunning: podHealthy,
        ollamaResponding: ollamaHealthy,
        modelsLoaded: hasRequiredModels,
      },
    }
  } catch (error) {
    console.error('[API] Failed to check RunPod health:', error)
    return {
      enabled: false,
      healthy: false,
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
