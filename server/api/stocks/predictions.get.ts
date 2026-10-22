/**
 * ML Predictions API
 *
 * Routes:
 *   GET /api/stocks/predictions?action=active     — Current active ML predictions
 *   GET /api/stocks/predictions?action=scorecard  — Validated ML prediction accuracy
 *   GET /api/stocks/predictions?action=history    — Training history timeline
 *   GET /api/stocks/predictions?action=dashboard  — Self-learning pipeline status
 */

import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'

import { buildScorecard, type ScorecardRow } from '~/server/utils/scorecard'
import { readLabelContract } from '~/server/utils/labelContract'

const projectRoot = '/var/www/newsar.codejungle.org'
const modelsDir = path.join(projectRoot, 'ml', 'models')
const reportsDir = path.join(projectRoot, 'ml', 'reports')

/**
 * The event the deployed 4-week model is trained on (ml/features.py:
 * target_4w_up = change_4w > 1.0). The scorecard grades this and says so —
 * previously it graded `> 0`, which is a different event.
 */
const LABEL_HURDLE_PCT = 1.0
const LABEL_EXPR = `actual_change_4w > ${LABEL_HURDLE_PCT}%`
const HORIZON_DAYS = 28

function readJsonFile(filePath: string): any | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e: any) {
    console.error(`[predictions] Failed to read ${filePath}:`, e?.message)
    return null
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const action = (query.action as string) || 'active'
  const db = getDatabase()

  if (action === 'active') {
    return handleActive(db)
  }
  if (action === 'scorecard') {
    return handleScorecard(db)
  }
  if (action === 'history') {
    return handleHistory()
  }
  if (action === 'dashboard') {
    return handleDashboard(db)
  }

  return { error: `Unknown action: ${action}` }
})

async function handleActive(db: any) {
  const result = await db.execute(sql`
    SELECT
      r.id, r.signal_direction, r.signal_strength,
      r.ml_prob_up_4w, r.ml_confidence,
      r.event_type, r.event_date, r.expires_at,
      r.medium_term_direction, r.medium_term_confidence,
      r.created_at,
      sw.ticker, sw.company_name, sw.sector,
      e.slug as entity_slug,
      lp.price as current_price, lp.change_percent as current_change_percent
    FROM stock_recommendations r
    JOIN stock_watchlist sw ON sw.id = r.watchlist_id
    LEFT JOIN entities e ON sw.entity_id = e.id
    LEFT JOIN LATERAL (
      SELECT price, change_percent FROM stock_prices
      WHERE watchlist_id = r.watchlist_id ORDER BY fetched_at DESC LIMIT 1
    ) lp ON true
    WHERE r.model_source = 'ml_model'
      AND r.status = 'active'
    ORDER BY r.ml_confidence DESC NULLS LAST, r.signal_strength DESC
  `)

  return {
    predictions: result.rows.map((r: any) => ({
      id: parseInt(r.id),
      ticker: r.ticker,
      companyName: r.company_name,
      sector: r.sector,
      entitySlug: r.entity_slug,
      signalDirection: r.signal_direction,
      signalStrength: parseFloat(r.signal_strength) || 0,
      probUp4w: parseFloat(r.ml_prob_up_4w) || null,
      mlConfidence: parseFloat(r.ml_confidence) || null,
      mediumTermDirection: r.medium_term_direction,
      mediumTermConfidence: parseFloat(r.medium_term_confidence) || 0,
      eventType: r.event_type,
      eventDate: r.event_date,
      expiresAt: r.expires_at,
      currentPrice: parseFloat(r.current_price) || null,
      currentChangePercent: parseFloat(r.current_change_percent) || null,
      createdAt: r.created_at,
    })),
    count: result.rows.length,
  }
}

async function handleScorecard(db: any) {
  const rowsResult = await db.execute(sql`
    SELECT
      r.id, r.model_source, r.signal_direction, r.signal_strength,
      r.ml_prob_up_4w, r.ml_confidence, r.short_term_confidence,
      r.event_type, r.event_date, r.actual_change_4w, r.validated_at,
      sw.ticker, sw.company_name
    FROM stock_recommendations r
    JOIN stock_watchlist sw ON sw.id = r.watchlist_id
    WHERE r.validated_at IS NOT NULL
      AND r.actual_change_4w IS NOT NULL
    ORDER BY r.validated_at DESC
  `)

  const rows = (rowsResult.rows as any[]).map((r: any) => {
    const change = parseFloat(r.actual_change_4w)
    return {
      id: parseInt(r.id),
      modelSource: r.model_source,
      ticker: r.ticker,
      companyName: r.company_name,
      direction: r.signal_direction,
      signalStrength: parseFloat(r.signal_strength) || 0,
      probUp4w: r.ml_prob_up_4w != null ? parseFloat(r.ml_prob_up_4w) : null,
      // Until migration 0021 adds ml_prob_alpha_4w, the probability that decides
      // direction lives in short_term_confidence.
      probAlpha4w: r.short_term_confidence != null ? parseFloat(r.short_term_confidence) : null,
      mlConfidence: r.ml_confidence != null ? parseFloat(r.ml_confidence) : null,
      eventType: r.event_type,
      eventDate: r.event_date,
      actualChange4w: Number.isFinite(change) ? change : null,
      label: Number.isFinite(change) ? (change > LABEL_HURDLE_PCT ? 1 : 0) : null,
      validatedAt: r.validated_at,
    }
  })

  const toScorecardRows = (subset: typeof rows, score: (r: typeof rows[0]) => number | null): ScorecardRow[] =>
    subset.map(r => ({
      score: score(r),
      label: r.label,
      direction: r.direction,
      date: r.eventDate,
      cluster: r.ticker,
    }))

  const mlRows = rows.filter(r => r.modelSource === 'ml_model')
  const heuristicRows = rows.filter(r => r.modelSource === 'heuristic')
  const opts = { labelExpr: LABEL_EXPR, horizonDays: HORIZON_DAYS }

  const scorecards = {
    // The score that decides direction, and therefore the one that matters.
    mlDeciding: {
      ...buildScorecard(toScorecardRows(mlRows, r => r.probAlpha4w), opts),
      score: 'ml_prob_alpha_4w',
      note: 'alpha model — decides signal_direction',
    },
    // Displayed on the page but not part of the decision path.
    mlRawReturn: {
      ...buildScorecard(toScorecardRows(mlRows, r => r.probUp4w), opts),
      score: 'ml_prob_up_4w',
      note: 'raw-return model — displayed only',
    },
    // The control the ML model has to beat.
    heuristic: {
      ...buildScorecard(toScorecardRows(heuristicRows, r => r.signalStrength),
                        { ...opts, scoreIsProbability: false }),
      score: 'signal_strength',
      note: 'heuristic composite — the control',
    },
  }

  // Cluster-bootstrap confidence intervals are computed nightly by ml/evaluate.py;
  // recomputing them per request would be both slow and, done naively, wrong.
  const report = readJsonFile(path.join(reportsDir, 'evaluation_report.json'))
  const reportScores: any[] = report?.live?.sources?.ml_model?.scores ?? []
  const findCi = (scoreName: string) => {
    const match = reportScores.find((s: any) => s.score === scoreName && s.ci_low != null)
    return match ? { low: match.ci_low, high: match.ci_high, level: match.ci_level } : null
  }
  ;(scorecards.mlDeciding as any).ci = findCi('ml_prob_alpha_4w') ?? findCi('short_term_confidence')
  ;(scorecards.mlRawReturn as any).ci = findCi('ml_prob_up_4w')
  ;(scorecards as any).reportGeneratedAt = report?.generated_at ?? null

  // Grouped breakdowns, each with the base rate over its own window rather than
  // a bare win rate.
  const groupBy = (subset: typeof rows, key: (r: typeof rows[0]) => string) => {
    const groups = new Map<string, typeof rows>()
    for (const r of subset) {
      const k = key(r)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(r)
    }
    return [...groups.entries()].map(([name, group]) => {
      const card = buildScorecard(toScorecardRows(group, r => r.probAlpha4w), opts)
      const directional = ['bullish', 'bearish']
        .map(d => card.directions[d])
        .filter(d => d.nGraded > 0)
      const hits = directional.reduce((s, d) => s + (d.hitRate! * d.nGraded), 0)
      const graded = directional.reduce((s, d) => s + d.nGraded, 0)
      return {
        name,
        count: group.length,
        winRate: graded > 0 ? hits / graded : null,
        baseRate: card.baseRate,
        avgReturn: group.length
          ? group.reduce((s, r) => s + (r.actualChange4w ?? 0), 0) / group.length
          : null,
        nBullish: card.nBullish,
      }
    }).sort((a, b) => b.count - a.count)
  }

  const byEventType = groupBy(mlRows, r => r.eventType)
    .map(g => ({ eventType: g.name, ...g }))
  const byConfidence = groupBy(mlRows, r =>
    r.mlConfidence == null ? 'Unknown'
      : r.mlConfidence >= 0.7 ? 'High (70%+)'
      : r.mlConfidence >= 0.4 ? 'Medium (40-70%)'
      : 'Low (<40%)')
    .map(g => ({ bucket: g.name, ...g }))

  const deciding = scorecards.mlDeciding
  const bullish = deciding.directions.bullish
  const bearish = deciding.directions.bearish
  const gradedDirectional = bullish.nGraded + bearish.nGraded
  const winRate4w = gradedDirectional > 0
    ? (bullish.hitRate! * bullish.nGraded + bearish.hitRate! * bearish.nGraded) / gradedDirectional
    : null

  /**
   * The number the pooled win rate actually has to beat.
   *
   * Not the label base rate: a bearish call is "correct" when the event did NOT
   * happen, so its baseline is 1 − p. With 228 of 249 calls bearish, comparing
   * the pooled win rate against p alone flatters the model by ~14 points. The
   * comparator has to be weighted by the direction mix the model chose.
   */
  const blendedBaseline = gradedDirectional > 0
    && bullish.matchedBaseRate != null && bearish.matchedBaseRate != null
    ? (bullish.matchedBaseRate * bullish.nGraded + bearish.matchedBaseRate * bearish.nGraded) / gradedDirectional
    : bearish.matchedBaseRate ?? bullish.matchedBaseRate ?? null

  const avgOf = (subset: typeof rows) => subset.length
    ? subset.reduce((s, r) => s + (r.actualChange4w ?? 0), 0) / subset.length
    : null

  // Whether each model is cleared to trade, and why. Derived from outcomes by
  // ml/evaluate.py — see server/utils/labelContract.ts.
  const contract = readLabelContract()

  return {
    labelExpr: LABEL_EXPR,
    contract: contract ? {
      version: contract.version,
      criterion: contract.criterion,
      generatedAt: contract.generated_at,
      sources: contract.sources,
    } : null,
    summary: {
      totalValidated: mlRows.length,
      winRate4w,
      // Every win rate now travels with the number it has to beat.
      winRateBaseline: blendedBaseline,
      baseRate: deciding.baseRate,
      alwaysBullishRate: deciding.baselines.alwaysBullish,
      alwaysBearishRate: deciding.baselines.alwaysBearish,
      nBullish: deciding.nBullish,
      nBearish: deciding.nBearish,
      nNeutral: deciding.nNeutral,
      auc: deciding.auc,
      brierSkill: deciding.brierSkill,
      meanPredicted: deciding.meanPredicted,
      calibrationGap: deciding.calibrationGap,
      effectiveN: deciding.effectiveN,
      avgReturnBullish: avgOf(mlRows.filter(r => r.direction === 'bullish')),
      avgReturnBearish: avgOf(mlRows.filter(r => r.direction === 'bearish')),
    },
    scorecards,
    recent: rows.filter(r => r.modelSource === 'ml_model').slice(0, 50).map(r => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.companyName,
      signalDirection: r.direction,
      signalStrength: r.signalStrength,
      probUp4w: r.probUp4w,
      probAlpha4w: r.probAlpha4w,
      mlConfidence: r.mlConfidence,
      eventType: r.eventType,
      eventDate: r.eventDate,
      actualChange4w: r.actualChange4w,
      correct: r.direction === 'neutral' || r.label == null
        ? null
        : (r.direction === 'bullish' ? r.label === 1 : r.label === 0),
      validatedAt: r.validatedAt,
    })),
    byEventType,
    byConfidence,
  }
}

function handleHistory() {
  const historyPath = path.join(modelsDir, 'training_history.json')
  const history = readJsonFile(historyPath)

  if (!history || !Array.isArray(history)) {
    return { entries: [], count: 0 }
  }

  return {
    entries: history,
    count: history.length,
  }
}

async function handleDashboard(db: any) {
  const metadata = readJsonFile(path.join(modelsDir, 'model_metadata.json'))

  // Database stats
  const statsResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM stock_news_correlations) as total_anomalies,
      (SELECT COUNT(*)::int FROM stock_recommendations WHERE model_source = 'ml_model' AND validated_at IS NOT NULL AND actual_change_4w IS NOT NULL) as validated_outcomes,
      (SELECT COUNT(*)::int FROM stock_recommendations WHERE model_source = 'ml_model' AND status = 'active') as active_ml_signals,
      (SELECT COUNT(*)::int FROM stock_recommendations WHERE model_source = 'ml_model' AND validated_at IS NOT NULL) as validated_ml_signals,
      (SELECT COUNT(*)::int FROM stock_watchlist WHERE entity_id IS NOT NULL AND is_active = true) as mapped_tickers,
      (SELECT COUNT(*)::int FROM stock_watchlist WHERE entity_id IS NULL AND is_active = true) as unmapped_tickers,
      (SELECT COUNT(*)::int FROM stock_watchlist WHERE is_active = true) as total_tickers,
      (SELECT COUNT(DISTINCT watchlist_id)::int FROM stock_news_correlations) as tickers_with_anomalies
  `)

  const stats = statsResult.rows[0] as any

  // Compute next retrain date (next Sunday at 2 AM UTC)
  const now = new Date()
  const nextSunday = new Date(now)
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday)
  nextSunday.setUTCHours(2, 0, 0, 0)
  if (nextSunday <= now) {
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7)
  }

  return {
    model: metadata ? {
      trainingDate: metadata.training_date,
      totalSamples: metadata.total_samples,
      totalFeatures: metadata.total_features,
      nFolds: metadata.n_folds,
      models: Object.fromEntries(
        Object.entries(metadata.models || {}).map(([name, info]: [string, any]) => [
          name,
          {
            roc_auc: info.avg_metrics?.roc_auc,
            accuracy: info.avg_metrics?.accuracy,
            f1: info.avg_metrics?.f1,
          },
        ])
      ),
    } : null,
    pipeline: {
      totalAnomalies: parseInt(stats.total_anomalies) || 0,
      validatedOutcomes: parseInt(stats.validated_outcomes) || 0,
      activeMlSignals: parseInt(stats.active_ml_signals) || 0,
      validatedMlSignals: parseInt(stats.validated_ml_signals) || 0,
      mappedTickers: parseInt(stats.mapped_tickers) || 0,
      unmappedTickers: parseInt(stats.unmapped_tickers) || 0,
      totalTickers: parseInt(stats.total_tickers) || 0,
      tickersWithAnomalies: parseInt(stats.tickers_with_anomalies) || 0,
    },
    nextRetrainDate: nextSunday.toISOString(),
  }
}
