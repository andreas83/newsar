import { generateChatCompletion } from '../utils/ollama.js'

export interface SummaryResult {
  summary: string
  success: boolean
  wordCount?: number
  error?: string
}

/**
 * Build the prompt and config for summary generation (used by both real-time and batch)
 * Note: Summary uses plain text output, not JSON mode.
 */
export function buildSummaryPrompt(title: string, content: string, targetLength: 'short' | 'medium' | 'long' = 'medium', language: string = 'en', description?: string): { prompt: string, options: { temperature: number, maxTokens: number, jsonMode: false } } {
  const lengthConfig = {
    short: { words: '50-80', sentences: '2-3' },
    medium: { words: '100-150', sentences: '4-6' },
    long: { words: '200-300', sentences: '8-12' },
  }

  const config = lengthConfig[targetLength]

  const languageInstruction = language !== 'en'
    ? `Write the summary in the same language as the article (${language}).`
    : ''

  const descriptionSection = description ? `\nDescription: ${description}\n` : ''

  const prompt = `Write a concise, informative summary of this news article.

Title: ${title}
${descriptionSection}
Content: ${content.substring(0, 5000)}

Write a summary that:
- Captures the main points and key facts
- Is ${config.words} words (${config.sentences} sentences)
- Uses clear, neutral language
- Focuses on the "who, what, when, where, why"
- Derives all facts strictly from the article content, not from the headline — headlines can be ambiguous
- Carefully attributes actions and decisions to the correct actors as stated in the article (e.g. do not confuse who made a decision with who is affected by it)
- Avoids opinion or interpretation
- Is written in third person
${languageInstruction}

Return ONLY the summary text, no additional formatting or labels.`

  return { prompt, options: { temperature: 0.3, maxTokens: 500, jsonMode: false as const } }
}

/**
 * Parse the raw LLM response text into a summary result
 */
export function parseSummaryResponse(responseText: string): SummaryResult {
  const summary = responseText.trim()
  if (!summary) {
    return { summary: '', success: false, error: 'Empty response' }
  }
  const wordCount = summary.split(/\s+/).length
  return { summary, wordCount, success: true }
}

/**
 * Generate a concise summary of an article using Ollama
 */
export async function generateSummary(
  title: string,
  content: string,
  targetLength: 'short' | 'medium' | 'long' = 'medium',
  language: string = 'en',
  description?: string
): Promise<SummaryResult> {
  try {
    const { prompt, options } = buildSummaryPrompt(title, content, targetLength, language, description)

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    })

    return parseSummaryResponse(response)
  } catch (error) {
    console.error('Error generating summary with Ollama:', error)

    return {
      summary: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Generate a comparative summary for grouped articles (story summary)
 */
export async function generateStorySummary(
  articles: Array<{ title: string; content: string; source?: string }>
): Promise<SummaryResult> {
  try {
    if (articles.length === 0) {
      throw new Error('No articles provided for story summary')
    }

    // Build articles text (limit each to 1000 chars)
    const articlesText = articles
      .slice(0, 5) // Max 5 articles for context
      .map((a, idx) => {
        const source = a.source ? ` (${a.source})` : ''
        return `Article ${idx + 1}${source}:
Title: ${a.title}
Content: ${a.content.substring(0, 1000)}...
`
      })
      .join('\n---\n\n')

    const prompt = `These articles cover the same news story from different sources. Write a comprehensive summary that synthesizes the key information.

${articlesText}

Write a summary that:
- Combines information from all sources
- Highlights different perspectives or additional details from each source
- Is 150-200 words
- Presents a complete picture of the story
- Uses neutral, factual language
- Notes any conflicting information if present

Return ONLY the summary text, no additional formatting or labels.`

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: 0.4,
      maxTokens: 500,
    })

    const summary = response.trim()
    const wordCount = summary.split(/\s+/).length

    return {
      summary,
      wordCount,
      success: true,
    }
  } catch (error) {
    console.error('Error generating story summary with Ollama:', error)

    return {
      summary: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Generate headline-style summary (very short)
 */
export async function generateHeadline(content: string): Promise<SummaryResult> {
  try {
    const prompt = `Based on this article content, write a single-sentence headline that captures the main news:

${content.substring(0, 2000)}

Requirements:
- One sentence only
- 10-15 words maximum
- Active voice
- Factual and neutral
- No clickbait

Return ONLY the headline text.`

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: 0.3,
      maxTokens: 50,
    })

    const summary = response.trim()
    const wordCount = summary.split(/\s+/).length

    return {
      summary,
      wordCount,
      success: true,
    }
  } catch (error) {
    console.error('Error generating headline with Ollama:', error)

    return {
      summary: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
