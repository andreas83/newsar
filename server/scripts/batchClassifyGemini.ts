/**
 * Batch classify articles using Gemini Batch API
 *
 * Submits entity extraction + feature extraction as two batch jobs,
 * then processes results and stores in the database.
 *
 * Run with: npm run classify:batch [limit]
 *
 * Example:
 *   npm run classify:batch 100   # Classify 100 articles via batch API
 *   npm run classify:batch        # Classify 500 articles (default)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, feeds, classifications, articleClaims as articleClaimsTable } from '../database/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { detectLanguage, iso3ToIso1 } from '../services/languageDetector'
import { classifyBias, getBiasLabel } from '../services/biasClassifier'
import { buildEntityPrompt, parseEntityResponse, extractGeoPOV } from '../services/entityExtractor'
import { buildFeaturePrompt, parseFeatureResponse } from '../services/articleFeatureExtractor'
import { storeArticleEntities } from '../services/articleClassifier'
import { buildRequest, cancelPendingBatches, submitBatch, waitForCompletion, extractResults, getDefaultBatchModel, processRealtime } from '../utils/geminiBatch'

config()

interface ArticleData {
  id: number
  title: string
  content: string | null
  fullContent: string | null
  knownBias: number | null
}

async function batchClassifyGemini() {
  const db = getDatabase()
  const limit = parseInt(process.argv[2]) || 500
  const model = getDefaultBatchModel()

  console.log(`\n🏷️  Batch Classification (Gemini Batch API)`)
  console.log(`   Limit: ${limit} articles`)
  console.log(`   Model: ${model}\n`)

  try {
    // 1. Query articles pending classification
    const pendingArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
        knownBias: feeds.knownBias,
      })
      .from(articles)
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
      .where(
        sql`${articles.contentExtracted} = true
            AND ${articles.processingStatus} = 'pending'
            AND (length(${articles.content}) > 200 OR length(${articles.fullContent}) > 200)`
      )
      .orderBy(desc(articles.id))
      .limit(limit)

    if (pendingArticles.length === 0) {
      console.log('No articles pending classification!\n')
      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} articles to classify\n`)

    // 2. Pre-process: language detection + bias (local, no LLM needed)
    const articleDataMap = new Map<number, {
      article: ArticleData
      textToAnalyze: string
      language: string
      biasResult: any
      isContentThin: boolean
    }>()

    // Track which articles go into each batch (maintain order)
    const batchArticleIds: number[] = []
    const entityRequests: any[] = []
    const featureRequests: any[] = []

    console.log('Pre-processing articles (language detection, bias)...')

    for (const article of pendingArticles) {
      const textToAnalyze = article.fullContent || article.content || ''
      if (textToAnalyze.length < 100) {
        console.log(`  Skipping article ${article.id}: content too short`)
        continue
      }

      // Language detection (local, no LLM)
      const langResult = detectLanguage(textToAnalyze)
      const language = iso3ToIso1(langResult.language)

      // Bias classification (rule-based if knownBias exists, otherwise will use LLM later in real-time)
      const isContentThin = textToAnalyze.length < 300
      let biasResult
      if (isContentThin && article.knownBias === null) {
        biasResult = { bias: 0, confidence: 0.1, method: 'rule-based', reasoning: 'Content too short' }
      } else {
        // For batch mode, use rule-based classification (no LLM call)
        // If no known bias, set a default — the real-time pipeline can refine later
        if (article.knownBias !== null) {
          biasResult = await classifyBias(article.title, textToAnalyze, article.knownBias, false, language)
        } else {
          biasResult = await classifyBias(article.title, textToAnalyze, null, false, language)
        }
      }

      articleDataMap.set(article.id, {
        article,
        textToAnalyze,
        language,
        biasResult,
        isContentThin,
      })

      // Build batch requests
      const entityConfig = buildEntityPrompt(article.title, textToAnalyze)
      entityRequests.push(buildRequest({
        prompt: entityConfig.prompt,
        systemPrompt: entityConfig.systemPrompt,
        options: entityConfig.options,
      }))

      const featureConfig = buildFeaturePrompt(article.title, textToAnalyze, language)
      featureRequests.push(buildRequest({
        prompt: featureConfig.prompt,
        systemPrompt: featureConfig.systemPrompt,
        options: featureConfig.options,
      }))

      batchArticleIds.push(article.id)
    }

    if (batchArticleIds.length === 0) {
      console.log('No valid articles to process after pre-processing.\n')
      process.exit(0)
    }

    console.log(`\nPre-processed ${batchArticleIds.length} articles`)

    // 3. Cancel any stale PENDING batch jobs to free up quota
    await cancelPendingBatches()

    console.log(`Submitting 2 batch jobs (entity + feature extraction)...\n`)

    // 4. Submit both batch jobs, with automatic real-time fallback
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
    const startTime = Date.now()

    let entityResults: { index: number; text?: string; error?: string }[]
    let featureResults: { index: number; text?: string; error?: string }[]

    try {
      const entityJob = await submitBatch(entityRequests, `entity-extraction-${timestamp}`, model)
      const featureJob = await submitBatch(featureRequests, `feature-extraction-${timestamp}`, model)

      // Wait for both to complete (15 min timeout, auto-cancels stuck jobs)
      console.log('\nWaiting for batch jobs to complete...')
      const [completedEntityJob, completedFeatureJob] = await Promise.all([
        waitForCompletion(entityJob.name!),
        waitForCompletion(featureJob.name!),
      ])

      // Check if any batch timed out — fall back to real-time for those
      if (completedEntityJob && completedEntityJob.state !== 'JOB_STATE_FAILED') {
        entityResults = extractResults(completedEntityJob)
      } else {
        console.log('[Classify] Entity batch failed/timed out, using real-time fallback...')
        entityResults = await processRealtime(entityRequests, model, 5, 300)
      }

      if (completedFeatureJob && completedFeatureJob.state !== 'JOB_STATE_FAILED') {
        featureResults = extractResults(completedFeatureJob)
      } else {
        console.log('[Classify] Feature batch failed/timed out, using real-time fallback...')
        featureResults = await processRealtime(featureRequests, model, 5, 300)
      }
    } catch (e: any) {
      // Batch submission itself failed (429/503) — go straight to real-time
      console.log(`[Classify] Batch submission failed (${e?.status || 'unknown'}), using real-time fallback for all...`)
      const [er, fr] = await Promise.all([
        processRealtime(entityRequests, model, 5, 300),
        processRealtime(featureRequests, model, 5, 300),
      ])
      entityResults = er
      featureResults = fr
    }

    const batchDuration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\nBatch jobs completed in ${batchDuration}s`)

    console.log(`Entity results: ${entityResults.length} | Feature results: ${featureResults.length}`)

    // 6. Process results and store in database
    let successful = 0
    let failed = 0
    const stats = {
      languages: {} as Record<string, number>,
      biasLabels: {} as Record<string, number>,
      totalEntities: 0,
      framings: {} as Record<string, number>,
    }

    console.log('\nProcessing results...\n')
    console.log('='.repeat(70))

    for (let i = 0; i < batchArticleIds.length; i++) {
      const articleId = batchArticleIds[i]
      const data = articleDataMap.get(articleId)!
      const entityResult = entityResults[i]
      const featureResult = featureResults[i]

      try {
        // Parse entity response
        let parsedEntities = { entities: [] as any[], success: false }
        if (entityResult?.text) {
          parsedEntities = parseEntityResponse(entityResult.text)
        } else if (entityResult?.error) {
          console.log(`  Article ${articleId}: Entity batch error: ${entityResult.error}`)
        }

        // Parse feature response
        let parsedFeatures = parseFeatureResponse('{}')
        if (featureResult?.text) {
          parsedFeatures = parseFeatureResponse(featureResult.text)
        } else if (featureResult?.error) {
          console.log(`  Article ${articleId}: Feature batch error: ${featureResult.error}`)
        }

        const geoPov = parsedEntities.success ? extractGeoPOV(parsedEntities.entities) : null

        // Store classification
        await db
          .insert(classifications)
          .values({
            articleId,
            language: data.language,
            politicalBias: (data.isContentThin && data.article.knownBias === null) ? null : data.biasResult.bias,
            geoPov,
            confidence: Math.min(0.8, data.biasResult.confidence), // Cap at 0.8 for batch
            method: data.biasResult.method,
            entityExtractionDone: parsedEntities.success && parsedEntities.entities.length > 0,
            primaryFraming: parsedFeatures.primaryFraming,
            secondaryFraming: parsedFeatures.secondaryFraming,
            articleType: parsedFeatures.articleType,
            sensationalism: parsedFeatures.sensationalism,
            factOpinionRatio: parsedFeatures.factOpinionRatio,
            sourceCountCited: parsedFeatures.sourceCountCited,
            featureExtractionDone: parsedFeatures.success,
            processingMetadata: {
              biasConfidence: data.biasResult.confidence,
              biasReasoning: data.biasResult.reasoning,
              batchMode: true,
              timestamp: new Date().toISOString(),
            },
            metadata: {
              techniques: data.biasResult.techniques || [],
              osintClassification: data.biasResult.classification,
              analysisVersion: '3.0-batch',
            },
          })

        // Store claims
        if (parsedFeatures.claims.length > 0) {
          await db.insert(articleClaimsTable).values(
            parsedFeatures.claims.map(claim => ({
              articleId,
              claimText: claim.text,
              attribution: claim.attribution,
              claimType: claim.type,
              confidence: claim.confidence,
            }))
          )
        }

        // Store entities
        if (parsedEntities.success && parsedEntities.entities.length > 0) {
          await storeArticleEntities(articleId, parsedEntities.entities)
          stats.totalEntities += parsedEntities.entities.length
        }

        // Update processing status
        await db
          .update(articles)
          .set({ processingStatus: 'grouped' })
          .where(eq(articles.id, articleId))

        // Track stats
        stats.languages[data.language] = (stats.languages[data.language] || 0) + 1
        const biasLabel = getBiasLabel(data.biasResult.bias)
        stats.biasLabels[biasLabel] = (stats.biasLabels[biasLabel] || 0) + 1
        if (parsedFeatures.primaryFraming) {
          stats.framings[parsedFeatures.primaryFraming] = (stats.framings[parsedFeatures.primaryFraming] || 0) + 1
        }

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
    console.log('CLASSIFICATION SUMMARY (Gemini Batch API)')
    console.log('='.repeat(70))
    console.log(`Total Processed:  ${batchArticleIds.length}`)
    console.log(`Successful:       ${successful}`)
    console.log(`Failed:           ${failed}`)
    console.log(`Success Rate:     ${((successful / batchArticleIds.length) * 100).toFixed(1)}%`)
    console.log(`Batch Wait Time:  ${batchDuration}s`)
    console.log(`Total Time:       ${totalTime}s`)
    console.log(`Avg Time/Article: ${(parseFloat(totalTime) / batchArticleIds.length).toFixed(1)}s`)

    if (successful > 0) {
      console.log('\nLanguage Distribution:')
      Object.entries(stats.languages)
        .sort(([, a], [, b]) => b - a)
        .forEach(([lang, count]) => console.log(`   ${lang}: ${count}`))

      console.log('\nBias Label Distribution:')
      Object.entries(stats.biasLabels)
        .sort(([, a], [, b]) => b - a)
        .forEach(([label, count]) => console.log(`   ${label}: ${count}`))

      console.log(`\nEntity Statistics:`)
      console.log(`   Total Entities:   ${stats.totalEntities}`)
      console.log(`   Avg per Article:  ${(stats.totalEntities / successful).toFixed(1)}`)

      console.log('\nFraming Distribution:')
      Object.entries(stats.framings)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .forEach(([framing, count]) => console.log(`   ${framing}: ${count}`))
    }

    console.log('\nBatch classification complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\nBatch classification failed:', error)
    process.exit(1)
  }
}

batchClassifyGemini()
