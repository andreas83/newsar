#!/usr/bin/env tsx

/**
 * Find Duplicate Articles Script
 *
 * Scans recent articles for near-duplicates using title similarity and
 * embedding cosine similarity. Identifies syndicated content that slips
 * through the SHA-256 exact hash check.
 *
 * This script ONLY displays candidates for review - it does NOT auto-exclude.
 *
 * Usage:
 *   npx tsx server/scripts/findDuplicateArticles.ts [options]
 *
 * Options (positional):
 *   1. article ID: specific article to check, or "scan" for batch scan (default: scan)
 *   2. days: how many days back to scan (default: 7)
 *   3. title threshold: minimum title similarity 0.0-1.0 (default: 0.85)
 *   4. limit: max results (default: 100)
 *
 * Examples:
 *   npx tsx server/scripts/findDuplicateArticles.ts                    # Scan last 7 days
 *   npx tsx server/scripts/findDuplicateArticles.ts scan 14            # Scan last 14 days
 *   npx tsx server/scripts/findDuplicateArticles.ts scan 7 0.80        # Lower title threshold
 *   npx tsx server/scripts/findDuplicateArticles.ts 12345              # Check specific article
 *   npx tsx server/scripts/findDuplicateArticles.ts 12345 30           # Check article against last 30 days
 */

// Load environment variables first
import { config } from 'dotenv'
config()

import { findNearDuplicates, type NearDuplicate } from '../services/articleDeduplicator'

function formatDate(date: Date | null): string {
  if (!date) return 'N/A'
  return date.toISOString().replace('T', ' ').substring(0, 19)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.substring(0, maxLen - 3) + '...'
}

async function main() {
  const arg1 = process.argv[2] || 'scan'
  const articleId = arg1 !== 'scan' ? parseInt(arg1) : undefined
  const days = parseInt(process.argv[3]) || 7
  const titleThreshold = parseFloat(process.argv[4]) || 0.85
  const limit = parseInt(process.argv[5]) || 100

  console.log('=== Article Near-Duplicate Finder ===\n')
  if (articleId) {
    console.log(`Mode:             Single article (#${articleId})`)
  } else {
    console.log(`Mode:             Batch scan`)
  }
  console.log(`Days back:        ${days}`)
  console.log(`Title threshold:  ${titleThreshold}`)
  console.log(`Max results:      ${limit}`)
  console.log('')

  const startTime = Date.now()

  try {
    const duplicates = await findNearDuplicates({
      articleId,
      days,
      titleThreshold,
      limit,
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(`\n${'='.repeat(100)}`)
    console.log(`Found ${duplicates.length} near-duplicate pairs in ${duration}s`)
    console.log(`${'='.repeat(100)}\n`)

    if (duplicates.length === 0) {
      console.log('No near-duplicates found with current settings.')
      console.log('Try lowering the title threshold or increasing the days range.')
      process.exit(0)
    }

    // Split by classification
    const definite = duplicates.filter(d => d.classification === 'duplicate')
    const possible = duplicates.filter(d => d.classification === 'possible_duplicate')

    if (definite.length > 0) {
      console.log(`\n--- DUPLICATES (${definite.length} pairs) ---\n`)
      printDuplicates(definite)
    }

    if (possible.length > 0) {
      console.log(`\n--- POSSIBLE DUPLICATES (${possible.length} pairs) ---\n`)
      printDuplicates(possible)
    }

    // Summary
    console.log(`${'='.repeat(100)}`)
    console.log('SUMMARY:')
    console.log(`  Total pairs found:      ${duplicates.length}`)
    console.log(`  Definite duplicates:    ${definite.length}`)
    console.log(`  Possible duplicates:    ${possible.length}`)

    const withEmbeddings = duplicates.filter(d => d.embeddingSimilarity !== null)
    const withoutEmbeddings = duplicates.filter(d => d.embeddingSimilarity === null)
    console.log(`  With embeddings:        ${withEmbeddings.length}`)
    console.log(`  Without embeddings:     ${withoutEmbeddings.length}`)

    if (definite.length > 0) {
      const avgTitleSim = definite.reduce((sum, d) => sum + d.titleSimilarity, 0) / definite.length
      const avgEmbSim = definite
        .filter(d => d.embeddingSimilarity !== null)
        .reduce((sum, d) => sum + (d.embeddingSimilarity || 0), 0) /
        (definite.filter(d => d.embeddingSimilarity !== null).length || 1)

      console.log(`\n  Avg title similarity (duplicates):     ${(avgTitleSim * 100).toFixed(1)}%`)
      console.log(`  Avg embedding similarity (duplicates): ${(avgEmbSim * 100).toFixed(1)}%`)
    }

    console.log(`\nNote: This is a READ-ONLY scan. No articles were excluded.`)
    console.log(`To exclude duplicates, use the markAsDuplicate() function from articleDeduplicator.ts`)

  } catch (error) {
    console.error('Error finding duplicates:', error)
    process.exit(1)
  }

  process.exit(0)
}

function printDuplicates(duplicates: NearDuplicate[]) {
  for (let i = 0; i < duplicates.length; i++) {
    const d = duplicates[i]

    const titleSim = (d.titleSimilarity * 100).toFixed(1)
    const embSim = d.embeddingSimilarity !== null
      ? (d.embeddingSimilarity * 100).toFixed(1) + '%'
      : 'N/A'

    console.log(`  ${i + 1}. Title Sim: ${titleSim}% | Embedding Sim: ${embSim}`)
    console.log(`     Article A (#${d.article1.id}): ${truncate(d.article1.title, 70)}`)
    console.log(`       Feed: ${d.article1.feedName} | Published: ${formatDate(d.article1.publishedAt)}`)
    console.log(`     Article B (#${d.article2.id}): ${truncate(d.article2.title, 70)}`)
    console.log(`       Feed: ${d.article2.feedName} | Published: ${formatDate(d.article2.publishedAt)}`)
    console.log('')
  }
}

main()
