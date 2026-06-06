/**
 * Audit Geo Normalization Mappings
 *
 * Queries for unmapped geoPov values sorted by frequency.
 * Run periodically to catch new values as feeds are added.
 *
 * Usage: npx tsx server/scripts/auditGeoMappings.ts [minCount]
 *   minCount: minimum article count to display (default: 5)
 */

import { config } from 'dotenv'
config()

import { getDatabase } from '../database/db'
import { classifications, geoNormalization } from '../database/schema'
import { sql, isNotNull } from 'drizzle-orm'

async function main() {
  const minCount = parseInt(process.argv[2]) || 5
  const db = getDatabase()

  console.log('=== Geo Normalization Audit ===\n')

  // Total mappings
  const [{ count: totalMappings }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(geoNormalization)
  console.log(`Total mappings in geo_normalization: ${totalMappings}`)

  // Total classified articles with geoPov
  const [{ total, mapped, unmapped }] = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE LOWER(TRIM(geo_pov)) IN (SELECT LOWER(raw_value) FROM geo_normalization)) as mapped,
      COUNT(*) FILTER (WHERE LOWER(TRIM(geo_pov)) NOT IN (SELECT LOWER(raw_value) FROM geo_normalization)) as unmapped
    FROM classifications WHERE geo_pov IS NOT NULL
  `) as any

  const coverage = ((Number(mapped) / Number(total)) * 100).toFixed(1)
  console.log(`Articles with geo data: ${total}`)
  console.log(`  Mapped:   ${mapped} (${coverage}%)`)
  console.log(`  Unmapped: ${unmapped} (${(100 - parseFloat(coverage)).toFixed(1)}%)`)

  // Get unmapped values with counts
  const unmappedValues = await db.execute(sql`
    SELECT geo_pov, COUNT(*) as cnt
    FROM classifications
    WHERE geo_pov IS NOT NULL
      AND LOWER(TRIM(geo_pov)) NOT IN (SELECT LOWER(raw_value) FROM geo_normalization)
    GROUP BY geo_pov
    HAVING COUNT(*) >= ${minCount}
    ORDER BY COUNT(*) DESC
  `) as any[]

  console.log(`\nUnmapped values with >= ${minCount} articles: ${unmappedValues.length}\n`)

  if (unmappedValues.length === 0) {
    console.log('No unmapped values above threshold. Great coverage!')
    process.exit(0)
  }

  // Display results
  console.log('Raw geoPov Value'.padEnd(50) + 'Articles'.padStart(10))
  console.log('-'.repeat(60))

  let totalUnmappedArticles = 0
  for (const row of unmappedValues) {
    const geoPov = String(row.geo_pov)
    const count = Number(row.cnt)
    totalUnmappedArticles += count
    console.log(geoPov.padEnd(50) + String(count).padStart(10))
  }

  console.log('-'.repeat(60))
  console.log('Total unmapped articles (above threshold):'.padEnd(50) + String(totalUnmappedArticles).padStart(10))

  // Generate INSERT suggestions for top unmapped values
  console.log('\n\n=== Suggested SQL INSERTs ===\n')
  console.log('-- Add these to a new migration or run directly:')
  console.log("INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES")

  const top20 = unmappedValues.slice(0, 20)
  for (let i = 0; i < top20.length; i++) {
    const v = String(top20[i].geo_pov).replace(/'/g, "''")
    const comma = i < top20.length - 1 ? ',' : ';'
    console.log(`  ('${v}', '<COUNTRY>', '<REGION>')${comma}  -- ${top20[i].cnt} articles`)
  }

  console.log('\n✅ Audit complete')
  process.exit(0)
}

main().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})
