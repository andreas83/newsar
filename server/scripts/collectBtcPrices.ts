import { collectPrice } from '../services/btcPriceCollector.js'

async function main() {
  console.log('[collectBtcPrices] Collecting current BTC price...')
  const result = await collectPrice()
  console.log(`[collectBtcPrices] Done: price=$${result.price}, inserted=${result.inserted}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
