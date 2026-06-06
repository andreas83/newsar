import Parser from 'rss-parser'
import crypto from 'crypto'
import { getDatabase } from '../database/db.js'
import { feeds, articles } from '../database/schema.js'
import { eq } from 'drizzle-orm'
import { queueContentExtraction } from '../queues/feedQueue.js'

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

  // Basic HTML strip (you might want to use a proper HTML parser)
  content = content.replace(/<[^>]*>/g, ' ')

  // Normalize whitespace
  content = content.replace(/\s+/g, ' ').trim()

  return content
}

/**
 * Title patterns to skip (lottery results, horoscopes, etc.)
 * Case-insensitive regex patterns matched against article titles.
 */
const SKIP_TITLE_PATTERNS = [
  /\bsueldazo\b/i,
  /\bcuponazo\b/i,
  /\bonce[:\s].*resultados/i,
  /\blotería.*resultados/i,
  /\bcomprobar.*sorteo/i,
]

function shouldSkipByTitle(title: string): boolean {
  return SKIP_TITLE_PATTERNS.some(pattern => pattern.test(title))
}

/**
 * Parse and store articles from an RSS feed
 */
export async function parseFeed(feedId: number) {
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

    console.log(`Fetching RSS feed: ${feed.name} (${feed.url})`)

    // Parse RSS feed
    const rssFeed = await parser.parseURL(feed.url)

    console.log(`Found ${rssFeed.items.length} items in feed: ${feed.name}`)

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
          console.warn('Skipping item without URL:', item.title)
          results.skipped++
          continue
        }

        const title = item.title || 'Untitled'

        if (shouldSkipByTitle(title)) {
          console.log(`Skipping by title filter: ${title}`)
          results.skipped++
          continue
        }

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
          console.log(`Article already exists: ${title}`)
          results.skipped++
          continue
        }

        // Insert new article
        const [insertedArticle] = await db.insert(articles).values({
          feedId: feed.id,
          title,
          content,
          url,
          author,
          publishedAt,
          contentHash,
          processingStatus: 'pending', // Will be processed by auto-grouping later
          rawData: item as any, // Store original RSS data
        }).returning({ id: articles.id })

        results.inserted++
        console.log(`Inserted article: ${title}`)

        // Queue content extraction job
        try {
          await queueContentExtraction(insertedArticle.id, 15)
        } catch (queueError) {
          console.error(`Failed to queue content extraction for article ${insertedArticle.id}:`, queueError)
          // Don't fail the entire RSS parse if queueing fails
        }
      } catch (itemError) {
        console.error('Error processing item:', itemError)
        results.errors++
      }
    }

    // Update feed's last_fetched_at timestamp
    await db
      .update(feeds)
      .set({ lastFetchedAt: new Date() })
      .where(eq(feeds.id, feedId))

    console.log(`Feed fetch complete for ${feed.name}:`, results)

    return {
      success: true,
      feedId: feed.id,
      feedName: feed.name,
      results,
    }
  } catch (error) {
    console.error(`Error parsing feed ${feedId}:`, error)
    throw error
  }
}
