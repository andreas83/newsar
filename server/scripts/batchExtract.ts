/**
 * Batch extract content for all pending articles (no Redis/BullMQ required)
 *
 * Run with: npx tsx server/scripts/batchExtract.ts [limit] [concurrency]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { extractArticleById } from '../services/contentExtractor'
import { eq, or } from 'drizzle-orm'

// Load environment variables
config()

async function batchExtract() {
  const db = getDatabase()
  const limit = parseInt(process.argv[2]) || 100
  const concurrency = parseInt(process.argv[3]) || 5

  try {
    console.log(`\n🚀 Starting batch extraction (limit: ${limit}, concurrency: ${concurrency})\n`)

    // Get pending articles
    const pendingArticles = await db
      .select({ id: articles.id, title: articles.title, url: articles.url })
      .from(articles)
      .where(eq(articles.extractionStatus, 'pending'))
      .limit(limit)

    if (pendingArticles.length === 0) {
      console.log('No pending articles to extract!\n')
      process.exit(0)
    }

    console.log(`Found ${pendingArticles.length} pending articles\n`)

    const results = {
      total: pendingArticles.length,
      success: 0,
      failed: 0,
      skipped: 0,
    }

    // Process in batches
    for (let i = 0; i < pendingArticles.length; i += concurrency) {
      const batch = pendingArticles.slice(i, i + concurrency)

      console.log(`\nProcessing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(pendingArticles.length / concurrency)}...`)

      const batchResults = await Promise.allSettled(
        batch.map(async (article) => {
          try {
            console.log(`  [${article.id}] ${article.title.substring(0, 50)}...`)
            const result = await extractArticleById(article.id)

            if (result.skipped) {
              results.skipped++
              return { success: true, articleId: article.id, skipped: true }
            }

            if (result.success) {
              results.success++
              console.log(`  ✅ [${article.id}] ${result.contentLength} chars`)
            } else {
              results.failed++
              console.log(`  ❌ [${article.id}] ${result.error}`)
            }

            return result
          } catch (error: any) {
            results.failed++
            console.log(`  ❌ [${article.id}] ${error.message}`)
            return { success: false, articleId: article.id, error: error.message }
          }
        })
      )

      // Brief pause between batches to avoid overwhelming the network
      if (i + concurrency < pendingArticles.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    // Final summary
    console.log('\n\n📊 EXTRACTION COMPLETE')
    console.log('=' .repeat(60))
    console.log(`Total:    ${results.total}`)
    console.log(`Success:  ${results.success} ✅`)
    console.log(`Failed:   ${results.failed} ❌`)
    console.log(`Skipped:  ${results.skipped}`)

    const successRate = ((results.success / results.total) * 100).toFixed(1)
    console.log(`Success Rate: ${successRate}%`)

    // Database stats
    console.log('\n💾 Database Stats:')
    const allArticles = await db.select().from(articles)
    const extracted = allArticles.filter((a) => a.contentExtracted)
    const avgLength = extracted.length > 0
      ? extracted.reduce((sum, a) => sum + (a.fullContent?.length || 0), 0) / extracted.length
      : 0

    console.log(`   Total articles: ${allArticles.length}`)
    console.log(`   Content extracted: ${extracted.length}`)
    console.log(`   Pending extraction: ${allArticles.filter((a) => a.extractionStatus === 'pending').length}`)
    console.log(`   Failed extraction: ${allArticles.filter((a) => a.extractionStatus === 'failed').length}`)
    console.log(`   Average content length: ${Math.round(avgLength)} characters`)

    console.log('\n✨ Batch extraction complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Batch extraction failed:', error)
    process.exit(1)
  }
}

batchExtract()
