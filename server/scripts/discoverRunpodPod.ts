import { config } from 'dotenv'
config()

import { getRunPodManager } from '../services/runpodManager.js'

async function discover() {
  console.log('Triggering RunPod discovery...')

  const apiKey = process.env.RUNPOD_API_KEY
  const templateId = process.env.RUNPOD_TEMPLATE_ID

  if (!apiKey || !templateId) {
    console.log('RunPod API key or template ID missing')
    process.exit(1)
  }

  const manager = getRunPodManager({
    apiKey,
    templateId,
    gpuType: process.env.RUNPOD_GPU_TYPE,
    enabled: true,
    maxPods: parseInt(process.env.RUNPOD_MAX_PODS || '1'),
    maxCostPerDay: parseFloat(process.env.RUNPOD_MAX_COST_PER_DAY || '20'),
    idleTimeoutMs: parseInt(process.env.RUNPOD_POD_IDLE_TIMEOUT || '900000'),
  })

  console.log('Manager initialized, discovering pods...')

  const found = await manager.discoverRunningPods()

  if (found) {
    const pod = manager.getCurrentPod()
    console.log('✅ Pod discovered and synced:')
    console.log('  ID:', pod?.id)
    console.log('  Status:', pod?.status)
    console.log('  URL:', pod?.url)
  } else {
    console.log('❌ No running pods found')
  }

  process.exit(0)
}

discover()
