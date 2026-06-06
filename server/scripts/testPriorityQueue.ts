// Load environment variables first
import { config } from 'dotenv'
config()

import { calculateArticlePriority } from '../queues/feedQueue.js'
import { getDatabase } from '../database/db.js'
import { articles, storyMembers, stories } from '../database/schema.js'
import { desc, eq } from 'drizzle-orm'

const db = getDatabase()

console.log('=== Testing Priority Queue System ===\n')

// Get a mix of articles for testing
const testArticles = await db
  .select({
    id: articles.id,
    title: articles.title,
    publishedAt: articles.publishedAt,
    storyId: storyMembers.storyId,
    status: stories.status,
  })
  .from(articles)
  .leftJoin(storyMembers, eq(articles.id, storyMembers.articleId))
  .leftJoin(stories, eq(storyMembers.storyId, stories.id))
  .orderBy(desc(articles.publishedAt))
  .limit(10)

console.log('Testing priority calculation for 10 recent articles:\n')

for (const article of testArticles) {
  const priority = await calculateArticlePriority(article.id)
  const now = new Date()
  const publishedAt = new Date(article.publishedAt)
  const hoursAgo = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60)

  const priorityLabel = priority <= 10 ? '🔥 HIGH' : priority <= 20 ? '⚡ MEDIUM' : '📋 NORMAL'

  console.log(`Article ${article.id}:`)
  console.log(`  Title: ${article.title.substring(0, 60)}...`)
  console.log(`  Published: ${hoursAgo.toFixed(1)}h ago`)
  console.log(`  Story Status: ${article.status || 'none'}`)
  console.log(`  Priority: ${priority} ${priorityLabel}`)
  console.log('')
}

console.log('\n=== Priority Rules ===')
console.log('Priority 5:  Recent (<6h) + Trending story')
console.log('Priority 10: Recent (<6h) article')
console.log('Priority 15: Trending/emerging story')
console.log('Priority 30: Default (older articles)')

process.exit(0)
