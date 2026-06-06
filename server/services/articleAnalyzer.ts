import { getDatabase } from '../database/db.js'
import { articles, analyses, classifications } from '../database/schema.js'
import { eq, desc, sql } from 'drizzle-orm'
import { extractKeywords, storeKeywords } from './keywordExtractor.js'
import { generateSummary } from './summaryGenerator.js'
import { analyzeSentiment, getSentimentLabel } from './sentimentAnalyzer.js'

export interface AnalysisResult {
  success: boolean
  articleId: number
  keywordCount?: number
  summaryLength?: number
  sentiment?: number
  sentimentLabel?: string
  error?: string
}

/**
 * Perform comprehensive analysis on an article
 * (keywords, summary, sentiment)
 */
export async function analyzeArticle(
  articleId: number,
  useOllama: boolean = true
): Promise<AnalysisResult> {
  const db = getDatabase()

  try {
    // 1. Get article
    const [article] = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!article) {
      throw new Error(`Article ${articleId} not found`)
    }

    const textToAnalyze = article.fullContent || article.content || ''

    if (textToAnalyze.length < 100) {
      throw new Error('Article content too short for analysis')
    }

    // Look up article's classified language
    const [classification] = await db
      .select({ language: classifications.language })
      .from(classifications)
      .where(eq(classifications.articleId, articleId))
      .limit(1)
    const articleLanguage = classification?.language || 'en'

    console.log(`Analyzing article ${articleId}: ${article.title.substring(0, 50)}... [${articleLanguage}]`)

    let keywordCount = 0
    let summaryText = ''
    let summaryLength = 0
    let sentiment = 0
    let sentimentConfidence = 0
    let sentimentTone = 'neutral'
    let emotions: string[] = []

    if (useOllama) {
      // Check feature flags for transformer models
      const useTransformersForSentiment = process.env.USE_TRANSFORMERS_FOR_SENTIMENT === 'true'
      const useTransformersForKeywords = process.env.USE_TRANSFORMERS_FOR_KEYWORDS === 'true'
      const useTransformersForSummary = process.env.USE_TRANSFORMERS_FOR_SUMMARY === 'true'

      // Run all analyses in parallel for faster processing
      console.log(`  Running parallel analysis (keywords, summary, sentiment)...`)

      // Prepare analysis tasks based on feature flags
      const tasks = []

      // Keywords - use transformer or Ollama
      if (useTransformersForKeywords) {
        const { extractKeywordsWithTransformer } = await import('./keywordTransformer.js')
        tasks.push(extractKeywordsWithTransformer(article.title, textToAnalyze, 10))
      } else {
        tasks.push(extractKeywords(article.title, textToAnalyze, 10, articleLanguage))
      }

      // Summary - use transformer or Ollama
      if (useTransformersForSummary) {
        const { generateSummaryWithTransformer } = await import('./summaryTransformer.js')
        tasks.push(generateSummaryWithTransformer(article.title, textToAnalyze, 'medium'))
      } else {
        const rssDescription = article.fullContent ? article.content : undefined
        tasks.push(generateSummary(article.title, textToAnalyze, 'medium', articleLanguage, rssDescription))
      }

      // Sentiment - use transformer or Ollama
      if (useTransformersForSentiment) {
        const { analyzeSentimentWithTransformer } = await import('./sentimentTransformer.js')
        tasks.push(analyzeSentimentWithTransformer(article.title, textToAnalyze))
      } else {
        tasks.push(analyzeSentiment(article.title, textToAnalyze, articleLanguage))
      }

      const [keywordResult, summaryResult, sentimentResult] = await Promise.all(tasks)

      // 2. Process keyword results
      if (keywordResult.success && keywordResult.keywords.length > 0) {
        await storeKeywords(articleId, keywordResult.keywords)
        keywordCount = keywordResult.keywords.length
        const method = useTransformersForKeywords ? 'Transformers.js' : 'Ollama'
        console.log(`  ✅ ${keywordCount} keywords extracted (${method})`)
      } else {
        console.log(`  ⚠️  Keyword extraction failed: ${keywordResult.error}`)
      }

      // 3. Process summary results
      if (summaryResult.success) {
        summaryText = summaryResult.summary
        summaryLength = summaryResult.wordCount || 0
        const method = useTransformersForSummary ? 'Transformers.js' : 'Ollama'
        console.log(`  ✅ Summary generated (${summaryLength} words) (${method})`)
      } else {
        console.log(`  ⚠️  Summary generation failed: ${summaryResult.error}`)
      }

      // 4. Process sentiment results
      if (sentimentResult.success) {
        sentiment = sentimentResult.sentiment
        sentimentConfidence = sentimentResult.confidence
        sentimentTone = sentimentResult.tone
        emotions = sentimentResult.emotions || []
        const sentimentLabel = getSentimentLabel(sentiment)
        const method = useTransformersForSentiment ? 'Transformers.js' : 'Ollama'
        console.log(`  ✅ Sentiment: ${sentimentLabel} (${sentiment.toFixed(2)}) (${method})`)
      } else {
        console.log(`  ⚠️  Sentiment analysis failed: ${sentimentResult.error}`)
      }
    }

    // 5. Store analysis in database
    const [analysis] = await db
      .insert(analyses)
      .values({
        articleId: article.id,
        summary: summaryText || null,
        sentiment: sentiment,
        sentimentConfidence: sentimentConfidence,
        keywordExtractionDone: keywordCount > 0,
        summaryGenerated: summaryText.length > 0,
        sentimentAnalyzed: sentimentConfidence > 0,
        analysisMetadata: {
          keywordCount,
          summaryWordCount: summaryLength,
          sentimentTone,
          emotions,
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: analyses.id })

    console.log(`  ✅ Analysis complete`)

    return {
      success: true,
      articleId: article.id,
      keywordCount,
      summaryLength,
      sentiment,
      sentimentLabel: getSentimentLabel(sentiment),
    }
  } catch (error) {
    console.error(`Failed to analyze article ${articleId}:`, error)

    return {
      success: false,
      articleId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get articles pending analysis
 */
export async function getArticlesPendingAnalysis(limit: number = 10) {
  const db = getDatabase()

  // Use LEFT JOIN to get grouped articles without analyses directly in SQL
  // Order by ID descending to prioritize newer articles
  // Exclude disabled languages (fr, de, es) to save tokens
  const pending = await db
    .select({
      id: articles.id,
      title: articles.title,
      contentExtracted: articles.contentExtracted,
      processingStatus: articles.processingStatus,
    })
    .from(articles)
    .leftJoin(analyses, eq(articles.id, analyses.articleId))
    .leftJoin(classifications, eq(articles.id, classifications.articleId))
    .where(sql`${articles.processingStatus} = 'grouped'
      AND ${analyses.articleId} IS NULL
      AND (${classifications.language} IS NULL OR ${classifications.language} NOT IN ('fr', 'de', 'es'))`)
    .orderBy(desc(articles.id))
    .limit(limit)

  return pending
}

/**
 * Get analysis for an article
 */
export async function getArticleAnalysis(articleId: number) {
  const db = getDatabase()

  const [analysis] = await db
    .select()
    .from(analyses)
    .where(eq(analyses.articleId, articleId))
    .limit(1)

  return analysis
}
