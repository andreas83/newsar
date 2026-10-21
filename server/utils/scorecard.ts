/**
 * Scorecard metrics for prediction track records.
 *
 * A pure function over already-fetched rows: no database access, no framework
 * types. It mirrors `ml/eval_core.py` so the page and the nightly report cannot
 * drift apart.
 *
 * The rules it enforces, each of which this system got wrong for months:
 *
 *  - A hit rate is never reported without the base rate over the *same*
 *    calendar window. Monthly base rates here have swung from 13% to 78%, so an
 *    unqualified win rate says more about the month than about the model.
 *  - `nBullish` / `nBearish` are first-class outputs. "The model has never made
 *    a bullish call" is invisible in an aggregate accuracy number.
 *  - The label expression travels with the metric, so it is always clear which
 *    event was graded.
 *
 * Confidence intervals are deliberately NOT computed here. Honest intervals
 * need a cluster bootstrap over overlapping labels, which belongs in the
 * nightly Python report (`ml/reports/evaluation_report.json`) rather than in a
 * request handler.
 */

export interface ScorecardRow {
  /** Model score being graded (probability, strength, …). Null rows are skipped. */
  score: number | null
  /** Realised label: 1 = the graded event happened, 0 = it did not, null = unknown. */
  label: number | null
  /** Direction the system committed to. */
  direction: string
  /** Event date, used for matched-period baselines and effective-n blocks. */
  date: string | Date
  /** Overlap group — ticker for stocks. Rows sharing one are not independent. */
  cluster: string
}

export interface DirectionStats {
  n: number
  nGraded: number
  hitRate: number | null
  /** Base rate for this direction over the window these calls actually span. */
  matchedBaseRate: number | null
  /** hitRate − matchedBaseRate, in percentage points. This is the skill claim. */
  edgePp: number | null
  windowStart: string | null
  windowEnd: string | null
}

export interface ScorecardResult {
  labelExpr: string
  n: number
  nGraded: number
  baseRate: number | null
  auc: number | null
  brier: number | null
  brierSkill: number | null
  meanPredicted: number | null
  calibrationGap: number | null
  effectiveN: { nRaw: number, nEff: number, nEffMarket: number, horizonDays: number }
  directions: Record<string, DirectionStats>
  nBullish: number
  nBearish: number
  nNeutral: number
  baselines: { alwaysBullish: number | null, alwaysBearish: number | null, randomAuc: number }
}

const DAY_MS = 86_400_000

function toDayNumber(d: string | Date): number {
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d))
  return Math.floor(t / DAY_MS)
}

/**
 * Mann-Whitney ROC-AUC with tie correction.
 * Returns null for single-class input — never 0.5, which would read as a result.
 */
export function auc(labels: number[], scores: number[]): number | null {
  const pairs = labels
    .map((y, i) => ({ y, p: scores[i] }))
    .filter(r => Number.isFinite(r.y) && Number.isFinite(r.p))

  const nPos = pairs.filter(r => r.y === 1).length
  const nNeg = pairs.length - nPos
  if (nPos === 0 || nNeg === 0) return null

  const sorted = [...pairs].sort((a, b) => a.p - b.p)
  const ranks = new Array<number>(sorted.length)
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[k] = avgRank
    i = j + 1
  }

  let rankSumPos = 0
  for (let k = 0; k < sorted.length; k++) if (sorted[k].y === 1) rankSumPos += ranks[k]
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg)
}

/** Base rate restricted to the calendar window a subset of rows spans. */
function matchedBaseRate(rows: ScorecardRow[], subset: ScorecardRow[]) {
  const graded = rows.filter(r => r.label != null)
  if (!subset.length || !graded.length) {
    return { baseRate: null, windowStart: null, windowEnd: null }
  }
  const days = subset.map(r => toDayNumber(r.date))
  const lo = Math.min(...days)
  const hi = Math.max(...days)
  const inWindow = graded.filter(r => {
    const d = toDayNumber(r.date)
    return d >= lo && d <= hi
  })
  if (!inWindow.length) return { baseRate: null, windowStart: null, windowEnd: null }
  return {
    baseRate: inWindow.reduce((s, r) => s + (r.label as number), 0) / inWindow.length,
    windowStart: new Date(lo * DAY_MS).toISOString().slice(0, 10),
    windowEnd: new Date(hi * DAY_MS).toISOString().slice(0, 10),
  }
}

/**
 * Independent-observation counts behind a raw row count.
 *
 * `nEffMarket` ignores the cluster: every ticker shares one market over the same
 * four weeks, so a label driven by market direction cannot have more independent
 * observations than there are non-overlapping windows in the sample — however
 * many tickers are in it.
 */
export function effectiveN(rows: ScorecardRow[], horizonDays: number) {
  if (!rows.length) return { nRaw: 0, nEff: 0, nEffMarket: 0, horizonDays }
  const days = rows.map(r => toDayNumber(r.date))
  const min = Math.min(...days)
  const span = Math.max(1, horizonDays)

  const blocks = new Set<number>()
  const cells = new Set<string>()
  rows.forEach((r, i) => {
    const block = Math.floor((days[i] - min) / span)
    blocks.add(block)
    cells.add(`${r.cluster}@${block}`)
  })

  return { nRaw: rows.length, nEff: cells.size, nEffMarket: blocks.size, horizonDays }
}

export function buildScorecard(
  rows: ScorecardRow[],
  options: { labelExpr: string, horizonDays: number, scoreIsProbability?: boolean },
): ScorecardResult {
  const { labelExpr, horizonDays, scoreIsProbability = true } = options
  const graded = rows.filter(r => r.label != null)
  const scored = graded.filter(r => r.score != null && Number.isFinite(r.score as number))

  const baseRate = graded.length
    ? graded.reduce((s, r) => s + (r.label as number), 0) / graded.length
    : null

  let brier: number | null = null
  let brierSkill: number | null = null
  let meanPredicted: number | null = null
  let calibrationGap: number | null = null

  if (scoreIsProbability && scored.length && baseRate != null) {
    brier = scored.reduce((s, r) => s + ((r.score as number) - (r.label as number)) ** 2, 0) / scored.length
    const brierBase = scored.reduce((s, r) => s + (baseRate - (r.label as number)) ** 2, 0) / scored.length
    brierSkill = brierBase === 0 ? null : 1 - brier / brierBase
    meanPredicted = scored.reduce((s, r) => s + (r.score as number), 0) / scored.length
    calibrationGap = meanPredicted - baseRate
  }

  const directions: Record<string, DirectionStats> = {}
  for (const name of ['bullish', 'bearish', 'neutral']) {
    const subset = rows.filter(r => r.direction === name)
    const subsetGraded = subset.filter(r => r.label != null)
    const stats: DirectionStats = {
      n: subset.length,
      nGraded: subsetGraded.length,
      hitRate: null,
      matchedBaseRate: null,
      edgePp: null,
      windowStart: null,
      windowEnd: null,
    }

    if (name !== 'neutral' && subsetGraded.length) {
      // A bullish call is right when the labelled event happened; a bearish call
      // when it did not — so their baselines are p and 1 − p respectively.
      const correctWhen = name === 'bullish' ? 1 : 0
      stats.hitRate = subsetGraded.filter(r => r.label === correctWhen).length / subsetGraded.length
      const matched = matchedBaseRate(rows, subsetGraded)
      stats.windowStart = matched.windowStart
      stats.windowEnd = matched.windowEnd
      if (matched.baseRate != null) {
        stats.matchedBaseRate = correctWhen === 1 ? matched.baseRate : 1 - matched.baseRate
        stats.edgePp = (stats.hitRate - stats.matchedBaseRate) * 100
      }
    }
    directions[name] = stats
  }

  return {
    labelExpr,
    n: rows.length,
    nGraded: graded.length,
    baseRate,
    auc: auc(scored.map(r => r.label as number), scored.map(r => r.score as number)),
    brier,
    brierSkill,
    meanPredicted,
    calibrationGap,
    effectiveN: effectiveN(graded, horizonDays),
    directions,
    nBullish: directions.bullish.n,
    nBearish: directions.bearish.n,
    nNeutral: directions.neutral.n,
    baselines: {
      alwaysBullish: baseRate,
      alwaysBearish: baseRate == null ? null : 1 - baseRate,
      randomAuc: 0.5,
    },
  }
}
