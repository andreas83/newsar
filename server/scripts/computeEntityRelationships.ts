#!/usr/bin/env tsx

/**
 * Compute Entity Relationships Script
 *
 * Computes entity-to-entity co-occurrence relationships for network graph visualization.
 * Run this after articles have been processed and entities extracted.
 *
 * Usage:
 *   npm run relationships:compute [minCooccurrence] [fromDate]
 *
 * Examples:
 *   npm run relationships:compute          # Compute all relationships (min 2 co-occurrences)
 *   npm run relationships:compute 3        # Require at least 3 co-occurrences
 *   npm run relationships:compute 2 7      # Last 7 days, min 2 co-occurrences
 */

// Load environment variables first
import { config } from 'dotenv'
config()

import { computeEntityRelationships } from '../services/entityRelationshipComputer'

async function main() {
  const minCooccurrence = parseInt(process.argv[2]) || 2
  const daysBack = parseInt(process.argv[3]) || 0

  const fromDate = daysBack > 0
    ? new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    : undefined

  console.log('🚀 Computing Entity Relationships')
  console.log('='.repeat(50))
  console.log(`Min Co-occurrence: ${minCooccurrence}`)
  console.log(`Date Range: ${fromDate ? `Last ${daysBack} days` : 'All time'}`)
  console.log('')

  const startTime = Date.now()

  try {
    const count = await computeEntityRelationships({
      minCooccurrence,
      fromDate,
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('')
    console.log('='.repeat(50))
    console.log(`✅ Successfully computed ${count} relationships`)
    console.log(`⏱️  Duration: ${duration}s`)
    console.log('')
    console.log('💡 Next steps:')
    console.log('   - View network graph at /admin/network')
    console.log('   - Run "npm run relationships:compute" periodically to update')
    console.log('')

    process.exit(0)
  } catch (error) {
    console.error('❌ Error computing relationships:', error)
    process.exit(1)
  }
}

main()
