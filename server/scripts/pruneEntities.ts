/**
 * Prune Single-Mention Stale Entities
 *
 * Soft-deletes (or hard-deletes) entities that have exactly 1 article mention,
 * are older than a threshold, and have no AI summary. These are noise entities
 * that clutter the entity browser and network graphs.
 *
 * Also cleans up orphaned entities (zero article links).
 *
 * Usage: npx tsx server/scripts/pruneEntities.ts [daysOld] [dryRun]
 *   daysOld: minimum entity age in days (default: 30)
 *   dryRun: 'true' for preview, 'false' for actual deletion (default: 'true')
 *
 * Examples:
 *   npx tsx server/scripts/pruneEntities.ts                  # Preview prunable entities
 *   npx tsx server/scripts/pruneEntities.ts 30 false         # Delete entities > 30 days old with 1 mention
 */

import { config } from 'dotenv'
config()

import { getDatabase } from '../database/db'
import { entities, articleEntities, entitySummaries, storyEntities, entityRelationships } from '../database/schema'
import { sql, eq, and, lt, isNull, notInArray, inArray } from 'drizzle-orm'

async function main() {
  const daysOld = parseInt(process.argv[2]) || 30
  const dryRun = (process.argv[3] || 'true') !== 'false'

  const db = getDatabase()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  console.log('=== Entity Pruning ===\n')
  console.log(`Min age:  ${daysOld} days (before ${cutoffDate.toISOString().split('T')[0]})`)
  console.log(`Mode:     ${dryRun ? 'DRY RUN (preview only)' : 'LIVE DELETE'}`)
  console.log('')

  // ── Step 1: Find orphaned entities (zero article links) ──────────────
  const orphanedRaw = await db.execute(sql`
    SELECT e.id, e.type, e.name
    FROM entities e
    LEFT JOIN article_entities ae ON ae.entity_id = e.id
    WHERE ae.id IS NULL
  `)
  const orphanedResult = (orphanedRaw as any).rows || orphanedRaw || []

  console.log(`Orphaned entities (0 article links): ${orphanedResult.length}`)

  // ── Step 2: Find single-mention stale entities without summaries ─────
  const staleRaw = await db.execute(sql`
    SELECT e.id, e.type, e.name, COUNT(ae.id) as mention_count
    FROM entities e
    JOIN article_entities ae ON ae.entity_id = e.id
    LEFT JOIN entity_summaries es ON es.entity_id = e.id
    WHERE e.created_at < ${cutoffDate}
      AND es.id IS NULL
    GROUP BY e.id, e.type, e.name
    HAVING COUNT(ae.id) = 1
    ORDER BY e.type, e.name
  `)
  const staleResult = (staleRaw as any).rows || staleRaw || []

  console.log(`Single-mention stale entities (no summary, > ${daysOld} days): ${staleResult.length}`)

  // ── Summary by type ──────────────────────────────────────────────────
  const orphanByType = new Map<string, number>()
  for (const r of orphanedResult) {
    orphanByType.set(r.type, (orphanByType.get(r.type) || 0) + 1)
  }

  const staleByType = new Map<string, number>()
  for (const r of staleResult) {
    staleByType.set(r.type, (staleByType.get(r.type) || 0) + 1)
  }

  console.log('\nOrphaned by type:')
  for (const [type, count] of orphanByType) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nStale by type:')
  for (const [type, count] of staleByType) {
    console.log(`  ${type}: ${count}`)
  }

  const totalToPrune = orphanedResult.length + staleResult.length
  console.log(`\nTotal entities to prune: ${totalToPrune}`)

  if (totalToPrune === 0) {
    console.log('Nothing to prune. Exiting.')
    process.exit(0)
  }

  if (dryRun) {
    // Show samples
    if (orphanedResult.length > 0) {
      console.log('\nSample orphaned entities:')
      for (const r of orphanedResult.slice(0, 10)) {
        console.log(`  [${r.type}] #${r.id} "${r.name}"`)
      }
    }

    if (staleResult.length > 0) {
      console.log('\nSample stale entities:')
      for (const r of staleResult.slice(0, 20)) {
        console.log(`  [${r.type}] #${r.id} "${r.name}" (1 mention)`)
      }
    }

    console.log(`\nTo execute deletion, run:`)
    console.log(`  npx tsx server/scripts/pruneEntities.ts ${daysOld} false`)
    process.exit(0)
  }

  // ── Execute deletion ─────────────────────────────────────────────────

  // Collect all IDs to delete
  const idsToDelete = [
    ...orphanedResult.map((r: any) => r.id),
    ...staleResult.map((r: any) => r.id),
  ]

  if (idsToDelete.length === 0) {
    console.log('No entities to delete.')
    process.exit(0)
  }

  // Process in batches of 500 to avoid query size limits
  const batchSize = 500
  let totalDeleted = 0

  for (let i = 0; i < idsToDelete.length; i += batchSize) {
    const batch = idsToDelete.slice(i, i + batchSize)

    // Delete article_entities links for these entities
    await db
      .delete(articleEntities)
      .where(inArray(articleEntities.entityId, batch))

    // Delete story_entities links
    await db
      .delete(storyEntities)
      .where(inArray(storyEntities.entityId, batch))

    // Delete entity_relationships (cascade should handle this, but be explicit)
    await db
      .delete(entityRelationships)
      .where(sql`${entityRelationships.sourceEntityId} IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})
        OR ${entityRelationships.targetEntityId} IN (${sql.join(batch.map(id => sql`${id}`), sql`, `)})`)

    // Delete entity_summaries (cascade should handle, but explicit)
    await db
      .delete(entitySummaries)
      .where(inArray(entitySummaries.entityId, batch))

    // Delete the entities themselves
    await db
      .delete(entities)
      .where(inArray(entities.id, batch))

    totalDeleted += batch.length
    console.log(`  Deleted batch: ${totalDeleted}/${idsToDelete.length}`)
  }

  console.log(`\n✅ Pruned ${totalDeleted} entities`)
  console.log(`  Orphaned: ${orphanedResult.length}`)
  console.log(`  Stale single-mention: ${staleResult.length}`)

  process.exit(0)
}

main().catch((err) => {
  console.error('Pruning failed:', err)
  process.exit(1)
})
