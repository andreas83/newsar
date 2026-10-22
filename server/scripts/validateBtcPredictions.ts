import { validatePredictions } from '../services/btcSignalGenerator.js'

async function main() {
  console.log('[validateBtcPredictions] Validating past BTC predictions...')
  const result = await validatePredictions()
  console.log(`[validateBtcPredictions] Done: validated=${result.validated}, noData=${result.noData}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
