/**
 * Rebuild an entity's summary evolution week by week with the structured
 * pipeline (dated developments with sources, reusable themes).
 *
 * Usage:
 *   npm run entities:rebuild-history -- <entityId> [<entityId> ...] [--dry-run] [--weeks N]
 *
 *   --dry-run  build and print every version, write nothing
 *   --weeks N  only the last N weeks (default: since the entity's first summary)
 *
 * Writes happen in one transaction per entity, after all versions are built:
 *   - legacy history rows are marked superseded_at (kept, not deleted)
 *   - one format-2 history row per past week that had material developments
 *   - the newest version becomes the current entity_summaries row
 *
 * Cost: one LLM call per week per entity (~26 calls for half a year).
 */
import { config } from 'dotenv'
config()

import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDatabase } from '../database/db.js'
import { entities, entitySummaries, entitySummaryHistory, articleEntities } from '../database/schema.js'
import { buildEntityVersion, type EntityVersion } from '../services/entitySummarizer.js'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** Monday 00:00 UTC of the week containing d. */
function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = (x.getUTCDay() + 6) % 7
  return new Date(x.getTime() - dow * DAY_MS)
}

interface BuiltWeek { since: Date; until: Date; version: EntityVersion }

async function rebuild(entityId: number, dryRun: boolean, weeksBack: number | null) {
  const db = getDatabase()
  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1)
  if (!entity) throw new Error(`Entity ${entityId} not found`)

  const [current] = await db.select().from(entitySummaries).where(eq(entitySummaries.entityId, entityId)).limit(1)
  const [{ first }] = await db
    .select({ first: sql<Date | null>`MIN(${entitySummaryHistory.generatedAt})` })
    .from(entitySummaryHistory)
    .where(eq(entitySummaryHistory.entityId, entityId))

  const now = new Date()
  const origin = weeksBack != null
    ? new Date(weekStart(now).getTime() - weeksBack * WEEK_MS)
    : weekStart(new Date(first ?? current?.generatedAt ?? now.getTime() - 4 * WEEK_MS))

  console.log(`\n=== ${entity.name} (#${entity.id}) — weeks from ${origin.toISOString().slice(0, 10)}${dryRun ? ' [dry run]' : ''}`)

  const built: BuiltWeek[] = []
  let previous: { summary: string | null; shortDescription: string | null; themes: string[]; generatedAt: Date | null } | null = null
  let themePool: string[] = []

  // A week with too little coverage rolls into the next window instead of being dropped.
  let since = origin
  for (let end = origin.getTime() + WEEK_MS; since < now; end += WEEK_MS) {
    const until = new Date(Math.min(end, now.getTime()))
    const outcome = await buildEntityVersion(
      { id: entity.id, name: entity.name, type: entity.type, subtype: (entity as any).subtype },
      { since, until },
      previous ? { ...previous, themes: themePool } : null,
    )
    const label = `${since.toISOString().slice(0, 10)} → ${until.toISOString().slice(0, 10)}`
    if (outcome.status === 'skipped') {
      console.log(`  ${label}: carried forward (${outcome.reason})`)
      if (until.getTime() >= now.getTime()) break
      continue
    }
    if (previous && outcome.noMajorChange) {
      console.log(`  ${label}: no major change (${outcome.windowStats.selected}/${outcome.windowStats.articles} articles)`)
      since = until
      continue
    }
    console.log(`  ${label}: ${outcome.developments.length} developments · themes: ${outcome.themes.join('; ')} · ${outcome.windowStats.selected}/${outcome.windowStats.articles} articles`)
    console.log(`     ${outcome.shortDescription}`)
    for (const d of outcome.developments) console.log(`     - ${d.date} [${d.theme ?? '-'}] ${d.text} (${d.articleIds.join(',')})`)

    built.push({ since, until, version: outcome })
    previous = { summary: outcome.summary, shortDescription: outcome.shortDescription, themes: outcome.themes, generatedAt: until }
    since = until
    // Offer every label seen so far, most recent first, so storylines keep one name.
    themePool = [...new Set([...outcome.themes, ...themePool])].slice(0, 15)
  }

  if (!built.length) {
    console.log('  Nothing built; leaving existing data untouched.')
    return
  }
  if (dryRun) return

  const [{ count: mentionCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(articleEntities)
    .where(eq(articleEntities.entityId, entityId))

  const latest = built[built.length - 1]
  const past = built.slice(0, -1)

  await db.transaction(async (tx) => {
    // Keep the legacy record, but out of the timeline.
    await tx.update(entitySummaryHistory)
      .set({ supersededAt: now })
      .where(and(eq(entitySummaryHistory.entityId, entityId), isNull(entitySummaryHistory.supersededAt)))

    // The current row is replaced below; archive it as superseded too.
    if (current?.summary) {
      await tx.insert(entitySummaryHistory).values({
        entityId,
        summary: current.summary,
        shortDescription: current.shortDescription,
        changeNote: null,
        mentionCount: current.mentionCount,
        trendingScore: current.trendingScore,
        articleContext: current.articleContext,
        windowStart: current.windowStart,
        developments: current.developments,
        themes: current.themes,
        windowStats: current.windowStats,
        formatVersion: current.developments != null ? 2 : 1,
        generatedAt: current.generatedAt || current.lastUpdated,
        supersededAt: now,
      })
    }

    for (const w of past) {
      await tx.insert(entitySummaryHistory).values({
        entityId,
        summary: w.version.summary,
        shortDescription: w.version.shortDescription,
        changeNote: w.version.developments.map(d => d.text).join(' ') || null,
        mentionCount: w.version.windowStats.articles,
        articleContext: w.version.articleContext,
        windowStart: w.since,
        developments: w.version.developments,
        themes: w.version.themes,
        windowStats: w.version.windowStats,
        formatVersion: 2,
        generatedAt: w.until,
      })
    }

    const version = {
      summary: latest.version.summary,
      shortDescription: latest.version.shortDescription,
      mentionCount: mentionCount || 0,
      windowStart: latest.since,
      developments: latest.version.developments,
      themes: latest.version.themes,
      articleContext: latest.version.articleContext,
      windowStats: latest.version.windowStats,
      generatedAt: latest.until,
      lastUpdated: now,
    }
    await tx.insert(entitySummaries)
      .values({ entityId, ...version })
      .onConflictDoUpdate({ target: entitySummaries.entityId, set: version })
  })

  console.log(`  ✅ Wrote ${past.length} history versions + current; legacy rows marked superseded.`)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const weeksIdx = args.indexOf('--weeks')
  const weeksBack = weeksIdx >= 0 ? parseInt(args[weeksIdx + 1], 10) : null
  const ids = args.filter((a, i) => /^\d+$/.test(a) && !(weeksIdx >= 0 && i === weeksIdx + 1)).map(Number)
  if (!ids.length) {
    console.error('Usage: rebuildEntityHistory <entityId> [...] [--dry-run] [--weeks N]')
    process.exit(1)
  }
  for (const id of ids) await rebuild(id, dryRun, weeksBack)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
