#!/usr/bin/env tsx
/**
 * Generate story narratives (headline, overview, developments, perspectives)
 *
 * Usage:
 *   npm run stories:narrate [limit]                # stories that need one, most trending first (default 30)
 *   npm run stories:narrate -- --story 123,456     # specific stories (regenerates)
 *   npm run stories:narrate -- --story 123 --dry-run   # print, don't store
 */

import { config } from 'dotenv'
import { findStoriesNeedingNarrative, generateStoryNarrative } from '../services/storyNarrator'
import { isGeminiAvailable } from '../utils/gemini'

config()

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const storyArg = argv.indexOf('--story')
  const explicitIds = storyArg >= 0 ? (argv[storyArg + 1] || '').split(',').map(Number).filter(Boolean) : []
  const limit = parseInt(argv.find((a, i) => /^\d+$/.test(a) && (storyArg < 0 || i !== storyArg + 1)) || '30')

  if (!isGeminiAvailable()) {
    console.error('GEMINI_API_KEY not configured')
    process.exit(1)
  }

  const targets = explicitIds.length > 0
    ? explicitIds.map(id => ({ id, articleCount: 0, reason: 'requested' }))
    : await findStoriesNeedingNarrative(limit)

  console.log(`Narrating ${targets.length} stories${dryRun ? ' (dry run)' : ''}\n`)

  let done = 0
  let failed = 0
  for (const target of targets) {
    try {
      const started = Date.now()
      const narrative = await generateStoryNarrative(target.id, { dryRun })
      done++
      console.log(`✓ ${target.id} [${target.reason}] ${narrative.headline} (${narrative.developments.length} developments, ${narrative.perspectives.length} perspectives, ${((Date.now() - started) / 1000).toFixed(1)}s)`)
      if (dryRun) console.log(JSON.stringify(narrative, null, 2))
    } catch (error) {
      failed++
      console.error(`✗ ${target.id}: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(`\nDone: ${done} narrated, ${failed} failed`)
  process.exit(failed > 0 && done === 0 ? 1 : 0)
}

main()
