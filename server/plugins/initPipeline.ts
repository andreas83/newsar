/**
 * Initialize automatic pipeline and periodic feed fetching on server startup
 * Also initializes RunPod on-demand pod management if enabled
 */
import { schedulePeriodicFeedFetch } from '../queues/feedQueue'
import { getAutoPipeline } from '../services/autoPipeline'
import { getRunPodManager } from '../services/runpodManager'
import { getPodIdleMonitor } from '../services/podIdleMonitor'

export default defineNitroPlugin(async (nitroApp) => {
  // Only run on server startup, not in dev mode hot reloads
  if (process.env.NODE_ENV === 'development' && process.env.NITRO_DEV) {
    console.log('[InitPipeline] Skipping initialization in dev mode with hot reload')
    return
  }

  try {
    console.log('[InitPipeline] Initializing automatic pipeline...')

    // Initialize RunPod manager (if enabled)
    const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'
    if (runpodEnabled) {
      const apiKey = process.env.RUNPOD_API_KEY
      const templateId = process.env.RUNPOD_TEMPLATE_ID

      if (apiKey && templateId) {
        try {
          console.log('[InitPipeline] Initializing RunPod manager...')

          const manager = getRunPodManager({
            apiKey,
            templateId,
            gpuType: process.env.RUNPOD_GPU_TYPE,
            enabled: true,
            maxPods: parseInt(process.env.RUNPOD_MAX_PODS || '1'),
            maxCostPerDay: parseFloat(process.env.RUNPOD_MAX_COST_PER_DAY || '20'),
            idleTimeoutMs: parseInt(process.env.RUNPOD_POD_IDLE_TIMEOUT || '900000'),
          })

          console.log('[InitPipeline] ✓ RunPod manager initialized')

          // Start idle monitor
          const idleMonitor = getPodIdleMonitor({
            enabled: true,
            checkIntervalMs: 2 * 60 * 1000, // Check every 2 minutes
          })

          idleMonitor.start()
          console.log('[InitPipeline] ✓ Pod idle monitor started')
        } catch (error) {
          console.error('[InitPipeline] Failed to initialize RunPod manager:', error)
          console.log('[InitPipeline] Continuing without RunPod on-demand management')
        }
      } else {
        console.warn('[InitPipeline] RunPod enabled but API key or template ID missing')
      }
    } else {
      console.log('[InitPipeline] RunPod on-demand management disabled')
    }

    // NOTE: Feed fetching and processing are handled by cron jobs, not auto-pipeline
    // See crontab for schedule: fetch every 4h, extract/classify/embed/analyze on schedule
    console.log('[InitPipeline] Skipping auto-pipeline (using cron instead)')

    console.log('[InitPipeline] Initialization complete')
  } catch (error) {
    console.error('[InitPipeline] Failed to initialize:', error)
  }
})
