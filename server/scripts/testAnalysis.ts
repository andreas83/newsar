/**
 * Test article analysis (keywords, summary, sentiment)
 *
 * Run with: npm run test:analyze [articleId]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { analyzeArticle, getArticleAnalysis } from '../services/articleAnalyzer'
import { getArticleKeywords } from '../services/keywordExtractor'
import { eq } from 'drizzle-orm'

// Load environment variables
config()

async function testAnalysis() {
  const db = getDatabase()
  const articleId = parseInt(process.argv[2])

  if (!articleId || isNaN(articleId)) {
    console.log('\n❌ Please provide an article ID\n')
    console.log('Usage: npm run test:analyze [articleId]\n')
    process.exit(1)
  }

  try {
    console.log(`\n🔬 Testing analysis for article ${articleId}\n`)

    // Get the article
    const [article] = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!article) {
      console.log(`❌ Article ${articleId} not found\n`)
      process.exit(1)
    }

    console.log('📰 Article:')
    console.log(`   ID: ${article.id}`)
    console.log(`   Title: ${article.title}`)
    console.log(`   Snippet: ${article.content?.substring(0, 150)}...\n`)

    console.log('🔎 Running analysis...\n')
    console.log('=' .repeat(70))

    // Run analysis
    const result = await analyzeArticle(articleId, true)

    console.log('\n' + '=' .repeat(70))
    console.log('\n📊 Analysis Results:')

    if (!result.success) {
      console.log(`   ❌ Failed: ${result.error}\n`)
      process.exit(1)
    }

    console.log(`   ✅ Success!`)

    // Get full analysis details
    const analysis = await getArticleAnalysis(articleId)
    const keywords = await getArticleKeywords(articleId)

    // Keywords
    if (keywords.length > 0) {
      console.log(`\n🏷️  Keywords (${keywords.length}):`)
      keywords
        .sort((a, b) => b.relevance - a.relevance)
        .forEach((k) => {
          const relevanceBar = '█'.repeat(Math.round(k.relevance * 10))
          console.log(`   ${relevanceBar} ${k.keyword} (${k.category}, ${(k.relevance * 100).toFixed(0)}%)`)
        })
    }

    // Summary
    if (analysis && analysis.summary) {
      console.log(`\n📝 Summary (${result.summaryLength} words):`)
      console.log(`   ${analysis.summary}`)
    }

    // Sentiment
    if (analysis && analysis.sentiment !== null) {
      const sentiment = analysis.sentiment
      const label = result.sentimentLabel || 'Unknown'
      const emoji = getSentimentEmoji(sentiment)
      const bar = getSentimentBar(sentiment)

      console.log(`\n😊 Sentiment: ${emoji} ${label}`)
      console.log(`   Score: ${sentiment.toFixed(3)}`)
      console.log(`   ${bar}`)
      console.log(`   Confidence: ${((analysis.sentimentConfidence || 0) * 100).toFixed(0)}%`)

      // Metadata
      const metadata = analysis.analysisMetadata as any
      if (metadata && metadata.emotions && metadata.emotions.length > 0) {
        console.log(`   Emotions: ${metadata.emotions.join(', ')}`)
      }
      if (metadata && metadata.sentimentTone) {
        console.log(`   Tone: ${metadata.sentimentTone}`)
      }
    }

    console.log('\n✨ Analysis test complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Analysis test failed:', error)
    process.exit(1)
  }
}

function getSentimentEmoji(sentiment: number): string {
  if (sentiment <= -0.6) return '😢'
  if (sentiment <= -0.2) return '😟'
  if (sentiment < 0.2) return '😐'
  if (sentiment < 0.6) return '🙂'
  return '😄'
}

function getSentimentBar(sentiment: number): string {
  // Create a visual bar from -1 to 1
  const normalized = (sentiment + 1) / 2 // Convert -1..1 to 0..1
  const position = Math.round(normalized * 40) // 40 char wide bar

  const negative = '█'.repeat(Math.max(0, 20 - position))
  const positive = '█'.repeat(Math.max(0, position - 20))
  const marker = '●'

  return `   [-] ${negative}${' '.repeat(Math.max(0, 20 - negative.length))}${marker}${' '.repeat(Math.max(0, 20 - positive.length))}${positive} [+]`
}

testAnalysis()
