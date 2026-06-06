import Anthropic from '@anthropic-ai/sdk'

let claudeClient: Anthropic | null = null

// Rate limiting: 5 requests per minute
const RATE_LIMIT_MAX = 5
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
    console.log(`[Claude] Rate limit reached (${RATE_LIMIT_MAX}/min), waiting ${Math.ceil(waitTime / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitTime))
    // Recursively check again after waiting
    return waitForRateLimit()
  }

  // Record this request
  requestTimestamps.push(now)
}

/**
 * Get or create Claude client singleton
 */
function getClaudeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return null
  }

  if (!claudeClient) {
    claudeClient = new Anthropic({ apiKey })
  }

  return claudeClient
}

/**
 * Check if Claude API is available
 */
export function isClaudeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/**
 * Generate chat completion using Claude API
 */
export async function generateClaudeCompletion(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
): Promise<string> {
  const client = getClaudeClient()

  if (!client) {
    throw new Error('Claude API key not configured')
  }

  // Wait for rate limit
  await waitForRateLimit()

  const model = options?.model || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022'
  const maxTokens = options?.maxTokens || 2000
  const temperature = options?.temperature || 0.3

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt || 'You are a helpful assistant that analyzes news articles.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    // Extract text from response
    const textContent = response.content.find(block => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response')
    }

    return textContent.text
  } catch (error) {
    console.error('[Claude] API error:', error instanceof Error ? error.message : 'Unknown error')
    throw error
  }
}

/**
 * Generate JSON response using Claude API
 */
export async function generateClaudeJSON<T>(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
): Promise<T> {
  const jsonSystemPrompt = (systemPrompt || '') + '\n\nYou must respond with valid JSON only. No markdown, no code blocks, just the raw JSON object.'

  const response = await generateClaudeCompletion(prompt, jsonSystemPrompt, {
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
    console.error('[Claude] Failed to parse JSON response:', cleanJson.substring(0, 200))
    throw new Error(`Failed to parse Claude JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
  }
}
