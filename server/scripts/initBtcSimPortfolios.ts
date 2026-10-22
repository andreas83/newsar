import { getDatabase } from '../database/db.js'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('[initBtcSimPortfolios] Creating 3 BTC simulator portfolios...')
  const db = getDatabase()

  // Check if portfolios already exist
  const existing = await db.execute(sql`SELECT COUNT(*)::int as cnt FROM btc_sim_portfolios`)
  if (parseInt((existing.rows[0] as any).cnt) > 0) {
    console.log('[initBtcSimPortfolios] Portfolios already exist. Skipping.')
    process.exit(0)
  }

  const portfolios = [
    { name: 'BTC ML Model', strategy: 'ml_model', seed: null },
    { name: 'BTC Random', strategy: 'random', seed: 42 },
    { name: 'BTC Buy & Hold', strategy: 'buy_and_hold', seed: null },
  ]

  for (const p of portfolios) {
    await db.execute(sql`
      INSERT INTO btc_sim_portfolios (name, strategy, initial_capital, current_capital, current_value, random_seed)
      VALUES (${p.name}, ${p.strategy}, 100000, 100000, 100000, ${p.seed})
    `)
    console.log(`  Created: ${p.name} (${p.strategy})`)
  }

  console.log('[initBtcSimPortfolios] Done.')
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
