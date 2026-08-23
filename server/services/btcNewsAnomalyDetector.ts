/**
 * BTC News Anomaly Detector
 *
 * Detects spikes in crypto/macro news volume and sentiment shifts.
 * Supplements daily features with event-driven signals.
 */
import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() { if (!db) db = getDatabase(); return db }

interface AnomalyResult {
  dateProcessed: string
  cryptoMentions: number
  cryptoBaseline: number
  macroMentions: number
  anomaliesDetected: number
}

export async function detectAnomalies(daysBack: number = 7): Promise<AnomalyResult[]> {
  const results: AnomalyResult[] = []

  for (let i = daysBack; i >= 1; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    const result = await detectForDate(dateStr)
    results.push(result)
  }

  return results
}

async function detectForDate(dateStr: string): Promise<AnomalyResult> {
  // Count crypto entity mentions on target date
  const cryptoResult = await getDb().execute(sql`
    SELECT COUNT(DISTINCT ae.article_id)::int as cnt
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND (e.name ILIKE '%bitcoin%' OR e.name ILIKE '%cryptocurrency%' OR e.name ILIKE '%crypto%')
      AND e.name NOT ILIKE '%crypto.com arena%'
  `)
  const cryptoMentions = parseInt((cryptoResult.rows[0] as any)?.cnt) || 0

  // 30-day baseline
  const baselineResult = await getDb().execute(sql`
    SELECT COALESCE(COUNT(DISTINCT ae.article_id)::float / 30, 0) as avg_daily
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE a.published_at >= (${dateStr}::date - INTERVAL '31 days')
      AND a.published_at < ${dateStr}::date
      AND a.excluded = false
      AND (e.name ILIKE '%bitcoin%' OR e.name ILIKE '%cryptocurrency%' OR e.name ILIKE '%crypto%')
      AND e.name NOT ILIKE '%crypto.com arena%'
  `)
  const cryptoBaseline = parseFloat((baselineResult.rows[0] as any)?.avg_daily) || 0

  // Count macro mentions (war/Fed/geopolitical)
  const macroResult = await getDb().execute(sql`
    SELECT COUNT(DISTINCT ae.article_id)::int as cnt
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND (e.name ILIKE '%federal reserve%' OR e.name ILIKE '%war%' OR e.name ILIKE '%nato%')
  `)
  const macroMentions = parseInt((macroResult.rows[0] as any)?.cnt) || 0

  let anomaliesDetected = 0
  if (cryptoBaseline > 0 && cryptoMentions / cryptoBaseline >= 2) {
    anomaliesDetected++
    console.log(`[BtcAnomaly] ${dateStr}: Crypto mention spike ${cryptoMentions} (${(cryptoMentions / cryptoBaseline).toFixed(1)}x baseline)`)
  }

  return { dateProcessed: dateStr, cryptoMentions, cryptoBaseline, macroMentions, anomaliesDetected }
}
