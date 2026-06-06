/**
 * Initialize Paper Trading Portfolios
 *
 * Creates 3 comparison portfolios:
 *  1. ML Model — trades based on ML predictions
 *  2. Heuristic — trades based on existing composite scoring
 *  3. SPY Benchmark — buy-and-hold SPY for comparison
 *
 * Usage: tsx server/scripts/initPaperPortfolios.ts
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'

async function main() {
  const db = getDatabase()

  const INITIAL_CAPITAL = 100000

  const portfolios = [
    { name: 'ML Model Portfolio', strategy: 'ml_model' },
    { name: 'Heuristic Portfolio', strategy: 'heuristic' },
    { name: 'SPY Benchmark', strategy: 'buy_and_hold' },
  ]

  for (const p of portfolios) {
    // Check if already exists
    const existing = await db.execute(sql`
      SELECT id FROM paper_portfolios WHERE strategy = ${p.strategy} LIMIT 1
    `)

    if (existing.rows.length > 0) {
      console.log(`Portfolio "${p.name}" (${p.strategy}) already exists (ID: ${(existing.rows[0] as any).id})`)
      continue
    }

    await db.execute(sql`
      INSERT INTO paper_portfolios (name, strategy, initial_capital, current_capital, current_value)
      VALUES (${p.name}, ${p.strategy}, ${INITIAL_CAPITAL}, ${INITIAL_CAPITAL}, ${INITIAL_CAPITAL})
    `)

    console.log(`Created portfolio: "${p.name}" (${p.strategy}) with $${INITIAL_CAPITAL.toLocaleString()}`)
  }

  // For SPY benchmark, open a buy-and-hold position immediately
  const benchResult = await db.execute(sql`
    SELECT pp.id as portfolio_id, pp.current_capital
    FROM paper_portfolios pp
    WHERE pp.strategy = 'buy_and_hold' AND pp.is_active = true
    LIMIT 1
  `)

  if (benchResult.rows.length > 0) {
    const benchPortfolio = benchResult.rows[0] as any
    const portfolioId = parseInt(benchPortfolio.portfolio_id)
    const capital = parseFloat(benchPortfolio.current_capital)

    // Check if SPY position already open
    const existingTrade = await db.execute(sql`
      SELECT id FROM paper_trades
      WHERE portfolio_id = ${portfolioId} AND status = 'open'
      LIMIT 1
    `)

    if (existingTrade.rows.length === 0) {
      // Get SPY price
      const spyResult = await db.execute(sql`
        SELECT sw.id as watchlist_id, sp.price
        FROM stock_watchlist sw
        JOIN stock_prices sp ON sp.watchlist_id = sw.id
        WHERE sw.ticker = 'SPY'
        ORDER BY sp.fetched_at DESC
        LIMIT 1
      `)

      if (spyResult.rows.length > 0) {
        const spy = spyResult.rows[0] as any
        const spyPrice = parseFloat(spy.price)
        const shares = Math.floor(capital / spyPrice)
        const positionSize = shares * spyPrice

        await db.execute(sql`
          INSERT INTO paper_trades (
            portfolio_id, watchlist_id, direction, entry_price, entry_date,
            shares, position_size, status, metadata
          ) VALUES (
            ${portfolioId}, ${parseInt(spy.watchlist_id)}, 'long',
            ${spyPrice}, NOW(), ${shares}, ${positionSize}, 'open',
            '{"note": "Buy and hold benchmark"}'::jsonb
          )
        `)

        await db.execute(sql`
          UPDATE paper_portfolios
          SET current_capital = current_capital - ${positionSize}, updated_at = NOW()
          WHERE id = ${portfolioId}
        `)

        console.log(`SPY benchmark: Bought ${shares} shares @ $${spyPrice.toFixed(2)} ($${positionSize.toFixed(0)})`)
      } else {
        console.log('WARNING: No SPY price data found. Run stocks:collect first.')
      }
    } else {
      console.log('SPY benchmark already has an open position.')
    }
  }

  console.log('\nDone. Paper portfolios initialized.')
  process.exit(0)
}

main().catch(console.error)
