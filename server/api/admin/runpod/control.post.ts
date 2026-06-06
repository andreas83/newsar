/**
 * Control RunPod pod lifecycle
 * Supports: create, terminate, restart actions
 */

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { action } = body

    if (!action) {
      throw createError({
        statusCode: 400,
        message: 'Action is required (create, terminate, restart)',
      })
    }

    // Check if RunPod is enabled
    const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

    if (!runpodEnabled) {
      throw createError({
        statusCode: 400,
        message: 'RunPod on-demand management is disabled',
      })
    }

    // Get manager instance
    const { getRunPodManager } = await import('../../../services/runpodManager')
    const manager = getRunPodManager()

    if (!manager) {
      throw createError({
        statusCode: 500,
        message: 'RunPod manager not initialized',
      })
    }

    // Execute action
    switch (action) {
      case 'create': {
        console.log('[API] Manual pod creation requested')

        const currentPod = manager.getCurrentPod()
        if (currentPod && (currentPod.status === 'READY' || currentPod.status === 'ACTIVE' || currentPod.status === 'IDLE')) {
          return {
            success: true,
            message: 'Pod already running',
            pod: currentPod,
          }
        }

        if (currentPod && (currentPod.status === 'PENDING' || currentPod.status === 'STARTING')) {
          return {
            success: true,
            message: 'Pod is already being created',
            pod: currentPod,
          }
        }

        // Create new pod
        const pod = await manager.createPod({ force: body.force || false })

        return {
          success: true,
          message: 'Pod created successfully',
          pod: {
            id: pod.id,
            status: pod.status,
            createdAt: new Date(pod.createdAt).toISOString(),
          },
        }
      }

      case 'terminate': {
        console.log('[API] Manual pod termination requested')

        const currentPod = manager.getCurrentPod()
        if (!currentPod) {
          return {
            success: true,
            message: 'No pod to terminate',
          }
        }

        if (currentPod.status === 'TERMINATING' || currentPod.status === 'TERMINATED') {
          return {
            success: true,
            message: 'Pod already terminating',
          }
        }

        // Terminate pod
        await manager.terminatePod()

        return {
          success: true,
          message: 'Pod terminated successfully',
          pod: {
            id: currentPod.id,
            uptimeMs: Date.now() - currentPod.createdAt,
            jobsProcessed: currentPod.jobsProcessed,
          },
        }
      }

      case 'restart': {
        console.log('[API] Manual pod restart requested')

        const currentPod = manager.getCurrentPod()

        // Terminate existing pod if any
        if (currentPod && currentPod.status !== 'TERMINATED') {
          console.log('[API] Terminating existing pod before restart')
          await manager.terminatePod()
        }

        // Wait a moment for termination to complete
        await new Promise(resolve => setTimeout(resolve, 2000))

        // Create new pod
        const newPod = await manager.createPod({ force: true })

        return {
          success: true,
          message: 'Pod restarted successfully',
          pod: {
            id: newPod.id,
            status: newPod.status,
            createdAt: new Date(newPod.createdAt).toISOString(),
          },
        }
      }

      default:
        throw createError({
          statusCode: 400,
          message: `Unknown action: ${action}. Valid actions: create, terminate, restart`,
        })
    }
  } catch (error) {
    console.error('[API] RunPod control error:', error)

    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error // Re-throw H3 errors
    }

    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : 'Failed to control pod',
    })
  }
})
