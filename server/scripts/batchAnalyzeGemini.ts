/**
 * Batch analyze articles using Gemini Batch API
 *
 * Submits keyword extraction, summary generation, and sentiment analysis
 * as three batch jobs, then processes results and stores in the database.
 *
 * Run with: npm run analyze:batch [limit]
 *
 * Example:
 *   npm run analyze:batch 100   # Analyze 100 articles via batch API
 *   npm run analyze:batch        # Analyze 500 articles (default)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, analyses, classifications } from '../database/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { buildKeywordPrompt, parseKeywordResponse, storeKeywords } from '../services/keywordExtractor'
import { buildSummaryPrompt, parseSummaryResponse } from '../services/summaryGenerator'
import { buildSentimentPrompt, parseSentimentResponse, getSentimentLabel } from '../services/sentimentAnalyzer'
import { buildRequest, cancelPendingBatches, submitBatch, waitForCompletion, extractResults, getDefaultBatchModel, processRealtime } from '../utils/geminiBatch'

config()

async function batchAnalyzeGemini() {
  const db = getDatabase()
  const limit = parseInt(process.argv[2]) || 500
  const model = getDefaultBatchModel()

  console.log(`\n🔬 Batch Analysis (Gemini Batch API)`)
  console.log(`   Limit: ${limit} articles`)
  console.log(`   Model: ${model}\n`)

  try {
    // 1. Query articles pending analysis (grouped but not yet analyzed)
    const pendingArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
        language: classifications.language,
      })
      .from(articles)
      .leftJoin(analyses, eq(articles.id, analyses.articleId))
      .leftJoin(classifications, eq(articles.id, classifications.articleId))
      .where(sql`${articles.processingStatus} = 'grouped' AND ${analyses.articleId} IS NULL`)
      .orderBy(desc(articles.id))
      .limit(limit)

    if (pendingArticles.length === 0) {
      console.log('No articles pending analysis!\n')
      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} articles to analyze\n`)

    // 2. Build batch requests for all three analyses
    const batchArticleIds: number[] = []
    const articleLanguages: string[] = []
    const keywordRequests: any[] = []
    const summaryRequests: any[] = []
    const sentimentRequests: any[] = []

    console.log('Building batch requests...')

    for (const article of pendingArticles) {
      const textToAnalyze = article.fullContent || article.content || ''
      if (textToAnalyze.length < 100) {
        console.log(`  Skipping article ${article.id}: content too short`)
        continue
      }

      const language = article.language || 'en'

      // Build keyword request
      const kwConfig = buildKeywordPrompt(article.title, textToAnalyze, 10, language)
      keywordRequests.push(buildRequest({
        prompt: kwConfig.prompt,
        options: kwConfig.options,
      }))

      // Build summary request (no JSON mode)
      const sumConfig = buildSummaryPrompt(article.title, textToAnalyze, 'medium', language)
      summaryRequests.push(buildRequest({
        prompt: sumConfig.prompt,
        options: sumConfig.options,
      }))

      // Build sentiment request
      const sentConfig = buildSentimentPrompt(article.title, textToAnalyze, language)
      sentimentRequests.push(buildRequest({
        prompt: sentConfig.prompt,
        options: sentConfig.options,
      }))

      batchArticleIds.push(article.id)
      articleLanguages.push(language)
    }

    if (batchArticleIds.length === 0) {
      console.log('No valid articles to process.\n')
      process.exit(0)
    }

    console.log(`\nPrepared ${batchArticleIds.length} articles`)

    // 3. Cancel any stale PENDING batch jobs to free up quota
    await cancelPendingBatches()

    console.log(`Submitting 3 batch jobs (keywords + summary + sentiment)...\n`)

    // 4. Submit all three batch jobs, with automatic real-time fallback
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
    const startTime = Date.now()

    let keywordResults: { index: number; text?: string; error?: string }[]
    let summaryResults: { index: number; text?: string; error?: string }[]
    let sentimentResults: { index: number; text?: string; error?: string }[]

    async function submitAndExtract(
      requests: any[],
      displayName: string,
    ): Promise<{ index: number; text?: string; error?: string }[]> {
      try {
        const job = await submitBatch(requests, displayName, model)
        const completed = await waitForCompletion(job.name!)
        if (completed && completed.state !== 'JOB_STATE_FAILED') {
          return extractResults(completed)
        }
        console.log(`[Analyze] Batch "${displayName}" failed/timed out, using real-time fallback...`)
        return processRealtime(requests, model, 5, 300)
      } catch (e: any) {
        console.log(`[Analyze] Batch "${displayName}" submission failed (${e?.status || 'unknown'}), using real-time fallback...`)
        return processRealtime(requests, model, 5, 300)
      }
    }

    console.log('\nSubmitting and waiting for batch jobs...')

    // Submit all three — they run in parallel
    ;[keywordResults, summaryResults, sentimentResults] = await Promise.all([
      submitAndExtract(keywordRequests, `keyword-extraction-${timestamp}`),
      submitAndExtract(summaryRequests, `summary-generation-${timestamp}`),
      submitAndExtract(sentimentRequests, `sentiment-analysis-${timestamp}`),
    ])

    const batchDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\nBatch jobs completed in ${batchDuration}s`)

    console.log(`Keyword results: ${keywordResults.length} | Summary results: ${summaryResults.length} | Sentiment results: ${sentimentResults.length}`)

    // 6. Process results and store in database
    let successful = 0
    let failed = 0
    const stats = {
      totalKeywords: 0,
      totalSummaryWords: 0,
      sentiments: [] as number[],
      sentimentLabels: {} as Record<string, number>,
    }

    console.log('\nProcessing results...\n')
    console.log('='.repeat(70))

    for (let i = 0; i < batchArticleIds.length; i++) {
      const articleId = batchArticleIds[i]

      try {
        // Parse keyword response
        let keywordCount = 0
        const kwResult = keywordResults[i]
        if (kwResult?.text) {
          const parsedKeywords = parseKeywordResponse(kwResult.text, 10)
          if (parsedKeywords.success && parsedKeywords.keywords.length > 0) {
            await storeKeywords(articleId, parsedKeywords.keywords)
            keywordCount = parsedKeywords.keywords.length
            stats.totalKeywords += keywordCount
          }
        }

        // Parse summary response
        let summaryText = ''
        let summaryLength = 0
        const sumResult = summaryResults[i]
        if (sumResult?.text) {
          const parsedSummary = parseSummaryResponse(sumResult.text)
          if (parsedSummary.success) {
            summaryText = parsedSummary.summary
            summaryLength = parsedSummary.wordCount || 0
            stats.totalSummaryWords += summaryLength
          }
        }

        // Parse sentiment response
        let sentiment = 0
        let sentimentConfidence = 0
        let sentimentTone = 'neutral'
        let emotions: string[] = []
        const sentResult = sentimentResults[i]
        if (sentResult?.text) {
          const parsedSentiment = parseSentimentResponse(sentResult.text)
          if (parsedSentiment.success) {
            sentiment = parsedSentiment.sentiment
            sentimentConfidence = parsedSentiment.confidence
            sentimentTone = parsedSentiment.tone
            emotions = parsedSentiment.emotions || []
            stats.sentiments.push(sentiment)
            const label = getSentimentLabel(sentiment)
            stats.sentimentLabels[label] = (stats.sentimentLabels[label] || 0) + 1
          }
        }

        // Store analysis
        await db.insert(analyses).values({
          articleId,
          summary: summaryText || null,
          sentiment,
          sentimentConfidence,
          keywordExtractionDone: keywordCount > 0,
          summaryGenerated: summaryText.length > 0,
          sentimentAnalyzed: sentimentConfidence > 0,
          analysisMetadata: {
            keywordCount,
            summaryWordCount: summaryLength,
            sentimentTone,
            emotions,
            batchMode: true,
            timestamp: new Date().toISOString(),
          },
        })

        successful++
        if (successful % 50 === 0) {
          console.log(`  Processed ${successful}/${batchArticleIds.length}...`)
        }
      } catch (error) {
        failed++
        console.log(`  Article ${articleId}: ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Final summary
    console.log('\n\n')
    console.log('='.repeat(70))
    console.log('ANALYSIS SUMMARY (Gemini Batch API)')
    console.log('='.repeat(70))
    console.log(`Total Processed:  ${batchArticleIds.length}`)
    console.log(`Successful:       ${successful}`)
    console.log(`Failed:           ${failed}`)
    console.log(`Success Rate:     ${((successful / batchArticleIds.length) * 100).toFixed(1)}%`)
    console.log(`Batch Wait Time:  ${batchDuration}s`)
    console.log(`Total Time:       ${totalTime}s`)
    console.log(`Avg Time/Article: ${(parseFloat(totalTime) / batchArticleIds.length).toFixed(1)}s`)

    if (successful > 0) {
      console.log('\nKeyword Statistics:')
      console.log(`   Total keywords extracted: ${stats.totalKeywords}`)
      console.log(`   Avg per article: ${(stats.totalKeywords / successful).toFixed(1)}`)

      console.log('\nSummary Statistics:')
      console.log(`   Articles with summaries: ${successful}`)
      console.log(`   Avg summary length: ${(stats.totalSummaryWords / successful).toFixed(0)} words`)

      if (stats.sentiments.length > 0) {
        const avgSentiment = stats.sentiments.reduce((a, b) => a + b, 0) / stats.sentiments.length
        console.log('\nSentiment Statistics:')
        console.log(`   Articles analyzed: ${stats.sentiments.length}`)
        console.log(`   Average sentiment: ${avgSentiment.toFixed(3)}`)
        console.log(`   Range: ${Math.min(...stats.sentiments).toFixed(2)} to ${Math.max(...stats.sentiments).toFixed(2)}`)

        console.log('\n   Sentiment Distribution:')
        Object.entries(stats.sentimentLabels)
          .sort(([, a], [, b]) => b - a)
          .forEach(([label, count]) => console.log(`     ${label}: ${count}`))
      }
    }

    console.log('\nBatch analysis complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\nBatch analysis failed:', error)
    process.exit(1)
  }
}

batchAnalyzeGemini()
