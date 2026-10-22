import { buildFeatures } from '../services/btcFeatureBuilder.js'

async function main() {
  const backfill = process.argv.includes('--backfill')
  console.log(`[buildBtcFeatures] Building daily features (backfill=${backfill})...`)
  await buildFeatures({ backfill })
  console.log('[buildBtcFeatures] Done.')
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
