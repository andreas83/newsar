/**
 * BTC Backtester
 *
 * Computes forward BTC price changes for each daily feature row.
 * Calendar days (not trading days — BTC trades 24/7).
 * Horizons: 1d, 3d, 7d, 14d, 28d
 */
import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() { if (!db) db = getDatabase(); return db }

export async function backtestFeatures(): Promise<{ updated: number; noData: number }> {
  // Get all btc_daily_features rows without targets
  const features = await getDb().execute(sql`
    SELECT id, feature_date FROM btc_daily_features
    WHERE target_14d_change IS NULL
    ORDER BY feature_date ASC
  `)

  let updated = 0, noData = 0

  for (const row of features.rows as any[]) {
    const dateStr = new Date(row.feature_date).toISOString().split('T')[0]

    // Get the price on feature_date
    const baseResult = await getDb().execute(sql`
      SELECT price FROM btc_prices
      WHERE DATE(fetched_at) = ${dateStr}::date
      ORDER BY fetched_at DESC LIMIT 1
    `)
    if (baseResult.rows.length === 0) { noData++; continue }
    const basePrice = parseFloat((baseResult.rows[0] as any).price)

    // Get forward prices at various horizons (calendar days)
    const horizons = [
      { days: 7, col7d: true },
      { days: 14, col14d: true },
    ]

    let change7d: number | null = null
    let change14d: number | null = null

    // 7d forward
    const p7d = await getDb().execute(sql`
      SELECT price FROM btc_prices
      WHERE DATE(fetched_at) = (${dateStr}::date + INTERVAL '7 days')::date
      ORDER BY fetched_at DESC LIMIT 1
    `)
    if (p7d.rows.length > 0) {
      const price7d = parseFloat((p7d.rows[0] as any).price)
      change7d = ((price7d - basePrice) / basePrice) * 100
    }

    // 14d forward
    const p14d = await getDb().execute(sql`
      SELECT price FROM btc_prices
      WHERE DATE(fetched_at) = (${dateStr}::date + INTERVAL '14 days')::date
      ORDER BY fetched_at DESC LIMIT 1
    `)
    if (p14d.rows.length > 0) {
      const price14d = parseFloat((p14d.rows[0] as any).price)
      change14d = ((price14d - basePrice) / basePrice) * 100
    }

    if (change7d == null && change14d == null) { noData++; continue }

    await getDb().execute(sql`
      UPDATE btc_daily_features
      SET target_7d_change = ${change7d},
          target_14d_change = ${change14d},
          target_7d_up = ${change7d != null ? change7d > 2 : null},
          target_14d_up = ${change14d != null ? change14d > 2 : null}
      WHERE id = ${parseInt(row.id)}
    `)
    updated++
  }

  console.log(`[BtcBacktester] Updated ${updated} feature rows, ${noData} missing data`)
  return { updated, noData }
}
