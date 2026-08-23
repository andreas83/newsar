import { generatePredictions } from '../services/btcSignalGenerator.js'

async function main() {
  const days = parseInt(process.argv[2]) || 7
  console.log(`[generateBtcSignals] Generating BTC predictions (last ${days} days)...`)
  const result = await generatePredictions(days)
  console.log(`[generateBtcSignals] Done: generated=${result.generated}, errors=${result.errors}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
