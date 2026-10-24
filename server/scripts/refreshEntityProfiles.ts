#!/usr/bin/env tsx
/**
 * Force-regenerate entity profiles, e.g. ones with stale titles ("former President Trump").
 * The current version moves to history as usual; entities with no articles in the window are skipped.
 *
 * Usage:
 *   npm run entities:refresh -- 181 365            # specific entities
 *   npm run entities:refresh -- --stale --dry-run  # list profiles with known stale titles
 *   npm run entities:refresh -- --stale            # regenerate them
 */

import { config } from 'dotenv'
config()

import { sql } from 'drizzle-orm'
import { getDatabase } from '../database/db'
import { updateEntitySummary } from '../services/entitySummarizer'

// Known stale-fact patterns (as of 2026-10): Trump is the sitting president, Biden is not, Starmer is no longer PM
const STALE = String.raw`former (us |u\.s\. )?president (donald )?trump|(current|sitting|incumbent) (us |u\.s\. )?president,? (joe )?biden|biden is the current|prime minister (sir )?keir starmer|starmer, the (uk |british )?prime minister`

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const db = getDatabase()

  let ids = args.filter(a => /^\d+$/.test(a)).map(Number)
  if (args.includes('--stale')) {
    const rows = await db.execute(sql`
      SELECT s.entity_id AS id, e.name, s.mention_count
      FROM entity_summaries s JOIN entities e ON e.id = s.entity_id
      WHERE s.summary ~* ${STALE} OR s.short_description ~* ${STALE}
         OR (e.id = 181 AND s.short_description ~* 'current')
      ORDER BY s.mention_count DESC NULLS LAST`)
    ids = [...new Set([...ids, ...(rows.rows as any[]).map(r => Number(r.id))])]
    if (dryRun) for (const r of rows.rows as any[]) console.log(`${r.id}\t${r.mention_count}\t${r.name}`)
  }

  console.log(`${ids.length} entities${dryRun ? ' (dry run, nothing written)' : ''}`)
  if (dryRun || !ids.length) process.exit(0)

  const counts: Record<string, number> = {}
  const queue = [...ids]
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const id = queue.shift()!
      try {
        const status = await updateEntitySummary(id, { force: true })
        counts[status] = (counts[status] || 0) + 1
      } catch (e) {
        counts.failed = (counts.failed || 0) + 1
        console.error(`  ✗ ${id}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }))
  console.log('Done:', counts)
  process.exit(0)
}

main()
