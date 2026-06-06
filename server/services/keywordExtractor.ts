import { generateChatCompletion } from '../utils/ollama.js'
import { getDatabase } from '../database/db.js'
import { keywords } from '../database/schema.js'
import { eq } from 'drizzle-orm'

export interface Keyword {
  keyword: string
  relevance: number // 0-1
  category?: string // 'topic' | 'entity' | 'event' | 'general'
}

export interface KeywordExtractionResult {
  keywords: Keyword[]
  success: boolean
  error?: string
}

const VALID_CATEGORIES = ['topic', 'entity', 'event', 'general'] as const

/**
 * Normalize keyword category to one of the 4 standard types
 */
function normalizeKeywordCategory(category: string | undefined): string {
  if (!category) return 'general'
  const lower = category.toLowerCase().trim()
  if (VALID_CATEGORIES.includes(lower as any)) return lower

  const categoryMap: Record<string, string> = {
    'person': 'entity',
    'organization': 'entity',
    'location': 'entity',
    'region': 'entity',
    'group': 'entity',
    'company': 'entity',
    'concept': 'topic',
    'technology': 'topic',
    'healthcare': 'topic',
    'health': 'topic',
    'technical term': 'topic',
    'technical': 'topic',
    'theme': 'topic',
    'service': 'topic',
    'product': 'topic',
    'genre': 'topic',
    'activity': 'topic',
    'sport': 'topic',
    'weather': 'topic',
    'award': 'topic',
    'role': 'entity',
    'weather event': 'event',
  }

  return categoryMap[lower] || 'general'
}

/**
 * Build the prompt and config for keyword extraction (used by both real-time and batch)
 */
export function buildKeywordPrompt(title: string, content: string, maxKeywords: number = 10, language: string = 'en'): { prompt: string, options: { temperature: number, maxTokens: number, jsonMode: boolean } } {
  const languageNote = language !== 'en'
    ? `\nExtract keywords in the article's original language (${language}).`
    : ''

  const prompt = `Extract the most important keywords from this news article. Focus on topics, concepts, and themes (not just named entities).${languageNote}

Title: ${title}

Content: ${content.substring(0, 2500)}

Identify keywords that:
- Represent main topics and themes
- Are important for categorizing this article
- Help users discover related content
- Include technical terms, concepts, and key phrases

Respond with ONLY a JSON object in this exact format:
{
  "keywords": [
    {
      "keyword": "keyword or phrase",
      "relevance": <0.0 to 1.0, how important to the article>,
      "category": "topic|entity|event|general"
    }
  ]
}

Guidelines:
- Maximum ${maxKeywords} keywords
- Only include keywords with relevance >= 0.4
- Use 1-3 word phrases when appropriate (e.g., "artificial intelligence", "climate change")
- Relevance 1.0 = central to the article, 0.5 = important context, 0.4 = relevant mention
- Categories:
  - topic: broad subject (e.g., "technology", "politics", "healthcare")
  - entity: specific name (e.g., "Tesla", "Biden")
  - event: specific event (e.g., "election", "summit")
  - general: other important terms

Only return the JSON, nothing else.`

  return { prompt, options: { temperature: 0.2, maxTokens: 400, jsonMode: true } }
}

/**
 * Parse the raw LLM response text into structured keyword results
 */
export function parseKeywordResponse(responseText: string, maxKeywords: number = 10): KeywordExtractionResult {
  let result: any
  try {
    result = JSON.parse(responseText.trim())
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { keywords: [], success: false, error: 'Response does not contain JSON' }
    }
    try {
      result = JSON.parse(jsonMatch[0])
    } catch {
      return { keywords: [], success: false, error: 'Malformed JSON response' }
    }
  }

  const keywords: Keyword[] = (result.keywords || [])
    .filter((k: any) => k.keyword && k.relevance >= 0.4)
    .map((k: any) => ({
      keyword: k.keyword.toLowerCase().trim(),
      relevance: Math.max(0, Math.min(1, k.relevance || 0.5)),
      category: normalizeKeywordCategory(k.category),
    }))
    .slice(0, maxKeywords)

  return { keywords, success: true }
}

/**
 * Extract keywords from article using Ollama
 */
export async function extractKeywords(
  title: string,
  content: string,
  maxKeywords: number = 10,
  language: string = 'en'
): Promise<KeywordExtractionResult> {
  try {
    const { prompt, options } = buildKeywordPrompt(title, content, maxKeywords, language)

    const response = await generateChatCompletion(prompt, undefined, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      format: 'json',
    })

    const result = parseKeywordResponse(response, maxKeywords)
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse keyword response')
    }
    return result
  } catch (error) {
    console.error('Error extracting keywords with Ollama:', error)

    return {
      keywords: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Store keywords in database for an article
 */
export async function storeKeywords(articleId: number, extractedKeywords: Keyword[]): Promise<void> {
  const db = getDatabase()

  // Delete existing keywords for this article
  await db.delete(keywords).where(eq(keywords.articleId, articleId))

  // Insert new keywords
  if (extractedKeywords.length > 0) {
    await db.insert(keywords).values(
      extractedKeywords.map((k) => ({
        articleId,
        keyword: k.keyword,
        relevanceScore: k.relevance,
        category: k.category,
      }))
    )
  }
}

/**
 * Get keywords for an article
 */
export async function getArticleKeywords(articleId: number): Promise<Keyword[]> {
  const db = getDatabase()

  const results = await db
    .select({
      keyword: keywords.keyword,
      relevance: keywords.relevanceScore,
      category: keywords.category,
    })
    .from(keywords)
    .where(eq(keywords.articleId, articleId))

  return results.map((r) => ({
    keyword: r.keyword,
    relevance: r.relevance || 0.5,
    category: r.category || 'general',
  }))
}

/**
 * Get top keywords across all articles (trending topics)
 */
export async function getTrendingKeywords(limit: number = 20): Promise<Array<{ keyword: string; count: number; avgRelevance: number }>> {
  const db = getDatabase()

  const results = await db
    .select({
      keyword: keywords.keyword,
    })
    .from(keywords)

  // Count occurrences and calculate average relevance
  const keywordMap = new Map<string, { count: number; totalRelevance: number }>()

  for (const row of results) {
    const existing = keywordMap.get(row.keyword) || { count: 0, totalRelevance: 0 }
    keywordMap.set(row.keyword, {
      count: existing.count + 1,
      totalRelevance: existing.totalRelevance,
    })
  }

  // Convert to array and sort by count
  const trending = Array.from(keywordMap.entries())
    .map(([keyword, stats]) => ({
      keyword,
      count: stats.count,
      avgRelevance: stats.totalRelevance / stats.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  return trending
}
