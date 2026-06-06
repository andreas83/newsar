import { generateChatCompletion } from '../utils/ollama.js'

export interface SentimentResult {
  sentiment: number // -1 (very negative) to 1 (very positive), 0 = neutral
  confidence: number // 0 to 1
  tone: string // 'positive', 'negative', 'neutral', 'mixed'
  emotions?: string[] // ['hopeful', 'concerned', 'angry', etc.]
  reasoning?: string
  success: boolean
  error?: string
}

/**
 * Build the prompt and config for sentiment analysis (used by both real-time and batch)
 */
export function buildSentimentPrompt(title: string, content: string, language: string = 'en'): { prompt: string, options: { temperature: number, maxTokens: number, jsonMode: boolean } } {
  const languageNote = language !== 'en'
    ? `\nNote: This article is written in ${language}. Analyze the sentiment based on the original language context.`
    : ''

  const prompt = `Analyze the sentiment and emotional tone of this news article.${languageNote}

Title: ${title}

Content: ${content.substring(0, 2500)}

Analyze:
1. Overall sentiment: How positive or negative is the article's tone?
2. Emotional tone: What emotions does the article convey?
3. Consider: word choice, framing, emphasis, and perspective

Respond with ONLY a JSON object in this exact format:
{
  "sentiment": <number between -1.0 and 1.0, where -1.0 is very negative, 0 is neutral, 1.0 is very positive>,
  "confidence": <number between 0 and 1>,
  "tone": "positive|negative|neutral|mixed",
  "emotions": ["emotion1", "emotion2", ...],
  "reasoning": "<brief explanation in 1-2 sentences>"
}

Guidelines:
- sentiment scale:
  * -1.0 to -0.6: Very negative (tragedy, disaster, outrage)
  * -0.5 to -0.2: Negative (problems, concerns, criticism)
  * -0.1 to 0.1: Neutral (factual reporting)
  * 0.2 to 0.5: Positive (progress, solutions, good news)
  * 0.6 to 1.0: Very positive (celebration, major breakthrough)
- emotions: up to 3 primary emotions (e.g., "hopeful", "concerned", "angry", "optimistic", "fearful", "excited")
- tone: "mixed" if article has both positive and negative elements
- confidence: based on clarity of sentiment signals

Only return the JSON, nothing else.`

  return { prompt, options: { temperature: 0.3, maxTokens: 250, jsonMode: true } }
}

/**
 * Parse the raw LLM response text into structured sentiment results
 */
export function parseSentimentResponse(responseText: string): SentimentResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { sentiment: 0, confidence: 0, tone: 'neutral', success: false, error: 'Response does not contain JSON' }
  }

  let result: any
  try {
    result = JSON.parse(jsonMatch[0])
  } catch {
    return { sentiment: 0, confidence: 0, tone: 'neutral', success: false, error: 'Malformed JSON response' }
  }

  const sentiment = Math.max(-1, Math.min(1, result.sentiment || 0))
  const confidence = Math.max(0, Math.min(1, result.confidence || 0.5))

  return {
    sentiment,
    confidence,
    tone: result.tone || 'neutral',
    emotions: result.emotions || [],
    reasoning: result.reasoning || 'No reasoning provided',
    success: true,
  }
}

/**
 * Analyze sentiment and tone of an article using Ollama
 */
export async function analyzeSentiment(
  title: string,
  content: string,
  language: string = 'en'
): Promise<SentimentResult> {
  try {
    const { prompt, options } = buildSentimentPrompt(title, content, language)

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      format: 'json',
    })

    const result = parseSentimentResponse(response)
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse sentiment response')
    }
    return result
  } catch (error) {
    console.error('Error analyzing sentiment with Ollama:', error)

    return {
      sentiment: 0,
      confidence: 0,
      tone: 'neutral',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get sentiment label for display
 */
export function getSentimentLabel(sentiment: number): string {
  if (sentiment <= -0.6) return 'Very Negative'
  if (sentiment <= -0.2) return 'Negative'
  if (sentiment < 0.2) return 'Neutral'
  if (sentiment < 0.6) return 'Positive'
  return 'Very Positive'
}

/**
 * Get sentiment color for visualization
 */
export function getSentimentColor(sentiment: number): string {
  if (sentiment <= -0.6) return '#DC2626' // Red
  if (sentiment <= -0.2) return '#F97316' // Orange
  if (sentiment < 0.2) return '#6B7280' // Gray
  if (sentiment < 0.6) return '#10B981' // Green
  return '#059669' // Dark Green
}

/**
 * Get sentiment emoji
 */
export function getSentimentEmoji(sentiment: number): string {
  if (sentiment <= -0.6) return '😢'
  if (sentiment <= -0.2) return '😟'
  if (sentiment < 0.2) return '😐'
  if (sentiment < 0.6) return '🙂'
  return '😄'
}

/**
 * Analyze comparative sentiment across multiple articles about same story
 */
export async function compareStorySentiment(
  articles: Array<{ title: string; content: string; source?: string }>
): Promise<{
  overall: SentimentResult
  articles: Array<{ source?: string; sentiment: number; tone: string }>
}> {
  try {
    // Analyze each article individually
    const articleResults = await Promise.all(
      articles.map(async (article) => {
        const result = await analyzeSentiment(article.title, article.content)
        return {
          source: article.source,
          sentiment: result.sentiment,
          tone: result.tone,
        }
      })
    )

    // Calculate overall sentiment
    const avgSentiment = articleResults.reduce((sum, r) => sum + r.sentiment, 0) / articleResults.length
    const sentimentVariance = articleResults.reduce((sum, r) => sum + Math.pow(r.sentiment - avgSentiment, 2), 0) / articleResults.length

    // Determine overall tone
    let overallTone = 'neutral'
    if (sentimentVariance > 0.15) {
      overallTone = 'mixed' // High variance = mixed coverage
    } else if (avgSentiment > 0.2) {
      overallTone = 'positive'
    } else if (avgSentiment < -0.2) {
      overallTone = 'negative'
    }

    return {
      overall: {
        sentiment: avgSentiment,
        confidence: 1 - Math.min(sentimentVariance, 1), // Lower variance = higher confidence
        tone: overallTone,
        reasoning: `Average sentiment across ${articles.length} sources`,
        success: true,
      },
      articles: articleResults,
    }
  } catch (error) {
    console.error('Error comparing story sentiment:', error)
    throw error
  }
}
