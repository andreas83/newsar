import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

let db: ReturnType<typeof drizzle> | null = null
let pool: Pool | null = null

export function getDatabase() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/newsar'

    pool = new Pool({
      connectionString,
      max: 10, // Maximum number of connections in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    db = drizzle(pool, { schema })

    // Log connection errors
    pool.on('error', (err) => {
      console.error('Unexpected database error:', err)
    })
  }

  return db
}

export async function closeDatabase() {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

// Export schema for convenience
export { schema }
