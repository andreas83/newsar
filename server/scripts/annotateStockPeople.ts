import { config } from 'dotenv'
config()

import { annotateStockPeople } from '../services/stockPersonAnnotator.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  console.log('=== Stock Person Annotator ===')
  console.log('Annotating person-org relationships for stock-linked entities\n')

  const result = await annotateStockPeople()

  console.log(`\nResults:`)
  console.log(`  Annotated: ${result.annotated}`)
  console.log(`  Skipped:   ${result.skipped}`)
  console.log(`  Errors:    ${result.errors}`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
