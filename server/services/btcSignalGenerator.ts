/**
 * BTC Signal Generator
 *
 * Runs ML model on latest daily features, stores predictions in btc_predictions.
 * Calls ml/btc_predict.py, same pattern as stockSignalGenerator.generateMLRecommendations.
 */
import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() { if (!db) db = getDatabase(); return db }

export async function generatePredictions(daysBack: number = 7): Promise<{ generated: number; errors: number }> {
  const { spawn } = await import('child_process')
  const path = await import('path')
  const { fileURLToPath } = await import('url')
  const fs = await import('fs')

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(__dirname, '..', '..')
  const mlDir = path.join(projectRoot, 'ml')
  const venvPython = path.join(mlDir, '.venv', 'bin', 'python')

  if (!fs.existsSync(venvPython)) {
    console.log('[BtcSignalGen] Python venv not found. Skipping.')
    return { generated: 0, errors: 0 }
  }

  const modelPath = path.join(mlDir, 'models', 'btc_xgb_2w_classifier.joblib')
  if (!fs.existsSync(modelPath)) {
    console.log('[BtcSignalGen] No trained BTC models found. Run ml:btc-train first.')
    return { generated: 0, errors: 0 }
  }

  return new Promise((resolve) => {
    const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://newsar@localhost:5432/newsar' }
    const child = spawn(venvPython, [path.join(mlDir, 'btc_predict.py'), '--since', String(daysBack)], { cwd: mlDir, env })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    child.on('close', async (code) => {
      if (code !== 0) {
        console.error(`[BtcSignalGen] btc_predict.py failed (code ${code}):`, stderr)
        resolve({ generated: 0, errors: 1 })
        return
      }

      let predictions: any[]
      try { predictions = JSON.parse(stdout) } catch (e) {
        console.error('[BtcSignalGen] Failed to parse predictions:', stdout.slice(0, 200))
        resolve({ generated: 0, errors: 1 })
        return
      }

      if (!predictions.length) {
        console.log('[BtcSignalGen] No predictions returned')
        resolve({ generated: 0, errors: 0 })
        return
      }

      let generated = 0, errors = 0
      for (const pred of predictions) {
        try {
          const predDate = pred.prediction_date
          const expiresAt = new Date(predDate)
          expiresAt.setDate(expiresAt.getDate() + 14)

          await getDb().execute(sql`
            INSERT INTO btc_predictions (
              prediction_date, model_source, direction, prob_up_2w,
              confidence, top_features, status, expires_at
            ) VALUES (
              ${predDate}::date, ${pred.model_source || 'ensemble'}, ${pred.direction},
              ${pred.prob_up_2w}, ${pred.confidence},
              ${JSON.stringify(pred.top_features || [])}::jsonb,
              'active', ${expiresAt}
            )
            ON CONFLICT (prediction_date, model_source) DO UPDATE SET
              direction = EXCLUDED.direction,
              prob_up_2w = EXCLUDED.prob_up_2w,
              confidence = EXCLUDED.confidence,
              top_features = EXCLUDED.top_features,
              status = 'active',
              updated_at = NOW()
          `)
          generated++
          console.log(`[BtcSignalGen] ${predDate}: ${pred.direction} (P(up)=${(pred.prob_up_2w * 100).toFixed(1)}%)`)
        } catch (e) {
          console.error(`[BtcSignalGen] Error storing prediction:`, e)
          errors++
        }
      }

      // Expire old predictions past expiry
      await getDb().execute(sql`
        UPDATE btc_predictions SET status = 'expired', updated_at = NOW()
        WHERE status = 'active' AND expires_at < NOW()
      `)

      resolve({ generated, errors })
    })
  })
}

export async function validatePredictions(): Promise<{ validated: number; noData: number }> {
  const preds = await getDb().execute(sql`
    SELECT id, prediction_date FROM btc_predictions
    WHERE validated_at IS NULL AND prediction_date < NOW() - INTERVAL '14 days'
    ORDER BY prediction_date ASC
  `)

  let validated = 0, noData = 0
  for (const row of preds.rows as any[]) {
    const predDate = new Date(row.prediction_date).toISOString().split('T')[0]

    const baseResult = await getDb().execute(sql`
      SELECT price FROM btc_prices WHERE DATE(fetched_at) = ${predDate}::date ORDER BY fetched_at DESC LIMIT 1
    `)
    if (baseResult.rows.length === 0) { noData++; continue }
    const basePrice = parseFloat((baseResult.rows[0] as any).price)

    const fwdDate = new Date(row.prediction_date)
    fwdDate.setDate(fwdDate.getDate() + 14)
    const fwdDateStr = fwdDate.toISOString().split('T')[0]

    const fwdResult = await getDb().execute(sql`
      SELECT price FROM btc_prices WHERE DATE(fetched_at) = ${fwdDateStr}::date ORDER BY fetched_at DESC LIMIT 1
    `)
    if (fwdResult.rows.length === 0) { noData++; continue }
    const fwdPrice = parseFloat((fwdResult.rows[0] as any).price)
    const change = ((fwdPrice - basePrice) / basePrice) * 100

    await getDb().execute(sql`
      UPDATE btc_predictions
      SET actual_change_2w = ${+change.toFixed(4)}, validated_at = NOW(), status = 'validated', updated_at = NOW()
      WHERE id = ${parseInt(row.id)}
    `)
    validated++
  }

  console.log(`[BtcSignalGen] Validated ${validated} predictions, ${noData} missing data`)
  return { validated, noData }
}
