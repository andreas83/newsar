/**
 * Batch fetch articles from all RSS feeds (no Redis required)
 *
 * Run with: npm run fetch:all
 */

import { config } from 'dotenv'
import Parser from 'rss-parser'
import crypto from 'crypto'
import { getDatabase } from '../database/db.js'
import { feeds, articles } from '../database/schema.js'
import { eq } from 'drizzle-orm'

// Load environment variables
config()

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['content:encoded', 'contentEncoded'],
      ['description', 'description'],
    ],
  },
})

/**
 * Generate SHA-256 hash of content for deduplication
 */
function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Clean and extract text content from article
 */
function cleanContent(item: any): string {
  // Priority: content:encoded > description > summary
  let content = item.contentEncoded || item.content || item.description || item.summary || ''

  // Basic HTML strip
  content = content.replace(/<[^>]*>/g, ' ')

  // Normalize whitespace
  content = content.replace(/\s+/g, ' ').trim()

  return content
}

/**
 * Fetch articles from a single feed (no queue system)
 */
async function fetchFeed(feedId: number) {
  const db = getDatabase()

  try {
    // Get feed details
    const [feed] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.id, feedId))
      .limit(1)

    if (!feed) {
      throw new Error(`Feed ${feedId} not found`)
    }

    console.log(`\n📡 Fetching: ${feed.name}`)
    console.log(`   URL: ${feed.url}`)

    // Parse RSS feed
    const rssFeed = await parser.parseURL(feed.url)

    console.log(`   Found ${rssFeed.items.length} items in feed`)

    const results = {
      processed: 0,
      inserted: 0,
      skipped: 0,
      errors: 0,
    }

    // Process each item
    for (const item of rssFeed.items) {
      try {
        results.processed++

        // Extract article data
        const url = item.link || item.guid || ''
        if (!url) {
          console.warn('   ⚠️  Skipping item without URL:', item.title)
          results.skipped++
          continue
        }

        const title = item.title || 'Untitled'
        const content = cleanContent(item)
        const contentHash = generateContentHash(content)
        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date()
        const author = item.creator || item.author || null

        // Check if article already exists (by URL)
        const existing = await db
          .select()
          .from(articles)
          .where(eq(articles.url, url))
          .limit(1)

        if (existing.length > 0) {
          results.skipped++
          continue
        }

        // Insert new article
        await db.insert(articles).values({
          feedId: feed.id,
          title,
          content,
          url,
          author,
          publishedAt,
          contentHash,
          processingStatus: 'pending',
          rawData: item as any,
        })

        results.inserted++
        console.log(`   ✅ Inserted: ${title.substring(0, 60)}...`)
      } catch (itemError) {
        console.error('   ❌ Error processing item:', itemError)
        results.errors++
      }
    }

    // Update feed's last_fetched_at timestamp
    await db
      .update(feeds)
      .set({ lastFetchedAt: new Date() })
      .where(eq(feeds.id, feedId))

    return {
      success: true,
      feedId: feed.id,
      feedName: feed.name,
      results,
    }
  } catch (error) {
    console.error(`❌ Error parsing feed ${feedId}:`, error)
    return {
      success: false,
      feedId,
      feedName: 'Unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
      results: {
        processed: 0,
        inserted: 0,
        skipped: 0,
        errors: 0,
      },
    }
  }
}

/**
 * Fetch articles from all active feeds
 */
async function batchFetch() {
  const db = getDatabase()

  console.log('\n🚀 Starting batch RSS feed fetch (no Redis required)\n')
  console.log('=' .repeat(70))

  try {
    // Get all active feeds
    const allFeeds = await db
      .select()
      .from(feeds)
      .where(eq(feeds.isActive, 1))

    console.log(`Found ${allFeeds.length} active feeds\n`)

    if (allFeeds.length === 0) {
      console.log('⚠️  No active feeds found')
      process.exit(0)
    }

    const results = []

    // Fetch each feed sequentially
    for (const feed of allFeeds) {
      const result = await fetchFeed(feed.id)
      results.push(result)
    }

    // Summary
    console.log('\n\n📊 BATCH FETCH SUMMARY')
    console.log('=' .repeat(70))

    let totalProcessed = 0
    let totalInserted = 0
    let totalSkipped = 0
    let totalErrors = 0
    let successCount = 0
    let failCount = 0

    results.forEach((result: any) => {
      if (result.success) {
        successCount++
        console.log(`\n✅ ${result.feedName}:`)
        console.log(`   Processed: ${result.results.processed}`)
        console.log(`   Inserted:  ${result.results.inserted}`)
        console.log(`   Skipped:   ${result.results.skipped}`)
        console.log(`   Errors:    ${result.results.errors}`)

        totalProcessed += result.results.processed
        totalInserted += result.results.inserted
        totalSkipped += result.results.skipped
        totalErrors += result.results.errors
      } else {
        failCount++
        console.log(`\n❌ ${result.feedName}: ${result.error}`)
      }
    })

    console.log('\n' + '='.repeat(70))
    console.log('TOTAL:')
    console.log(`   Feeds successful: ${successCount}/${allFeeds.length}`)
    console.log(`   Feeds failed:     ${failCount}/${allFeeds.length}`)
    console.log(`   Processed:        ${totalProcessed}`)
    console.log(`   Inserted:         ${totalInserted} ✅`)
    console.log(`   Skipped:          ${totalSkipped}`)
    console.log(`   Errors:           ${totalErrors}`)

    // Show database stats
    console.log('\n💾 Database Stats:')
    const articleCount = await db.select().from(articles)
    console.log(`   Total articles in database: ${articleCount.length}`)

    console.log('\n✨ Batch fetch complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Batch fetch failed:', error)
    process.exit(1)
  }
}

batchFetch()
