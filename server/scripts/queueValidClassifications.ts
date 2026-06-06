/**
 * Queue valid articles with sufficient content for classification
 */
import { config } from 'dotenv'
config()

import { getDatabase } from '../database/db.js'
import { articles, classifications } from '../database/schema.js'
import { eq, isNull, and, not, inArray, sql } from 'drizzle-orm'
import { queueArticleClassification } from '../queues/feedQueue.js'

const limit = parseInt(process.argv[2]) || 50

async function queueValidArticles() {
  const db = getDatabase()

  console.log(`Finding articles with sufficient content (>= 100 chars) for classification...`)

  // Get articles with content >= 100 chars but no classification
  const validArticles = await db
    .select({ id: articles.id, contentLength: sql<number>`LENGTH(${articles.fullContent})` })
    .from(articles)
    .leftJoin(classifications, eq(articles.id, classifications.articleId))
    .where(
      and(
        inArray(articles.extractionStatus, ['success', 'fallback']),
        sql`LENGTH(${articles.fullContent}) >= 100`,
        isNull(classifications.id)
      )
    )
    .limit(limit)

  console.log(`Found ${validArticles.length} valid articles`)

  if (validArticles.length === 0) {
    console.log('No valid articles to queue')
    process.exit(0)
  }

  // Queue them
  let queued = 0
  for (const article of validArticles) {
    try {
      await queueArticleClassification(article.id, 25)
      queued++
    } catch (error: any) {
      console.error(`Failed to queue article ${article.id}:`, error.message)
    }
  }

  console.log(`✓ Successfully queued ${queued} classification jobs`)
  process.exit(0)
}

queueValidArticles().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
