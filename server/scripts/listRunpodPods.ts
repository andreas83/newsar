/**
 * List all RunPod pods
 */

import { getRunPodClient } from '../utils/runpodClient'

const apiKey = process.env.RUNPOD_API_KEY
const templateId = process.env.RUNPOD_TEMPLATE_ID || 'zimt6oxa13'

if (!apiKey) {
  console.error('RUNPOD_API_KEY environment variable is required')
  process.exit(1)
}

const client = getRunPodClient({
  apiKey,
  templateId,
})

async function listPods() {
  console.log('Fetching all pods from RunPod...\n')

  try {
    const pods = await client.listPods()

    if (pods.length === 0) {
      console.log('No pods found')
      return
    }

    console.log(`Found ${pods.length} pod(s):\n`)

    for (const pod of pods) {
      console.log(`Pod ID: ${pod.id}`)
      console.log(`  Status: ${pod.status}`)
      console.log(`  Desired Status: ${pod.desiredStatus}`)

      if (pod.runtime) {
        console.log(`  Uptime: ${pod.runtime.uptimeInSeconds}s (${(pod.runtime.uptimeInSeconds / 3600).toFixed(2)}h)`)

        if (pod.runtime.ports && pod.runtime.ports.length > 0) {
          const port = pod.runtime.ports[0]
          console.log(`  URL: https://${pod.id}-${port.privatePort}.proxy.runpod.net`)
        }
      }

      if (pod.machine) {
        console.log(`  GPU: ${pod.machine.gpuDisplayName}`)
        console.log(`  CPU: ${pod.machine.cpuCores} cores`)
        console.log(`  RAM: ${pod.machine.memoryInGb} GB`)
      }

      console.log('')
    }

    // Calculate total cost
    const runningPods = pods.filter(p => p.status === 'RUNNING')
    if (runningPods.length > 0) {
      const totalUptime = runningPods.reduce((sum, p) => sum + (p.runtime?.uptimeInSeconds || 0), 0)
      const totalHours = totalUptime / 3600
      const estimatedCost = totalHours * 0.40 // Approximate cost per hour

      console.log(`Running pods: ${runningPods.length}`)
      console.log(`Total uptime: ${totalHours.toFixed(2)} hours`)
      console.log(`Estimated cost: $${estimatedCost.toFixed(2)}`)
    }

  } catch (error) {
    console.error('Error listing pods:', error)
    process.exit(1)
  }
}

listPods()
