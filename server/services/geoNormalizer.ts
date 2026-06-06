/**
 * Geo Normalizer Service
 * Normalizes raw geoPov values from classifications into standardized country/region pairs
 * using the geo_normalization lookup table with lazy-loaded in-memory cache.
 */

import { getDatabase } from '../database/db'
import { geoNormalization } from '../database/schema'

interface GeoMapping {
  country: string
  region: string | null
}

let geoCache: Map<string, GeoMapping> | null = null

/**
 * Load geo normalization mappings into memory (lazy, once)
 */
async function ensureCache(): Promise<Map<string, GeoMapping>> {
  if (geoCache) return geoCache

  const db = getDatabase()
  const rows = await db.select().from(geoNormalization)

  geoCache = new Map()
  for (const row of rows) {
    geoCache.set(row.rawValue.toLowerCase(), {
      country: row.normalizedCountry,
      region: row.normalizedRegion,
    })
  }

  console.log(`[GeoNormalizer] Loaded ${geoCache.size} geo mappings`)
  return geoCache
}

/**
 * Normalize a raw geoPov string to a standardized country/region pair.
 * Falls back to { country: raw, region: null } if no mapping found.
 */
export async function normalizeGeoPov(raw: string | null): Promise<GeoMapping | null> {
  if (!raw || raw.trim() === '') return null

  const cache = await ensureCache()
  const key = raw.trim().toLowerCase()
  const mapping = cache.get(key)

  if (mapping) return mapping

  // Fallback: use raw value as country with no region
  return { country: raw.trim(), region: null }
}

/**
 * Check if two geoPov values resolve to the same country
 */
export async function sameCountry(a: string | null, b: string | null): Promise<boolean> {
  const normA = await normalizeGeoPov(a)
  const normB = await normalizeGeoPov(b)
  if (!normA || !normB) return false
  return normA.country.toLowerCase() === normB.country.toLowerCase()
}

/**
 * Check if two geoPov values resolve to the same region
 */
export async function sameRegion(a: string | null, b: string | null): Promise<boolean> {
  const normA = await normalizeGeoPov(a)
  const normB = await normalizeGeoPov(b)
  if (!normA?.region || !normB?.region) return false
  return normA.region.toLowerCase() === normB.region.toLowerCase()
}

/**
 * Invalidate the in-memory cache (for testing or after DB updates)
 */
export function invalidateGeoCache(): void {
  geoCache = null
}
