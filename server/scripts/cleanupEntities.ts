/**
 * Entity Data Cleanup
 *
 * One-off (re-runnable) repair of entity data quality problems:
 *   1. Self-mentions: drops article links where the publishing outlet was
 *      extracted as an entity of its own article ("Al Jazeera" in Al Jazeera
 *      articles). Uses feeds.publisher_aliases (migration 0024).
 *   2. Spelling variants: merges entities whose names differ only in case,
 *      accents, apostrophe style or periods ("Nato"/"NATO", "U.S."/"US").
 *   3. Curated aliases: merges known variants that need human judgment
 *      ("IDF", "Israeli military" → Israel Defense Forces; "Trump" → Donald Trump).
 *      Bare surnames are only listed where one person dominates the corpus.
 *   4. Display names: "UN" shown as "United Nations" (its canonical name).
 *   5. Languages: classifications with a language we don't support (franc
 *      tagged English articles as Scots, Danish, ...) get the feed's language.
 *
 * Merged names are kept in metadata.aliases, which storeArticleEntities uses
 * to resolve future mentions, so the duplicates don't come back.
 *
 * Usage: npx tsx server/scripts/cleanupEntities.ts [dryRun]
 *   dryRun: 'false' to apply changes (default: 'true' — preview only)
 */

import { config } from 'dotenv'
config()

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'
import { mergeEntities } from '../services/entityDeduplicator'
import { isOutletSelfMention } from '../utils/outletIdentity'

const CURATED_MERGES: { type: string; keep: string; variants: string[] }[] = [
  { type: 'organization', keep: 'Israel Defense Forces', variants: ['IDF', 'Israel Defence Forces', 'Israeli Defense Forces', 'Israeli Defence Forces', 'Israeli military', 'Israeli army'] },
  { type: 'organization', keep: 'Islamic Revolutionary Guard Corps', variants: ['IRGC', 'Islamic Revolutionary Guards Corps', 'Revolutionary Guard', 'Revolutionary Guards', 'Revolutionary Guard Corps'] },
  { type: 'organization', keep: 'NATO', variants: ['North Atlantic Treaty Organization', 'North Atlantic Treaty Organisation'] },
  { type: 'organization', keep: 'World Health Organization', variants: ['World Health Organisation'] },
  { type: 'organization', keep: "People's Liberation Army", variants: ['PLA', "People's Liberation Army (PLA)"] },
  { type: 'organization', keep: 'Houthis', variants: ['Houthi', 'Ansar Allah', 'Houthi movement', 'Houthi rebels'] },
  { type: 'organization', keep: 'United States military', variants: ['US military', 'U.S. military', 'American military'] },
  { type: 'person', keep: 'Donald Trump', variants: ['Trump', 'President Trump', 'Donald J. Trump', 'Donald J Trump'] },
  { type: 'person', keep: 'Volodymyr Zelenskyy', variants: ['Volodymyr Zelensky', 'Volodomyr Zelenskyy', 'Volodmyr Zelenskyy', 'Zelenskyy', 'Zelensky'] },
  { type: 'person', keep: 'Xi Jinping', variants: ['Xi', 'President Xi'] },
  { type: 'person', keep: 'Vladimir Putin', variants: ['Putin'] },
  { type: 'person', keep: 'Benjamin Netanyahu', variants: ['Netanyahu'] },
  { type: 'person', keep: 'Keir Starmer', variants: ['Starmer'] },
  { type: 'person', keep: 'Friedrich Merz', variants: ['Merz'] },
  { type: 'person', keep: 'Marco Rubio', variants: ['Rubio'] },
  { type: 'person', keep: 'Pete Hegseth', variants: ['Hegseth'] },
  { type: 'person', keep: 'Jeffrey Epstein', variants: ['Epstein'] },
  { type: 'person', keep: 'Anthony Albanese', variants: ['Albanese'] },
  { type: 'person', keep: 'Lars Klingbeil', variants: ['Klingbeil'] },
  { type: 'person', keep: 'Itamar Ben-Gvir', variants: ['Ben-Gvir'] },
  { type: 'person', keep: 'Andy Burnham', variants: ['Burnham'] },
  { type: 'person', keep: 'Mark Carney', variants: ['Carney'] },
  { type: 'person', keep: 'Kylian Mbappé', variants: ['Mbappé', 'Mbappe'] },
  { type: 'person', keep: 'Adolf Hitler', variants: ['Hitler'] },
]

// Languages the detector can return (ISO 639-1); anything else is a misdetection
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'bn', 'ur', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'und']

/** Key that ignores case, accents, apostrophe style, periods and a leading "the" */
function looseKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\./g, '')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface EntityRow {
  id: number
  type: string
  name: string
  mentions: number
}

async function main() {
  const dryRun = (process.argv[2] || 'true') !== 'false'
  const db = getDatabase()

  console.log('=== Entity Data Cleanup ===\n')
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE'}\n`)

  // Entities referenced by stock tables can't be deleted (no cascade); never merge them away
  const pinnedRaw = await db.execute(sql`
    SELECT entity_id AS id FROM stock_watchlist WHERE entity_id IS NOT NULL
    UNION SELECT entity_id FROM stock_news_correlations WHERE entity_id IS NOT NULL
  `)
  const pinned = new Set((pinnedRaw.rows as { id: number }[]).map(r => Number(r.id)))

  const entityRaw = await db.execute(sql`
    SELECT e.id, e.type, e.name, COUNT(ae.id)::int AS mentions
    FROM entities e
    LEFT JOIN article_entities ae ON ae.entity_id = e.id
    GROUP BY e.id
  `)
  const allEntities = entityRaw.rows as unknown as EntityRow[]
  const byId = new Map(allEntities.map(e => [e.id, e]))
  console.log(`Loaded ${allEntities.length} entities (${pinned.size} pinned by stock data)\n`)

  // ── 1. Self-mentions ────────────────────────────────────────────────
  const pairRaw = await db.execute(sql`
    SELECT a.feed_id, ae.entity_id, e.name, f.publisher_aliases, COUNT(*)::int AS links
    FROM article_entities ae
    JOIN entities e ON e.id = ae.entity_id AND e.type = 'organization'
    JOIN articles a ON a.id = ae.article_id
    JOIN feeds f ON f.id = a.feed_id
    WHERE f.publisher_aliases IS NOT NULL
    GROUP BY a.feed_id, ae.entity_id, e.name, f.publisher_aliases
  `)
  const selfPairs = (pairRaw.rows as { feed_id: number; entity_id: number; name: string; publisher_aliases: string[]; links: number }[])
    .filter(r => isOutletSelfMention(r.name, r.publisher_aliases))
  const selfLinks = selfPairs.reduce((sum, r) => sum + r.links, 0)
  console.log(`1. Self-mentions: ${selfLinks} links across ${selfPairs.length} outlet/entity pairs`)
  for (const r of [...selfPairs].sort((a, b) => b.links - a.links).slice(0, 15)) {
    console.log(`     feed ${r.feed_id}: "${r.name}" (${r.links})`)
  }
  if (!dryRun) {
    for (const r of selfPairs) {
      await db.execute(sql`
        DELETE FROM article_entities ae USING articles a
        WHERE ae.article_id = a.id AND a.feed_id = ${r.feed_id} AND ae.entity_id = ${r.entity_id}
      `)
    }
  }
  console.log('')

  // ── 2. Spelling variants ────────────────────────────────────────────
  const groups = new Map<string, EntityRow[]>()
  for (const e of allEntities) {
    const key = `${e.type}|${looseKey(e.name)}`
    const group = groups.get(key)
    if (group) group.push(e)
    else groups.set(key, [e])
  }
  const merges: { keep: EntityRow; remove: EntityRow; reason: string }[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    // Keep: stock-pinned first, then a capitalized name ("Police" over "police"), then most mentions
    const capitalized = (e: EntityRow) => Number(/^\p{Lu}/u.test(e.name))
    const [keep, ...rest] = [...group].sort((a, b) =>
      Number(pinned.has(b.id)) - Number(pinned.has(a.id))
      || capitalized(b) - capitalized(a)
      || b.mentions - a.mentions
      || a.id - b.id)
    for (const remove of rest) merges.push({ keep, remove, reason: 'variant' })
  }
  const variantCount = merges.length

  // ── 3. Curated aliases ──────────────────────────────────────────────
  const merging = new Set(merges.map(m => m.remove.id))
  for (const rule of CURATED_MERGES) {
    const keep = allEntities
      .filter(e => e.type === rule.type && e.name === rule.keep && !merging.has(e.id))
      .sort((a, b) => b.mentions - a.mentions)[0]
    if (!keep) {
      console.log(`   (skip curated "${rule.keep}": entity not found)`)
      continue
    }
    const variantKeys = new Set(rule.variants.map(looseKey))
    for (const e of allEntities) {
      if (e.type === rule.type && e.id !== keep.id && !merging.has(e.id) && variantKeys.has(looseKey(e.name))) {
        merges.push({ keep, remove: e, reason: 'curated' })
        merging.add(e.id)
      }
    }
  }

  const blocked = merges.filter(m => pinned.has(m.remove.id))
  const runnable = merges.filter(m => !pinned.has(m.remove.id))
  console.log(`2. Spelling variants: ${variantCount} merges`)
  for (const m of runnable.filter(m => m.reason === 'variant').sort((a, b) => b.remove.mentions - a.remove.mentions).slice(0, 15)) {
    console.log(`     ${m.keep.type}: "${m.remove.name}" (${m.remove.mentions}) → "${m.keep.name}" (${m.keep.mentions})`)
  }
  console.log(`\n3. Curated aliases: ${merges.length - variantCount} merges`)
  for (const m of runnable.filter(m => m.reason === 'curated')) {
    console.log(`     ${m.keep.type}: "${m.remove.name}" (${m.remove.mentions}) → "${m.keep.name}" (${m.keep.mentions})`)
  }
  if (blocked.length > 0) {
    console.log(`\n   Skipped ${blocked.length} merges of entities referenced by stock data`)
  }

  if (!dryRun) {
    let done = 0
    let failed = 0
    for (const m of runnable) {
      // A previous merge may already have removed the keep side's duplicate
      if (!byId.has(m.keep.id) || !byId.has(m.remove.id)) continue
      try {
        await mergeEntities(m.keep.id, m.remove.id)
        byId.delete(m.remove.id)
        done++
      } catch (err) {
        failed++
        console.error(`   Merge failed: "${m.remove.name}" → "${m.keep.name}":`, err instanceof Error ? err.message : err)
      }
      if ((done + failed) % 500 === 0) console.log(`   ... ${done + failed}/${runnable.length}`)
    }
    console.log(`   Merged ${done}, failed ${failed}`)
  }
  console.log('')

  // ── 4. Display names ────────────────────────────────────────────────
  const displayRaw = await db.execute(sql`
    SELECT id, name, canonical_name FROM entities
    WHERE name IN ('UN', 'U.N.') AND canonical_name = 'United Nations'
  `)
  console.log(`4. Display names: ${displayRaw.rows.length} acronym-named entities`)
  if (!dryRun && displayRaw.rows.length > 0) {
    await db.execute(sql`
      UPDATE entities
      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{aliases}',
            COALESCE(metadata -> 'aliases', '[]'::jsonb) || to_jsonb(name)),
          name = canonical_name,
          updated_at = NOW()
      WHERE name IN ('UN', 'U.N.') AND canonical_name = 'United Nations'
    `)
  }
  console.log('')

  // ── 5. Languages ────────────────────────────────────────────────────
  const langRaw = await db.execute(sql`
    SELECT c.language, f.language AS feed_language, COUNT(*)::int AS n
    FROM classifications c
    JOIN articles a ON a.id = c.article_id
    JOIN feeds f ON f.id = a.feed_id
    WHERE c.language <> ALL(${sql.raw(`ARRAY['${SUPPORTED_LANGUAGES.join("','")}']`)})
      AND f.language IS NOT NULL
    GROUP BY 1, 2 ORDER BY 3 DESC
  `)
  const langRows = langRaw.rows as { language: string; feed_language: string; n: number }[]
  console.log(`5. Languages: ${langRows.reduce((s, r) => s + r.n, 0)} misdetected classifications`)
  for (const r of langRows.slice(0, 8)) console.log(`     ${r.language} → ${r.feed_language} (${r.n})`)
  if (!dryRun) {
    await db.execute(sql`
      UPDATE classifications c SET language = f.language
      FROM articles a JOIN feeds f ON f.id = a.feed_id
      WHERE a.id = c.article_id
        AND c.language <> ALL(${sql.raw(`ARRAY['${SUPPORTED_LANGUAGES.join("','")}']`)})
        AND f.language IS NOT NULL
    `)
  }

  console.log(dryRun ? '\nDry run complete. Run with "false" to apply.' : '\nCleanup complete.')
  process.exit(0)
}

main().catch(err => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
