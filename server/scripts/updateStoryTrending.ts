#!/usr/bin/env tsx
/**
 * Update Story Trending Scores
 * Calculates and updates trending scores and status for all stories
 */

import { config } from 'dotenv'
import { updateAllStoryTrendingScores, updateAllStoryTitles, updateAllStoryTimestamps, updateAllStoryCoverage, updateAllStoryFramingCoverage } from '../services/storyTrending'

config()

async function main() {
  console.log('Starting story trending score update...\n')

  try {
    // First, fix last_updated timestamps based on actual article dates
    console.log('Step 1: Fixing story timestamps...')
    const timestampCount = await updateAllStoryTimestamps()
    console.log(`✓ Updated ${timestampCount} story timestamps\n`)

    // Update all story titles
    console.log('Step 2: Updating story titles...')
    const titleCount = await updateAllStoryTitles()
    console.log(`✓ Updated ${titleCount} story titles\n`)

    // Update story coverage (left/center/right bias counts)
    console.log('Step 3: Updating story coverage...')
    const coverageCount = await updateAllStoryCoverage()
    console.log(`✓ Updated coverage for ${coverageCount} stories\n`)

    // Update framing coverage (framing distribution, avg sensationalism, avg factuality)
    console.log('Step 4: Updating framing coverage...')
    const framingCount = await updateAllStoryFramingCoverage()
    console.log(`✓ Updated framing coverage for ${framingCount} stories\n`)

    // Then update trending scores and statuses
    console.log('Step 5: Calculating trending scores...')
    const stats = await updateAllStoryTrendingScores()

    console.log('\n=== Update Complete ===')
    console.log(`Total stories updated: ${stats.updated}`)
    console.log(`  - Trending: ${stats.trending}`)
    console.log(`  - Emerging: ${stats.emerging}`)
    console.log(`  - Active: ${stats.active}`)
    console.log(`  - Declining: ${stats.declining}`)

    process.exit(0)
  } catch (error) {
    console.error('Error updating story trending scores:', error)
    process.exit(1)
  }
}

main()
