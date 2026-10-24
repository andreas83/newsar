import { generateJSON } from '../utils/ollama.js'
import { getDatabase } from '../database/db.js'
import { entities, articleEntities, entitySummaries, entitySummaryHistory } from '../database/schema.js'
import { eq, desc, sql } from 'drizzle-orm'

/**
 * Entity summaries as a versioned, article-grounded timeline.
 *
 * Each version is built from the articles published since the previous one
 * (its "window"). One LLM call returns the profile plus dated developments that
 * cite article ids, and theme labels that are reused across versions so
 * storylines can be compared week to week. A version owns its window, its
 * developments and its sources; when replaced it moves to history unchanged.
 *
 * The old pipeline used the 10 most recent articles (often a few hours of a
 * week), ignored whether the entity was the subject or a passing mention, and
 * produced change notes by diffing two summaries, which reported paraphrase as
 * news and filed every note under the previous version's date.
 */

/** Articles sent to the model per version; one per story cluster. */
const MAX_ARTICLES = 24
/** Below this many new relevant articles a scheduled run keeps the current version. */
const MIN_NEW_ARTICLES = 3
/** Window for an entity's first version. */
const FIRST_WINDOW_DAYS = 14
/** Cap for entities not refreshed in a long time. */
const MAX_WINDOW_DAYS = 30
const LEAD_CHARS = 500
const DAY_MS = 86_400_000

/** Phrases the model uses when it has nothing concrete to say. */
/** Category names, not storylines; they fill every week of the theme strip and say nothing. */
const GENERIC_THEMES = /^(us |u\.s\. |international |domestic |foreign )?(foreign policy|domestic (policy|politics)|presidential actions?|international relations|politics|policy|diplomacy|economy|economic (policy|concerns)|legal (challenges|issues)|government|news|other)$/i

const META_PHRASES = /newsworthiness|highlights (the|his|her|their)|the (new|updated|previous) (summary|profile|version)|is (frequently|often) mentioned|summary updated/i

export interface Development {
  date: string
  text: string
  articleIds: number[]
  theme: string | null
}

export interface WindowStats {
  /** All articles linking the entity in the window, any role. */
  articles: number
  outlets: number
  stories: number
  roles: Record<string, number>
  /** Articles actually sent to the model. */
  selected: number
}

export interface ArticleContext {
  articleIds: number[]
  articleTitles: string[]
  dateRange: { from: string | null; to: string | null }
}

export interface EntityVersion {
  summary: string
  shortDescription: string
  developments: Development[]
  themes: string[]
  noMajorChange: boolean
  articleContext: ArticleContext
  windowStats: WindowStats
}

export type VersionOutcome =
  | ({ status: 'built' } & EntityVersion)
  | { status: 'skipped'; reason: string; windowStats: WindowStats }

interface EntityRef { id: number; name: string; type: string; subtype?: string | null }

interface PreviousVersion {
  summary: string | null
  shortDescription: string | null
  themes: string[]
  generatedAt: Date | null
}

interface WindowArticle {
  id: number
  title: string
  lead: string
  publishedAt: Date
  outlet: string | null
  role: string
  score: number
  storyId: number | null
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Every article linking the entity in (since, until]. Future-dated articles are
 * excluded by the upper bound, so a bad feed date cannot pin one to the top.
 */
async function loadWindowArticles(entityId: number, since: Date, until: Date): Promise<WindowArticle[]> {
  const db = getDatabase()
  const result = await db.execute(sql`
    SELECT
      a.id, a.title, a.published_at,
      left(regexp_replace(coalesce(nullif(a.full_content, ''), a.content, ''), '\s+', ' ', 'g'), ${LEAD_CHARS}) AS lead,
      f.name AS outlet,
      lower(coalesce(ae.role, 'neutral')) AS role,
      coalesce(ae.relevance_score, 0.5) * greatest(coalesce(ae.mention_count, 1), 1) AS score,
      (SELECT sm.story_id FROM story_members sm WHERE sm.article_id = a.id
        ORDER BY sm.similarity DESC NULLS LAST LIMIT 1) AS story_id
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    LEFT JOIN feeds f ON f.id = a.feed_id
    WHERE ae.entity_id = ${entityId}
      AND a.published_at > ${since.toISOString()}::timestamp
      AND a.published_at <= ${until.toISOString()}::timestamp
  `)
  return (result.rows as any[]).map(r => ({
    id: Number(r.id),
    title: r.title,
    lead: r.lead ?? '',
    publishedAt: new Date(r.published_at),
    outlet: r.outlet,
    role: r.role,
    score: Number(r.score) || 0,
    storyId: r.story_id != null ? Number(r.story_id) : null,
  }))
}

/**
 * The articles worth showing the model: the entity is the subject (not a
 * passing "context" mention), one per story cluster, highest relevance first.
 */
function selectArticles(all: WindowArticle[], allowContext: boolean): WindowArticle[] {
  const pool = all.filter(a => a.role !== 'context')
  const candidates = pool.length || !allowContext ? pool : all
  const bestPerStory = new Map<string, WindowArticle>()
  for (const a of candidates) {
    const key = a.storyId != null ? `s${a.storyId}` : `a${a.id}`
    const current = bestPerStory.get(key)
    if (!current || a.score > current.score || (a.score === current.score && a.publishedAt > current.publishedAt)) {
      bestPerStory.set(key, a)
    }
  }
  return [...bestPerStory.values()]
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, MAX_ARTICLES)
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
}

function windowStats(all: WindowArticle[], selected: WindowArticle[]): WindowStats {
  const roles: Record<string, number> = {}
  for (const a of all) roles[a.role] = (roles[a.role] ?? 0) + 1
  return {
    articles: all.length,
    outlets: new Set(all.map(a => a.outlet).filter(Boolean)).size,
    stories: new Set(all.map(a => (a.storyId != null ? `s${a.storyId}` : `a${a.id}`))).size,
    roles,
    selected: selected.length,
  }
}

const TYPE_LABELS: Record<string, string> = {
  person: 'person',
  organization: 'organization',
  location: 'place',
  event: 'event',
  topic: 'topic or concept',
}

function buildPrompt(entity: EntityRef, since: Date, until: Date, selected: WindowArticle[], total: number, previous: PreviousVersion | null): string {
  const kind = TYPE_LABELS[entity.type] ?? 'entity'
  const sub = entity.subtype ? `, ${entity.subtype}` : ''
  const prev = previous?.summary
    ? `PREVIOUS PROFILE (written ${previous.generatedAt ? day(previous.generatedAt) : 'earlier'}; background only and possibly outdated. Where it conflicts with the articles, the articles are right):
Short: ${previous.shortDescription ?? ''}
${previous.summary}`
    : 'There is no previous profile.'
  const themes = previous?.themes?.length
    ? `\nTHEME LABELS USED BEFORE (reuse one when a storyline continues, so themes stay comparable over time): ${previous.themes.join('; ')}\n`
    : ''
  const articleBlock = selected.map(a =>
    `[${a.id}] ${day(a.publishedAt)} · ${a.outlet ?? 'unknown outlet'} · ${entity.name} is ${a.role}
${a.title}
${a.lead}`).join('\n\n')

  return `You maintain a running profile of ${entity.name} (${kind}${sub}) for a news site.
Write it as of ${day(until)}. The articles below were published between ${day(since)} and ${day(until)}.

${prev}
${themes}
ARTICLES (the ${selected.length} most relevant of ${total} that mention ${entity.name}; each line: [id] date · outlet · role of ${entity.name}):

${articleBlock}

Return only a JSON object:
{
  "shortDescription": "at most 100 characters: who ${entity.name} is (title or role exactly as the articles state it) and their main story right now",
  "summary": "120-180 words. First sentence: who ${entity.name} is. Then what is happening with them now, most important first. Neutral and factual.",
  "developments": [{"date": "YYYY-MM-DD", "text": "one concrete event, at most 25 words", "articleIds": [123], "theme": "exactly one of the labels in themes"}],
  "themes": ["2 to 5 specific storylines, 2-5 words each, e.g. \"Iran ceasefire talks\", \"EU tariff dispute\", \"Midterm campaign\". Never generic categories like \"Foreign policy\", \"Domestic politics\", \"Presidential actions\" or \"International relations\""],
  "noMajorChange": false
}

Rules for developments (0 to 5 items, most important first):
- Only events in which ${entity.name} acts, speaks, decides, or is directly affected. Skip articles where they are only mentioned in passing.
- Only things that happened in this window and are not already covered by the previous profile.
- Every item cites at least one article id from the list above. The date is when it happened, usually the article date.
- State the event itself ("Met Iran's foreign minister in Doha"). Never comment on the coverage or the profile ("highlights", "newsworthiness", "the summary").
If nothing material happened, return an empty developments list and "noMajorChange": true.

Rules for facts and fairness:
- Current titles and offices come only from the articles, never from the previous profile or memory. Use titles such as "President" or "former" only when the articles support them. If the articles show ${entity.name} left an office or was replaced, say so plainly; never write hedges about the profile itself ("should not be assumed").
- When the articles report criticism, accusations or findings against ${entity.name}, include their response or denial if the articles give one. Likewise include the other side's response when ${entity.name} accuses someone. If the articles give no response, say nothing about one; never claim something is missing from the articles.
- Keep the articles' account of who did what to whom: do not turn a one-sided action (an attack, an arrest) into a mutual one, or the reverse.
- Keep the articles' caveats (unverified claims, disputed figures, correlation rather than cause). Opinion columns are opinion: attribute their judgements to the writer, never state them as fact.`
}

/** Keep only well-formed developments that cite articles the model was shown. */
function cleanDevelopments(raw: any, selected: WindowArticle[], themes: string[]): Development[] {
  if (!Array.isArray(raw)) return []
  const byId = new Map(selected.map(a => [a.id, a]))
  const themeSet = new Map(themes.map(t => [t.toLowerCase(), t]))
  const out: Development[] = []
  for (const d of raw) {
    const text = typeof d?.text === 'string' ? d.text.trim() : ''
    if (!text || META_PHRASES.test(text)) continue
    const ids = (Array.isArray(d.articleIds) ? d.articleIds : [])
      .map((x: any) => Number(x))
      .filter((x: number) => byId.has(x))
    if (!ids.length) continue
    const cited = ids.map((x: number) => byId.get(x)!.publishedAt).sort((a: Date, b: Date) => a.getTime() - b.getTime())
    const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : day(cited[0])
    const theme = typeof d.theme === 'string' ? (themeSet.get(d.theme.trim().toLowerCase()) ?? d.theme.trim()) : null
    out.push({ date, text: text.slice(0, 300), articleIds: [...new Set<number>(ids)], theme: theme || null })
    if (out.length === 5) break
  }
  return out
}

export function cleanThemes(raw: any): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const label = t.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!label || GENERIC_THEMES.test(label) || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    out.push(label)
    if (out.length === 6) break
  }
  return out
}

/**
 * Build one version of an entity's profile from the articles in (since, until].
 * Pure with respect to storage: callers decide whether and where to write it.
 */
export async function buildEntityVersion(
  entity: EntityRef,
  window: { since: Date; until: Date },
  previous: PreviousVersion | null,
  options: { minArticles?: number, allowContext?: boolean } = {},
): Promise<VersionOutcome> {
  const all = await loadWindowArticles(entity.id, window.since, window.until)
  const isFirst = !previous?.summary
  const selected = selectArticles(all, isFirst || !!options.allowContext)
  const stats = windowStats(all, selected)
  const minArticles = options.minArticles ?? (isFirst ? 1 : MIN_NEW_ARTICLES)

  if (selected.length < minArticles) {
    return {
      status: 'skipped',
      reason: `${selected.length} relevant article(s) in window (need ${minArticles})`,
      windowStats: stats,
    }
  }

  const prompt = buildPrompt(entity, window.since, window.until, selected, all.length, previous)
  const raw = await generateJSON<any>(prompt, undefined, { layer: 'summary', temperature: 0.2, maxTokens: 1800 })

  const shortDescription = typeof raw?.shortDescription === 'string' ? raw.shortDescription.trim().slice(0, 300) : ''
  const summary = typeof raw?.summary === 'string' ? raw.summary.trim() : ''
  if (!shortDescription || !summary) throw new Error('Model response is missing shortDescription or summary')

  const listed = cleanThemes(raw.themes)
  const developments = cleanDevelopments(raw.developments, selected, listed)
  // A development's theme must be in the version's themes, or the theme strip
  // shows storylines with no events behind them (and events with no row).
  const themes = cleanThemes([...listed, ...developments.map(d => d.theme)]).slice(0, 6)
  const inThemes = new Set(themes.map(t => t.toLowerCase()))
  for (const d of developments) if (d.theme && !inThemes.has(d.theme.toLowerCase())) d.theme = null
  const dates = selected.map(a => a.publishedAt.toISOString())

  return {
    status: 'built',
    summary,
    shortDescription,
    themes,
    developments,
    noMajorChange: raw.noMajorChange === true && developments.length === 0,
    articleContext: {
      articleIds: selected.map(a => a.id),
      articleTitles: selected.map(a => a.title),
      dateRange: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    },
    windowStats: stats,
  }
}

/** Plain-text note for the legacy change_note column, so old readers keep working. */
function developmentsAsNote(devs: Development[] | null | undefined): string | null {
  return devs?.length ? devs.map(d => d.text).join(' ') : null
}

export type UpdateStatus = 'updated' | 'skipped' | 'no_change'

/**
 * Refresh an entity's profile from the articles published since its current
 * version. Archives the current version (unchanged) when a new one is written;
 * when there is too little new coverage, only records that it was checked.
 */
export async function updateEntitySummary(entityId: number, options: { force?: boolean } = {}): Promise<UpdateStatus> {
  const db = getDatabase()

  const [entity] = await db.select().from(entities).where(eq(entities.id, entityId)).limit(1)
  if (!entity) throw new Error(`Entity ${entityId} not found`)

  const [existing] = await db.select().from(entitySummaries).where(eq(entitySummaries.entityId, entityId)).limit(1)

  const now = new Date()
  const floor = new Date(now.getTime() - MAX_WINDOW_DAYS * DAY_MS)
  // force reaches back to the cap so a stale profile can be rewritten even after a quiet week
  const since = options.force
    ? floor
    : existing?.generatedAt
      ? new Date(Math.max(existing.generatedAt.getTime(), floor.getTime()))
      : new Date(now.getTime() - FIRST_WINDOW_DAYS * DAY_MS)

  console.log(`Generating summary for ${entity.type}: ${entity.name} (window ${day(since)} → ${day(now)})`)

  const outcome = await buildEntityVersion(
    { id: entity.id, name: entity.name, type: entity.type, subtype: (entity as any).subtype },
    { since, until: now },
    existing ? {
      summary: existing.summary,
      shortDescription: existing.shortDescription,
      themes: (existing.themes as string[] | null) ?? [],
      generatedAt: existing.generatedAt,
    } : null,
    // force: rewrite a stale profile even with little new coverage
    options.force ? { minArticles: 1, allowContext: true } : {},
  )

  const touch = () => db.update(entitySummaries).set({ lastUpdated: now }).where(eq(entitySummaries.entityId, entityId))

  if (outcome.status === 'skipped') {
    if (!existing) throw new Error(`No summary written for ${entity.name}: ${outcome.reason}`)
    await touch()
    console.log(`  Skipped ${entity.name}: ${outcome.reason}`)
    return 'skipped'
  }
  if (existing && outcome.noMajorChange && !options.force) {
    await touch()
    console.log(`  No major change for ${entity.name}; kept current version`)
    return 'no_change'
  }

  const [{ count: mentionCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(articleEntities)
    .where(eq(articleEntities.entityId, entityId))

  await db.transaction(async (tx) => {
    if (existing?.summary) {
      const isStructured = existing.developments != null
      await tx.insert(entitySummaryHistory).values({
        entityId,
        summary: existing.summary,
        shortDescription: existing.shortDescription,
        changeNote: developmentsAsNote(existing.developments as Development[] | null),
        mentionCount: existing.mentionCount,
        trendingScore: existing.trendingScore,
        articleContext: existing.articleContext,
        windowStart: existing.windowStart,
        developments: existing.developments,
        themes: existing.themes,
        windowStats: existing.windowStats,
        formatVersion: isStructured ? 2 : 1,
        generatedAt: existing.generatedAt || existing.lastUpdated,
      })
    }

    const version = {
      summary: outcome.summary,
      shortDescription: outcome.shortDescription,
      mentionCount: mentionCount || 0,
      windowStart: since,
      developments: outcome.developments,
      themes: outcome.themes,
      articleContext: outcome.articleContext,
      windowStats: outcome.windowStats,
      generatedAt: now,
      lastUpdated: now,
    }
    await tx.insert(entitySummaries)
      .values({ entityId, ...version })
      .onConflictDoUpdate({ target: entitySummaries.entityId, set: version })
  })

  console.log(`✅ Summary generated for ${entity.name} (${outcome.developments.length} developments, ${outcome.windowStats.selected}/${outcome.windowStats.articles} articles)`)
  return 'updated'
}

/**
 * Get entities that need summary generation
 * Prioritizes: 1) No summary, 2) Stale summaries, 3) By mention count
 */
export async function getEntitiesNeedingSummary(limit: number = 20, force: boolean = false): Promise<number[]> {
  const db = getDatabase()

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  if (force) {
    // Force mode: Get top entities by mention count regardless of summary status
    const topEntities = await db
      .select({
        entityId: articleEntities.entityId,
      })
      .from(articleEntities)
      .groupBy(articleEntities.entityId)
      .having(sql`COUNT(*) >= 2`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(limit)

    return topEntities.map(e => e.entityId)
  }

  // Normal mode: Prioritize unsummarized entities first, then stale ones
  // This ensures if you've done top 500, next batch gets entities 501-600, not re-does top 500
  const entitiesNeedingSummary = await db
    .select({
      entityId: articleEntities.entityId,
      mentionCount: sql<number>`COUNT(*)::int`,
      lastUpdated: entitySummaries.lastUpdated,
    })
    .from(articleEntities)
    .leftJoin(entitySummaries, eq(articleEntities.entityId, entitySummaries.entityId))
    .groupBy(articleEntities.entityId, entitySummaries.lastUpdated)
    .having(sql`COUNT(*) >= 2`) // At least 2 mentions
    .orderBy(
      sql`CASE WHEN ${entitySummaries.lastUpdated} IS NULL THEN 0 ELSE 1 END`, // No summary first
      sql`CASE WHEN ${entitySummaries.lastUpdated} < ${sevenDaysAgo} THEN 0 ELSE 1 END`, // Then stale
      desc(sql`COUNT(*)`) // Then by mention count
    )
    .limit(limit)

  // Only return entities that actually need updates
  const needsUpdate = entitiesNeedingSummary
    .filter(e => !e.lastUpdated || e.lastUpdated < sevenDaysAgo)
    .map(e => e.entityId)

  return needsUpdate
}

/**
 * Batch generate summaries for multiple entities
 * @param limit - Maximum number of entities to process
 * @param force - Force regeneration even if summary exists
 * @param concurrency - Number of entities to process in parallel (default 5)
 */
export async function batchGenerateSummaries(limit: number = 10, force: boolean = false, concurrency: number = 5): Promise<{ processed: number; failed: number; total: number; startTime: number }> {
  const startTime = Date.now()
  const entityIds = await getEntitiesNeedingSummary(limit, force)

  console.log(`Generating summaries for ${entityIds.length} entities${force ? ' (forced)' : ''} (concurrency: ${concurrency})...`)

  let processed = 0
  let failed = 0
  const statuses: Record<UpdateStatus, number> = { updated: 0, skipped: 0, no_change: 0 }

  // Process in batches of `concurrency`
  for (let i = 0; i < entityIds.length; i += concurrency) {
    const batch = entityIds.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map(entityId => updateEntitySummary(entityId))
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        processed++
        statuses[result.value]++
      } else {
        console.error(`Failed to generate summary:`, result.reason)
        failed++
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const total = processed + failed
    const rate = total > 0 ? Math.round(total / (elapsed / 60)) : 0
    console.log(`Progress: ${total}/${entityIds.length} (${processed} ok, ${failed} failed) - ${elapsed}s elapsed - ${rate}/min`)

    // Small delay between batches (rate limiter handles backpressure)
    if (i + concurrency < entityIds.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`✅ Batch summary generation complete: ${processed} succeeded (${statuses.updated} new versions, ${statuses.no_change} unchanged, ${statuses.skipped} too little new coverage), ${failed} failed in ${duration}s`)

  return {
    processed,
    failed,
    total: entityIds.length,
    startTime
  }
}

/**
 * Update trending scores for entities based on recent mention velocity
 *
 * Scoring formula combines:
 * - Volume: log-scaled 24h mention count (rewards high activity without saturating)
 * - Velocity: ratio of 24h vs 7d daily average (detects spikes)
 * - Recency weight: entities with 0 mentions in 24h decay to 0
 */
export async function updateEntityTrendingScores(): Promise<void> {
  const db = getDatabase()

  const twentyFourHoursAgo = new Date()
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  // Step 1: Reset ALL trending scores to 0 so stale entities decay
  await db
    .update(entitySummaries)
    .set({ trendingScore: 0 })

  // Step 2: Calculate and set new scores for entities with recent activity
  // Formula: 0.6 * volume_score + 0.4 * velocity_score
  //   volume_score  = ln(1 + mentions_24h) / ln(1 + max_mentions_24h)  → 0..1 log-scaled
  //   velocity_score = min(mentions_24h / (mentions_7d / 7), 3) / 3    → 0..1 capped spike ratio
  const trendingScores = await db.execute(sql`
    WITH recent_mentions AS (
      SELECT
        ae.entity_id,
        COUNT(*) FILTER (WHERE a.published_at >= ${twentyFourHoursAgo}) as mentions_24h,
        COUNT(*) FILTER (WHERE a.published_at >= ${sevenDaysAgo}) as mentions_7d
      FROM article_entities ae
      INNER JOIN articles a ON ae.article_id = a.id
      WHERE a.published_at >= ${sevenDaysAgo}
      GROUP BY ae.entity_id
    ),
    max_24h AS (
      SELECT GREATEST(MAX(mentions_24h), 1) as max_val FROM recent_mentions
    )
    SELECT
      rm.entity_id,
      rm.mentions_24h,
      rm.mentions_7d,
      LEAST(
        0.6 * (ln(1 + rm.mentions_24h::real) / ln(1 + m.max_val::real))
        + 0.4 * LEAST(rm.mentions_24h::real / GREATEST(rm.mentions_7d::real / 7.0, 0.1), 3.0) / 3.0,
        1.0
      ) as trending_score
    FROM recent_mentions rm, max_24h m
    WHERE rm.mentions_24h > 0
  `)

  // Update only entities with recent activity (others stay at 0 from step 1)
  for (const row of trendingScores.rows as any[]) {
    await db
      .update(entitySummaries)
      .set({
        trendingScore: row.trending_score,
      })
      .where(eq(entitySummaries.entityId, row.entity_id))
  }

  console.log(`✅ Updated trending scores for ${trendingScores.rows.length} entities (all others reset to 0)`)
}
