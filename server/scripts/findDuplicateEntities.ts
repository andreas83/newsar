#!/usr/bin/env tsx

/**
 * Find Duplicate Entities Script
 *
 * Scans the entities table for potential duplicates using name normalization,
 * substring matching, and token overlap strategies.
 *
 * This script ONLY displays candidates for review - it does NOT auto-merge.
 *
 * Usage:
 *   npx tsx server/scripts/findDuplicateEntities.ts [options]
 *
 * Options (positional):
 *   1. entity type filter: person, organization, location, event, or "all" (default: all)
 *   2. minimum confidence: 0.0-1.0 (default: 0.6)
 *   3. limit: max results (default: 100)
 *   4. minimum mentions: only entities with >= N mentions (default: 1)
 *
 * Examples:
 *   npx tsx server/scripts/findDuplicateEntities.ts                    # All types, default settings
 *   npx tsx server/scripts/findDuplicateEntities.ts person             # Only person entities
 *   npx tsx server/scripts/findDuplicateEntities.ts person 0.8         # Persons with >= 0.8 confidence
 *   npx tsx server/scripts/findDuplicateEntities.ts all 0.6 200        # All types, 200 results
 *   npx tsx server/scripts/findDuplicateEntities.ts all 0.6 100 3      # Only entities with >= 3 mentions
 */

// Load environment variables first
import { config } from 'dotenv'
config()

import { findDuplicateCandidates } from '../services/entityDeduplicator'

async function main() {
  const entityType = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : undefined
  const minConfidence = parseFloat(process.argv[3]) || 0.6
  const limit = parseInt(process.argv[4]) || 100
  const minMentions = parseInt(process.argv[5]) || 1

  console.log('=== Entity Duplicate Finder ===\n')
  console.log(`Entity Type:      ${entityType || 'all'}`)
  console.log(`Min Confidence:   ${minConfidence}`)
  console.log(`Max Results:      ${limit}`)
  console.log(`Min Mentions:     ${minMentions}`)
  console.log('')

  const startTime = Date.now()

  try {
    const candidates = await findDuplicateCandidates({
      entityType,
      minConfidence,
      limit,
      minMentions,
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(`\n${'='.repeat(80)}`)
    console.log(`Found ${candidates.length} duplicate candidates in ${duration}s`)
    console.log(`${'='.repeat(80)}\n`)

    if (candidates.length === 0) {
      console.log('No duplicates found with current settings.')
      console.log('Try lowering the confidence threshold or minimum mentions.')
      process.exit(0)
    }

    // Group by type for better readability
    const byType = new Map<string, typeof candidates>()
    for (const c of candidates) {
      const type = c.entity1.type
      const group = byType.get(type) || []
      group.push(c)
      byType.set(type, group)
    }

    for (const [type, group] of byType) {
      console.log(`\n--- ${type.toUpperCase()} (${group.length} pairs) ---\n`)

      for (let i = 0; i < group.length; i++) {
        const c = group[i]
        const confidenceBar = '|'.repeat(Math.round(c.confidence * 20)).padEnd(20, '.')
        const confidencePercent = (c.confidence * 100).toFixed(0)

        console.log(`  ${i + 1}. [${confidenceBar}] ${confidencePercent}% confidence`)
        console.log(`     KEEP:   #${c.entity1.id} "${c.entity1.name}" (${c.entity1.mentionCount} mentions)`)
        console.log(`     REMOVE: #${c.entity2.id} "${c.entity2.name}" (${c.entity2.mentionCount} mentions)`)
        console.log(`     Reasons: ${c.reasons.join('; ')}`)
        console.log('')
      }
    }

    // Summary statistics
    console.log(`${'='.repeat(80)}`)
    console.log('SUMMARY:')
    console.log(`  Total candidate pairs: ${candidates.length}`)
    for (const [type, group] of byType) {
      console.log(`  ${type}: ${group.length} pairs`)
    }

    const highConfidence = candidates.filter(c => c.confidence >= 0.9)
    const medConfidence = candidates.filter(c => c.confidence >= 0.7 && c.confidence < 0.9)
    const lowConfidence = candidates.filter(c => c.confidence < 0.7)

    console.log(`\n  High confidence (>= 0.9): ${highConfidence.length}`)
    console.log(`  Medium confidence (0.7-0.9): ${medConfidence.length}`)
    console.log(`  Low confidence (< 0.7): ${lowConfidence.length}`)

    console.log(`\nNote: This is a READ-ONLY scan. No entities were merged.`)
    console.log(`To merge entities, use the mergeEntities() function from entityDeduplicator.ts`)

  } catch (error) {
    console.error('Error finding duplicates:', error)
    process.exit(1)
  }

  process.exit(0)
}

main()
