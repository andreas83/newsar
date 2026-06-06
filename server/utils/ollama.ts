import { Ollama } from 'ollama'
import { isGeminiAvailable, generateGeminiCompletion, generateGeminiJSON } from './gemini'
import { isOpenRouterAvailable, generateOpenRouterCompletion, generateOpenRouterJSON } from './openrouter'

let primaryClient: Ollama | null = null
let fallbackClient: Ollama | null = null
let currentPrimaryUrl: string | null = null

interface OllamaConfig {
  primary: {
    url: string
    chatModel: string
    embedModel: string
  }
  fallback: {
    url: string
    chatModel: string
    embedModel: string
  }
  timeout: number
}

/**
 * Get the current primary Ollama URL
 * Checks RunPod manager first (if enabled), otherwise uses env var
 */
function getPrimaryUrl(): string {
  // Check if RunPod is enabled
  const runpodEnabled = process.env.RUNPOD_ENABLED === 'true'

  if (runpodEnabled) {
    try {
      // Use global singleton if available (set by worker)
      // @ts-ignore - accessing global
      const getManager = global._getRunPodManager
      if (getManager) {
        const manager = getManager()
        if (manager && manager.isEnabled()) {
          const podUrl = manager.getPodUrl()
          if (podUrl) {
            // Pod is running and ready, use its URL
            return podUrl
          }
          // Pod not ready yet, fall through to static URL
        }
      }
    } catch (error) {
      // RunPod manager not initialized or error, use static URL
      // This is normal during startup before manager is initialized
    }
  }

  // Default to environment variable
  return process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
}

function getConfig(): OllamaConfig {
  return {
    primary: {
      url: getPrimaryUrl(),
      chatModel: process.env.OLLAMA_CHAT_MODEL || 'llama3',
      embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    },
    fallback: {
      url: process.env.OLLAMA_FALLBACK_URL || 'http://localhost:11434',
      chatModel: process.env.OLLAMA_FALLBACK_CHAT_MODEL || 'llama3.2:3b',
      embedModel: process.env.OLLAMA_FALLBACK_EMBED_MODEL || 'nomic-embed-text',
    },
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '30000', 10),
  }
}

function getPrimaryClient(): Ollama {
  const config = getConfig()
  const newUrl = config.primary.url

  // Reset client if URL changed (pod lifecycle)
  if (currentPrimaryUrl !== newUrl) {
    console.log(`[Ollama] Primary URL changed: ${currentPrimaryUrl || 'none'} → ${newUrl}`)
    primaryClient = null
    currentPrimaryUrl = newUrl
  }

  if (!primaryClient) {
    primaryClient = new Ollama({ host: newUrl })
  }
  return primaryClient
}

function getFallbackClient(): Ollama {
  if (!fallbackClient) {
    const config = getConfig()
    fallbackClient = new Ollama({ host: config.fallback.url })
  }
  return fallbackClient
}

/**
 * @deprecated Use getPrimaryClient() or getFallbackClient() instead
 */
export function getOllamaClient(): Ollama {
  return getPrimaryClient()
}

/**
 * Execute an Ollama operation with automatic fallback
 */
async function withFallback<T>(
  operation: (client: Ollama, config: OllamaConfig) => Promise<T>,
  operationName: string
): Promise<T> {
  const config = getConfig()

  // Try primary first
  try {
    console.log(`[Ollama] Trying primary instance for ${operationName}...`)
    const result = await Promise.race([
      operation(getPrimaryClient(), config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Primary timeout')), config.timeout)
      )
    ])
    console.log(`[Ollama] ✓ Primary instance succeeded for ${operationName}`)
    return result
  } catch (primaryError) {
    console.warn(`[Ollama] ✗ Primary instance failed for ${operationName}:`, primaryError instanceof Error ? primaryError.message : 'Unknown error')

    // Try fallback
    try {
      console.log(`[Ollama] Trying fallback instance for ${operationName}...`)
      const result = await Promise.race([
        operation(getFallbackClient(), config),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Fallback timeout')), config.timeout)
        )
      ])
      console.log(`[Ollama] ✓ Fallback instance succeeded for ${operationName}`)
      return result
    } catch (fallbackError) {
      console.error(`[Ollama] ✗ Fallback instance failed for ${operationName}:`, fallbackError instanceof Error ? fallbackError.message : 'Unknown error')
      throw new Error(`Both Ollama instances failed. Primary: ${primaryError instanceof Error ? primaryError.message : 'Unknown'}; Fallback: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown'}`)
    }
  }
}

/**
 * Generate embeddings for text using nomic-embed-text model with fallback
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return withFallback(
    async (client, config) => {
      const isPrimary = client === getPrimaryClient()
      const model = isPrimary ? config.primary.embedModel : config.fallback.embedModel

      const response = await client.embeddings({
        model,
        prompt: text,
        options: {
          num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || '4', 10),
        },
      })

      return response.embedding
    },
    'embedding generation'
  )
}

/**
 * Generate chat completion using OpenRouter (primary), Gemini (secondary), or Ollama (fallback)
 */
export async function generateChatCompletion(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
    format?: string
  }
): Promise<string> {
  // Check force flags
  const forceOllama = process.env.FORCE_OLLAMA === 'true'
  const forceGemini = process.env.FORCE_GEMINI === 'true'

  const wantJson = options?.format === 'json'
  const geminiOpts = {
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    ...(wantJson && { responseMimeType: 'application/json' }),
  }

  // If forcing Gemini, try it first
  if (forceGemini && isGeminiAvailable()) {
    try {
      console.log('[LLM] Using Gemini API for chat completion (forced)...')
      const result = await generateGeminiCompletion(prompt, systemPrompt, geminiOpts)
      console.log('[LLM] ✓ Gemini API succeeded')
      return result
    } catch (geminiError) {
      console.warn('[LLM] ✗ Gemini API failed:', geminiError instanceof Error ? geminiError.message : 'Unknown error')
      console.log('[LLM] Falling back to other providers...')
    }
  }

  // Try OpenRouter first if available and not forcing Ollama
  if (isOpenRouterAvailable() && !forceOllama) {
    try {
      console.log('[LLM] Using OpenRouter API for chat completion...')
      const result = await generateOpenRouterCompletion(prompt, systemPrompt, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      })
      console.log('[LLM] ✓ OpenRouter API succeeded')
      return result
    } catch (openRouterError) {
      console.warn('[LLM] ✗ OpenRouter API failed:', openRouterError instanceof Error ? openRouterError.message : 'Unknown error')
      console.log('[LLM] Falling back to Gemini...')
    }
  }

  // Try Gemini as secondary fallback (if not already forced and tried)
  if (isGeminiAvailable() && !forceOllama && !forceGemini) {
    try {
      console.log('[LLM] Using Gemini API for chat completion...')
      const result = await generateGeminiCompletion(prompt, systemPrompt, geminiOpts)
      console.log('[LLM] ✓ Gemini API succeeded')
      return result
    } catch (geminiError) {
      console.warn('[LLM] ✗ Gemini API failed:', geminiError instanceof Error ? geminiError.message : 'Unknown error')
      console.log('[LLM] Falling back to Ollama...')
    }
  }

  // Fall back to Ollama
  return withFallback(
    async (client, config) => {
      const isPrimary = client === getPrimaryClient()
      const defaultModel = isPrimary ? config.primary.chatModel : config.fallback.chatModel
      const model = options?.model || defaultModel

      const messages = []

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

      const response = await client.chat({
        model,
        messages,
        format: options?.format, // Support JSON mode
        options: {
          temperature: options?.temperature || 0.7,
          num_predict: options?.maxTokens || 1000,
          num_thread: parseInt(process.env.OLLAMA_NUM_THREAD || '4', 10),
          num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || '2048', 10),
        },
      })

      return response.message.content
    },
    'chat completion'
  )
}

/**
 * Check if a specific model is available (checks both primary and fallback)
 */
export async function isModelAvailable(modelName: string): Promise<boolean> {
  // Try primary first
  try {
    const models = await getPrimaryClient().list()
    const available = models.models.some(m => m.name.includes(modelName))
    if (available) {
      console.log(`[Ollama] Model ${modelName} found on primary instance`)
      return true
    }
  } catch (error) {
    console.warn('[Ollama] Could not check primary instance for model availability')
  }

  // Try fallback
  try {
    const models = await getFallbackClient().list()
    const available = models.models.some(m => m.name.includes(modelName))
    if (available) {
      console.log(`[Ollama] Model ${modelName} found on fallback instance`)
      return true
    }
  } catch (error) {
    console.warn('[Ollama] Could not check fallback instance for model availability')
  }

  console.log(`[Ollama] Model ${modelName} not found on any instance`)
  return false
}

/**
 * Generate JSON response using the best available LLM provider
 * Follows the same fallback chain as generateChatCompletion
 */
export async function generateJSON<T>(
  prompt: string,
  systemPrompt?: string,
  options?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
): Promise<T> {
  // Check force flags
  const forceOllama = process.env.FORCE_OLLAMA === 'true'
  const forceGemini = process.env.FORCE_GEMINI === 'true'

  // If forcing Gemini, try it first
  if (forceGemini && isGeminiAvailable()) {
    try {
      console.log('[LLM] Using Gemini API for JSON generation (forced)...')
      const result = await generateGeminiJSON<T>(prompt, systemPrompt, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      })
      console.log('[LLM] ✓ Gemini API succeeded')
      return result
    } catch (geminiError) {
      console.warn('[LLM] ✗ Gemini API failed:', geminiError instanceof Error ? geminiError.message : 'Unknown error')
      console.log('[LLM] Falling back to other providers...')
    }
  }

  // Try OpenRouter first if available and not forcing Ollama
  if (isOpenRouterAvailable() && !forceOllama) {
    try {
      console.log('[LLM] Using OpenRouter API for JSON generation...')
      const result = await generateOpenRouterJSON<T>(prompt, systemPrompt, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      })
      console.log('[LLM] ✓ OpenRouter API succeeded')
      return result
    } catch (openRouterError) {
      console.warn('[LLM] ✗ OpenRouter API failed:', openRouterError instanceof Error ? openRouterError.message : 'Unknown error')
      console.log('[LLM] Falling back to Gemini...')
    }
  }

  // Try Gemini as secondary fallback (if not already forced and tried)
  if (isGeminiAvailable() && !forceOllama && !forceGemini) {
    try {
      console.log('[LLM] Using Gemini API for JSON generation...')
      const result = await generateGeminiJSON<T>(prompt, systemPrompt, {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      })
      console.log('[LLM] ✓ Gemini API succeeded')
      return result
    } catch (geminiError) {
      console.warn('[LLM] ✗ Gemini API failed:', geminiError instanceof Error ? geminiError.message : 'Unknown error')
      console.log('[LLM] Falling back to Ollama...')
    }
  }

  // Fall back to Ollama with JSON format
  const response = await generateChatCompletion(prompt, systemPrompt, {
    ...options,
    format: 'json',
    temperature: options?.temperature || 0.1, // Lower temperature for JSON
  })

  // Parse JSON response
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
    console.error('[Ollama] Failed to parse JSON response:', cleanJson.substring(0, 200))
    throw new Error(`Failed to parse Ollama JSON response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
  }
}
