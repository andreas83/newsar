/**
 * Classify entity subtypes using a 3-pass strategy:
 * 1. Rule-based name matching (zero cost)
 * 2. Description keyword matching (zero cost)
 * 3. Gemini LLM for remaining entities (optional, --llm flag)
 *
 * Also fixes known misclassifications (orgs that should be locations, etc.)
 *
 * Usage:
 *   npm run entities:subtypes                          # all types, rules only
 *   npm run entities:subtypes -- --type organization   # orgs only
 *   npm run entities:subtypes -- --llm                 # include LLM pass
 *   npm run entities:subtypes -- --dry-run             # preview without writing
 *   npm run entities:subtypes -- --limit 100           # process N entities max
 */

import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { eq, sql, and, isNull, inArray } from 'drizzle-orm'
import * as schema from '../database/schema.js'
import {
  classifySubtype,
  ALL_SUBTYPES_BY_TYPE,
  SUBTYPE_LABELS,
  normalizeSubtype,
} from '../utils/entitySubtypes.js'
import { generateGeminiJSON, isGeminiAvailable } from '../utils/gemini.js'

const { Pool } = pg

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'newsar',
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
  database: process.env.DB_NAME || 'newsar',
})

const db = drizzle(pool, { schema })

// ── Parse CLI flags ─────────────────────────────────────────────────

const args = process.argv.slice(2)
const typeFilter = args.find((a, i) => args[i - 1] === '--type') || 'all'
const useLLM = args.includes('--llm')
const dryRun = args.includes('--dry-run')
const limitArg = args.find((a, i) => args[i - 1] === '--limit')
const entityLimit = limitArg ? parseInt(limitArg) : 0

const VALID_TYPES = ['organization', 'person', 'location', 'event', 'topic']
const typesToProcess = typeFilter === 'all'
  ? VALID_TYPES
  : VALID_TYPES.includes(typeFilter) ? [typeFilter] : []

if (typesToProcess.length === 0) {
  console.error(`Invalid type: ${typeFilter}. Must be one of: ${VALID_TYPES.join(', ')}, all`)
  process.exit(1)
}

// ── Stats tracking ──────────────────────────────────────────────────

interface Stats {
  total: number
  alreadyClassified: number
  pass1Rules: number
  pass2Description: number
  pass3LLM: number
  remaining: number
  misclassified: number
  subtypeCounts: Record<string, number>
}

function newStats(): Stats {
  return { total: 0, alreadyClassified: 0, pass1Rules: 0, pass2Description: 0, pass3LLM: 0, remaining: 0, misclassified: 0, subtypeCounts: {} }
}

// ── Misclassification fixes ─────────────────────────────────────────

async function fixMisclassifications() {
  console.log('\n=== Fixing Misclassifications ===')

  // Find organizations that match known country names in geo_normalization
  const geoMappings = await db
    .select({ rawValue: schema.geoNormalization.rawValue, normalizedCountry: schema.geoNormalization.normalizedCountry })
    .from(schema.geoNormalization)

  const countryNames = new Set(geoMappings.map(g => g.normalizedCountry.toLowerCase()))
  // Add raw values too — they include city names
  for (const g of geoMappings) {
    countryNames.add(g.rawValue.toLowerCase())
  }

  // Get all organization entities
  const orgEntities = await db
    .select({ id: schema.entities.id, name: schema.entities.name, slug: schema.entities.slug })
    .from(schema.entities)
    .where(eq(schema.entities.type, 'organization'))

  const toReclassify: { id: number; name: string; targetType: 'location' }[] = []

  // Known misclassifications — these org names are definitively locations
  const FORCE_LOCATION = new Set([
    'united kingdom', 'europa', 'europe', 'soviet union', 'palestinians', 'palestine',
    'gaza', 'gaza strip', 'west bank', 'crimea', 'hong kong', 'macau', 'taiwan',
    'puerto rico', 'kosovo',
  ])

  // Organizations that share names with locations but should NOT be reclassified
  const ORG_NOT_LOCATION = new Set([
    'nato', 'un', 'vatican', 'european union', 'eu', 'barcelona', 'sevilla',
    'santander', 'amazon', 'apple', 'oracle', 'shell', 'visa', 'chase',
    'columbia', 'jordan', 'georgia', 'paris', 'chelsea', 'arsenal', 'liverpool',
    'manchester united', 'manchester city', 'newcastle', 'leicester', 'brighton',
    'wolverhampton', 'norwich', 'burnley', 'luton', 'hull', 'reading', 'derby',
    'real madrid', 'atletico madrid', 'valencia', 'bilbao',
    'inter milan', 'ac milan', 'roma', 'napoli', 'bologna', 'torino', 'verona',
    'lyon', 'marseille', 'monaco', 'nice', 'toulouse', 'strasbourg',
    'hamburg', 'cologne', 'frankfurt', 'munich', 'stuttgart', 'düsseldorf', 'bremen', 'leipzig', 'dresden',
    'ajax', 'porto', 'benfica', 'sporting', 'galatasaray', 'fenerbahce',
    'buckelwal',  // Not a location
  ])

  for (const org of orgEntities) {
    const lower = org.name.toLowerCase()
    if (ORG_NOT_LOCATION.has(lower)) continue
    // Only reclassify if it's a forced location OR if it matches a country name
    // For geo_normalization matches, only reclassify if the name looks like a country/region, not a city
    const isForcedLocation = FORCE_LOCATION.has(lower)
    // Check if this org also has a rule-based org subtype — if so, it's a real org
    const orgSubtype = classifySubtype('organization', org.name)
    if (orgSubtype && !isForcedLocation) continue

    if (isForcedLocation) {
      // Check if a location entity already exists with same name
      const existing = await db
        .select({ id: schema.entities.id })
        .from(schema.entities)
        .where(and(
          eq(schema.entities.type, 'location'),
          sql`LOWER(${schema.entities.name}) = ${lower}`
        ))
        .limit(1)

      if (existing.length > 0) {
        // Merge: reassign article_entities from org to existing location entity
        if (!dryRun) {
          // Update article_entities: move references, skip conflicts
          await db.execute(sql`
            UPDATE article_entities
            SET entity_id = ${existing[0].id}
            WHERE entity_id = ${org.id}
              AND article_id NOT IN (
                SELECT article_id FROM article_entities WHERE entity_id = ${existing[0].id}
              )
          `)
          // Delete remaining conflicting article_entities for the org
          await db.execute(sql`
            DELETE FROM article_entities WHERE entity_id = ${org.id}
          `)
          // Delete the misclassified org entity
          await db.execute(sql`DELETE FROM entity_relationships WHERE source_entity_id = ${org.id} OR target_entity_id = ${org.id}`)
          await db.execute(sql`DELETE FROM story_entities WHERE entity_id = ${org.id}`)
          await db.execute(sql`DELETE FROM entity_summaries WHERE entity_id = ${org.id}`)
          await db.execute(sql`DELETE FROM entity_summary_history WHERE entity_id = ${org.id}`)
          await db.execute(sql`DELETE FROM entities WHERE id = ${org.id}`)
        }
        console.log(`  MERGE: "${org.name}" (org #${org.id}) → location #${existing[0].id}`)
      } else {
        toReclassify.push({ id: org.id, name: org.name, targetType: 'location' })
      }
    }
  }

  // Reclassify (change type from org to location)
  for (const item of toReclassify) {
    if (!dryRun) {
      await db.update(schema.entities)
        .set({ type: item.targetType })
        .where(eq(schema.entities.id, item.id))
    }
    console.log(`  RECLASSIFY: "${item.name}" (#${item.id}) org → ${item.targetType}`)
  }

  console.log(`  Fixed: ${toReclassify.length} reclassified, checked ${orgEntities.length} orgs`)
}

// ── Main classification logic ───────────────────────────────────────

async function classifyType(entityType: string): Promise<Stats> {
  const stats = newStats()
  console.log(`\n=== Classifying ${entityType} subtypes ===`)

  // Get entities without subtypes (with 3+ mentions for visibility)
  const baseConditions = [eq(schema.entities.type, entityType)]
  if (!dryRun) {
    // In real mode, only process unclassified entities
    baseConditions.push(isNull(schema.entities.subtype))
  }

  let entitiesQuery = db
    .select({
      id: schema.entities.id,
      name: schema.entities.name,
      type: schema.entities.type,
      shortDescription: schema.entitySummaries.shortDescription,
    })
    .from(schema.entities)
    .leftJoin(schema.entitySummaries, eq(schema.entities.id, schema.entitySummaries.entityId))
    .where(and(...baseConditions))
    .orderBy(sql`COALESCE(${schema.entitySummaries.mentionCount}, 0) DESC`)
    .$dynamic()

  if (entityLimit > 0) {
    entitiesQuery = entitiesQuery.limit(entityLimit)
  }

  const entitiesToClassify = await entitiesQuery

  stats.total = entitiesToClassify.length
  console.log(`  Total entities to classify: ${stats.total}`)

  if (stats.total === 0) {
    console.log('  No entities to classify.')
    return stats
  }

  // ── Pass 1: Rule-based name matching ──
  const pass1Remaining: typeof entitiesToClassify = []
  const updates: { id: number; subtype: string }[] = []

  for (const entity of entitiesToClassify) {
    const subtype = classifySubtype(entityType, entity.name)
    if (subtype) {
      updates.push({ id: entity.id, subtype })
      stats.pass1Rules++
      stats.subtypeCounts[subtype] = (stats.subtypeCounts[subtype] || 0) + 1
    } else {
      pass1Remaining.push(entity)
    }
  }

  console.log(`  Pass 1 (rules): ${stats.pass1Rules} classified`)

  // ── Pass 2: Description keyword matching ──
  const pass2Remaining: typeof entitiesToClassify = []

  for (const entity of pass1Remaining) {
    if (entity.shortDescription) {
      const subtype = classifySubtype(entityType, entity.name, entity.shortDescription)
      if (subtype) {
        updates.push({ id: entity.id, subtype })
        stats.pass2Description++
        stats.subtypeCounts[subtype] = (stats.subtypeCounts[subtype] || 0) + 1
      } else {
        pass2Remaining.push(entity)
      }
    } else {
      pass2Remaining.push(entity)
    }
  }

  console.log(`  Pass 2 (description): ${stats.pass2Description} classified`)

  // ── Pass 3: Gemini LLM (optional) ──
  if (useLLM && pass2Remaining.length > 0) {
    if (!isGeminiAvailable()) {
      console.log('  Pass 3 (LLM): SKIPPED — GEMINI_API_KEY not set')
    } else {
      // Only classify entities with 3+ mentions (visible in UI)
      const visibleEntities = pass2Remaining.filter(e => true) // already filtered by query if needed
      const BATCH_SIZE = 20

      console.log(`  Pass 3 (LLM): ${visibleEntities.length} entities remaining`)

      const validSubtypes = ALL_SUBTYPES_BY_TYPE[entityType] || []

      for (let i = 0; i < visibleEntities.length; i += BATCH_SIZE) {
        const batch = visibleEntities.slice(i, i + BATCH_SIZE)
        const entityList = batch.map((e, idx) => `${idx + 1}. "${e.name}"${e.shortDescription ? ` — ${e.shortDescription}` : ''}`).join('\n')

        const prompt = `Classify each entity into ONE subtype. Valid subtypes for ${entityType}: ${validSubtypes.join(', ')}

Entities:
${entityList}

Respond with JSON array: [{"index": 1, "subtype": "..."}, ...]
Only use subtypes from the valid list above. If unsure, use the most likely subtype.`

        try {
          const result = await generateGeminiJSON<Array<{ index: number; subtype: string }>>(
            prompt,
            'You are a named entity classifier. Classify entities into the correct subtype.',
            { temperature: 0.1, maxTokens: 1000 }
          )

          if (Array.isArray(result)) {
            for (const item of result) {
              const idx = (item.index || 0) - 1
              if (idx >= 0 && idx < batch.length && item.subtype) {
                const normalized = normalizeSubtype(entityType, item.subtype)
                if (normalized) {
                  updates.push({ id: batch[idx].id, subtype: normalized })
                  stats.pass3LLM++
                  stats.subtypeCounts[normalized] = (stats.subtypeCounts[normalized] || 0) + 1
                }
              }
            }
          }
        } catch (error) {
          console.error(`  LLM batch error (offset ${i}):`, error instanceof Error ? error.message : error)
        }

        // Small delay between batches
        if (i + BATCH_SIZE < visibleEntities.length) {
          await new Promise(r => setTimeout(r, 500))
        }
      }

      console.log(`  Pass 3 (LLM): ${stats.pass3LLM} classified`)
    }
  }

  stats.remaining = stats.total - stats.pass1Rules - stats.pass2Description - stats.pass3LLM

  // ── Apply updates ──
  if (!dryRun && updates.length > 0) {
    console.log(`  Writing ${updates.length} subtype updates...`)
    // Batch update in chunks of 500
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500)
      // Use a CASE statement for efficient bulk update
      const ids = chunk.map(u => u.id)
      const caseExpr = chunk.map(u => `WHEN ${u.id} THEN '${u.subtype}'`).join(' ')
      await db.execute(sql`
        UPDATE entities
        SET subtype = CASE id ${sql.raw(caseExpr)} END,
            updated_at = NOW()
        WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      `)
    }
    console.log(`  Done.`)
  } else if (dryRun) {
    console.log(`  [DRY RUN] Would write ${updates.length} subtype updates`)
  }

  // Print subtype distribution
  console.log(`\n  Subtype distribution for ${entityType}:`)
  const sorted = Object.entries(stats.subtypeCounts).sort((a, b) => b[1] - a[1])
  for (const [subtype, count] of sorted) {
    const label = SUBTYPE_LABELS[subtype] || subtype
    console.log(`    ${label.padEnd(22)} ${count}`)
  }
  if (stats.remaining > 0) {
    console.log(`    ${'(unclassified)'.padEnd(22)} ${stats.remaining}`)
  }

  // Print some sample classifications for review
  if (dryRun && updates.length > 0) {
    console.log(`\n  Sample classifications:`)
    const samples = updates.slice(0, 15)
    for (const s of samples) {
      const entity = entitiesToClassify.find(e => e.id === s.id)
      console.log(`    "${entity?.name}" → ${SUBTYPE_LABELS[s.subtype] || s.subtype}`)
    }
    if (updates.length > 15) console.log(`    ... and ${updates.length - 15} more`)
  }

  return stats
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('Entity Subtype Classification')
  console.log(`  Types: ${typesToProcess.join(', ')}`)
  console.log(`  LLM: ${useLLM ? 'enabled' : 'disabled'}`)
  console.log(`  Dry run: ${dryRun}`)
  if (entityLimit > 0) console.log(`  Limit: ${entityLimit} per type`)

  // Fix misclassifications first
  if (typesToProcess.includes('organization')) {
    await fixMisclassifications()
  }

  // Classify each type
  const allStats: Record<string, Stats> = {}
  for (const type of typesToProcess) {
    allStats[type] = await classifyType(type)
  }

  // Summary
  console.log('\n=== Summary ===')
  let grandTotal = 0, grandClassified = 0
  for (const [type, stats] of Object.entries(allStats)) {
    const classified = stats.pass1Rules + stats.pass2Description + stats.pass3LLM
    grandTotal += stats.total
    grandClassified += classified
    console.log(`  ${type}: ${classified}/${stats.total} classified (${stats.pass1Rules} rules + ${stats.pass2Description} desc + ${stats.pass3LLM} LLM)`)
  }
  console.log(`  Total: ${grandClassified}/${grandTotal} classified`)

  await pool.end()
}

main().catch((err) => {
  console.error('Fatal error:', err)
  pool.end()
  process.exit(1)
})
