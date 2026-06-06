import { config } from 'dotenv'
config()

import { autoMapEntities } from '../services/stockEntityMapper.js'
import { closeDatabase } from '../database/db.js'

async function main() {
  const limit = parseInt(process.argv[2] || '50')

  console.log('=== Stock Entity Auto-Mapper ===')
  console.log(`Limit: ${limit}\n`)

  const result = await autoMapEntities(limit)

  console.log(`\nResults:`)
  console.log(`  Mapped: ${result.mapped}`)
  console.log(`  Total unmapped checked: ${result.total}`)

  await closeDatabase()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
