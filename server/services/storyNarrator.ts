/**
 * Story Narrator
 *
 * Writes a reader-facing overview of a story from its member articles'
 * summaries: a neutral headline, what is happening, background, a dated list
 * of developments, how each outlet covers it, and where coverage agrees and
 * differs. One Gemini call per story; regenerated only when the story grows or
 * its membership shifts.
 */

import { getDatabase } from '../database/db'
import { stories, storyMembers, storyNarratives, articles, feeds, analyses } from '../database/schema'
import { eq, sql } from 'drizzle-orm'
import { generateGeminiCompletion, getSummaryModel } from '../utils/gemini'
import { generateClaudeCompletion, getClaudeModel, isClaudeAvailable } from '../utils/claude'

/** Regenerate once the story has grown by this share (and at least MIN_NEW_ARTICLES). */
const REGENERATE_GROWTH = 0.2
const MIN_NEW_ARTICLES = 3
/** Regenerate when fewer than this share of the narrated articles are still members. */
const MIN_RETAINED_SHARE = 0.7
/** Per-article summary budget in the prompt (chars). */
const SUMMARY_CHARS = 450

export interface StoryDevelopment {
  date: string // YYYY-MM-DD
  text: string
  articleIds: number[]
}

export interface StoryPerspective {
  outlet: string
  feedIds: number[]
  framing: string
  articleIds: number[]
}

export interface GeneratedNarrative {
  headline: string
  lede: string
  background: string | null
  developments: StoryDevelopment[]
  perspectives: StoryPerspective[]
  agreements: string[]
  disagreements: string[]
  openQuestions: string[]
}

interface NarrativeInputArticle {
  id: number
  title: string
  publishedAt: Date | null
  feedId: number
  feedName: string | null
  summary: string | null
}

export const SYSTEM_PROMPT = `You are a neutral news editor writing the overview page for a news story that several outlets have covered. Readers use it to understand quickly what the story is about, how it developed, and how outlets differ in their coverage.

Rules:
- Use only the articles provided. Do not add facts from memory.
- Write in plain, neutral English, even if the articles are in another language.
- Attribute contested claims ("Ukraine says…", "according to Fox News…"). Do not adopt any outlet's loaded wording as your own.
- When a party is criticised or accused, include its response or denial if any article reports one. Never state that the articles lack something (a response, details); just leave it out.
- Keep the articles' account of who did what to whom: do not turn a one-sided action (an attack, an arrest) into a mutual one, or the reverse. Keep their caveats (unverified claims, disputed figures).
- Describe every outlet's coverage by the same yardstick. Do not praise one outlet's tone ("measured", "factual") while describing another only by what it stresses.
- Keep the timeline straight: do not present events weeks or months apart as happening "meanwhile".
- Be concrete: names, places, numbers, dates.
- Headlines are written by the outlets. The summaries under them are machine-written and can get people's titles wrong (for example calling a sitting leader "former"). For anyone's office or title, follow the headlines. Never call someone "former" unless a headline does.
- Return valid JSON only.`

export function buildPrompt(storyArticles: NarrativeInputArticle[]): string {
  const lines = storyArticles.map((a) => {
    const date = a.publishedAt ? a.publishedAt.toISOString().slice(0, 10) : 'unknown'
    const summary = (a.summary || '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS)
    return `[${a.id}] ${date} | ${a.feedName || 'Unknown outlet'} | ${a.title}${summary ? `\n    ${summary}` : ''}`
  })
  const outlets = [...new Set(storyArticles.map(a => a.feedName).filter(Boolean))]

  return `Articles in this story, oldest first. Format: [article id] date | outlet | headline, then a summary.

${lines.join('\n')}

Outlets: ${outlets.join(', ')}

Return JSON with exactly these fields:
{
  "headline": "Neutral headline for the whole story, max 90 characters. Not any single outlet's headline.",
  "lede": "2-3 sentences: what this story is about and where it stands now. Max 450 characters.",
  "background": "1-2 sentences of context: why it matters or what led to it. Max 300 characters. Empty string if the articles give none.",
  "developments": [
    { "date": "YYYY-MM-DD", "text": "One sentence: what happened.", "articleIds": [up to 4 ids of articles reporting it] }
  ],
  "perspectives": [
    { "outlet": "outlet name exactly as listed", "framing": "1-2 sentences on what sets this outlet's coverage apart from the others: what it puts first or leaves out, whose voices it quotes, its tone. Start with the substance, not with the outlet's name or 'focuses on'.", "articleIds": [up to 3 ids of this outlet's most typical articles] }
  ],
  "agreements": ["Fact all or most outlets report the same way"],
  "disagreements": ["Where outlets differ in emphasis, framing or claims; name the outlets"],
  "openQuestions": ["What is unresolved or disputed"]
}

Guidance:
- developments: 3-10 key turning points in chronological order, one per distinct event; merge duplicates reported by several outlets. Skip pure analysis pieces.
- perspectives: one entry per outlet with at least one article, the outlets with the most articles first, max 8. Compare outlets with each other; if two cover it the same way, say so rather than inventing a difference.
- disagreements: differences between outlets' coverage (emphasis, framing, which claims they report), not disputes between the people in the story. Put disputes between the parties under openQuestions or agreements.
- agreements 1-3 items, disagreements 1-4 items, openQuestions 0-3 items. Keep every item to one sentence.`
}

export function cleanJson(text: string): string {
  let out = text.trim()
  if (out.startsWith('```json')) out = out.slice(7)
  else if (out.startsWith('```')) out = out.slice(3)
  if (out.endsWith('```')) out = out.slice(0, -3)
  return out.trim()
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim()).slice(0, max)
}

/** Keep only IDs that are in the story (the model sometimes invents or garbles them). */
function validIds(value: unknown, allowed: Set<number>): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter(id => allowed.has(id)))]
}

/** Validate the model's JSON against the input so nothing points outside the story. */
export function parseNarrative(raw: unknown, storyArticles: NarrativeInputArticle[]): GeneratedNarrative {
  const r = (raw || {}) as Record<string, any>
  const allowed = new Set(storyArticles.map(a => a.id))
  const feedIdsByName = new Map<string, Set<number>>()
  for (const a of storyArticles) {
    if (!a.feedName) continue
    const key = a.feedName.toLowerCase()
    if (!feedIdsByName.has(key)) feedIdsByName.set(key, new Set())
    feedIdsByName.get(key)!.add(a.feedId)
  }
  const articleById = new Map(storyArticles.map(a => [a.id, a]))

  const headline = typeof r.headline === 'string' ? r.headline.trim() : ''
  const lede = typeof r.lede === 'string' ? r.lede.trim() : ''
  if (!headline || !lede) throw new Error('Narrative is missing headline or lede')

  const developments: StoryDevelopment[] = (Array.isArray(r.developments) ? r.developments : [])
    .map((d: any) => ({
      date: typeof d?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '',
      text: typeof d?.text === 'string' ? d.text.trim() : '',
      articleIds: validIds(d?.articleIds, allowed),
    }))
    .filter((d: StoryDevelopment) => d.date && d.text)
    .sort((a: StoryDevelopment, b: StoryDevelopment) => a.date.localeCompare(b.date))
    .slice(0, 12)

  const perspectives: StoryPerspective[] = (Array.isArray(r.perspectives) ? r.perspectives : [])
    .map((p: any) => {
      const outlet = typeof p?.outlet === 'string' ? p.outlet.trim() : ''
      // Only the outlet's own articles count as its evidence
      const articleIds = validIds(p?.articleIds, allowed)
        .filter(id => articleById.get(id)?.feedName?.toLowerCase() === outlet.toLowerCase())
      return {
        outlet,
        feedIds: [...(feedIdsByName.get(outlet.toLowerCase()) || [])],
        framing: typeof p?.framing === 'string' ? p.framing.trim() : '',
        articleIds,
      }
    })
    .filter((p: StoryPerspective) => p.feedIds.length > 0 && p.framing)
    .slice(0, 8)

  return {
    headline: headline.slice(0, 140),
    lede: lede.slice(0, 700),
    background: typeof r.background === 'string' && r.background.trim() ? r.background.trim().slice(0, 500) : null,
    developments,
    perspectives,
    agreements: asStringList(r.agreements, 3),
    disagreements: asStringList(r.disagreements, 4),
    openQuestions: asStringList(r.openQuestions, 3),
  }
}

export async function loadStoryArticles(storyId: number): Promise<NarrativeInputArticle[]> {
  const db = getDatabase()
  return db
    .select({
      id: articles.id,
      title: articles.title,
      publishedAt: articles.publishedAt,
      feedId: articles.feedId,
      feedName: feeds.name,
      summary: analyses.summary,
    })
    .from(storyMembers)
    .innerJoin(articles, eq(storyMembers.articleId, articles.id))
    .leftJoin(feeds, eq(articles.feedId, feeds.id))
    .leftJoin(analyses, eq(articles.id, analyses.articleId))
    .where(eq(storyMembers.storyId, storyId))
    .orderBy(articles.publishedAt)
}

/** Claude when FORCE_CLAUDE is set, Gemini otherwise or if Claude fails. Returns the model that answered. */
async function generateNarrativeText(prompt: string): Promise<{ model: string; response: string }> {
  if (process.env.FORCE_CLAUDE === 'true' && isClaudeAvailable()) {
    const model = getClaudeModel('summary')
    try {
      const response = await generateClaudeCompletion(prompt, SYSTEM_PROMPT, { model, maxTokens: 6000, jsonMode: true })
      return { model, response }
    } catch (error) {
      console.warn(`[Narrator] Claude failed, falling back to Gemini: ${error instanceof Error ? error.message : error}`)
    }
  }
  const model = getSummaryModel()
  const response = await generateGeminiCompletion(prompt, SYSTEM_PROMPT, {
    model,
    temperature: 0.2,
    maxTokens: 6000,
    responseMimeType: 'application/json',
  })
  return { model, response }
}

/** Generate and store the narrative for one story. */
export async function generateStoryNarrative(storyId: number, options: { dryRun?: boolean } = {}): Promise<GeneratedNarrative> {
  const db = getDatabase()
  const storyArticles = await loadStoryArticles(storyId)
  if (storyArticles.length < 2) throw new Error(`Story ${storyId} has fewer than 2 articles`)

  const { model, response } = await generateNarrativeText(buildPrompt(storyArticles))
  const narrative = parseNarrative(JSON.parse(cleanJson(response)), storyArticles)

  if (options.dryRun) return narrative

  const articleIds = storyArticles.map(a => a.id)
  const values = {
    ...narrative,
    articleIds,
    articleCount: articleIds.length,
    model,
    generatedAt: new Date(),
  }
  await db.insert(storyNarratives)
    .values({ storyId, ...values })
    .onConflictDoUpdate({ target: storyNarratives.storyId, set: values })

  // Lists and cards read these columns
  await db.update(stories)
    .set({ name: narrative.headline.slice(0, 255), summary: narrative.lede })
    .where(eq(stories.id, storyId))

  return narrative
}

/**
 * Stories that need a (new) narrative: big enough to be worth one, still
 * current, and either never narrated, grown since, or with shifted membership.
 */
export async function findStoriesNeedingNarrative(limit: number, minArticles = 4): Promise<{ id: number; articleCount: number; reason: string }[]> {
  const db = getDatabase()
  const result = await db.execute(sql`
    WITH current_members AS (
      SELECT story_id, array_agg(article_id) AS ids FROM story_members GROUP BY story_id
    )
    SELECT s.id, s.article_count,
      CASE
        WHEN n.story_id IS NULL THEN 'new'
        WHEN s.article_count >= n.article_count + GREATEST(${MIN_NEW_ARTICLES}, CEIL(n.article_count * ${REGENERATE_GROWTH}::float)) THEN 'grown'
        ELSE 'membership'
      END AS reason
    FROM stories s
    JOIN current_members cm ON cm.story_id = s.id
    LEFT JOIN story_narratives n ON n.story_id = s.id
    WHERE s.article_count >= ${minArticles}
      AND s.source_count >= 2
      AND (s.status <> 'declining' OR s.last_updated > NOW() - INTERVAL '3 days')
      AND (
        n.story_id IS NULL
        OR s.article_count >= n.article_count + GREATEST(${MIN_NEW_ARTICLES}, CEIL(n.article_count * ${REGENERATE_GROWTH}::float))
        OR (
          SELECT COUNT(*) FROM jsonb_array_elements_text(n.article_ids) x(id)
          WHERE x.id::int = ANY(cm.ids)
        ) < jsonb_array_length(n.article_ids) * ${MIN_RETAINED_SHARE}::float
      )
    ORDER BY s.trending_score DESC NULLS LAST
    LIMIT ${limit}
  `)
  return (result.rows as any[]).map(r => ({ id: Number(r.id), articleCount: Number(r.article_count), reason: r.reason }))
}
