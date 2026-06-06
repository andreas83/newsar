/**
 * Gemini Batch API client wrapper with real-time fallback
 *
 * Uses @google/genai SDK for batch processing with inline requests.
 * Provides 50% cost reduction vs real-time API for non-time-sensitive workloads.
 *
 * Resilience features:
 * - Cancels stale PENDING batch jobs before submitting new ones
 * - Falls back to concurrent real-time API calls if batch stays PENDING too long
 * - Handles 429/503 errors gracefully
 */

import { GoogleGenAI, type BatchJob, type InlinedRequest } from '@google/genai'

let client: GoogleGenAI | null = null

export function getGeminiBatchClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required for batch API')
    }
    client = new GoogleGenAI({ apiKey })
  }
  return client
}

export function getDefaultBatchModel(): string {
  return process.env.GEMINI_BATCH_MODEL || 'gemini-2.5-flash-lite'
}

export interface PromptConfig {
  prompt: string
  systemPrompt?: string
  options?: {
    temperature?: number
    maxTokens?: number
    jsonMode?: boolean
  }
}

/**
 * Build an InlinedRequest for the batch API
 */
export function buildRequest(config: PromptConfig): InlinedRequest {
  const model = getDefaultBatchModel()
  const request: InlinedRequest = {
    contents: [
      {
        parts: [{ text: config.prompt }],
        role: 'user',
      },
    ],
    config: {},
  }

  if (config.systemPrompt) {
    request.config!.systemInstruction = config.systemPrompt
  }

  if (config.options?.temperature !== undefined) {
    request.config!.temperature = config.options.temperature
  }

  if (config.options?.maxTokens !== undefined) {
    request.config!.maxOutputTokens = config.options.maxTokens
  }

  if (config.options?.jsonMode) {
    request.config!.responseMimeType = 'application/json'
  }

  // Disable thinking for 2.5 models — thinking tokens count against
  // maxOutputTokens, leaving too few tokens for the actual response
  if (model.includes('2.5')) {
    (request.config as any).thinkingConfig = { thinkingBudget: 0 }
  }

  return request
}

/**
 * Cancel all PENDING batch jobs to free up quota.
 * Should be called before submitting new batches.
 */
export async function cancelPendingBatches(): Promise<number> {
  const ai = getGeminiBatchClient()
  let cancelled = 0

  try {
    const result = await ai.batches.list({ config: { pageSize: 50 } })
    for (const batch of result.page) {
      if (batch.state === 'JOB_STATE_PENDING' && batch.name) {
        try {
          await ai.batches.cancel({ name: batch.name })
          cancelled++
          console.log(`[GeminiBatch] Cancelled stale pending job: ${batch.name} (${batch.displayName})`)
        } catch (e) {
          // Ignore cancel errors for individual jobs
        }
      }
    }
    if (cancelled > 0) {
      console.log(`[GeminiBatch] Cancelled ${cancelled} stale pending batch job(s)`)
    }
  } catch (e) {
    console.log(`[GeminiBatch] Warning: could not list/cancel pending batches: ${e instanceof Error ? e.message : e}`)
  }

  return cancelled
}

/**
 * Submit a batch of inline requests to the Gemini Batch API
 */
export async function submitBatch(
  requests: InlinedRequest[],
  displayName: string,
  model?: string
): Promise<BatchJob> {
  const ai = getGeminiBatchClient()
  const batchModel = model || getDefaultBatchModel()

  console.log(`[GeminiBatch] Submitting batch "${displayName}" with ${requests.length} requests using model ${batchModel}`)

  const job = await ai.batches.create({
    model: batchModel,
    src: requests,
    config: {
      displayName,
    },
  })

  console.log(`[GeminiBatch] Batch job created: ${job.name} (state: ${job.state})`)
  return job
}

const TERMINAL_STATES = new Set([
  'JOB_STATE_SUCCEEDED',
  'JOB_STATE_FAILED',
  'JOB_STATE_CANCELLED',
  'JOB_STATE_EXPIRED',
  'JOB_STATE_PARTIALLY_SUCCEEDED',
])

/**
 * Poll for batch job completion with configurable timeout.
 * Returns null if the job is cancelled due to timeout (caller should fallback).
 */
export async function waitForCompletion(
  jobName: string,
  pollIntervalMs: number = 30_000,
  maxWaitMs: number = 15 * 60 * 1000 // 15 minutes (was 2 hours)
): Promise<BatchJob | null> {
  const ai = getGeminiBatchClient()
  const startTime = Date.now()

  let job = await ai.batches.get({ name: jobName })
  let lastState = job.state

  while (!TERMINAL_STATES.has(job.state || '')) {
    const elapsed = Date.now() - startTime

    if (elapsed > maxWaitMs) {
      // Cancel the stuck job instead of just throwing
      console.log(`[GeminiBatch] Job ${jobName} stuck in ${job.state} after ${Math.round(elapsed / 60000)}m — cancelling`)
      try {
        await ai.batches.cancel({ name: jobName })
      } catch (e) {
        // Ignore cancel errors
      }
      return null
    }

    if (job.state !== lastState) {
      console.log(`[GeminiBatch] Job ${jobName}: ${lastState} -> ${job.state}`)
      lastState = job.state
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))

    try {
      job = await ai.batches.get({ name: jobName })
    } catch (e: any) {
      // 503 during polling — wait and retry
      if (e?.status === 503 || e?.status === 429) {
        console.log(`[GeminiBatch] ${e.status} while polling ${jobName}, retrying in ${pollIntervalMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
        continue
      }
      throw e
    }
  }

  console.log(`[GeminiBatch] Job ${jobName} finished: ${job.state}`)
  return job
}

export interface BatchResult {
  index: number
  text?: string
  error?: string
}

/**
 * Extract text results from a completed batch job
 * Results are in the same order as the input requests.
 */
export function extractResults(job: BatchJob): BatchResult[] {
  const responses = job.dest?.inlinedResponses || []
  return responses.map((item, index) => {
    if (item.error) {
      return { index, error: item.error.message || 'Unknown batch error' }
    }
    if (item.response) {
      const text = item.response.text
      return { index, text: text || undefined }
    }
    return { index, error: 'No response or error in batch result' }
  })
}

/**
 * Process requests using real-time Gemini API with concurrency control.
 * Used as fallback when batch API is unavailable.
 */
export async function processRealtime(
  requests: InlinedRequest[],
  model?: string,
  concurrency: number = 5,
  delayMs: number = 200
): Promise<BatchResult[]> {
  const ai = getGeminiBatchClient()
  const batchModel = model || getDefaultBatchModel()
  const results: BatchResult[] = new Array(requests.length)
  let completed = 0
  let errors = 0

  console.log(`[GeminiBatch] Real-time fallback: processing ${requests.length} requests (concurrency: ${concurrency})`)

  // Process in chunks with concurrency limit
  for (let i = 0; i < requests.length; i += concurrency) {
    const chunk = requests.slice(i, Math.min(i + concurrency, requests.length))
    const promises = chunk.map(async (request, chunkIdx) => {
      const globalIdx = i + chunkIdx

      // Retry loop with exponential backoff
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: batchModel,
            contents: request.contents as any,
            config: {
              systemInstruction: request.config?.systemInstruction as any,
              temperature: request.config?.temperature,
              maxOutputTokens: request.config?.maxOutputTokens,
              responseMimeType: request.config?.responseMimeType as any,
            },
          })

          results[globalIdx] = { index: globalIdx, text: response.text || undefined }
          completed++
          return
        } catch (e: any) {
          if ((e?.status === 429 || e?.status === 503) && attempt < 2) {
            const backoff = (attempt + 1) * 5000
            console.log(`[GeminiBatch] ${e.status} on request ${globalIdx}, retry in ${backoff}ms (attempt ${attempt + 1}/3)`)
            await new Promise(resolve => setTimeout(resolve, backoff))
            continue
          }
          results[globalIdx] = { index: globalIdx, error: e instanceof Error ? e.message : 'Unknown error' }
          errors++
          return
        }
      }
    })

    await Promise.all(promises)

    // Progress update every 20 items
    if (completed % 20 < concurrency) {
      console.log(`[GeminiBatch] Real-time progress: ${completed}/${requests.length} completed, ${errors} errors`)
    }

    // Small delay between chunks to avoid rate limits
    if (i + concurrency < requests.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  console.log(`[GeminiBatch] Real-time complete: ${completed}/${requests.length} succeeded, ${errors} errors`)
  return results
}

/**
 * Submit batch and wait for completion, with automatic real-time fallback.
 * 1. Tries batch API first
 * 2. If batch stays PENDING or fails, falls back to concurrent real-time calls
 */
export async function submitAndWait(
  requests: InlinedRequest[],
  displayName: string,
  model?: string,
  pollIntervalMs?: number
): Promise<BatchResult[]> {
  try {
    const job = await submitBatch(requests, displayName, model)
    const completedJob = await waitForCompletion(job.name!, pollIntervalMs)

    // null means timeout/cancelled — fall back to real-time
    if (!completedJob) {
      console.log(`[GeminiBatch] Batch "${displayName}" timed out, falling back to real-time API`)
      return processRealtime(requests, model)
    }

    if (completedJob.state === 'JOB_STATE_FAILED') {
      console.log(`[GeminiBatch] Batch "${displayName}" failed, falling back to real-time API`)
      return processRealtime(requests, model)
    }

    return extractResults(completedJob)
  } catch (e: any) {
    // 429 or 503 on batch submission — fall back to real-time
    if (e?.status === 429 || e?.status === 503) {
      console.log(`[GeminiBatch] Batch submission failed (${e.status}), falling back to real-time API`)
      return processRealtime(requests, model)
    }
    throw e
  }
}
