/**
 * Test content extraction
 *
 * Run with: npx tsx server/scripts/testContentExtraction.ts [articleId]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { extractArticleById } from '../services/contentExtractor'
import { eq } from 'drizzle-orm'

// Load environment variables
config()

async function testContentExtraction() {
  const db = getDatabase()
  const articleId = parseInt(process.argv[2]) || null

  try {
    if (articleId) {
      // Test single article
      console.log(`\n🧪 Testing content extraction for article ID: ${articleId}\n`)

      const result = await extractArticleById(articleId)

      console.log('\n📊 Extraction Results:')
      console.log(`   Success: ${result.success}`)
      console.log(`   Article ID: ${result.articleId}`)
      if (result.contentLength) {
        console.log(`   Content Length: ${result.contentLength} characters`)
      }
      if (result.title) {
        console.log(`   Title: ${result.title}`)
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`)
      }

      // Show extracted content preview
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1)

      if (article && article.fullContent) {
        console.log(`\n📄 Content Preview (first 500 chars):`)
        console.log(article.fullContent.substring(0, 500) + '...')
      }
    } else {
      // Test extraction on first 5 pending articles
      console.log('\n🧪 Testing content extraction on 5 random articles\n')

      const pendingArticles = await db
        .select()
        .from(articles)
        .where(eq(articles.extractionStatus, 'pending'))
        .limit(5)

      console.log(`Found ${pendingArticles.length} pending articles\n`)

      const results = []

      for (const article of pendingArticles) {
        console.log(`\n📡 Extracting: ${article.title}...`)
        console.log(`   URL: ${article.url}`)

        try {
          const result = await extractArticleById(article.id)
          results.push(result)

          if (result.success) {
            console.log(`   ✅ Success: ${result.contentLength} characters extracted`)
          } else {
            console.log(`   ❌ Failed: ${result.error}`)
          }
        } catch (error: any) {
          console.error(`   ❌ Error: ${error.message}`)
          results.push({
            articleId: article.id,
            success: false,
            error: error.message,
          })
        }
      }

      // Summary
      console.log('\n\n📊 SUMMARY')
      console.log('=' .repeat(60))

      const successful = results.filter((r: any) => r.success && !r.skipped).length
      const failed = results.filter((r: any) => !r.success).length
      const skipped = results.filter((r: any) => r.skipped).length

      console.log(`\nTotal Tested: ${results.length}`)
      console.log(`Successful:   ${successful} ✅`)
      console.log(`Failed:       ${failed} ❌`)
      console.log(`Skipped:      ${skipped}`)

      // Show content stats
      const allArticles = await db.select().from(articles)
      const extracted = allArticles.filter((a) => a.contentExtracted)
      const avgLength = extracted.length > 0
        ? extracted.reduce((sum, a) => sum + (a.fullContent?.length || 0), 0) / extracted.length
        : 0

      console.log('\n\n💾 Database Stats:')
      console.log(`   Total articles: ${allArticles.length}`)
      console.log(`   Content extracted: ${extracted.length}`)
      console.log(`   Pending extraction: ${allArticles.filter((a) => a.extractionStatus === 'pending').length}`)
      console.log(`   Average content length: ${Math.round(avgLength)} characters`)
    }

    console.log('\n✨ Test complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

testContentExtraction()
