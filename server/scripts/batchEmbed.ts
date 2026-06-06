/**
 * Batch generate embeddings for articles
 *
 * Run with: npm run embed:all [limit] [concurrency]
 *
 * Example:
 *   npm run embed:all 20 3   # Embed 20 articles, 3 at a time
 *   npm run embed:all         # Embed 50 articles, 3 at a time (default)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, articleEmbeddings } from '../database/schema'
import { generateArticleEmbedding, getArticlesPendingEmbedding } from '../services/embeddingGenerator'

// Load environment variables
config()

async function batchEmbed() {
  const db = getDatabase()

  // Parse command line arguments
  const limit = parseInt(process.argv[2]) || 50
  const concurrency = parseInt(process.argv[3]) || 3

  console.log(`\n🧠 Batch Article Embedding`)
  console.log(`   Limit: ${limit} articles`)
  console.log(`   Concurrency: ${concurrency} parallel jobs`)
  console.log(`   Model: nomic-embed-text\n`)

  try {
    // Get articles pending embeddings
    const pendingArticles = await getArticlesPendingEmbedding(limit)

    if (pendingArticles.length === 0) {
      console.log('✅ No articles pending embedding!\n')

      // Show stats
      const totalArticles = await db.select().from(articles)
      const totalEmbeddings = await db.select().from(articleEmbeddings)

      console.log(`📊 Database Stats:`)
      console.log(`   Total articles: ${totalArticles.length}`)
      console.log(`   Articles with embeddings: ${totalEmbeddings.length}`)
      console.log(`   Coverage: ${((totalEmbeddings.length / totalArticles.length) * 100).toFixed(1)}%\n`)

      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} articles to embed\n`)
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
            const result = await generateArticleEmbedding(article.id)

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

      // Brief pause between batches
      if (i + concurrency < pendingArticles.length) {
        console.log(`\n⏳ Pausing 1s before next batch...`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Final summary
    console.log('\n\n')
    console.log('=' .repeat(70))
    console.log('📊 EMBEDDING SUMMARY')
    console.log('=' .repeat(70))
    console.log(`Total Processed:  ${pendingArticles.length}`)
    console.log(`Successful:       ${successful} ✅`)
    console.log(`Failed:           ${failed} ❌`)
    console.log(`Success Rate:     ${((successful / pendingArticles.length) * 100).toFixed(1)}%`)
    console.log(`Time Elapsed:     ${elapsedTime}s`)
    console.log(`Avg Time/Article: ${(parseFloat(elapsedTime) / pendingArticles.length).toFixed(1)}s`)

    // Embedding statistics
    if (successful > 0) {
      const successfulResults = results.filter((r) => r.success && r.dimension)

      if (successfulResults.length > 0) {
        const dimensions = successfulResults.map((r) => r.dimension!)
        const avgDimension = dimensions.reduce((a, b) => a + b, 0) / dimensions.length

        console.log('\n📈 Embedding Statistics:')
        console.log(`   Dimensions: ${Math.round(avgDimension)}`)
        console.log(`   Model: nomic-embed-text`)
      }
    }

    // Database coverage
    const totalArticles = await db.select().from(articles)
    const totalEmbeddings = await db.select().from(articleEmbeddings)

    console.log('\n💾 Database Coverage:')
    console.log(`   Total articles: ${totalArticles.length}`)
    console.log(`   Articles with embeddings: ${totalEmbeddings.length}`)
    console.log(`   Coverage: ${((totalEmbeddings.length / totalArticles.length) * 100).toFixed(1)}%`)

    console.log('\n✨ Batch embedding complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Batch embedding failed:', error)
    process.exit(1)
  }
}

batchEmbed()
