import Anthropic from '@anthropic-ai/sdk'
import { groundSystemPrompt } from './llmGrounding'

export type LlmLayer = 'classification' | 'summary'

let claudeClient: Anthropic | null = null

// Client-side rate limit (the SDK also retries 429s)
const RATE_LIMIT_MAX = parseInt(process.env.CLAUDE_RATE_LIMIT_PER_MIN || '50', 10)
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

/** Model for a pipeline layer: CLAUDE_MODEL for classification, CLAUDE_SUMMARY_MODEL for summaries */
export function getClaudeModel(layer: LlmLayer = 'classification'): string {
  const base = process.env.CLAUDE_MODEL || 'claude-haiku-5-5'
  return layer === 'summary' ? (process.env.CLAUDE_SUMMARY_MODEL || base) : base
}

/**
 * Thinking off, matching the Gemini setup (thinking tokens bill as output).
 * Sonnet 5.5 rejects `disabled`; `between_tools` is off when no tools are sent.
 * Opus 5.5 can't turn thinking off, so leave it at the default.
 */
function thinkingOff(model: string): Anthropic.ThinkingConfigParam | undefined {
  // between_tools is newer than the installed SDK's types
  if (model.startsWith('claude-sonnet-5-5')) return { type: 'between_tools' } as unknown as Anthropic.ThinkingConfigParam
  if (model.startsWith('claude-opus-5-5') || model.startsWith('claude-fable')) return undefined
  return { type: 'disabled' }
}

function stripJsonFences(text: string): string {
  let out = text.trim()
  if (out.startsWith('```json')) out = out.slice(7)
  else if (out.startsWith('```')) out = out.slice(3)
  if (out.endsWith('```')) out = out.slice(0, -3)
  return out.trim()
}

/**
 * Generate chat completion using Claude API.
 * No temperature: the Messages API rejects sampling parameters since 2026-10-21.
 */
export async function generateClaudeCompletion(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    maxTokens?: number
    jsonMode?: boolean
  }
): Promise<string> {
  const client = getClaudeClient()

  if (!client) {
    throw new Error('Claude API key not configured')
  }

  // Wait for rate limit
  await waitForRateLimit()

  const model = options?.model || getClaudeModel()
  const maxTokens = options?.maxTokens || 2000
  const thinking = thinkingOff(model)
  const system = groundSystemPrompt(systemPrompt || 'You are a helpful assistant that analyzes news articles.')
    + (options?.jsonMode ? '\n\nRespond with valid JSON only. No markdown, no code blocks, just the raw JSON object.' : '')

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(thinking && { thinking }),
      system,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    // Throw so the router falls back to the next provider
    if (response.stop_reason === 'refusal') {
      throw new Error('Claude declined the request (refusal)')
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(`Claude response truncated at max_tokens=${maxTokens}`)
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (!text) {
      throw new Error('No text content in Claude response')
    }

    return options?.jsonMode ? stripJsonFences(text) : text
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
    maxTokens?: number
  }
): Promise<T> {
  const cleanJson = await generateClaudeCompletion(prompt, systemPrompt, { ...options, jsonMode: true })

  try {
    return JSON.parse(cleanJson) as T
  } catch (parseError) {
    console.error('[Claude] Failed to parse JSON response:', cleanJson.substring(0, 200))
    throw new Error(`Failed to parse Claude JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
  }
}
