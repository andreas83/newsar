/**
 * RunPod API Client
 * Wrapper for RunPod GraphQL API to manage pod lifecycle
 */

export interface RunPodConfig {
  apiKey: string
  templateId: string
  gpuType?: string
}

export interface PodStatus {
  id: string
  status: 'PENDING' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED'
  desiredStatus: string
  runtime?: {
    uptimeInSeconds: number
    ports?: Array<{ ip: string; isIpPublic: boolean; privatePort: number; publicPort: number; type: string }>
    gpus?: Array<{ gpuId: string; gpuType: string }>
  }
  machine?: {
    gpuDisplayName: string
    cpuCores: number
    memoryInGb: number
  }
}

export interface CreatePodResponse {
  id: string
  status: string
  message?: string
}

/**
 * RunPod GraphQL API Client
 */
export class RunPodClient {
  private apiKey: string
  private apiUrl = 'https://api.runpod.io/graphql'
  private config: RunPodConfig

  constructor(config: RunPodConfig) {
    if (!config.apiKey) {
      throw new Error('RunPod API key is required')
    }
    if (!config.templateId) {
      throw new Error('RunPod template ID is required')
    }

    this.apiKey = config.apiKey
    this.config = config
  }

  /**
   * Execute GraphQL query
   */
  private async query(query: string, variables?: Record<string, any>): Promise<any> {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      })

      if (!response.ok) {
        throw new Error(`RunPod API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()

      if (data.errors) {
        throw new Error(`RunPod GraphQL error: ${JSON.stringify(data.errors)}`)
      }

      return data.data
    } catch (error) {
      console.error('[RunPodClient] API request failed:', error)
      throw error
    }
  }

  /**
   * Create a new pod from template
   */
  async createPod(options?: {
    name?: string
    gpuType?: string
    gpuCount?: number
    containerDiskInGb?: number
  }): Promise<CreatePodResponse> {
    const mutation = `
      mutation CreatePod($input: PodFindAndDeployOnDemandInput!) {
        podFindAndDeployOnDemand(input: $input) {
          id
          desiredStatus
          imageName
          machine {
            podHostId
          }
        }
      }
    `

    const gpuType = options?.gpuType || this.config.gpuType || 'NVIDIA RTX 4090'

    const variables = {
      input: {
        cloudType: 'ALL',
        gpuCount: options?.gpuCount || 1,
        gpuTypeId: gpuType,
        name: options?.name || `newsar-ollama-${Date.now()}`,
        templateId: this.config.templateId,
        containerDiskInGb: options?.containerDiskInGb || 20,
        volumeInGb: 0,
        minVcpuCount: 2,
        minMemoryInGb: 8,
        startJupyter: false,
        startSsh: false,
        env: [
          { key: 'OLLAMA_HOST', value: '0.0.0.0:11434' },
          { key: 'OLLAMA_ORIGINS', value: '*' },
        ],
      },
    }

    console.log('[RunPodClient] Creating pod with template:', this.config.templateId)
    console.log('[RunPodClient] GPU type:', gpuType)

    try {
      const data = await this.query(mutation, variables)

      if (!data.podFindAndDeployOnDemand || !data.podFindAndDeployOnDemand.id) {
        throw new Error('Pod creation failed: No pod ID returned')
      }

      const pod = data.podFindAndDeployOnDemand

      console.log(`[RunPodClient] Pod created successfully: ${pod.id}`)

      return {
        id: pod.id,
        status: pod.desiredStatus || 'PENDING',
      }
    } catch (error) {
      console.error('[RunPodClient] Failed to create pod:', error)
      throw new Error(`Failed to create RunPod pod: ${error}`)
    }
  }

  /**
   * Get pod status
   */
  async getPodStatus(podId: string): Promise<PodStatus> {
    const query = `
      query GetPod($podId: String!) {
        pod(input: { podId: $podId }) {
          id
          desiredStatus
          runtime {
            uptimeInSeconds
            ports {
              ip
              isIpPublic
              privatePort
              publicPort
              type
            }
            gpus {
              gpuId
              gpuType
            }
          }
          machine {
            gpuDisplayName
            cpuCores
            memoryInGb
          }
        }
      }
    `

    try {
      const data = await this.query(query, { podId })

      if (!data.pod) {
        throw new Error(`Pod ${podId} not found`)
      }

      const pod = data.pod

      return {
        id: pod.id,
        status: pod.desiredStatus as PodStatus['status'],
        desiredStatus: pod.desiredStatus,
        runtime: pod.runtime,
        machine: pod.machine,
      }
    } catch (error) {
      console.error(`[RunPodClient] Failed to get pod status for ${podId}:`, error)
      throw error
    }
  }

  /**
   * Terminate (stop) a pod
   */
  async terminatePod(podId: string): Promise<void> {
    const mutation = `
      mutation TerminatePod($podId: String!) {
        podTerminate(input: { podId: $podId })
      }
    `

    try {
      console.log(`[RunPodClient] Terminating pod: ${podId}`)
      await this.query(mutation, { podId })
      console.log(`[RunPodClient] Pod ${podId} terminated successfully`)
    } catch (error) {
      console.error(`[RunPodClient] Failed to terminate pod ${podId}:`, error)
      throw error
    }
  }

  /**
   * Get pod proxy URL for Ollama
   */
  getPodUrl(podId: string, status: PodStatus): string | null {
    // Try to get URL from runtime ports if available
    if (status.runtime && status.runtime.ports) {
      // Find port 11434 (Ollama)
      const ollamaPort = status.runtime.ports.find(p => p.privatePort === 11434)

      if (ollamaPort && ollamaPort.isIpPublic) {
        // RunPod proxy URL format: https://{podId}-{publicPort}.proxy.runpod.net
        return `https://${podId}-${ollamaPort.publicPort}.proxy.runpod.net`
      }
    }

    // Fallback: construct URL using standard RunPod pattern
    // RunPod uses predictable URL pattern: https://{podId}-{port}.proxy.runpod.net
    // This works when runtime details aren't available from listPods()
    console.log(`[RunPodClient] Using fallback URL pattern for pod ${podId}`)
    return `https://${podId}-11434.proxy.runpod.net`
  }

  /**
   * Wait for pod to be in RUNNING state
   */
  async waitForPodRunning(podId: string, options: {
    maxWaitMs?: number
    pollIntervalMs?: number
  } = {}): Promise<PodStatus> {
    const maxWaitMs = options.maxWaitMs || 300000 // 5 minutes default
    const pollIntervalMs = options.pollIntervalMs || 5000 // 5 seconds default
    const startTime = Date.now()

    console.log(`[RunPodClient] Waiting for pod ${podId} to be running (max ${maxWaitMs}ms)...`)

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getPodStatus(podId)

      console.log(`[RunPodClient] Pod ${podId} status: ${status.status}`)

      if (status.status === 'RUNNING') {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`[RunPodClient] Pod ${podId} is running after ${elapsed}s`)
        return status
      }

      if (status.status === 'FAILED' || status.status === 'STOPPED') {
        throw new Error(`Pod ${podId} failed to start: ${status.status}`)
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error(`Pod ${podId} did not start within ${maxWaitMs}ms`)
  }

  /**
   * List all pods (for monitoring/debugging)
   */
  async listPods(): Promise<PodStatus[]> {
    const query = `
      query ListPods {
        myself {
          pods {
            id
            desiredStatus
            runtime {
              uptimeInSeconds
            }
            machine {
              gpuDisplayName
            }
          }
        }
      }
    `

    try {
      const data = await this.query(query)

      if (!data.myself || !data.myself.pods) {
        return []
      }

      return data.myself.pods.map((pod: any) => ({
        id: pod.id,
        status: pod.desiredStatus as PodStatus['status'],
        desiredStatus: pod.desiredStatus,
        runtime: pod.runtime,
        machine: pod.machine,
      }))
    } catch (error) {
      console.error('[RunPodClient] Failed to list pods:', error)
      return []
    }
  }
}

/**
 * Singleton instance
 */
let runpodClientInstance: RunPodClient | null = null

export function getRunPodClient(config?: RunPodConfig): RunPodClient {
  if (!runpodClientInstance && config) {
    runpodClientInstance = new RunPodClient(config)
  }

  if (!runpodClientInstance) {
    throw new Error('RunPod client not initialized. Call with config first.')
  }

  return runpodClientInstance
}

export function resetRunPodClient() {
  runpodClientInstance = null
}
