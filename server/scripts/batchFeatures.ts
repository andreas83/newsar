/**
 * Batch extract article features (framing, factuality, sensationalism, claims)
 *
 * Run with: npm run features:all [limit] [concurrency]
 *
 * Example:
 *   npm run features:all 20 2   # Process 20 articles, 2 at a time
 *   npm run features:all         # Process 50 articles, 2 at a time (default)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, classifications } from '../database/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import { extractArticleFeatures, storeArticleFeatures } from '../services/articleFeatureExtractor'

// Load environment variables
config()

async function batchFeatures() {
  const db = getDatabase()

  // Parse command line arguments
  const limit = parseInt(process.argv[2]) || 50
  const concurrency = parseInt(process.argv[3]) || 2

  console.log(`\n🔬 Batch Article Feature Extraction`)
  console.log(`   Limit: ${limit} articles`)
  console.log(`   Concurrency: ${concurrency} parallel jobs\n`)

  try {
    // Get articles that have classifications but feature_extraction_done = false
    const pendingArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
        classificationId: classifications.id,
        language: classifications.language,
      })
      .from(articles)
      .innerJoin(classifications, eq(articles.id, classifications.articleId))
      .where(
        and(
          eq(classifications.featureExtractionDone, false),
          sql`(length(${articles.content}) > 200 OR length(${articles.fullContent}) > 200)`
        )
      )
      .orderBy(desc(articles.id))
      .limit(limit)

    if (pendingArticles.length === 0) {
      console.log('✅ No articles pending feature extraction!\n')
      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} articles to process\n`)
    console.log('='.repeat(70))

    let successful = 0
    let failed = 0
    const startTime = Date.now()

    // Track framing distribution for summary
    const framingCounts: Record<string, number> = {}
    const typeCounts: Record<string, number> = {}
    let totalClaims = 0
    let totalSensationalism = 0
    let totalFactuality = 0

    // Process in batches with concurrency control
    for (let i = 0; i < pendingArticles.length; i += concurrency) {
      const batch = pendingArticles.slice(i, i + concurrency)
      const batchNum = Math.floor(i / concurrency) + 1
      const totalBatches = Math.ceil(pendingArticles.length / concurrency)

      console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} articles)`)
      console.log('-'.repeat(70))

      await Promise.allSettled(
        batch.map(async (article) => {
          try {
            const textToAnalyze = article.fullContent || article.content || ''
            console.log(`\n🔍 Article ${article.id}: ${article.title.substring(0, 50)}...`)

            const result = await extractArticleFeatures(
              article.title,
              textToAnalyze,
              article.language || 'en'
            )

            if (result.success) {
              await storeArticleFeatures(article.id, result)
              console.log(`   ✅ ${result.primaryFraming} | ${result.articleType} | sens=${result.sensationalism.toFixed(2)} | fact=${result.factOpinionRatio.toFixed(2)} | ${result.claims.length} claims`)
              successful++

              // Track stats
              framingCounts[result.primaryFraming] = (framingCounts[result.primaryFraming] || 0) + 1
              typeCounts[result.articleType] = (typeCounts[result.articleType] || 0) + 1
              totalClaims += result.claims.length
              totalSensationalism += result.sensationalism
              totalFactuality += result.factOpinionRatio
            } else {
              console.log(`   ❌ Failed: ${result.error}`)
              failed++
            }
          } catch (error: any) {
            console.log(`   ❌ Error: ${error.message}`)
            failed++
          }
        })
      )

      // Brief pause between batches
      if (i + concurrency < pendingArticles.length) {
        console.log(`\n⏳ Pausing 2s before next batch...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Final summary
    console.log('\n\n')
    console.log('='.repeat(70))
    console.log('📊 FEATURE EXTRACTION SUMMARY')
    console.log('='.repeat(70))
    console.log(`Total Processed:  ${pendingArticles.length}`)
    console.log(`Successful:       ${successful} ✅`)
    console.log(`Failed:           ${failed} ❌`)
    console.log(`Success Rate:     ${((successful / pendingArticles.length) * 100).toFixed(1)}%`)
    console.log(`Time Elapsed:     ${elapsedTime}s`)
    console.log(`Avg Time/Article: ${(parseFloat(elapsedTime) / pendingArticles.length).toFixed(1)}s`)

    if (successful > 0) {
      console.log(`\n📰 Framing Distribution:`)
      Object.entries(framingCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([framing, count]) => {
          console.log(`   ${framing}: ${count}`)
        })

      console.log(`\n📝 Article Type Distribution:`)
      Object.entries(typeCounts)
        .sort(([, a], [, b]) => b - a)
        .forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`)
        })

      console.log(`\n📈 Quality Averages:`)
      console.log(`   Avg Sensationalism: ${(totalSensationalism / successful).toFixed(3)}`)
      console.log(`   Avg Factuality:     ${(totalFactuality / successful).toFixed(3)}`)
      console.log(`   Total Claims:       ${totalClaims}`)
      console.log(`   Avg Claims/Article: ${(totalClaims / successful).toFixed(1)}`)
    }

    console.log('\n✨ Batch feature extraction complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Batch feature extraction failed:', error)
    process.exit(1)
  }
}

batchFeatures()
