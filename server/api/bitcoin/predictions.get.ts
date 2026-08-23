/**
 * BTC ML Predictions API
 *
 * GET /api/bitcoin/predictions?action=active     — Current active predictions
 * GET /api/bitcoin/predictions?action=scorecard  — Validated accuracy
 * GET /api/bitcoin/predictions?action=history    — Training history timeline
 * GET /api/bitcoin/predictions?action=dashboard  — Pipeline status
 */
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'

const projectRoot = '/var/www/newsar.codejungle.org'
const modelsDir = path.join(projectRoot, 'ml', 'models')

function readJsonFile(filePath: string): any | null {
  if (!existsSync(filePath)) return null
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) }
  catch (e: any) { return null }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const action = (query.action as string) || 'active'
  const db = getDatabase()

  if (action === 'active') {
    const result = await db.execute(sql`
      SELECT id, prediction_date, model_source, direction, prob_up_2w,
             confidence, top_features, status, expires_at, created_at
      FROM btc_predictions
      WHERE status = 'active'
      ORDER BY prediction_date DESC, confidence DESC
    `)

    // Get current BTC price
    const priceResult = await db.execute(sql`
      SELECT price, change_percent_24h FROM btc_prices ORDER BY fetched_at DESC LIMIT 1
    `)
    const currentPrice = priceResult.rows[0] as any

    // Get upcoming calendar events
    const eventsResult = await db.execute(sql`
      SELECT event_date, event_type, name, expected_impact
      FROM btc_calendar_events
      WHERE event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY event_date ASC LIMIT 5
    `)

    return {
      predictions: result.rows.map((r: any) => ({
        id: parseInt(r.id),
        predictionDate: r.prediction_date,
        modelSource: r.model_source,
        direction: r.direction,
        probUp2w: parseFloat(r.prob_up_2w) || null,
        confidence: parseFloat(r.confidence) || null,
        topFeatures: r.top_features,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
      currentPrice: currentPrice ? {
        price: parseFloat(currentPrice.price),
        changePercent24h: parseFloat(currentPrice.change_percent_24h) || null,
      } : null,
      upcomingEvents: eventsResult.rows.map((r: any) => ({
        eventDate: r.event_date,
        eventType: r.event_type,
        name: r.name,
        expectedImpact: r.expected_impact,
      })),
      count: result.rows.length,
    }
  }

  if (action === 'scorecard') {
    const overallResult = await db.execute(sql`
      SELECT
        COUNT(*)::int as total_validated,
        AVG(CASE
          WHEN direction = 'bullish' AND actual_change_2w > 0 THEN 1.0
          WHEN direction = 'bearish' AND actual_change_2w < 0 THEN 1.0
          WHEN direction = 'neutral' THEN NULL
          ELSE 0.0
        END) as win_rate,
        AVG(actual_change_2w) FILTER (WHERE direction = 'bullish') as avg_return_bullish,
        AVG(actual_change_2w) FILTER (WHERE direction = 'bearish') as avg_return_bearish
      FROM btc_predictions
      WHERE validated_at IS NOT NULL AND actual_change_2w IS NOT NULL
    `)

    const recentResult = await db.execute(sql`
      SELECT id, prediction_date, model_source, direction, prob_up_2w,
             confidence, actual_change_2w, validated_at
      FROM btc_predictions
      WHERE validated_at IS NOT NULL AND actual_change_2w IS NOT NULL
      ORDER BY validated_at DESC LIMIT 50
    `)

    const byConfResult = await db.execute(sql`
      SELECT
        CASE
          WHEN confidence >= 0.7 THEN 'High (70%+)'
          WHEN confidence >= 0.4 THEN 'Medium (40-70%)'
          ELSE 'Low (<40%)'
        END as bucket,
        COUNT(*)::int as count,
        AVG(CASE
          WHEN direction = 'bullish' AND actual_change_2w > 0 THEN 1.0
          WHEN direction = 'bearish' AND actual_change_2w < 0 THEN 1.0
          WHEN direction = 'neutral' THEN NULL
          ELSE 0.0
        END) as win_rate,
        AVG(actual_change_2w) as avg_return
      FROM btc_predictions
      WHERE validated_at IS NOT NULL AND actual_change_2w IS NOT NULL AND confidence IS NOT NULL
      GROUP BY bucket ORDER BY bucket
    `)

    const overall = overallResult.rows[0] as any
    return {
      summary: {
        totalValidated: parseInt(overall?.total_validated) || 0,
        winRate: parseFloat(overall?.win_rate) || null,
        avgReturnBullish: parseFloat(overall?.avg_return_bullish) || null,
        avgReturnBearish: parseFloat(overall?.avg_return_bearish) || null,
      },
      recent: recentResult.rows.map((r: any) => {
        const dir = r.direction
        const change = parseFloat(r.actual_change_2w)
        const correct = dir === 'neutral' ? null : (dir === 'bullish' && change > 0) || (dir === 'bearish' && change < 0)
        return {
          id: parseInt(r.id),
          predictionDate: r.prediction_date,
          direction: dir,
          probUp2w: parseFloat(r.prob_up_2w) || null,
          confidence: parseFloat(r.confidence) || null,
          actualChange2w: change,
          correct,
          validatedAt: r.validated_at,
        }
      }),
      byConfidence: byConfResult.rows.map((r: any) => ({
        bucket: r.bucket,
        count: parseInt(r.count),
        winRate: parseFloat(r.win_rate) || null,
        avgReturn: parseFloat(r.avg_return) || null,
      })),
    }
  }

  if (action === 'history') {
    const history = readJsonFile(path.join(modelsDir, 'btc_training_history.json'))
    return { entries: history || [], count: history?.length || 0 }
  }

  if (action === 'dashboard') {
    const metadata = readJsonFile(path.join(modelsDir, 'btc_model_metadata.json'))
    const statsResult = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM btc_daily_features) as total_features,
        (SELECT COUNT(*)::int FROM btc_predictions WHERE status = 'active') as active_predictions,
        (SELECT COUNT(*)::int FROM btc_predictions WHERE validated_at IS NOT NULL) as validated_predictions,
        (SELECT COUNT(*)::int FROM btc_prices) as total_prices,
        (SELECT COUNT(*)::int FROM btc_calendar_events) as total_calendar_events,
        (SELECT MIN(fetched_at) FROM btc_prices) as earliest_price,
        (SELECT MAX(fetched_at) FROM btc_prices) as latest_price
    `)
    const stats = statsResult.rows[0] as any

    const now = new Date()
    const nextSunday = new Date(now)
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7
    nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday)
    nextSunday.setUTCHours(3, 0, 0, 0)

    return {
      model: metadata ? {
        trainingDate: metadata.training_date,
        totalSamples: metadata.total_samples,
        totalFeatures: metadata.total_features,
        nFolds: metadata.n_folds,
        models: Object.fromEntries(
          Object.entries(metadata.models || {}).map(([name, info]: [string, any]) => [name, {
            roc_auc: info.avg_metrics?.roc_auc,
            accuracy: info.avg_metrics?.accuracy,
            f1: info.avg_metrics?.f1,
          }])
        ),
      } : null,
      pipeline: {
        totalFeatures: parseInt(stats.total_features) || 0,
        activePredictions: parseInt(stats.active_predictions) || 0,
        validatedPredictions: parseInt(stats.validated_predictions) || 0,
        totalPrices: parseInt(stats.total_prices) || 0,
        totalCalendarEvents: parseInt(stats.total_calendar_events) || 0,
        earliestPrice: stats.earliest_price,
        latestPrice: stats.latest_price,
      },
      nextRetrainDate: nextSunday.toISOString(),
    }
  }

  return { error: `Unknown action: ${action}` }
})
