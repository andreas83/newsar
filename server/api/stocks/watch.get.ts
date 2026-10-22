/**
 * News-spike watch API — the single public view of the stock prediction work.
 *
 * Routes:
 *   GET /api/stocks/watch?action=now     — news spikes whose 4-week window is still open
 *   GET /api/stocks/watch?action=record  — honest track record of past calls
 *
 * Everything is graded on ONE event, the one the label contract defines:
 * "did the stock beat SPY over the next 4 weeks?" (actual_change_4w − benchmark > 0).
 * Earlier pages mixed that with "rose more than 1%", which graded a different
 * event than the one that decided the call.
 *
 * Only calls made at event time count. ~200 heuristic rows were backfilled weeks
 * later from profiles that already contained those events' outcomes; they look
 * better than the live calls and would flatter the record.
 */

import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'
import { buildScorecard, effectiveN, type ScorecardRow } from '~/server/utils/scorecard'
import { readLabelContract } from '~/server/utils/labelContract'

const HORIZON_DAYS = 28
const LABEL_EXPR = 'beat SPY over 4 weeks (actual_change_4w − benchmark > 0)'
/** A call created more than this long after its event was backfilled, not made live. */
const MAX_CALL_LAG_DAYS = 7

const SOURCES = {
  ml_model: 'Machine-learning model',
  heuristic: 'Rule-based score',
} as const

export default defineEventHandler(async (event) => {
  const action = (getQuery(event).action as string) || 'now'
  const db = getDatabase()

  if (action === 'now') return handleNow(db)
  if (action === 'record') return handleRecord(db)
  return { error: `Unknown action: ${action}` }
})

/** Plain-English description of what triggered an event. */
function describeTrigger(eventType: string, meta: any, mentions: number | null): string {
  const multiplier = Number(meta?.multiplier)
  const n = mentions ?? Number(meta?.mentionCount)
  const articles = Number.isFinite(n) ? `${n} article${n === 1 ? '' : 's'}` : 'news'
  if (eventType === 'source_diversity_spike') {
    return `Covered by unusually many different outlets (${articles})`
  }
  if (Number.isFinite(multiplier)) {
    return `News mentions ${multiplier >= 10 ? Math.round(multiplier) : multiplier.toFixed(1)}× the usual level (${articles})`
  }
  return `Unusual news volume (${articles})`
}

/** Reasons the trigger itself may be noise. Shown on the card, never hidden. */
function qualityFlags(meta: any, mentions: number | null): string[] {
  const flags: string[] = []
  const sources = Number(meta?.source_count ?? meta?.sourceCount)
  const baseline = Number(meta?.baseline_avg ?? meta?.baselineAvg)
  if (mentions != null && mentions <= 1) flags.push('Based on a single article')
  else if (Number.isFinite(sources) && sources <= 1) flags.push('Only one news outlet')
  if (Number.isFinite(baseline) && baseline < 0.5) {
    flags.push('Rarely in our news feed, so a single story counts as a big spike')
  }
  return flags
}

async function handleNow(db: any) {
  const result = await db.execute(sql`
    SELECT
      c.id, c.event_type, c.event_date, c.metadata, c.mention_count_window,
      c.price_before, c.article_ids,
      sw.id AS watchlist_id, sw.ticker, sw.company_name, sw.sector,
      e.slug AS entity_slug, e.type AS entity_type,
      lp.price AS current_price,
      spy_then.price AS spy_then, spy_now.price AS spy_now,
      ml.signal_direction AS ml_direction, ml.short_term_confidence AS ml_prob_beat,
      h.signal_direction AS h_direction, h.signal_strength AS h_strength
    FROM stock_news_correlations c
    JOIN stock_watchlist sw ON sw.id = c.watchlist_id
    LEFT JOIN entities e ON e.id = c.entity_id
    LEFT JOIN LATERAL (
      SELECT price FROM stock_prices WHERE watchlist_id = c.watchlist_id
      ORDER BY fetched_at DESC LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
      SELECT p.price FROM stock_prices p JOIN stock_watchlist s ON s.id = p.watchlist_id
      WHERE s.ticker = 'SPY' AND DATE(p.fetched_at) <= DATE(c.event_date)
      ORDER BY DATE(p.fetched_at) DESC, p.source ASC, p.fetched_at DESC LIMIT 1
    ) spy_then ON true
    LEFT JOIN LATERAL (
      SELECT p.price FROM stock_prices p JOIN stock_watchlist s ON s.id = p.watchlist_id
      WHERE s.ticker = 'SPY' ORDER BY p.fetched_at DESC LIMIT 1
    ) spy_now ON true
    LEFT JOIN LATERAL (
      SELECT signal_direction, short_term_confidence FROM stock_recommendations
      WHERE correlation_id = c.id AND model_source = 'ml_model'
      ORDER BY created_at DESC LIMIT 1
    ) ml ON true
    LEFT JOIN LATERAL (
      SELECT signal_direction, signal_strength FROM stock_recommendations
      WHERE correlation_id = c.id AND model_source = 'heuristic'
      ORDER BY created_at DESC LIMIT 1
    ) h ON true
    WHERE c.event_date >= NOW() - (${HORIZON_DAYS} || ' days')::interval
    ORDER BY c.event_date DESC, c.id DESC
  `)
  const rows = result.rows as any[]

  // Headlines that triggered each spike (first three per event).
  const articleIds = [...new Set(rows.flatMap(r => (Array.isArray(r.article_ids) ? r.article_ids : []).slice(0, 3)))]
    .map(Number).filter(Number.isFinite)
  const articleMap = new Map<number, any>()
  if (articleIds.length) {
    const arts = await db.execute(sql`
      SELECT a.id, a.title, a.published_at, f.name AS feed_name
      FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id
      WHERE a.id IN (${sql.join(articleIds.map(id => sql`${id}`), sql`, `)})
    `)
    for (const a of arts.rows as any[]) articleMap.set(Number(a.id), a)
  }

  const setups = await setupStats(db)
  const baseRate = setups.overall.beatRate

  const num = (v: any) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const pct = (from: number | null, to: number | null) =>
    from != null && to != null && from > 0 ? ((to - from) / from) * 100 : null

  const spikes = rows.map((r) => {
    const meta = r.metadata ?? {}
    const mentions = num(r.mention_count_window)
    const priceAtEvent = num(r.price_before)
    const currentPrice = num(r.current_price)
    const changeSince = pct(priceAtEvent, currentPrice)
    const spyChange = pct(num(r.spy_then), num(r.spy_now))
    // event_date is a naive calendar date; read it as UTC so the server's zone can't shift it.
    const eventDay = String(r.event_date).slice(0, 10)
    const resolvesOn = new Date(Date.parse(`${eventDay}T00:00:00Z`) + HORIZON_DAYS * 86_400_000)
    const probBeat = num(r.ml_prob_beat)

    return {
      id: Number(r.id),
      ticker: r.ticker,
      companyName: r.company_name,
      sector: r.sector,
      entitySlug: r.entity_slug,
      entityType: r.entity_type,
      eventType: r.event_type,
      eventDate: eventDay,
      trigger: describeTrigger(r.event_type, meta, mentions),
      keywords: (meta.new_keywords ?? meta.newKeywords ?? []).slice(0, 6),
      articles: (Array.isArray(r.article_ids) ? r.article_ids : []).slice(0, 3)
        .map((id: any) => articleMap.get(Number(id)))
        .filter(Boolean)
        .map((a: any) => ({ id: Number(a.id), title: a.title, source: a.feed_name, publishedAt: a.published_at })),
      flags: qualityFlags(meta, mentions),
      priceAtEvent,
      currentPrice,
      changeSince,
      spyChangeSince: spyChange,
      vsMarketSoFar: changeSince != null && spyChange != null ? changeSince - spyChange : null,
      resolvesOn: resolvesOn.toISOString().slice(0, 10),
      daysLeft: Math.max(0, Math.ceil((resolvesOn.getTime() - Date.now()) / 86_400_000)),
      // The model's view, as odds of beating SPY next to the odds of any stock doing so.
      lean: probBeat != null
        ? { source: 'ml_model', probBeatSpy: probBeat, typical: baseRate, direction: r.ml_direction }
        : r.h_direction
          ? { source: 'heuristic', probBeatSpy: null, typical: baseRate, direction: r.h_direction }
          : null,
      setup: setups.byType[r.event_type] ?? null,
    }
  })

  return {
    horizonDays: HORIZON_DAYS,
    labelExpr: LABEL_EXPR,
    count: spikes.length,
    baseRate,
    spikes,
  }
}

/**
 * What has historically happened to a stock in the 4 weeks after each kind of
 * spike, regardless of any model's call. One row per event (the earliest
 * live heuristic row carries the realised outcome).
 */
async function setupStats(db: any) {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (r.correlation_id)
      r.event_type, r.actual_change_4w - r.actual_benchmark_change_4w AS excess
    FROM stock_recommendations r
    WHERE r.validated_at IS NOT NULL
      AND r.actual_change_4w IS NOT NULL
      AND r.actual_benchmark_change_4w IS NOT NULL
      AND r.created_at <= r.event_date + (${MAX_CALL_LAG_DAYS} || ' days')::interval
    ORDER BY r.correlation_id, r.created_at ASC
  `)
  const rows = (result.rows as any[]).map(r => ({ type: r.event_type as string, excess: Number(r.excess) }))
  const summarise = (subset: typeof rows) => ({
    n: subset.length,
    beatRate: subset.length ? subset.filter(r => r.excess > 0).length / subset.length : null,
    avgExcess: subset.length ? subset.reduce((s, r) => s + r.excess, 0) / subset.length : null,
  })
  const byType: Record<string, ReturnType<typeof summarise>> = {}
  for (const type of new Set(rows.map(r => r.type))) byType[type] = summarise(rows.filter(r => r.type === type))
  return { overall: summarise(rows), byType }
}

async function handleRecord(db: any) {
  const result = await db.execute(sql`
    SELECT
      r.id, r.model_source, r.signal_direction, r.signal_strength, r.short_term_confidence,
      r.event_type, r.event_date, r.created_at,
      r.actual_change_4w, r.actual_benchmark_change_4w,
      sw.ticker, sw.company_name
    FROM stock_recommendations r
    JOIN stock_watchlist sw ON sw.id = r.watchlist_id
    WHERE r.validated_at IS NOT NULL
      AND r.actual_change_4w IS NOT NULL
      AND r.actual_benchmark_change_4w IS NOT NULL
      AND r.created_at <= r.event_date + (${MAX_CALL_LAG_DAYS} || ' days')::interval
    ORDER BY r.event_date DESC
  `)

  const rows = (result.rows as any[]).map(r => {
    const change = Number(r.actual_change_4w)
    const bench = Number(r.actual_benchmark_change_4w)
    const excess = change - bench
    const direction = r.signal_direction as string
    return {
      id: Number(r.id),
      source: r.model_source as keyof typeof SOURCES,
      ticker: r.ticker,
      companyName: r.company_name,
      direction,
      score: r.model_source === 'ml_model'
        ? (r.short_term_confidence != null ? Number(r.short_term_confidence) : null)
        : (r.signal_strength != null ? Number(r.signal_strength) : null),
      eventType: r.event_type,
      eventDate: r.event_date,
      change,
      benchmark: bench,
      excess,
      label: excess > 0 ? 1 : 0,
      // What following the call earned relative to just holding SPY:
      // bullish = long the stock, bearish = avoid/short it.
      payoff: direction === 'bullish' ? excess : direction === 'bearish' ? -excess : null,
      correct: direction === 'bullish' ? excess > 0 : direction === 'bearish' ? excess < 0 : null,
    }
  })

  const contract = readLabelContract()
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

  const sources = (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((source) => {
    const subset = rows.filter(r => r.source === source)
    const scRows: ScorecardRow[] = subset.map(r => ({
      score: r.score, label: r.label, direction: r.direction, date: r.eventDate, cluster: r.ticker,
    }))
    const card = buildScorecard(scRows, {
      labelExpr: LABEL_EXPR,
      horizonDays: HORIZON_DAYS,
      scoreIsProbability: source === 'ml_model',
    })
    const calls = subset.filter(r => r.payoff != null)
    const byDirection = (['bullish', 'bearish'] as const).map((d) => {
      const dRows = subset.filter(r => r.direction === d)
      const stats = card.directions[d]
      return {
        direction: d,
        n: dRows.length,
        hitRate: stats.hitRate,
        // Hit rate of making this same call on every stock in the same window.
        coinFlip: stats.matchedBaseRate,
        avgPayoff: avg(dRows.map(r => r.payoff as number)),
      }
    })
    const c = contract?.sources?.[source]
    const hasEdge = !!c?.tradeable
    const neff = effectiveN(scRows, HORIZON_DAYS)
    const windowStart = subset.length ? subset[subset.length - 1].eventDate : null
    const windowEnd = subset.length ? subset[0].eventDate : null
    const hitRate = calls.length ? calls.filter(r => r.correct).length / calls.length : null
    // The naive comparator: make each direction call on every stock in the same
    // window. Stocks underperformed SPY after spikes in this period, so an
    // always-bearish model "wins" too — a positive payoff alone proves nothing.
    const graded = byDirection.filter(d => d.n > 0 && d.coinFlip != null)
    const nGraded = graded.reduce((s, d) => s + d.n, 0)
    const naiveHitRate = nGraded ? graded.reduce((s, d) => s + (d.coinFlip as number) * d.n, 0) / nGraded : null
    const pp = (x: number) => `${Math.round(x * 100)}%`

    return {
      source,
      label: SOURCES[source],
      n: subset.length,
      nCalls: calls.length,
      nNeutral: subset.length - calls.length,
      independentWindows: neff.nEffMarket,
      effectiveN: neff.nEff,
      windowStart,
      windowEnd,
      hitRate,
      naiveHitRate,
      avgPayoff: avg(calls.map(r => r.payoff as number)),
      byDirection,
      auc: c?.auc ?? card.auc,
      aucCi: c?.auc_ci_low != null ? [c.auc_ci_low, c.auc_ci_high] : null,
      hasEdge,
      verdict: calls.length === 0
        ? 'No resolved calls yet.'
        : hasEdge
          ? 'Some evidence of skill on the live record — still a small sample.'
          : hitRate != null && naiveHitRate != null
            ? `No evidence of skill: right ${pp(hitRate)} of the time, vs ${pp(naiveHitRate)} for making the same call on every stock.`
            : 'No evidence of skill on the live record.',
    }
  })

  // Month by month: did following the calls beat just holding SPY?
  const monthly = new Map<string, { month: string, source: string, payoffs: number[] }>()
  for (const r of rows) {
    if (r.payoff == null) continue
    const month = new Date(r.eventDate).toISOString().slice(0, 7)
    const key = `${r.source}|${month}`
    if (!monthly.has(key)) monthly.set(key, { month, source: r.source, payoffs: [] })
    monthly.get(key)!.payoffs.push(r.payoff)
  }

  return {
    horizonDays: HORIZON_DAYS,
    labelExpr: LABEL_EXPR,
    excludedBackfill: `Calls created more than ${MAX_CALL_LAG_DAYS} days after their event are excluded.`,
    sources,
    monthly: [...monthly.values()]
      .map(m => ({ month: m.month, source: m.source, n: m.payoffs.length, avgPayoff: avg(m.payoffs) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    // Several event types can fire for one ticker on one day; list each call once.
    recent: rows.filter(r => r.payoff != null)
      .filter((r, i, all) => all.findIndex(o => o.source === r.source && o.ticker === r.ticker
        && String(o.eventDate).slice(0, 10) === String(r.eventDate).slice(0, 10)) === i)
      .slice(0, 40).map(r => ({
      id: r.id, source: r.source, ticker: r.ticker, companyName: r.companyName,
      direction: r.direction, eventDate: r.eventDate,
      change: r.change, benchmark: r.benchmark, payoff: r.payoff, correct: r.correct,
    })),
  }
}
