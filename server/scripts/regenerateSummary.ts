/**
 * Regenerate summary for a specific article
 * Usage: npx tsx server/scripts/regenerateSummary.ts <articleId>
 */
import 'dotenv/config'
import { buildSummaryPrompt, parseSummaryResponse } from '../services/summaryGenerator'
import { getDatabase } from '../database/db'
import { articles, analyses, classifications } from '../database/schema'
import { eq } from 'drizzle-orm'
import { generateChatCompletion } from '../utils/ollama'

const db = getDatabase()

const articleId = parseInt(process.argv[2])
if (!articleId) {
  console.error('Usage: npx tsx server/scripts/regenerateSummary.ts <articleId>')
  process.exit(1)
}

const [article] = await db.select().from(articles).where(eq(articles.id, articleId))
if (!article) {
  console.error('Article not found:', articleId)
  process.exit(1)
}

// Get language
const [cls] = await db.select().from(classifications).where(eq(classifications.articleId, articleId))
const lang = cls?.language || 'en'

const content = article.fullContent || article.content || ''
const description = article.fullContent ? (article.content || undefined) : undefined
console.log('Article title:', article.title)
console.log('Content length:', content.length, 'chars')
console.log('Description:', description ? description.substring(0, 100) + '...' : '(none)')
console.log('Language:', lang)

// Build prompt with updated settings
const { prompt, options } = buildSummaryPrompt(article.title, content, 'medium', lang, description)

// Generate new summary
console.log('\nGenerating summary...')
const response = await generateChatCompletion(prompt, undefined, {
  temperature: options.temperature,
  maxTokens: options.maxTokens,
})

const result = parseSummaryResponse(response)
console.log('\nNew summary:', result.summary)
console.log('Word count:', result.wordCount)

if (result.success) {
  await db.update(analyses)
    .set({ summary: result.summary, updatedAt: new Date() })
    .where(eq(analyses.articleId, articleId))
  console.log('\n✅ Summary updated in database')
} else {
  console.error('\n❌ Summary generation failed:', result.error)
}

process.exit(0)
