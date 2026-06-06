/**
 * Test article classification
 *
 * Run with: npx tsx server/scripts/testClassification.ts [articleId]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, classifications, articleEntities, entities as entitiesTable } from '../database/schema'
import { classifyArticle, getPendingClassification } from '../services/articleClassifier'
import { eq } from 'drizzle-orm'

// Load environment variables
config()

async function testClassification() {
  const db = getDatabase()
  const articleId = parseInt(process.argv[2]) || null

  try {
    if (articleId) {
      // Test single article
      console.log(`\n🧪 Testing classification for article ID: ${articleId}\n`)

      const result = await classifyArticle(articleId, true)

      console.log('\n📊 Classification Results:')
      console.log(`   Success: ${result.success}`)
      if (result.success) {
        console.log(`   Language: ${result.language}`)
        console.log(`   Bias: ${result.biasLabel} (${result.bias?.toFixed(2)})`)
        console.log(`   Geographic POV: ${result.geoPov || 'None detected'}`)
        console.log(`   Entities: ${result.entityCount}`)

        // Show extracted entities
        if (result.entityCount && result.entityCount > 0) {
          const entityLinks = await db
            .select({
              entityName: entitiesTable.name,
              entityType: entitiesTable.type,
              relevance: articleEntities.relevanceScore,
              mentions: articleEntities.mentionCount,
            })
            .from(articleEntities)
            .leftJoin(entitiesTable, eq(articleEntities.entityId, entitiesTable.id))
            .where(eq(articleEntities.articleId, articleId))

          console.log('\n   Extracted Entities:')
          entityLinks.forEach((e) => {
            console.log(`     - ${e.entityName} (${e.entityType}) - relevance: ${e.relevance?.toFixed(2)}, mentions: ${e.mentions}`)
          })
        }
      } else {
        console.log(`   Error: ${result.error}`)
      }
    } else {
      // Test on 5 pending articles
      console.log('\n🧪 Testing classification on pending articles\n')

      const pending = await getPendingClassification(5)

      if (pending.length === 0) {
        console.log('No pending articles to classify!\n')
        process.exit(0)
      }

      console.log(`Found ${pending.length} pending articles\n`)

      const results = []

      for (const article of pending) {
        console.log(`\n📰 Article ${article.id}: ${article.title.substring(0, 60)}...`)

        if (!article.contentExtracted) {
          console.log('   ⚠️  Skipping: Content not extracted yet')
          continue
        }

        try {
          const result = await classifyArticle(article.id, true)
          results.push(result)

          if (result.success) {
            console.log(`   ✅ ${result.language} | ${result.biasLabel} | ${result.entityCount} entities`)
          } else {
            console.log(`   ❌ Failed: ${result.error}`)
          }
        } catch (error: any) {
          console.error(`   ❌ Error: ${error.message}`)
          results.push({
            success: false,
            articleId: article.id,
            error: error.message,
          })
        }

        // Brief pause between articles to avoid overwhelming Ollama
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // Summary
      console.log('\n\n📊 SUMMARY')
      console.log('=' .repeat(60))

      const successful = results.filter((r) => r.success).length
      const failed = results.filter((r) => !r.success).length

      console.log(`Total Tested: ${results.length}`)
      console.log(`Successful:   ${successful} ✅`)
      console.log(`Failed:       ${failed} ❌`)

      // Show statistics
      if (successful > 0) {
        const languages = results
          .filter((r) => r.success && r.language)
          .map((r) => r.language)

        const biases = results
          .filter((r) => r.success && r.bias !== undefined)
          .map((r) => r.bias!)

        console.log('\n📈 Statistics:')
        console.log(`   Languages detected: ${[...new Set(languages)].join(', ')}`)

        if (biases.length > 0) {
          const avgBias = biases.reduce((a, b) => a + b, 0) / biases.length
          console.log(`   Average bias: ${avgBias.toFixed(2)}`)
        }

        const totalEntities = results.reduce((sum, r) => sum + (r.entityCount || 0), 0)
        console.log(`   Total entities extracted: ${totalEntities}`)
      }
    }

    // Database stats
    console.log('\n\n💾 Database Stats:')
    const allArticles = await db.select().from(articles)
    const classified = allArticles.filter((a) => a.processingStatus === 'grouped')
    const pendingCount = allArticles.filter((a) => a.processingStatus === 'pending').length

    console.log(`   Total articles: ${allArticles.length}`)
    console.log(`   Classified: ${classified.length}`)
    console.log(`   Pending classification: ${pendingCount}`)

    const classificationCount = await db.select().from(classifications)
    console.log(`   Classifications in DB: ${classificationCount.length}`)

    const entityCount = await db.select().from(entitiesTable)
    console.log(`   Unique entities: ${entityCount.length}`)

    console.log('\n✨ Test complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

testClassification()
