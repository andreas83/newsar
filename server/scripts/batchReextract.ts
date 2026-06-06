/**
 * Batch Re-Extract Short Articles
 *
 * Re-queues articles that were marked as 'partial' (< 500 chars) or 'fallback'
 * for a fresh extraction attempt. Resets their extraction status so they get
 * processed again through the normal extraction pipeline.
 *
 * Usage: npx tsx server/scripts/batchReextract.ts [limit] [maxContentLength]
 *   limit: max articles to reset (default: 1000)
 *   maxContentLength: only re-extract articles with content shorter than this (default: 500)
 */

import { config } from 'dotenv'
config()

import { getDatabase } from '../database/db'
import { articles } from '../database/schema'
import { sql, and, or, eq, lte, isNotNull } from 'drizzle-orm'

async function main() {
  const limit = parseInt(process.argv[2]) || 1000
  const maxContentLength = parseInt(process.argv[3]) || 500

  const db = getDatabase()

  console.log('=== Batch Re-Extract Short Articles ===\n')
  console.log(`Limit: ${limit}`)
  console.log(`Max content length: ${maxContentLength} chars`)

  // Count eligible articles
  const partialRaw = await db.execute(sql`
    SELECT COUNT(*) as count FROM articles WHERE extraction_status = 'partial'
  `)
  const partialCount = Number(((partialRaw as any).rows?.[0] || (partialRaw as any)[0])?.count || 0)

  const shortSuccessRaw = await db.execute(sql`
    SELECT COUNT(*) as count FROM articles
    WHERE extraction_status = 'success' AND full_content IS NOT NULL AND LENGTH(full_content) < ${maxContentLength}
  `)
  const shortSuccessCount = Number(((shortSuccessRaw as any).rows?.[0] || (shortSuccessRaw as any)[0])?.count || 0)

  const fallbackRaw = await db.execute(sql`
    SELECT COUNT(*) as count FROM articles
    WHERE extraction_status = 'fallback' AND (full_content IS NULL OR LENGTH(full_content) < ${maxContentLength})
  `)
  const fallbackCount = Number(((fallbackRaw as any).rows?.[0] || (fallbackRaw as any)[0])?.count || 0)

  console.log(`\nEligible articles:`)
  console.log(`  Partial status: ${partialCount}`)
  console.log(`  Short "success" (< ${maxContentLength} chars): ${shortSuccessCount}`)
  console.log(`  Short fallback (< ${maxContentLength} chars): ${fallbackCount}`)
  console.log(`  Total eligible: ${partialCount + shortSuccessCount + fallbackCount}`)

  // Reset extraction status for eligible articles
  // This makes them eligible for re-processing by batchExtract.ts
  const result = await db.execute(sql`
    UPDATE articles
    SET extraction_status = 'pending',
        content_extracted = false,
        extraction_error = NULL,
        extracted_at = NULL
    WHERE id IN (
      SELECT id FROM articles
      WHERE (
        extraction_status = 'partial'
        OR (extraction_status = 'success' AND full_content IS NOT NULL AND LENGTH(full_content) < ${maxContentLength})
        OR (extraction_status = 'fallback' AND (full_content IS NULL OR LENGTH(full_content) < ${maxContentLength}))
      )
      ORDER BY published_at DESC NULLS LAST
      LIMIT ${limit}
    )
  `)

  const resetCount = (result as any)?.rowCount || 0
  console.log(`\nReset ${resetCount} articles to 'pending' for re-extraction`)

  if (resetCount > 0) {
    console.log(`\nNext steps:`)
    console.log(`  1. Run extraction: npm run extract:all ${Math.min(resetCount, 100)} 3`)
    console.log(`  2. After extraction, re-classify: npm run classify:all ${Math.min(resetCount, 100)} 2`)
    console.log(`  3. Re-embed: npm run embed:all ${Math.min(resetCount, 100)} 3`)
    console.log(`  4. Re-cluster: npm run test:cluster 0.5 2`)
  }

  console.log('\n✅ Done')
  process.exit(0)
}

main().catch((err) => {
  console.error('Re-extraction setup failed:', err)
  process.exit(1)
})
