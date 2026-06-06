import { getDatabase } from '../../database/db.js'
import { sql } from 'drizzle-orm'

// Rate limit: max 1 request per second to Nominatim
let lastNominatimCall = 0

async function fetchFromNominatim(name: string): Promise<{ lat: number; lon: number } | null> {
  const now = Date.now()
  const wait = Math.max(0, 1100 - (now - lastNominatimCall))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastNominatimCall = Date.now()

  try {
    const res = await $fetch<any[]>('https://nominatim.openstreetmap.org/search', {
      query: { q: name, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'Newsar/1.0 (news aggregator)' },
    })
    if (res && res.length > 0) {
      return { lat: parseFloat(res[0].lat), lon: parseFloat(res[0].lon) }
    }
  } catch (e) {
    console.warn(`[Geocode] Nominatim error for "${name}":`, (e as Error).message)
  }
  return null
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const names: string[] = body?.names
  if (!Array.isArray(names) || names.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'names[] required' })
  }

  // Limit batch size
  const batch = names.slice(0, 60)
  const db = getDatabase()

  // Check cache for all names
  const inClause = sql.join(batch.map(n => sql`${n}`), sql`, `)
  const cacheRes: any = await db.execute(sql`
    SELECT name, lat, lon, found FROM geocache WHERE name IN (${inClause})
  `)
  const cached = new Map<string, { lat: number; lon: number } | null>()
  for (const row of (cacheRes.rows ?? cacheRes) as any[]) {
    if (row.found && row.lat !== null) {
      cached.set(row.name, { lat: row.lat, lon: row.lon })
    } else {
      cached.set(row.name, null) // negative cache
    }
  }

  // Find uncached names
  const uncached = batch.filter(n => !cached.has(n))

  // Fetch from Nominatim and cache results
  for (const name of uncached) {
    const coords = await fetchFromNominatim(name)
    if (coords) {
      cached.set(name, coords)
      await db.execute(sql`
        INSERT INTO geocache (name, lat, lon, found)
        VALUES (${name}, ${coords.lat}, ${coords.lon}, true)
        ON CONFLICT (name) DO UPDATE SET lat = ${coords.lat}, lon = ${coords.lon}, found = true
      `)
    } else {
      cached.set(name, null)
      await db.execute(sql`
        INSERT INTO geocache (name, lat, lon, found)
        VALUES (${name}, NULL, NULL, false)
        ON CONFLICT (name) DO UPDATE SET found = false
      `)
    }
  }

  // Return results
  const results: Record<string, { lat: number; lon: number } | null> = {}
  for (const name of batch) {
    results[name] = cached.get(name) ?? null
  }

  return { results, fromCache: batch.length - uncached.length, fetched: uncached.length }
})
