/**
 * Batch analyze articles (keywords, summary, sentiment)
 *
 * Run with: npm run analyze:all [limit] [concurrency]
 *
 * Example:
 *   npm run analyze:all 10 1   # Analyze 10 articles, 1 at a time
 *   npm run analyze:all         # Analyze 20 articles, 1 at a time (default)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, analyses } from '../database/schema'
import { analyzeArticle, getArticlesPendingAnalysis } from '../services/articleAnalyzer'

// Load environment variables
config()

async function batchAnalyze() {
  const db = getDatabase()

  // Parse command line arguments
  const limit = parseInt(process.argv[2]) || 20
  const concurrency = parseInt(process.argv[3]) || 1 // Default to 1 for Ollama stability

  console.log(`\n🔬 Batch Article Analysis`)
  console.log(`   Limit: ${limit} articles`)
  console.log(`   Concurrency: ${concurrency} parallel jobs`)
  console.log(`   Model: ${process.env.OLLAMA_CHAT_MODEL || 'llama3'}\n`)

  try {
    // Get articles pending analysis
    const pendingArticles = await getArticlesPendingAnalysis(limit)

    if (pendingArticles.length === 0) {
      console.log('✅ No articles pending analysis!\n')

      // Show stats
      const totalArticles = await db.select().from(articles)
      const totalAnalyses = await db.select().from(analyses)

      console.log(`📊 Database Stats:`)
      console.log(`   Total articles: ${totalArticles.length}`)
      console.log(`   Articles analyzed: ${totalAnalyses.length}`)
      console.log(`   Coverage: ${((totalAnalyses.length / totalArticles.length) * 100).toFixed(1)}%\n`)

      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} articles to analyze\n`)
    console.log('=' .repeat(70))

    let successful = 0
    let failed = 0
    const results: any[] = []
    const startTime = Date.now()

    // Process in batches with concurrency control
    for (let i = 0; i < pendingArticles.length; i += concurrency) {
      const batch = pendingArticles.slice(i, i + concurrency)
      const batchNum = Math.floor(i / concurrency) + 1
      const totalBatches = Math.ceil(pendingArticles.length / concurrency)

      console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} articles)`)
      console.log('-'.repeat(70))

      const batchResults = await Promise.allSettled(
        batch.map(async (article) => {
          try {
            const result = await analyzeArticle(article.id, true)

            if (result.success) {
              successful++
            } else {
              failed++
            }

            results.push(result)
            return result
          } catch (error: any) {
            console.log(`   ❌ Article ${article.id}: Error: ${error.message}`)
            failed++
            const errorResult = {
              success: false,
              articleId: article.id,
              error: error.message,
            }
            results.push(errorResult)
            return errorResult
          }
        })
      )

      // Brief pause between batches (important for Ollama)
      if (i + concurrency < pendingArticles.length) {
        console.log(`\n⏳ Pausing 2s before next batch...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Final summary
    console.log('\n\n')
    console.log('=' .repeat(70))
    console.log('📊 ANALYSIS SUMMARY')
    console.log('=' .repeat(70))
    console.log(`Total Processed:  ${pendingArticles.length}`)
    console.log(`Successful:       ${successful} ✅`)
    console.log(`Failed:           ${failed} ❌`)
    console.log(`Success Rate:     ${((successful / pendingArticles.length) * 100).toFixed(1)}%`)
    console.log(`Time Elapsed:     ${elapsedTime}s`)
    console.log(`Avg Time/Article: ${(parseFloat(elapsedTime) / pendingArticles.length).toFixed(1)}s`)

    // Analysis statistics
    if (successful > 0) {
      const successfulResults = results.filter((r) => r.success)

      // Keyword statistics
      const totalKeywords = successfulResults.reduce((sum, r) => sum + (r.keywordCount || 0), 0)
      const avgKeywords = totalKeywords / successfulResults.length

      console.log('\n📈 Keyword Statistics:')
      console.log(`   Total keywords extracted: ${totalKeywords}`)
      console.log(`   Avg per article: ${avgKeywords.toFixed(1)}`)

      // Summary statistics
      const articlesWithSummary = successfulResults.filter((r) => r.summaryLength && r.summaryLength > 0)
      if (articlesWithSummary.length > 0) {
        const avgSummaryLength = articlesWithSummary.reduce((sum, r) => sum + (r.summaryLength || 0), 0) / articlesWithSummary.length

        console.log('\n📝 Summary Statistics:')
        console.log(`   Articles with summaries: ${articlesWithSummary.length}`)
        console.log(`   Avg summary length: ${avgSummaryLength.toFixed(0)} words`)
      }

      // Sentiment statistics
      const articlesWithSentiment = successfulResults.filter((r) => r.sentiment !== undefined)
      if (articlesWithSentiment.length > 0) {
        const avgSentiment = articlesWithSentiment.reduce((sum, r) => sum + (r.sentiment || 0), 0) / articlesWithSentiment.length
        const sentiments = articlesWithSentiment.map((r) => r.sentiment!)

        console.log('\n😊 Sentiment Statistics:')
        console.log(`   Articles analyzed: ${articlesWithSentiment.length}`)
        console.log(`   Average sentiment: ${avgSentiment.toFixed(3)}`)
        console.log(`   Range: ${Math.min(...sentiments).toFixed(2)} to ${Math.max(...sentiments).toFixed(2)}`)

        // Sentiment label distribution
        const labelCounts = articlesWithSentiment.reduce((acc: any, r) => {
          const label = r.sentimentLabel || 'Unknown'
          acc[label] = (acc[label] || 0) + 1
          return acc
        }, {})

        console.log('\n   Sentiment Distribution:')
        Object.entries(labelCounts)
          .sort(([, a]: any, [, b]: any) => b - a)
          .forEach(([label, count]) => {
            console.log(`     ${label}: ${count}`)
          })
      }
    }

    // Database coverage
    const totalArticles = await db.select().from(articles)
    const totalAnalyses = await db.select().from(analyses)

    console.log('\n💾 Database Coverage:')
    console.log(`   Total articles: ${totalArticles.length}`)
    console.log(`   Articles analyzed: ${totalAnalyses.length}`)
    console.log(`   Coverage: ${((totalAnalyses.length / totalArticles.length) * 100).toFixed(1)}%`)

    console.log('\n✨ Batch analysis complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Batch analysis failed:', error)
    process.exit(1)
  }
}

batchAnalyze()
