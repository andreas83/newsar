import { generateChatCompletion } from '../utils/ollama.js'
import { getDatabase } from '../database/db.js'
import { classifications, articleClaims } from '../database/schema.js'
import { eq } from 'drizzle-orm'

export const VALID_FRAMINGS = [
  'economic_impact',
  'human_rights',
  'national_security',
  'public_health',
  'environmental',
  'political_strategy',
  'human_interest',
  'legal_judicial',
  'technology',
  'conflict',
  'diplomatic',
  'social_justice',
] as const

export type Framing = typeof VALID_FRAMINGS[number]

export const VALID_ARTICLE_TYPES = [
  'news_report',
  'opinion',
  'analysis',
  'editorial',
  'press_release',
] as const

export type ArticleType = typeof VALID_ARTICLE_TYPES[number]

export const VALID_CLAIM_TYPES = [
  'factual',
  'quote',
  'statistic',
  'prediction',
] as const

export type ClaimType = typeof VALID_CLAIM_TYPES[number]

export interface ExtractedClaim {
  text: string
  attribution: string | null
  type: ClaimType
  confidence: number
}

export interface FeatureExtractionResult {
  primaryFraming: Framing
  secondaryFraming: Framing | null
  articleType: ArticleType
  sensationalism: number
  factOpinionRatio: number
  sourceCountCited: number
  claims: ExtractedClaim[]
  success: boolean
  error?: string
}

/**
 * Build the prompt and config for feature extraction (used by both real-time and batch)
 */
export function buildFeaturePrompt(title: string, content: string, language: string = 'en'): { prompt: string, systemPrompt: string, options: { temperature: number, maxTokens: number, jsonMode: boolean } } {
  const systemPrompt = `You are an expert media analyst specializing in framing analysis, factuality assessment, and claim extraction. Respond only with valid JSON.`

  const prompt = `Analyze this news article for framing, factuality, sensationalism, and extract key claims.

Title: ${title}

Content: ${content.substring(0, 3000)}

Language: ${language}

Respond with ONLY this JSON structure:
{
  "framing": {
    "primary": "<one of: economic_impact, human_rights, national_security, public_health, environmental, political_strategy, human_interest, legal_judicial, technology, conflict, diplomatic, social_justice>",
    "secondary": "<same options or null if not applicable>"
  },
  "article_type": "<one of: news_report, opinion, analysis, editorial, press_release>",
  "factuality": {
    "fact_opinion_ratio": <0.0 to 1.0, where 1.0 = all facts, 0.0 = all opinion>,
    "sources_cited": <integer count of named sources/experts quoted>,
    "hedging_present": <boolean, true if lots of qualifying language>
  },
  "sensationalism": <0.0 to 1.0, where 0.0 = measured/neutral, 1.0 = highly sensational>,
  "claims": [
    {
      "text": "<verifiable claim statement, max 200 chars>",
      "attribution": "<who made the claim, or null if article's own claim>",
      "type": "<factual|quote|statistic|prediction>",
      "confidence": <0.0 to 1.0, how confident the claim is stated>
    }
  ]
}

Guidelines:
- Extract 3-5 of the most important verifiable claims
- Framing = the dominant angle/lens through which the story is told
- Sensationalism considers: emotional language, exaggeration, clickbait patterns, loaded terms
- Fact/opinion ratio considers: cited data, expert quotes, vs subjective statements, editorializing
- Only return JSON, no other text`

  return { prompt, systemPrompt, options: { temperature: 0, maxTokens: 1500, jsonMode: true } }
}

/**
 * Parse the raw LLM response text into structured feature extraction results
 */
export function parseFeatureResponse(responseText: string): FeatureExtractionResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      primaryFraming: 'human_interest', secondaryFraming: null, articleType: 'news_report',
      sensationalism: 0.5, factOpinionRatio: 0.5, sourceCountCited: 0, claims: [],
      success: false, error: 'Response does not contain JSON',
    }
  }

  let result: any
  try {
    result = JSON.parse(jsonMatch[0])
  } catch {
    return {
      primaryFraming: 'human_interest', secondaryFraming: null, articleType: 'news_report',
      sensationalism: 0.5, factOpinionRatio: 0.5, sourceCountCited: 0, claims: [],
      success: false, error: 'Malformed JSON response',
    }
  }

  const primaryFraming = validateFraming(result.framing?.primary) || 'human_interest'
  const secondaryFraming = validateFraming(result.framing?.secondary)
  const articleType = validateArticleType(result.article_type) || 'news_report'
  const sensationalism = clamp(result.sensationalism ?? 0.5, 0, 1)
  const factOpinionRatio = clamp(result.factuality?.fact_opinion_ratio ?? 0.5, 0, 1)
  const sourceCountCited = Math.max(0, Math.round(result.factuality?.sources_cited ?? 0))

  const claims: ExtractedClaim[] = (result.claims || [])
    .filter((c: any) => c.text && typeof c.text === 'string')
    .map((c: any) => ({
      text: c.text.substring(0, 500),
      attribution: c.attribution || null,
      type: validateClaimType(c.type) || 'factual',
      confidence: clamp(c.confidence ?? 0.5, 0, 1),
    }))
    .slice(0, 7)

  return { primaryFraming, secondaryFraming, articleType, sensationalism, factOpinionRatio, sourceCountCited, claims, success: true }
}

/**
 * Extract article features: framing, factuality, sensationalism, and claims
 */
export async function extractArticleFeatures(
  title: string,
  content: string,
  language: string = 'en'
): Promise<FeatureExtractionResult> {
  try {
    const { prompt, systemPrompt, options } = buildFeaturePrompt(title, content, language)

    const response = await generateChatCompletion(prompt, systemPrompt, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      format: 'json',
    })

    const result = parseFeatureResponse(response)
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse feature response')
    }
    return result
  } catch (error) {
    console.error('[FeatureExtractor] Error extracting features:', error)
    return {
      primaryFraming: 'human_interest',
      secondaryFraming: null,
      articleType: 'news_report',
      sensationalism: 0.5,
      factOpinionRatio: 0.5,
      sourceCountCited: 0,
      claims: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Store extracted features in the database
 * Updates the existing classification row and inserts claims
 */
export async function storeArticleFeatures(
  articleId: number,
  features: FeatureExtractionResult
): Promise<void> {
  const db = getDatabase()

  // Update classification with feature data
  await db
    .update(classifications)
    .set({
      primaryFraming: features.primaryFraming,
      secondaryFraming: features.secondaryFraming,
      articleType: features.articleType,
      sensationalism: features.sensationalism,
      factOpinionRatio: features.factOpinionRatio,
      sourceCountCited: features.sourceCountCited,
      featureExtractionDone: true,
      updatedAt: new Date(),
    })
    .where(eq(classifications.articleId, articleId))

  // Insert claims
  if (features.claims.length > 0) {
    await db.insert(articleClaims).values(
      features.claims.map(claim => ({
        articleId,
        claimText: claim.text,
        attribution: claim.attribution,
        claimType: claim.type,
        confidence: claim.confidence,
      }))
    )
  }
}

function validateFraming(value: any): Framing | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().trim()
  if (VALID_FRAMINGS.includes(normalized as Framing)) return normalized as Framing
  return null
}

function validateArticleType(value: any): ArticleType | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().trim()
  if (VALID_ARTICLE_TYPES.includes(normalized as ArticleType)) return normalized as ArticleType
  return null
}

function validateClaimType(value: any): ClaimType | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().trim()
  if (VALID_CLAIM_TYPES.includes(normalized as ClaimType)) return normalized as ClaimType
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
