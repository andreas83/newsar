/**
 * Auto-Merge Duplicate Entities
 *
 * Finds duplicate entity candidates and automatically merges those above
 * a confidence threshold. For each pair, keeps the entity with more mentions
 * and merges the other into it.
 *
 * Usage: npx tsx server/scripts/mergeEntities.ts [type] [confidence] [limit] [dryRun]
 *   type: entity type filter ('person', 'organization', 'location', 'event', or 'all') (default: all)
 *   confidence: minimum confidence for auto-merge (default: 0.85)
 *   limit: max pairs to process (default: 200)
 *   dryRun: set to 'false' to actually merge (default: 'true' — dry run)
 *
 * Examples:
 *   npx tsx server/scripts/mergeEntities.ts                         # Dry run, all types
 *   npx tsx server/scripts/mergeEntities.ts person 0.9 100 false    # Merge persons with 90%+ confidence
 *   npx tsx server/scripts/mergeEntities.ts all 0.85 200 false      # Merge all types, 85%+ confidence
 */

import { config } from 'dotenv'
config()

import { findDuplicateCandidates, mergeEntities, type DuplicateCandidate } from '../services/entityDeduplicator'

async function main() {
  const entityType = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : undefined
  const minConfidence = parseFloat(process.argv[3]) || 0.85
  const limit = parseInt(process.argv[4]) || 200
  const dryRun = (process.argv[5] || 'true') !== 'false'

  console.log('=== Entity Auto-Merge ===\n')
  console.log(`Entity Type:      ${entityType || 'all'}`)
  console.log(`Min Confidence:   ${minConfidence}`)
  console.log(`Max Pairs:        ${limit}`)
  console.log(`Mode:             ${dryRun ? 'DRY RUN (preview only)' : 'LIVE MERGE'}`)
  console.log('')

  const startTime = Date.now()

  // Find candidates
  console.log('Finding duplicate candidates...')
  const candidates = await findDuplicateCandidates({
    entityType,
    minConfidence,
    limit,
    minMentions: 1,
  })

  console.log(`Found ${candidates.length} candidate pairs above ${minConfidence} confidence\n`)

  if (candidates.length === 0) {
    console.log('No duplicates found. Exiting.')
    process.exit(0)
  }

  // Group by type for display
  const byType = new Map<string, DuplicateCandidate[]>()
  for (const c of candidates) {
    const type = c.entity1.type
    const group = byType.get(type) || []
    group.push(c)
    byType.set(type, group)
  }

  for (const [type, group] of byType) {
    console.log(`--- ${type.toUpperCase()} (${group.length} pairs) ---`)
  }
  console.log('')

  if (dryRun) {
    // Just display the candidates
    for (const [type, group] of byType) {
      console.log(`\n--- ${type.toUpperCase()} ---\n`)
      for (let i = 0; i < group.length; i++) {
        const c = group[i]
        // Determine keep/remove: keep the one with more mentions
        const keepEntity = c.entity1.mentionCount >= c.entity2.mentionCount ? c.entity1 : c.entity2
        const removeEntity = keepEntity === c.entity1 ? c.entity2 : c.entity1

        console.log(`  ${i + 1}. [${(c.confidence * 100).toFixed(0)}%] KEEP: "${keepEntity.name}" (${keepEntity.mentionCount} mentions)`)
        console.log(`              REMOVE: "${removeEntity.name}" (${removeEntity.mentionCount} mentions)`)
        console.log(`              Reasons: ${c.reasons.join('; ')}`)
      }
    }

    console.log(`\n\nTo execute merges, run:`)
    console.log(`  npx tsx server/scripts/mergeEntities.ts ${entityType || 'all'} ${minConfidence} ${limit} false`)
    process.exit(0)
  }

  // Execute merges
  let merged = 0
  let failed = 0
  const mergedIds = new Set<number>() // Track already-merged entity IDs to avoid conflicts

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]

    // Determine keep/remove: keep the one with more mentions
    const keepEntity = c.entity1.mentionCount >= c.entity2.mentionCount ? c.entity1 : c.entity2
    const removeEntity = keepEntity === c.entity1 ? c.entity2 : c.entity1

    // Skip if either entity was already merged in this run
    if (mergedIds.has(keepEntity.id) || mergedIds.has(removeEntity.id)) {
      console.log(`  [${i + 1}/${candidates.length}] SKIP: "${removeEntity.name}" — entity already merged in this run`)
      continue
    }

    try {
      console.log(`  [${i + 1}/${candidates.length}] Merging "${removeEntity.name}" → "${keepEntity.name}" (${(c.confidence * 100).toFixed(0)}% confidence)`)
      await mergeEntities(keepEntity.id, removeEntity.id)
      mergedIds.add(removeEntity.id)
      merged++
    } catch (err: any) {
      console.error(`  [${i + 1}/${candidates.length}] FAILED: ${err.message}`)
      failed++
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log(`\n${'='.repeat(60)}`)
  console.log(`MERGE COMPLETE`)
  console.log(`  Merged:  ${merged}`)
  console.log(`  Failed:  ${failed}`)
  console.log(`  Skipped: ${candidates.length - merged - failed}`)
  console.log(`  Duration: ${duration}s`)
  console.log(`${'='.repeat(60)}`)

  process.exit(0)
}

main().catch((err) => {
  console.error('Merge failed:', err)
  process.exit(1)
})
