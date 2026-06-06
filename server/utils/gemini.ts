/**
 * Google Gemini API client for LLM completions
 * Uses Gemini 2.0 Flash
 * Paid tier: 2000 RPM, 4M TPM
 * Free tier: 15 RPM, 1M TPM
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

// Rate limiting: paid tier is 2000 RPM, keep conservative to control costs
const RATE_LIMIT_MAX = parseInt(process.env.GEMINI_RATE_LIMIT || '500', 10)
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const requestTimestamps: number[] = []

/**
 * Wait if rate limit is reached
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now()

  // Remove timestamps older than the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift()
  }

  // If at limit, wait until oldest request expires
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    const oldestTimestamp = requestTimestamps[0]
    const waitTime = oldestTimestamp + RATE_LIMIT_WINDOW_MS - now + 100 // +100ms buffer
    console.log(`[Gemini] Rate limit reached (${RATE_LIMIT_MAX}/min), waiting ${Math.ceil(waitTime / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
    // Recursively check again after waiting
    return waitForRateLimit()
  }

  // Record this request
  requestTimestamps.push(now)
}

/**
 * Check if Gemini API is available
 */
export function isGeminiAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY
}

/**
 * Get the default model to use
 */
function getDefaultModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash'
}

interface GeminiContent {
  parts: Array<{ text: string }>
  role?: 'user' | 'model'
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>
      role: string
    }
    finishReason: string
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
  error?: {
    message: string
    code: number
    status: string
  }
}

/**
 * Generate chat completion using Gemini API
 */
export async function generateGeminiCompletion(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
    responseMimeType?: string
  }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error('Gemini API key not configured')
  }

  // Wait for rate limit
  await waitForRateLimit()

  const model = options?.model || getDefaultModel()
  const maxTokens = options?.maxTokens || 2000
  const temperature = options?.temperature || 0.3

  const contents: GeminiContent[] = [{
    parts: [{ text: prompt }],
    role: 'user',
  }]

  const maxRetries = 3
  let lastError: Error | null = null
  const url = `${GEMINI_API_URL}/${model}:generateContent`

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents,
          ...(systemPrompt && {
            systemInstruction: { parts: [{ text: systemPrompt }] },
          }),
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature,
            ...(options?.responseMimeType && {
              responseMimeType: options.responseMimeType,
            }),
            // Disable thinking — thinking tokens count against maxOutputTokens,
            // leaving too few tokens for the actual response.
            // Applied unconditionally: model aliases like 'gemini-flash-latest'
            // may resolve to 2.5 models server-side without '2.5' in the name.
            thinking_config: { thinking_budget: 0 },
          },
        }),
      })

      if (response.status === 429) {
        // Rate limited - exponential backoff: 10s, 30s, 60s
        const waitTime = Math.min(10000 * Math.pow(3, attempt - 1), 60000)
        console.warn(`[Gemini] Rate limited (429), retry ${attempt}/${maxRetries} in ${waitTime / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }

      if (response.status === 503) {
        // Service unavailable - wait and retry
        const waitTime = attempt * 5000
        console.warn(`[Gemini] Service unavailable (503), retry ${attempt}/${maxRetries} in ${waitTime / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Gemini] API error:', response.status, errorText)
        throw new Error(`Gemini API error: ${response.status} ${errorText}`)
      }

      const data = await response.json() as GeminiResponse

      if (data.error) {
        throw new Error(`Gemini error: ${data.error.message}`)
      }

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No candidates in Gemini response')
      }

      // Skip thinking parts (thought=true) from 2.5 models, take last non-thought text
      const parts = data.candidates[0].content?.parts || []
      let content: string | undefined
      for (const p of parts as any[]) {
        if (!p.thought && p.text) {
          content = p.text
        }
      }
      if (!content) {
        throw new Error('No content in Gemini response')
      }

      return content
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error')
      if (attempt < maxRetries && (lastError.message.includes('429') || lastError.message.includes('503'))) {
        continue
      }
      console.error('[Gemini] API error:', lastError.message)
      throw lastError
    }
  }

  throw lastError || new Error('Gemini failed after retries')
}

/**
 * Generate JSON response using Gemini API
 */
export async function generateGeminiJSON<T>(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
): Promise<T> {
  const response = await generateGeminiCompletion(prompt, systemPrompt, {
    ...options,
    temperature: options?.temperature || 0.1, // Lower temperature for JSON
    responseMimeType: 'application/json',
  })

  // Clean response - remove markdown code blocks if present
  let cleanJson = response.trim()
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.slice(7)
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.slice(3)
  }
  if (cleanJson.endsWith('```')) {
    cleanJson = cleanJson.slice(0, -3)
  }
  cleanJson = cleanJson.trim()

  try {
    return JSON.parse(cleanJson) as T
  } catch (parseError) {
    console.error('[Gemini] Failed to parse JSON response:', cleanJson.substring(0, 200))
    throw new Error(`Failed to parse Gemini JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
  }
}
