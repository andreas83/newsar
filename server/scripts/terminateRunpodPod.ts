/**
 * Terminate a RunPod pod
 */

import { getRunPodClient } from '../utils/runpodClient'

const apiKey = process.env.RUNPOD_API_KEY
const templateId = process.env.RUNPOD_TEMPLATE_ID || 'zimt6oxa13'
const podId = process.argv[2]

if (!apiKey) {
  console.error('RUNPOD_API_KEY environment variable is required')
  process.exit(1)
}

if (!podId) {
  console.error('Usage: tsx terminateRunpodPod.ts <pod_id>')
  process.exit(1)
}

const client = getRunPodClient({
  apiKey,
  templateId,
})

async function terminatePod() {
  console.log(`Terminating pod ${podId}...`)

  try {
    await client.terminatePod(podId)
    console.log(`✓ Pod ${podId} terminated successfully`)
  } catch (error) {
    console.error('Error terminating pod:', error)
    process.exit(1)
  }
}

terminatePod()
