/**
 * List all RunPod pods
 * Returns list of all pods from RunPod API
 */

export default defineEventHandler(async (event) => {
  try {
    // Check if RunPod is enabled
    const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

    if (!runpodEnabled) {
      return {
        enabled: false,
        pods: [],
        message: 'RunPod on-demand management is disabled',
      }
    }

    // Get RunPod client
    const { getRunPodClient } = await import('../../../utils/runpodClient')

    try {
      const client = getRunPodClient()
      const pods = await client.listPods()

      return {
        enabled: true,
        pods: pods.map(pod => ({
          id: pod.id,
          status: pod.status,
          desiredStatus: pod.desiredStatus,
          uptime: pod.runtime?.uptimeInSeconds,
          gpuType: pod.machine?.gpuDisplayName,
          cpuCores: pod.machine?.cpuCores,
          memoryInGb: pod.machine?.memoryInGb,
        })),
        count: pods.length,
      }
    } catch (error) {
      console.error('[API] Failed to list pods:', error)

      return {
        enabled: true,
        pods: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Failed to list pods',
      }
    }
  } catch (error) {
    console.error('[API] Failed to get pod list:', error)
    return {
      enabled: false,
      pods: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
})
