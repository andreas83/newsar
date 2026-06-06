/**
 * Test semantic similarity search
 *
 * Run with: npm run test:similarity [articleId]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { findSimilarArticles } from '../services/embeddingGenerator'
import { eq } from 'drizzle-orm'

// Load environment variables
config()

async function testSimilarity() {
  const db = getDatabase()
  const articleId = parseInt(process.argv[2])

  if (!articleId || isNaN(articleId)) {
    console.log('\n❌ Please provide an article ID\n')
    console.log('Usage: npm run test:similarity [articleId]\n')
    process.exit(1)
  }

  try {
    console.log(`\n🔍 Testing similarity search for article ${articleId}\n`)

    // Get the source article
    const [sourceArticle] = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!sourceArticle) {
      console.log(`❌ Article ${articleId} not found\n`)
      process.exit(1)
    }

    console.log('📰 Source Article:')
    console.log(`   ID: ${sourceArticle.id}`)
    console.log(`   Title: ${sourceArticle.title}`)
    console.log(`   Snippet: ${sourceArticle.content?.substring(0, 150)}...\n`)

    console.log('🔎 Finding similar articles...\n')

    // Find similar articles (0.7 threshold = 70% similarity)
    const similarArticles = await findSimilarArticles(articleId, 10, 0.7)

    if (similarArticles.length === 0) {
      console.log('   No similar articles found (similarity >= 0.7)\n')

      // Try with lower threshold
      console.log('   Trying with lower threshold (0.5)...\n')
      const lowerResults = await findSimilarArticles(articleId, 10, 0.5)

      if (lowerResults.length === 0) {
        console.log('   Still no similar articles found\n')
      } else {
        console.log(`   Found ${lowerResults.length} articles with 50%+ similarity:\n`)
        lowerResults.forEach((result, idx) => {
          console.log(`   ${idx + 1}. Article ${result.articleId} (${(result.similarity * 100).toFixed(1)}% similar)`)
          console.log(`      ${result.title}\n`)
        })
      }
    } else {
      console.log(`✅ Found ${similarArticles.length} similar articles:\n`)
      console.log('=' .repeat(70))

      similarArticles.forEach((result, idx) => {
        const percentage = (result.similarity * 100).toFixed(1)
        const bars = '█'.repeat(Math.round(result.similarity * 20))

        console.log(`\n${idx + 1}. Similarity: ${percentage}% ${bars}`)
        console.log(`   Article ID: ${result.articleId}`)
        console.log(`   Title: ${result.title}`)
      })

      console.log('\n' + '=' .repeat(70))

      // Show statistics
      const avgSimilarity = similarArticles.reduce((sum, r) => sum + r.similarity, 0) / similarArticles.length
      const maxSimilarity = Math.max(...similarArticles.map((r) => r.similarity))
      const minSimilarity = Math.min(...similarArticles.map((r) => r.similarity))

      console.log('\n📊 Statistics:')
      console.log(`   Average similarity: ${(avgSimilarity * 100).toFixed(1)}%`)
      console.log(`   Max similarity: ${(maxSimilarity * 100).toFixed(1)}%`)
      console.log(`   Min similarity: ${(minSimilarity * 100).toFixed(1)}%`)
    }

    console.log('\n✨ Similarity test complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Similarity test failed:', error)
    process.exit(1)
  }
}

testSimilarity()
