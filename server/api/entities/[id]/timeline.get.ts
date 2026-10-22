import { getDatabase } from '../../../database/db.js'
import { entitySummaryHistory, entitySummaries, entities } from '../../../database/schema.js'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

/**
 * Summary evolution for one entity, newest first.
 *
 * Two kinds of entry:
 *  - 'week'  — a self-contained version (format 2): its own article window,
 *              dated developments with sources, themes and coverage stats.
 *  - 'note'  — a legacy row (format 1). Its change note and article context
 *              describe the version that REPLACED it, so the entry is dated by
 *              archived_at and paired with that next version's profile.
 *
 * Also returns weekly article counts (activity) and a theme strip (which
 * storylines appear in which week) for the visual overview.
 */

interface Development { date: string; text: string; articleIds: number[]; theme: string | null }

function tokens(s: string | null | undefined): Set<string> {
  return new Set((s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3))
}

/** Rough "did the one-line description change meaningfully" check (Jaccard < 0.4). */
function descriptionChanged(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const ta = tokens(a), tb = tokens(b)
  const inter = [...ta].filter(w => tb.has(w)).length
  const union = new Set([...ta, ...tb]).size
  return union > 0 && inter / union < 0.4
}

export default defineEventHandler(async (event) => {
  const entityId = parseInt(getRouterParam(event, 'id') || '')
  if (!entityId || isNaN(entityId)) {
    throw createError({ statusCode: 400, message: 'Valid entity ID is required' })
  }

  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 20, 50)
  const offset = parseInt(query.offset as string) || 0

  const db = getDatabase()

  const [entity] = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1)
  if (!entity) throw createError({ statusCode: 404, message: 'Entity not found' })

  const [rows, [current]] = await Promise.all([
    db.select().from(entitySummaryHistory)
      .where(and(eq(entitySummaryHistory.entityId, entityId), isNull(entitySummaryHistory.supersededAt)))
      .orderBy(asc(entitySummaryHistory.generatedAt)),
    db.select().from(entitySummaries).where(eq(entitySummaries.entityId, entityId)).limit(1),
  ])

  type Entry = Record<string, any> & { kind: 'week' | 'note'; sortDate: Date }
  const all: Entry[] = []

  const weekEntry = (v: any, id: string, isCurrent: boolean): Entry => ({
    kind: 'week',
    id,
    isCurrent,
    periodStart: v.windowStart,
    periodEnd: v.generatedAt,
    shortDescription: v.shortDescription,
    summary: v.summary,
    developments: (v.developments ?? []) as Development[],
    themes: (v.themes ?? []) as string[],
    stats: v.windowStats ?? null,
    sortDate: new Date(v.generatedAt),
  })

  rows.forEach((r, i) => {
    if (r.formatVersion === 2 && r.developments != null) {
      all.push(weekEntry(r, `h${r.id}`, false))
    } else if (r.changeNote) {
      // The note belongs to whatever replaced this row.
      const next = rows[i + 1] ?? current
      all.push({
        kind: 'note',
        id: `h${r.id}`,
        date: r.archivedAt,
        changeNote: r.changeNote,
        articleContext: r.articleContext,
        shortDescription: next?.shortDescription ?? null,
        summary: next?.summary ?? null,
        sortDate: new Date(r.archivedAt),
      })
    }
  })
  if (current?.developments != null) all.push(weekEntry(current, 'current', true))

  all.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime())

  // Mark weeks whose one-line description changed versus the week before.
  const weeksChrono = all.filter(e => e.kind === 'week').reverse()
  weeksChrono.forEach((w, i) => {
    const prev = weeksChrono[i - 1]
    w.descriptionChanged = prev ? descriptionChanged(prev.shortDescription, w.shortDescription) : false
  })

  // Titles and outlets for every cited article on this page of results.
  const page = all.slice(offset, offset + limit)
  const citedIds = [...new Set(page.flatMap(e => (e.developments ?? []).flatMap((d: Development) => d.articleIds)))]
  const articleMap: Record<number, { title: string; outlet: string | null }> = {}
  if (citedIds.length) {
    const res = await db.execute(sql`
      SELECT a.id, a.title, f.name AS outlet FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id
      WHERE a.id IN (${sql.join(citedIds.map(id => sql`${id}`), sql`, `)})
    `)
    for (const a of res.rows as any[]) articleMap[Number(a.id)] = { title: a.title, outlet: a.outlet }
  }

  // Weekly coverage over the span of the timeline (at most a year).
  const spanStart = all.length
    ? new Date(Math.max(all[all.length - 1].sortDate.getTime() - 7 * 86_400_000, Date.now() - 365 * 86_400_000))
    : new Date(Date.now() - 26 * 7 * 86_400_000)
  const activityRes = await db.execute(sql`
    SELECT to_char(date_trunc('week', a.published_at), 'YYYY-MM-DD') AS week, COUNT(*)::int AS articles
    FROM article_entities ae JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ${entityId}
      AND a.published_at >= ${spanStart.toISOString()}::timestamp
      AND a.published_at <= NOW()
    GROUP BY 1 ORDER BY 1
  `)
  // One column per calendar week (Monday), zero-filled, shared by the sparkline and the theme strip.
  const counts = new Map((activityRes.rows as any[]).map(r => [r.week as string, Number(r.articles)]))
  const WEEK = 7 * 86_400_000
  const mondayOf = (d: Date) => {
    const x = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    return x - ((new Date(x).getUTCDay() + 6) % 7) * 86_400_000
  }
  const weekKeys: string[] = []
  for (let t = mondayOf(spanStart); t <= mondayOf(new Date()); t += WEEK) weekKeys.push(new Date(t).toISOString().slice(0, 10))
  const activity = weekKeys.map(week => ({ week, articles: counts.get(week) ?? 0 }))

  // Theme strip: the most frequent storylines, and the weeks they appear in.
  const themeCounts = new Map<string, { label: string; n: number }>()
  for (const w of weeksChrono) {
    for (const t of w.themes as string[]) {
      const key = t.toLowerCase()
      const cur = themeCounts.get(key) ?? { label: t, n: 0 }
      cur.n++
      themeCounts.set(key, cur)
    }
  }
  const topThemes = [...themeCounts.values()].sort((a, b) => b.n - a.n).slice(0, 8)
  // A theme covers every calendar week its version's window overlaps, so a
  // month-long window (thin coverage) paints a month, aligned with the sparkline.
  const weeksOf = (w: Entry) => {
    const start = new Date(w.periodStart ?? w.periodEnd).getTime()
    const end = new Date(w.periodEnd).getTime()
    return weekKeys.filter(k => {
      const ws = Date.parse(`${k}T00:00:00Z`)
      return ws < end && ws + WEEK > start
    })
  }
  const themeStrip = {
    themes: topThemes.map(t => ({
      label: t.label,
      weeks: [...new Set(weeksChrono
        .filter(w => (w.themes as string[]).some(x => x.toLowerCase() === t.label.toLowerCase()))
        .flatMap(weeksOf))],
    })),
  }

  return {
    entityId,
    entityName: entity.name,
    entries: page.map(({ sortDate, ...e }) => ({
      ...e,
      developments: (e.developments ?? []).map((d: Development) => ({
        ...d,
        sources: d.articleIds.map(id => ({ id, ...(articleMap[id] ?? { title: null, outlet: null }) })),
      })),
    })),
    activity,
    themeStrip,
    pagination: { total: all.length, limit, offset, hasMore: offset + limit < all.length },
  }
})
