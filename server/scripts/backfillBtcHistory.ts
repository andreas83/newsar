import { backfillHistory } from '../services/btcPriceCollector.js'

async function main() {
  const days = parseInt(process.argv[2]) || 365
  console.log(`[backfillBtcHistory] Backfilling ${days} days of BTC history...`)
  const result = await backfillHistory(days)
  console.log(`[backfillBtcHistory] Done: inserted=${result.inserted}, skipped=${result.skipped}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
