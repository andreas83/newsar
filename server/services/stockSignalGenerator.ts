/**
 * Stock Signal Generator
 *
 * Combines recent anomaly events with historical signal profiles to produce
 * buy/sell recommendations with dual timeframe outlook (short-term 1-5d, medium-term 1-4w).
 *
 * Composite Score Algorithm (5 weighted factors):
 *   0.35 * Historical win rate (from signal profiles)
 *   0.20 * Anomaly confidence (from stock_news_correlations)
 *   0.15 * Event type strength (3x=1.0, 2x=0.6, diversity=0.4)
 *   0.15 * Source diversity (min(1, (sources-1)/4))
 *   0.15 * Mention multiplier (min(1, (multiplier-2)/6))
 *
 * Score is dampened toward 0.5 proportionally to profile_confidence,
 * so tickers with few historical events don't produce strong signals.
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

interface AnomalyRow {
  id: number
  watchlistId: number
  entityId: number | null
  eventType: string
  eventDate: Date
  confidence: number
  metadata: any
  mentionCountWindow: number
  priceBefore: number | null
  priceAfter: number | null
  priceChangePercent: number | null
  ticker: string
  companyName: string
  sector: string | null
}

interface ProfileRow {
  id: number
  watchlistId: number
  eventType: string
  sampleCount: number
  avgChange5d: number | null
  avgChange4w: number | null
  winRate5d: number | null
  winRate4w: number | null
  avgChange1d: number | null
  avgChange3d: number | null
  winRate1d: number | null
  winRate3d: number | null
  profileConfidence: number
}

function eventTypeStrength(eventType: string): number {
  if (eventType === 'volume_spike_3x') return 1.0
  if (eventType === 'volume_spike_2x') return 0.6
  if (eventType === 'source_diversity_spike') return 0.4
  return 0.3
}

function computeDirection(score: number, avgChange: number | null): 'bullish' | 'bearish' | 'neutral' {
  if (score > 0.55 && avgChange != null && avgChange > 0) return 'bullish'
  if (score > 0.55 && avgChange != null && avgChange < 0) return 'bearish'
  return 'neutral'
}

/**
 * Generate recommendations for recent anomalies that don't have one yet.
 */
export async function generateRecommendations(daysBack: number = 7): Promise<{ generated: number; skipped: number }> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  // Find recent anomalies without existing recommendations
  const anomalies = await getDb().execute(sql`
    SELECT
      c.id, c.watchlist_id, c.entity_id, c.event_type, c.event_date,
      c.confidence, c.metadata, c.mention_count_window,
      c.price_before, c.price_after, c.price_change_percent,
      sw.ticker, sw.company_name, sw.sector
    FROM stock_news_correlations c
    JOIN stock_watchlist sw ON sw.id = c.watchlist_id
    LEFT JOIN stock_recommendations r ON r.correlation_id = c.id
    WHERE c.event_date >= ${cutoffStr}::date
      AND r.id IS NULL
    ORDER BY c.event_date DESC
  `)

  if (anomalies.rows.length === 0) {
    console.log('[SignalGen] No new anomalies to process')
    return { generated: 0, skipped: 0 }
  }

  console.log(`[SignalGen] Found ${anomalies.rows.length} anomalies without recommendations`)

  // Load all signal profiles
  const profilesResult = await getDb().execute(sql`
    SELECT
      id, watchlist_id, event_type, sample_count,
      avg_change_1d, avg_change_3d, avg_change_5d, avg_change_4w,
      win_rate_1d, win_rate_3d, win_rate_5d, win_rate_4w,
      profile_confidence
    FROM stock_signal_profiles
  `)

  // Index profiles by "watchlistId:eventType"
  const profileMap = new Map<string, ProfileRow>()
  for (const row of profilesResult.rows as any[]) {
    const key = `${row.watchlist_id}:${row.event_type}`
    profileMap.set(key, {
      id: parseInt(row.id),
      watchlistId: parseInt(row.watchlist_id),
      eventType: row.event_type,
      sampleCount: parseInt(row.sample_count),
      avgChange5d: parseFloat(row.avg_change_5d) || null,
      avgChange4w: parseFloat(row.avg_change_4w) || null,
      winRate5d: parseFloat(row.win_rate_5d) || null,
      winRate4w: parseFloat(row.win_rate_4w) || null,
      avgChange1d: parseFloat(row.avg_change_1d) || null,
      avgChange3d: parseFloat(row.avg_change_3d) || null,
      winRate1d: parseFloat(row.win_rate_1d) || null,
      winRate3d: parseFloat(row.win_rate_3d) || null,
      profileConfidence: parseFloat(row.profile_confidence) || 0,
    })
  }

  let generated = 0
  let skipped = 0

  for (const row of anomalies.rows as any[]) {
    const watchlistId = parseInt(row.watchlist_id)
    const correlationId = parseInt(row.id)
    const eventType = row.event_type
    const confidence = parseFloat(row.confidence) || 0
    const metadata = row.metadata || {}
    const multiplier = parseFloat(metadata.multiplier) || 2
    const sourceCount = parseInt(metadata.source_count) || 1

    // Look up profile for this ticker + event type
    const profileKey = `${watchlistId}:${eventType}`
    const profile = profileMap.get(profileKey)

    if (!profile) {
      // No historical profile for this combination -- generate a neutral signal
      skipped++
      continue
    }

    // -- Composite score (5 factors) --

    // 1. Historical win rate (0.35 weight)
    const shortWinRate = profile.winRate5d ?? 0.5
    const mediumWinRate = profile.winRate4w ?? 0.5

    // 2. Anomaly confidence (0.20 weight)
    const anomalyConf = confidence

    // 3. Event type strength (0.15 weight)
    const evtStrength = eventTypeStrength(eventType)

    // 4. Source diversity (0.15 weight)
    const srcDiversity = Math.min(1, (sourceCount - 1) / 4)

    // 5. Mention multiplier (0.15 weight)
    const mentionMult = Math.min(1, (multiplier - 2) / 6)

    // Short-term composite (uses 5d win rate)
    const shortRaw =
      0.35 * shortWinRate +
      0.20 * anomalyConf +
      0.15 * evtStrength +
      0.15 * srcDiversity +
      0.15 * mentionMult

    // Medium-term composite (uses 4w win rate)
    const mediumRaw =
      0.35 * mediumWinRate +
      0.20 * anomalyConf +
      0.15 * evtStrength +
      0.15 * srcDiversity +
      0.15 * mentionMult

    // Dampen toward 0.5 based on profile confidence
    const profConf = profile.profileConfidence
    const shortScore = +(0.5 + (shortRaw - 0.5) * profConf).toFixed(4)
    const mediumScore = +(0.5 + (mediumRaw - 0.5) * profConf).toFixed(4)

    // Overall signal: average of short and medium, weighted toward short
    const overallScore = +(shortScore * 0.6 + mediumScore * 0.4).toFixed(4)

    // Directions
    const shortDir = computeDirection(shortScore, profile.avgChange5d)
    const mediumDir = computeDirection(mediumScore, profile.avgChange4w)

    // Overall direction: prioritize short-term if both agree; else use the stronger signal
    let overallDir: 'bullish' | 'bearish' | 'neutral' = 'neutral'
    if (shortDir === mediumDir && shortDir !== 'neutral') {
      overallDir = shortDir
    } else if (shortDir !== 'neutral') {
      overallDir = shortDir
    } else if (mediumDir !== 'neutral') {
      overallDir = mediumDir
    }

    // Expiry: 5 trading days from event
    const eventDate = new Date(row.event_date)
    const expiresAt = new Date(eventDate)
    expiresAt.setDate(expiresAt.getDate() + 7) // ~5 trading days

    // Trigger metadata snapshot
    const triggerMeta = {
      ticker: row.ticker,
      companyName: row.company_name,
      sector: row.sector,
      multiplier,
      sourceCount,
      mentionCount: parseInt(row.mention_count_window) || 0,
      baselineAvg: metadata.baseline_avg,
      newKeywords: metadata.new_keywords || [],
      priceOnEvent: parseFloat(row.price_after) || null,
      priceChange: parseFloat(row.price_change_percent) || null,
    }

    await getDb().execute(sql`
      INSERT INTO stock_recommendations (
        watchlist_id, correlation_id, profile_id,
        signal_direction, signal_strength,
        short_term_direction, short_term_confidence, short_term_expected_change,
        medium_term_direction, medium_term_confidence, medium_term_expected_change,
        event_strength, historical_winrate, anomaly_confidence,
        source_diversity, mention_multiplier,
        event_type, event_date, trigger_metadata,
        status, expires_at
      ) VALUES (
        ${watchlistId}, ${correlationId}, ${profile.id},
        ${overallDir}, ${overallScore},
        ${shortDir}, ${shortScore}, ${profile.avgChange5d},
        ${mediumDir}, ${mediumScore}, ${profile.avgChange4w},
        ${evtStrength}, ${shortWinRate}, ${anomalyConf},
        ${srcDiversity}, ${mentionMult},
        ${eventType}, ${eventDate}, ${JSON.stringify(triggerMeta)}::jsonb,
        'active', ${expiresAt}
      )
      ON CONFLICT (correlation_id, model_source) DO NOTHING
    `)

    generated++

    console.log(
      `[SignalGen] ${row.ticker}: ${overallDir} (${(overallScore * 100).toFixed(0)}%) ` +
      `| Short: ${shortDir} (${(shortScore * 100).toFixed(0)}%), ` +
      `Medium: ${mediumDir} (${(mediumScore * 100).toFixed(0)}%) ` +
      `| Event: ${eventType}, confidence: ${(profConf * 100).toFixed(0)}%`
    )
  }

  // Expire old recommendations
  await getDb().execute(sql`
    UPDATE stock_recommendations
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active' AND expires_at < NOW()
  `)

  return { generated, skipped }
}

/**
 * Validate past recommendations by looking up actual price outcomes.
 */
export async function validateRecommendations(): Promise<{ validated: number; noData: number }> {
  // Find active/expired recommendations that haven't been validated yet
  const recs = await getDb().execute(sql`
    SELECT
      r.id, r.watchlist_id, r.event_date, r.signal_direction, r.signal_strength,
      r.short_term_expected_change, r.medium_term_expected_change
    FROM stock_recommendations r
    WHERE r.validated_at IS NULL
      AND r.event_date < NOW() - interval '7 days'
    ORDER BY r.event_date ASC
  `)

  let validated = 0
  let noData = 0

  for (const row of recs.rows as any[]) {
    const recId = parseInt(row.id)
    const watchlistId = parseInt(row.watchlist_id)
    const eventDate = new Date(row.event_date)
    const eventDateStr = eventDate.toISOString().split('T')[0]

    // Get event-day price
    const basePriceResult = await getDb().execute(sql`
      SELECT price FROM stock_prices
      WHERE watchlist_id = ${watchlistId}
        AND DATE(fetched_at) = ${eventDateStr}::date
      ORDER BY source ASC, fetched_at DESC
      LIMIT 1
    `)

    if (basePriceResult.rows.length === 0) {
      noData++
      continue
    }

    const basePrice = parseFloat((basePriceResult.rows[0] as any).price)

    // Get 5d forward price
    const p5dResult = await getDb().execute(sql`
      WITH daily_closes AS (
        SELECT DISTINCT ON (DATE(fetched_at))
          price, DATE(fetched_at) as trade_date
        FROM stock_prices
        WHERE watchlist_id = ${watchlistId}
          AND DATE(fetched_at) > ${eventDateStr}::date
        ORDER BY DATE(fetched_at) ASC, source ASC, fetched_at DESC
      )
      SELECT price FROM daily_closes ORDER BY trade_date ASC OFFSET 4 LIMIT 1
    `)

    // Get 4w (20d) forward price
    const p4wResult = await getDb().execute(sql`
      WITH daily_closes AS (
        SELECT DISTINCT ON (DATE(fetched_at))
          price, DATE(fetched_at) as trade_date
        FROM stock_prices
        WHERE watchlist_id = ${watchlistId}
          AND DATE(fetched_at) > ${eventDateStr}::date
        ORDER BY DATE(fetched_at) ASC, source ASC, fetched_at DESC
      )
      SELECT price FROM daily_closes ORDER BY trade_date ASC OFFSET 19 LIMIT 1
    `)

    const actualChange5d = p5dResult.rows.length > 0
      ? +((parseFloat((p5dResult.rows[0] as any).price) - basePrice) / basePrice * 100).toFixed(4)
      : null

    const actualChange4w = p4wResult.rows.length > 0
      ? +((parseFloat((p4wResult.rows[0] as any).price) - basePrice) / basePrice * 100).toFixed(4)
      : null

    if (actualChange5d == null && actualChange4w == null) {
      noData++
      continue
    }

    await getDb().execute(sql`
      UPDATE stock_recommendations
      SET
        actual_change_5d = ${actualChange5d},
        actual_change_4w = ${actualChange4w},
        validated_at = NOW(),
        status = 'validated',
        updated_at = NOW()
      WHERE id = ${recId}
    `)

    validated++
  }

  return { validated, noData }
}

/**
 * Generate ML-based recommendations by calling the Python prediction pipeline.
 * Falls back to heuristic if ML models aren't available.
 */
export async function generateMLRecommendations(daysBack: number = 7): Promise<{ generated: number; errors: number }> {
  const { spawn } = await import('child_process')
  const path = await import('path')
  const { fileURLToPath } = await import('url')

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mlDir = path.join(projectRoot, 'ml')
  const venvPython = path.join(mlDir, '.venv', 'bin', 'python')

  // Check if venv exists
  const fs = await import('fs')
  if (!fs.existsSync(venvPython)) {
    console.log('[SignalGen-ML] Python venv not found. Run `npm run ml:setup` first. Falling back to heuristic.')
    return { generated: 0, errors: 0 }
  }

  // Check if models exist
  const modelPath = path.join(mlDir, 'models', 'xgb_5d_classifier.joblib')
  if (!fs.existsSync(modelPath)) {
    console.log('[SignalGen-ML] No trained models found. Run `npm run ml:train` first. Falling back to heuristic.')
    return { generated: 0, errors: 0 }
  }

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://newsar@localhost:5432/newsar',
    }

    const child = spawn(venvPython, [
      path.join(mlDir, 'predict.py'),
      '--since', String(daysBack),
    ], { cwd: mlDir, env })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    child.on('close', async (code) => {
      if (code !== 0) {
        console.error(`[SignalGen-ML] predict.py failed (code ${code}):`, stderr)
        resolve({ generated: 0, errors: 1 })
        return
      }

      let predictions: any[]
      try {
        predictions = JSON.parse(stdout)
      } catch (e) {
        console.error('[SignalGen-ML] Failed to parse predictions:', stdout.slice(0, 200))
        resolve({ generated: 0, errors: 1 })
        return
      }

      if (!predictions.length) {
        console.log('[SignalGen-ML] No predictions returned')
        resolve({ generated: 0, errors: 0 })
        return
      }

      let generated = 0
      let errors = 0

      for (const pred of predictions) {
        try {
          const probUp5d = pred.prob_up_5d ?? 0.5
          const expectedChange5d = pred.expected_change_5d ?? 0
          const probUp4w = pred.prob_up_4w ?? 0.5
          const mlConfidence = pred.confidence ?? 0

          // Map ML probability to signal direction
          let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral'
          if (probUp5d > 0.6 && expectedChange5d > 0) direction = 'bullish'
          else if (probUp5d < 0.4 && expectedChange5d < 0) direction = 'bearish'

          // Signal strength = distance from 0.5 (0 to 1 scale)
          const strength = Math.abs(probUp5d - 0.5) * 2

          const eventDate = new Date(pred.event_date)
          const expiresAt = new Date(eventDate)
          expiresAt.setDate(expiresAt.getDate() + 7)

          // Insert ML recommendation as separate row (composite unique on correlation_id + model_source)
          await getDb().execute(sql`
            INSERT INTO stock_recommendations (
              watchlist_id, correlation_id,
              signal_direction, signal_strength,
              short_term_direction, short_term_confidence,
              medium_term_direction, medium_term_confidence,
              event_type, event_date,
              model_source,
              ml_prob_up_5d, ml_expected_change_5d, ml_prob_up_4w, ml_confidence,
              status, expires_at
            )
            SELECT
              c.watchlist_id, ${pred.correlation_id},
              ${direction}, ${strength},
              ${direction}, ${probUp5d},
              ${probUp4w > 0.6 ? 'bullish' : probUp4w < 0.4 ? 'bearish' : 'neutral'}, ${probUp4w},
              c.event_type, c.event_date,
              'ml_model',
              ${probUp5d}, ${expectedChange5d}, ${probUp4w}, ${mlConfidence},
              'active', ${expiresAt}
            FROM stock_news_correlations c
            WHERE c.id = ${pred.correlation_id}
            ON CONFLICT (correlation_id, model_source) DO UPDATE SET
              signal_direction = EXCLUDED.signal_direction,
              signal_strength = EXCLUDED.signal_strength,
              short_term_direction = EXCLUDED.short_term_direction,
              short_term_confidence = EXCLUDED.short_term_confidence,
              medium_term_direction = EXCLUDED.medium_term_direction,
              medium_term_confidence = EXCLUDED.medium_term_confidence,
              ml_prob_up_5d = EXCLUDED.ml_prob_up_5d,
              ml_expected_change_5d = EXCLUDED.ml_expected_change_5d,
              ml_prob_up_4w = EXCLUDED.ml_prob_up_4w,
              ml_confidence = EXCLUDED.ml_confidence,
              status = 'active',
              updated_at = NOW()
          `)

          generated++
        } catch (e) {
          console.error(`[SignalGen-ML] Error storing prediction for correlation ${pred.correlation_id}:`, e)
          errors++
        }
      }

      console.log(`[SignalGen-ML] Stored ${generated} ML predictions (${errors} errors)`)
      resolve({ generated, errors })
    })
  })
}

/**
 * Generate recommendations for a specific date (called from anomaly detector).
 * Soft dependency -- errors are logged but don't propagate.
 */
export async function generateRecommendationsForDate(dateStr: string): Promise<void> {
  try {
    const result = await generateRecommendations(1)
    if (result.generated > 0) {
      console.log(`[SignalGen] Generated ${result.generated} recommendations for anomalies near ${dateStr}`)
    }

    // Also try ML recommendations (non-blocking)
    generateMLRecommendations(1).catch(err => {
      console.error(`[SignalGen-ML] ML recommendations failed for ${dateStr}:`, err)
    })
  } catch (err) {
    console.error(`[SignalGen] Failed to generate recommendations for ${dateStr}:`, err)
  }
}
