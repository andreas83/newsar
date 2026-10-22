import { backtestFeatures } from '../services/btcBacktester.js'

async function main() {
  console.log('[backtestBtcEvents] Computing forward BTC price changes...')
  const result = await backtestFeatures()
  console.log(`[backtestBtcEvents] Done: updated=${result.updated}, noData=${result.noData}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
