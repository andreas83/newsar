import { detectAnomalies } from '../services/btcNewsAnomalyDetector.js'

async function main() {
  const days = parseInt(process.argv[2]) || 7
  console.log(`[detectBtcAnomalies] Detecting anomalies over last ${days} days...`)
  const results = await detectAnomalies(days)
  const totalAnomalies = results.reduce((sum, r) => sum + r.anomaliesDetected, 0)
  console.log(`[detectBtcAnomalies] Done: ${results.length} days processed, ${totalAnomalies} anomalies detected`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
