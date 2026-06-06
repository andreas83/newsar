/**
 * RunPod Manager Service
 * Manages on-demand RunPod pod lifecycle for Ollama processing
 *
 * Features:
 * - Creates pods on demand when Ollama jobs are queued
 * - Tracks pod state in Redis for persistence across restarts
 * - Monitors pod health and Ollama availability
 * - Provides dynamic Ollama base URL
 * - Tracks activity for idle timeout
 * - Cost protection (max pods, daily limits)
 */

import { getRunPodClient, PodStatus } from '../utils/runpodClient'
import { getRedisClient } from '../utils/redis'

export interface RunPodManagerConfig {
  apiKey: string
  templateId: string
  gpuType?: string
  enabled?: boolean
  maxPods?: number
  maxCostPerDay?: number // USD
  idleTimeoutMs?: number
  startupTimeoutMs?: number
  healthCheckIntervalMs?: number
}

export interface PodState {
  id: string
  status: 'PENDING' | 'STARTING' | 'READY' | 'ACTIVE' | 'IDLE' | 'TERMINATING' | 'TERMINATED'
  runpodStatus?: string
  url?: string
  createdAt: number
  lastActivityAt: number
  jobsProcessed: number
  uptimeSeconds?: number
  costAccumulated?: number // Estimated USD
}

const DEFAULT_CONFIG: Partial<RunPodManagerConfig> = {
  enabled: true,
  maxPods: 1,
  maxCostPerDay: 20, // $20/day
  idleTimeoutMs: 15 * 60 * 1000, // 15 minutes
  startupTimeoutMs: 5 * 60 * 1000, // 5 minutes
  healthCheckIntervalMs: 30 * 1000, // 30 seconds
}

// Redis keys
const REDIS_KEY_CURRENT_POD = 'runpod:current_pod_id'
const REDIS_KEY_POD_STATE = 'runpod:pod_state'
const REDIS_KEY_LAST_ACTIVITY = 'runpod:last_activity'
const REDIS_KEY_DAILY_COST = 'runpod:daily_cost'

/**
 * RunPod Manager
 */
export class RunPodManager {
  private config: RunPodManagerConfig
  private client: ReturnType<typeof getRunPodClient>
  private redis: ReturnType<typeof getRedisClient>
  private podState: PodState | null = null
  private costPerHour = 0.40 // Default RTX 4090 cost, update based on actual

  constructor(config: RunPodManagerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    if (!this.config.apiKey || !this.config.templateId) {
      throw new Error('RunPod API key and template ID are required')
    }

    this.client = getRunPodClient({
      apiKey: this.config.apiKey,
      templateId: this.config.templateId,
      gpuType: this.config.gpuType,
    })

    this.redis = getRedisClient()

    // Load state from Redis on initialization
    this.loadStateFromRedis()
  }

  /**
   * Load pod state from Redis (for recovery after restart)
   * If no Redis state exists, attempts to discover running pods from RunPod API
   */
  private async loadStateFromRedis() {
    try {
      const podId = await this.redis.get(REDIS_KEY_CURRENT_POD)
      const stateJson = await this.redis.get(REDIS_KEY_POD_STATE)

      if (podId && stateJson) {
        this.podState = JSON.parse(stateJson)
        console.log(`[RunPodManager] Restored pod state from Redis: ${podId}`)

        // Verify pod still exists (optional - skip on API errors)
        try {
          const status = await this.client.getPodStatus(podId)
          if (status.status === 'RUNNING') {
            console.log(`[RunPodManager] Pod ${podId} verified as running`)
          } else {
            console.log(`[RunPodManager] Pod ${podId} is ${status.status}, will use discovery`)
          }
        } catch (error: any) {
          // getPodStatus can fail due to RunPod API bugs (500 Internal Server Error)
          // Don't clear state - trust Redis and let Ollama calls verify pod health
          console.warn(`[RunPodManager] Could not verify pod ${podId}: ${error.message}`)
          console.warn('[RunPodManager] Keeping pod state from Redis, pod health will be verified on use')
        }
      } else {
        // No Redis state, try to discover running pods
        console.log('[RunPodManager] No Redis state found, attempting pod discovery...')
        await this.discoverRunningPods()
      }
    } catch (error) {
      console.error('[RunPodManager] Failed to load state from Redis:', error)
    }
  }

  /**
   * Save pod state to Redis
   */
  private async savePodState() {
    if (!this.podState) return

    try {
      await this.redis.set(REDIS_KEY_CURRENT_POD, this.podState.id)
      await this.redis.set(REDIS_KEY_POD_STATE, JSON.stringify(this.podState))
    } catch (error) {
      console.error('[RunPodManager] Failed to save pod state to Redis:', error)
    }
  }

  /**
   * Clear pod state from Redis
   */
  private async clearPodState() {
    this.podState = null
    try {
      await this.redis.del(REDIS_KEY_CURRENT_POD)
      await this.redis.del(REDIS_KEY_POD_STATE)
    } catch (error) {
      console.error('[RunPodManager] Failed to clear pod state from Redis:', error)
    }
  }

  /**
   * Check if feature is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled === true
  }

  /**
   * Get current pod state
   */
  getCurrentPod(): PodState | null {
    return this.podState
  }

  /**
   * Get pod URL for Ollama
   */
  getPodUrl(): string | null {
    if (!this.podState || this.podState.status !== 'READY' && this.podState.status !== 'ACTIVE' && this.podState.status !== 'IDLE') {
      return null
    }
    return this.podState.url || null
  }

  /**
   * Create a new pod
   */
  async createPod(options?: { force?: boolean }): Promise<PodState> {
    if (!this.config.enabled) {
      throw new Error('RunPod manager is disabled')
    }

    // Check if pod already exists
    if (this.podState && !options?.force) {
      if (this.podState.status === 'READY' || this.podState.status === 'ACTIVE') {
        console.log(`[RunPodManager] Pod already exists and ready: ${this.podState.id}`)
        return this.podState
      }

      if (this.podState.status === 'PENDING' || this.podState.status === 'STARTING') {
        console.log(`[RunPodManager] Pod creation already in progress: ${this.podState.id}`)
        return this.podState
      }
    }

    // Check cost limits
    const dailyCost = await this.getDailyCost()
    if (this.config.maxCostPerDay && dailyCost >= this.config.maxCostPerDay) {
      throw new Error(`Daily cost limit reached: $${dailyCost.toFixed(2)} >= $${this.config.maxCostPerDay}`)
    }

    // Check max pods limit
    if (this.podState && this.config.maxPods === 1) {
      // Need to terminate existing pod first
      console.log(`[RunPodManager] Max pods limit (${this.config.maxPods}), terminating existing pod`)
      await this.terminatePod()
    }

    console.log('[RunPodManager] Creating new pod...')

    try {
      // Create pod via RunPod API
      const response = await this.client.createPod({
        name: `newsar-ollama-${Date.now()}`,
        gpuType: this.config.gpuType,
      })

      // Initialize pod state
      this.podState = {
        id: response.id,
        status: 'PENDING',
        runpodStatus: response.status,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        jobsProcessed: 0,
      }

      await this.savePodState()

      console.log(`[RunPodManager] Pod created: ${response.id}`)

      // Wait for pod to be running
      await this.waitForPodReady()

      return this.podState
    } catch (error) {
      console.error('[RunPodManager] Failed to create pod:', error)
      await this.clearPodState()
      throw error
    }
  }

  /**
   * Wait for pod to be ready (running + Ollama responding)
   */
  async waitForPodReady(): Promise<void> {
    if (!this.podState) {
      throw new Error('No pod to wait for')
    }

    const podId = this.podState.id
    const startTime = Date.now()

    console.log(`[RunPodManager] Waiting for pod ${podId} to be ready...`)

    // Update status to STARTING
    this.podState.status = 'STARTING'
    await this.savePodState()

    try {
      // Step 1: Wait for RunPod status to be RUNNING
      const status = await this.client.waitForPodRunning(podId, {
        maxWaitMs: this.config.startupTimeoutMs,
        pollIntervalMs: 5000,
      })

      // Get pod URL
      const url = this.client.getPodUrl(podId, status)
      if (!url) {
        throw new Error('Failed to get pod URL')
      }

      this.podState.url = url
      this.podState.runpodStatus = status.status
      await this.savePodState()

      console.log(`[RunPodManager] Pod ${podId} is running, URL: ${url}`)

      // Step 2: Wait for Ollama to respond
      await this.waitForOllamaReady(url)

      // Update state to READY
      this.podState.status = 'READY'
      this.podState.lastActivityAt = Date.now()
      await this.savePodState()

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`[RunPodManager] Pod ${podId} is ready after ${elapsed}s`)
    } catch (error) {
      console.error(`[RunPodManager] Pod ${podId} failed to become ready:`, error)
      this.podState.status = 'PENDING' // Allow retry
      await this.savePodState()
      throw error
    }
  }

  /**
   * Wait for Ollama to respond on pod
   */
  private async waitForOllamaReady(url: string, maxWaitMs: number = 120000): Promise<void> {
    const startTime = Date.now()
    const pollIntervalMs = 5000

    console.log(`[RunPodManager] Waiting for Ollama to respond at ${url}...`)

    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Check if Ollama is responding
        const response = await fetch(`${url}/api/tags`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000), // 10 second timeout
        })

        if (response.ok) {
          const data = await response.json()

          // Check if models are loaded
          const hasQwen = data.models?.some((m: any) => m.name.includes('qwen2.5:14b'))
          const hasNomic = data.models?.some((m: any) => m.name.includes('nomic-embed-text'))

          if (hasQwen && hasNomic) {
            console.log('[RunPodManager] Ollama is ready with both models loaded')
            return
          } else {
            console.log(`[RunPodManager] Ollama responding but models not fully loaded yet (qwen: ${hasQwen}, nomic: ${hasNomic})`)
          }
        }
      } catch (error) {
        // Expected during startup, just log and retry
        console.log(`[RunPodManager] Ollama not ready yet, retrying...`)
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error('Ollama did not become ready within timeout')
  }

  /**
   * Check Ollama health on current pod
   */
  async checkOllamaHealth(): Promise<boolean> {
    const url = this.getPodUrl()
    if (!url) {
      return false
    }

    try {
      const response = await fetch(`${url}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return false
      }

      const data = await response.json()
      const hasModels = data.models && data.models.length > 0

      return hasModels
    } catch (error) {
      console.error('[RunPodManager] Ollama health check failed:', error)
      return false
    }
  }

  /**
   * Mark activity (job processed)
   */
  async recordActivity() {
    if (!this.podState) return

    this.podState.lastActivityAt = Date.now()
    this.podState.jobsProcessed += 1

    if (this.podState.status === 'READY' || this.podState.status === 'IDLE') {
      this.podState.status = 'ACTIVE'
    }

    await this.savePodState()
    await this.redis.set(REDIS_KEY_LAST_ACTIVITY, Date.now().toString())
  }

  /**
   * Get time since last activity (ms)
   */
  getTimeSinceLastActivity(): number {
    if (!this.podState) return Infinity
    return Date.now() - this.podState.lastActivityAt
  }

  /**
   * Check if pod is idle
   */
  isIdle(): boolean {
    if (!this.podState) return false
    if (this.podState.status !== 'ACTIVE' && this.podState.status !== 'IDLE' && this.podState.status !== 'READY') {
      return false
    }

    const idleDuration = this.getTimeSinceLastActivity()
    return idleDuration > (this.config.idleTimeoutMs || 900000)
  }

  /**
   * Terminate current pod
   */
  async terminatePod(): Promise<void> {
    if (!this.podState) {
      console.log('[RunPodManager] No pod to terminate')
      return
    }

    const podId = this.podState.id

    try {
      console.log(`[RunPodManager] Terminating pod ${podId}...`)

      this.podState.status = 'TERMINATING'
      await this.savePodState()

      // Calculate and log final cost
      const uptime = (Date.now() - this.podState.createdAt) / 1000 / 3600 // hours
      const cost = uptime * this.costPerHour

      console.log(`[RunPodManager] Pod ${podId} uptime: ${uptime.toFixed(2)}h, cost: $${cost.toFixed(2)}`)

      // Update daily cost
      await this.updateDailyCost(cost)

      // Terminate via API
      await this.client.terminatePod(podId)

      console.log(`[RunPodManager] Pod ${podId} terminated`)

      // Clear state
      await this.clearPodState()
    } catch (error) {
      console.error(`[RunPodManager] Failed to terminate pod ${podId}:`, error)
      // Clear state anyway to prevent stuck state
      await this.clearPodState()
      throw error
    }
  }

  /**
   * Get daily cost so far
   */
  async getDailyCost(): Promise<number> {
    try {
      const costStr = await this.redis.get(REDIS_KEY_DAILY_COST)
      return costStr ? parseFloat(costStr) : 0
    } catch (error) {
      console.error('[RunPodManager] Failed to get daily cost:', error)
      return 0
    }
  }

  /**
   * Update daily cost
   */
  private async updateDailyCost(additionalCost: number) {
    try {
      const currentCost = await this.getDailyCost()
      const newCost = currentCost + additionalCost

      // Store with 24 hour expiry (resets daily)
      await this.redis.setex(REDIS_KEY_DAILY_COST, 86400, newCost.toString())

      console.log(`[RunPodManager] Daily cost updated: $${newCost.toFixed(2)}`)
    } catch (error) {
      console.error('[RunPodManager] Failed to update daily cost:', error)
    }
  }

  /**
   * Sync external pod state (e.g., discovered from RunPod API)
   * Useful when a pod exists in RunPod but not in local state
   */
  async syncPodState(podState: PodState): Promise<void> {
    console.log(`[RunPodManager] Syncing pod state: ${podState.id}`)
    this.podState = podState
    await this.savePodState()
  }

  /**
   * Discover and sync running pods from RunPod API
   * Returns true if a pod was discovered and synced
   */
  async discoverRunningPods(): Promise<boolean> {
    try {
      console.log('[RunPodManager] Discovering running pods from RunPod API...')
      const pods = await this.client.listPods()

      // Find any running pod
      const runningPod = pods.find(p => p.status === 'RUNNING')

      if (runningPod) {
        console.log(`[RunPodManager] Found running pod: ${runningPod.id}`)

        // Get pod URL
        const url = this.client.getPodUrl(runningPod.id, runningPod)

        // Calculate created time from uptime
        const uptimeSeconds = runningPod.runtime?.uptimeInSeconds || 0
        const createdAt = Date.now() - (uptimeSeconds * 1000)

        // Sync to local state
        await this.syncPodState({
          id: runningPod.id,
          status: 'READY',
          runpodStatus: runningPod.status,
          url: url || undefined,
          createdAt,
          lastActivityAt: Date.now(),
          jobsProcessed: 0,
          uptimeSeconds,
        })

        return true
      }

      console.log('[RunPodManager] No running pods found')
      return false
    } catch (error) {
      console.error('[RunPodManager] Failed to discover pods:', error)
      return false
    }
  }

  /**
   * Get status summary
   */
  async getStatus() {
    return {
      enabled: this.config.enabled,
      currentPod: this.podState,
      dailyCost: await this.getDailyCost(),
      maxCostPerDay: this.config.maxCostPerDay,
      idleTimeoutMs: this.config.idleTimeoutMs,
      timeSinceLastActivity: this.podState ? this.getTimeSinceLastActivity() : null,
      isIdle: this.isIdle(),
    }
  }
}

/**
 * Singleton instance
 */
let runpodManagerInstance: RunPodManager | null = null

export function getRunPodManager(config?: RunPodManagerConfig): RunPodManager {
  if (!runpodManagerInstance && config) {
    runpodManagerInstance = new RunPodManager(config)
  }

  if (!runpodManagerInstance) {
    throw new Error('RunPod manager not initialized')
  }

  return runpodManagerInstance
}

export function resetRunPodManager() {
  runpodManagerInstance = null
}
