/**
 * Batch classify articles
 *
 * Run with: npm run classify:all [limit] [concurrency]
 *
 * Example:
 *   npm run classify:all 20 2   # Classify 20 articles, 2 at a time
 *   npm run classify:all         # Classify 50 articles, 3 at a time (default)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { classifyArticle } from '../services/articleClassifier'

// Load environment variables
config()

async function batchClassify() {
  const db = getDatabase()

  // Parse command line arguments
  const limit = parseInt(process.argv[2]) || 50
  const concurrency = parseInt(process.argv[3]) || 6 // Increased from 3 to 6

  console.log(`\n🏷️  Batch Article Classification`)
  console.log(`   Limit: ${limit} articles`)
  console.log(`   Concurrency: ${concurrency} parallel jobs`)
  console.log(`   Model: ${process.env.OLLAMA_CHAT_MODEL || 'llama3'}\n`)

  try {
    // Get articles that are extracted but not classified
    // Order by ID descending to prioritize newer articles with better content
    // Filter for articles with sufficient content length (>200 chars)
    const pendingArticles = await db
      .select({
        id: articles.id,
        title: articles.title,
      })
      .from(articles)
      .where(
        sql`${articles.contentExtracted} = true
            AND ${articles.processingStatus} = 'pending'
            AND (length(${articles.content}) > 200 OR length(${articles.fullContent}) > 200)`
      )
      .orderBy(desc(articles.id))
      .limit(limit)

    if (pendingArticles.length === 0) {
      console.log('✅ No articles pending classification!\n')
      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} articles to classify\n`)
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
            console.log(`\n🔍 Article ${article.id}: ${article.title.substring(0, 50)}...`)
            const result = await classifyArticle(article.id, true)

            if (result.success) {
              console.log(`   ✅ ${result.language} | ${result.biasLabel} | ${result.entityCount} entities`)
              successful++
            } else {
              console.log(`   ❌ Failed: ${result.error}`)
              failed++
            }

            results.push(result)
            return result
          } catch (error: any) {
            console.log(`   ❌ Error: ${error.message}`)
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

      // Brief pause between batches to avoid overwhelming Ollama
      if (i + concurrency < pendingArticles.length) {
        console.log(`\n⏳ Pausing 2s before next batch...`)
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Final summary
    console.log('\n\n')
    console.log('=' .repeat(70))
    console.log('📊 CLASSIFICATION SUMMARY')
    console.log('=' .repeat(70))
    console.log(`Total Processed:  ${pendingArticles.length}`)
    console.log(`Successful:       ${successful} ✅`)
    console.log(`Failed:           ${failed} ❌`)
    console.log(`Success Rate:     ${((successful / pendingArticles.length) * 100).toFixed(1)}%`)
    console.log(`Time Elapsed:     ${elapsedTime}s`)
    console.log(`Avg Time/Article: ${(parseFloat(elapsedTime) / pendingArticles.length).toFixed(1)}s`)

    // Statistics
    if (successful > 0) {
      const successfulResults = results.filter((r) => r.success)

      // Language distribution
      const languages = successfulResults
        .filter((r) => r.language)
        .map((r) => r.language)
      const langCounts = languages.reduce((acc: any, lang: string) => {
        acc[lang] = (acc[lang] || 0) + 1
        return acc
      }, {})

      console.log('\n📈 Language Distribution:')
      Object.entries(langCounts)
        .sort(([, a]: any, [, b]: any) => b - a)
        .forEach(([lang, count]) => {
          console.log(`   ${lang}: ${count}`)
        })

      // Bias distribution
      const biases = successfulResults
        .filter((r) => r.bias !== undefined)
        .map((r) => r.bias!)

      if (biases.length > 0) {
        const avgBias = biases.reduce((a, b) => a + b, 0) / biases.length
        const minBias = Math.min(...biases)
        const maxBias = Math.max(...biases)

        console.log('\n📊 Bias Statistics:')
        console.log(`   Average:  ${avgBias.toFixed(3)}`)
        console.log(`   Range:    ${minBias.toFixed(2)} to ${maxBias.toFixed(2)}`)

        // Bias label distribution
        const biasLabels = successfulResults
          .filter((r) => r.biasLabel)
          .map((r) => r.biasLabel)
        const labelCounts = biasLabels.reduce((acc: any, label: string) => {
          acc[label] = (acc[label] || 0) + 1
          return acc
        }, {})

        console.log('\n🏷️  Bias Label Distribution:')
        Object.entries(labelCounts)
          .sort(([, a]: any, [, b]: any) => b - a)
          .forEach(([label, count]) => {
            console.log(`   ${label}: ${count}`)
          })
      }

      // Entity statistics
      const totalEntities = successfulResults.reduce((sum, r) => sum + (r.entityCount || 0), 0)
      const avgEntities = totalEntities / successfulResults.length

      console.log('\n🏢 Entity Statistics:')
      console.log(`   Total Entities:   ${totalEntities}`)
      console.log(`   Avg per Article:  ${avgEntities.toFixed(1)}`)

      // Geographic POV distribution
      const geoPovs = successfulResults
        .filter((r) => r.geoPov)
        .map((r) => r.geoPov)

      if (geoPovs.length > 0) {
        const povCounts = geoPovs.reduce((acc: any, pov: string) => {
          acc[pov] = (acc[pov] || 0) + 1
          return acc
        }, {})

        console.log('\n🌍 Geographic POV Distribution:')
        Object.entries(povCounts)
          .sort(([, a]: any, [, b]: any) => b - a)
          .slice(0, 10) // Top 10
          .forEach(([pov, count]) => {
            console.log(`   ${pov}: ${count}`)
          })
      }
    }

    console.log('\n✨ Batch classification complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Batch classification failed:', error)
    process.exit(1)
  }
}

batchClassify()
