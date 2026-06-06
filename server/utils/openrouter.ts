/**
 * OpenRouter API client for LLM completions
 * Uses free models like meta-llama/llama-3.1-405b-instruct:free
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Rate limiting: 10 requests per minute for free tier (conservative)
const RATE_LIMIT_MAX = 10
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
    console.log(`[OpenRouter] Rate limit reached (${RATE_LIMIT_MAX}/min), waiting ${Math.ceil(waitTime / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
    // Recursively check again after waiting
    return waitForRateLimit()
  }

  // Record this request
  requestTimestamps.push(now)
}

/**
 * Check if OpenRouter API is available
 */
export function isOpenRouterAvailable(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}

/**
 * Get the default model to use
 */
function getDefaultModel(): string {
  return process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-405b-instruct:free'
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenRouterResponse {
  id: string
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  error?: {
    message: string
    code: string
  }
}

/**
 * Generate chat completion using OpenRouter API
 */
export async function generateOpenRouterCompletion(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error('OpenRouter API key not configured')
  }

  // Wait for rate limit
  await waitForRateLimit()

  const model = options?.model || getDefaultModel()
  const maxTokens = options?.maxTokens || 2000
  const temperature = options?.temperature || 0.3

  const messages: OpenRouterMessage[] = []

  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt,
    })
  }

  messages.push({
    role: 'user',
    content: prompt,
  })

  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://newsar.codejungle.org',
          'X-Title': 'Newsar News Aggregator',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
      })

      if (response.status === 429) {
        // Rate limited - wait and retry
        const waitTime = attempt * 2000 // 2s, 4s, 6s
        console.warn(`[OpenRouter] Rate limited (429), retry ${attempt}/${maxRetries} in ${waitTime/1000}s...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
        continue
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[OpenRouter] API error:', response.status, errorText)
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`)
      }

      const data = await response.json() as OpenRouterResponse

      if (data.error) {
        throw new Error(`OpenRouter error: ${data.error.message}`)
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No choices in OpenRouter response')
      }

      const content = data.choices[0].message.content
      if (!content) {
        throw new Error('No content in OpenRouter response')
      }

      return content
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error')
      if (attempt < maxRetries && lastError.message.includes('429')) {
        continue
      }
      console.error('[OpenRouter] API error:', lastError.message)
      throw lastError
    }
  }

  throw lastError || new Error('OpenRouter failed after retries')
}

/**
 * Generate JSON response using OpenRouter API
 */
export async function generateOpenRouterJSON<T>(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
): Promise<T> {
  const jsonSystemPrompt = (systemPrompt || '') + '\n\nYou must respond with valid JSON only. No markdown, no code blocks, just the raw JSON object.'

  const response = await generateOpenRouterCompletion(prompt, jsonSystemPrompt, {
    ...options,
    temperature: options?.temperature || 0.1, // Lower temperature for JSON
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
    console.error('[OpenRouter] Failed to parse JSON response:', cleanJson.substring(0, 200))
    throw new Error(`Failed to parse OpenRouter JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
  }
}
