import { config } from 'dotenv'
config()

import { detectAnomalies } from '../services/newsVolumeAnomalyDetector.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  const daysBack = parseInt(process.argv[2] || '1')

  console.log('=== News Volume Anomaly Detector ===')
  console.log(`Processing last ${daysBack} day(s)\n`)

  const results = await detectAnomalies(daysBack)

  console.log(`\nSummary:`)
  let totalAnomalies = 0
  let totalInserted = 0
  for (const r of results) {
    totalAnomalies += r.anomaliesFound
    totalInserted += r.inserted
    if (r.anomaliesFound > 0) {
      console.log(`  ${r.dateProcessed}: ${r.entitiesChecked} entities checked, ${r.anomaliesFound} anomalies, ${r.inserted} inserted, ${r.skipped} skipped`)
    }
  }

  console.log(`\nTotal: ${totalAnomalies} anomalies found, ${totalInserted} new records inserted`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
