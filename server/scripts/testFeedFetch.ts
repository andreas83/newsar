/**
 * Test RSS feed fetching
 *
 * Run with: npx tsx server/scripts/testFeedFetch.ts [feedId]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { feeds, articles } from '../database/schema'
import { parseFeed } from '../services/rssParser'
import { eq } from 'drizzle-orm'

// Load environment variables
config()

async function testFeedFetch() {
  const db = getDatabase()
  const feedId = parseInt(process.argv[2]) || null

  try {
    if (feedId) {
      // Test single feed
      console.log(`\n🧪 Testing feed fetch for feed ID: ${feedId}\n`)

      const result = await parseFeed(feedId)

      console.log('\n📊 Fetch Results:')
      console.log(`   Feed: ${result.feedName}`)
      console.log(`   Processed: ${result.results.processed}`)
      console.log(`   Inserted: ${result.results.inserted}`)
      console.log(`   Skipped: ${result.results.skipped}`)
      console.log(`   Errors: ${result.results.errors}`)
    } else {
      // Test all feeds
      console.log('\n🧪 Testing RSS fetch for ALL feeds\n')

      const allFeeds = await db
        .select()
        .from(feeds)
        .where(eq(feeds.isActive, 1))

      console.log(`Found ${allFeeds.length} active feeds\n`)

      const results = []

      for (const feed of allFeeds) {
        console.log(`\n📡 Fetching: ${feed.name}...`)
        try {
          const result = await parseFeed(feed.id)
          results.push(result)

          console.log(`   ✅ Success: ${result.results.inserted} new articles`)
        } catch (error: any) {
          console.error(`   ❌ Failed: ${error.message}`)
          results.push({
            feedId: feed.id,
            feedName: feed.name,
            success: false,
            error: error.message,
          })
        }
      }

      // Summary
      console.log('\n\n📊 SUMMARY')
      console.log('=' .repeat(60))

      let totalProcessed = 0
      let totalInserted = 0
      let totalSkipped = 0
      let totalErrors = 0

      results.forEach((result: any) => {
        if (result.results) {
          console.log(`\n${result.feedName}:`)
          console.log(`   Processed: ${result.results.processed}`)
          console.log(`   Inserted:  ${result.results.inserted} ✅`)
          console.log(`   Skipped:   ${result.results.skipped}`)
          console.log(`   Errors:    ${result.results.errors}`)

          totalProcessed += result.results.processed
          totalInserted += result.results.inserted
          totalSkipped += result.results.skipped
          totalErrors += result.results.errors
        } else if (result.error) {
          console.log(`\n${result.feedName}: ❌ ${result.error}`)
        }
      })

      console.log('\n' + '='.repeat(60))
      console.log('TOTAL:')
      console.log(`   Processed: ${totalProcessed}`)
      console.log(`   Inserted:  ${totalInserted} ✅`)
      console.log(`   Skipped:   ${totalSkipped}`)
      console.log(`   Errors:    ${totalErrors}`)
    }

    // Show database stats
    console.log('\n\n💾 Database Stats:')
    const articleCount = await db.select().from(articles)
    console.log(`   Total articles in database: ${articleCount.length}`)

    const feedStats = await db.select().from(feeds)
    for (const feed of feedStats) {
      const feedArticles = await db
        .select()
        .from(articles)
        .where(eq(articles.feedId, feed.id))

      console.log(`   ${feed.name}: ${feedArticles.length} articles`)
    }

    console.log('\n✨ Test complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

testFeedFetch()
