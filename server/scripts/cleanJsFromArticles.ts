/**
 * One-time cleanup script to strip embedded JS/CSS from article content
 *
 * Run with: npx tsx server/scripts/cleanJsFromArticles.ts [batch-size]
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { sql } from 'drizzle-orm'
import { postCleanText } from '../utils/contentCleaner'

config()

// Patterns that indicate JS/CSS contamination in stored content
const JS_CSS_DETECTION_SQL = sql`
  full_content LIKE '%freestar%'
  OR full_content LIKE '%function()%'
  OR full_content LIKE '%document.querySelector%'
  OR full_content LIKE '%document.getElementById%'
  OR full_content LIKE '%window.matchMedia%'
  OR full_content LIKE '%IntersectionObserver%'
  OR full_content LIKE '%dataLayer%'
  OR full_content LIKE '%@media%{%}%'
  OR content LIKE '%freestar%'
  OR content LIKE '%function()%'
  OR content LIKE '%document.querySelector%'
`

async function cleanJsFromArticles() {
  const db = getDatabase()
  const batchSize = parseInt(process.argv[2]) || 100

  console.log(`\nScanning for articles with embedded JS/CSS...\n`)

  // Count affected articles
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM articles
    WHERE ${JS_CSS_DETECTION_SQL}
  `)
  const totalAffected = Number((countResult.rows[0] as any).count)

  if (totalAffected === 0) {
    console.log('No articles with embedded JS/CSS found.')
    process.exit(0)
  }

  console.log(`Found ${totalAffected} affected articles. Processing in batches of ${batchSize}...\n`)

  let totalCleaned = 0
  let totalBlanked = 0
  let totalCharsSaved = 0
  let batchNum = 0

  while (true) {
    batchNum++
    // Always fetch from the top — cleaned rows no longer match the WHERE clause
    const batch = await db.execute(sql`
      SELECT id, content, full_content FROM articles
      WHERE ${JS_CSS_DETECTION_SQL}
      ORDER BY id
      LIMIT ${batchSize}
    `)

    const rows = batch.rows as any[]
    if (rows.length === 0) break

    for (const row of rows) {
      const id = row.id
      const originalContent = row.content || ''
      const originalFullContent = row.full_content || ''
      const originalTotal = originalContent.length + originalFullContent.length

      // Clean both fields
      const cleanedContent = originalContent ? postCleanText(originalContent) : null
      const cleanedFullContent = originalFullContent ? postCleanText(originalFullContent) : null

      const newTotal = (cleanedContent?.length || 0) + (cleanedFullContent?.length || 0)
      const charsSaved = originalTotal - newTotal

      // Always update to ensure rows stop matching the WHERE clause
      const updateData: Record<string, any> = {}
      if (cleanedContent !== null && cleanedContent !== originalContent) {
        updateData.content = cleanedContent || null
      }
      if (cleanedFullContent !== null && cleanedFullContent !== originalFullContent) {
        updateData.fullContent = cleanedFullContent || null
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(articles).set(updateData).where(sql`id = ${id}`)
        totalCleaned++
        totalCharsSaved += charsSaved

        if (newTotal === 0) {
          totalBlanked++
          console.log(`  Article ${id}: BLANKED (${originalTotal} chars were all JS/CSS)`)
        } else {
          console.log(`  Article ${id}: removed ${charsSaved} chars (${originalTotal} → ${newTotal})`)
        }
      }
    }

    console.log(`\n  Batch ${batchNum} done (${rows.length} rows). Cleaned so far: ${totalCleaned}\n`)
  }

  console.log(`\nDone!`)
  console.log(`  Articles cleaned: ${totalCleaned}`)
  console.log(`  Articles blanked (pure JS/CSS): ${totalBlanked}`)
  console.log(`  Total chars removed: ${totalCharsSaved.toLocaleString()}`)
  console.log(`  Average removed per article: ${totalCleaned > 0 ? Math.round(totalCharsSaved / totalCleaned).toLocaleString() : 0}`)

  process.exit(0)
}

cleanJsFromArticles().catch(err => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
