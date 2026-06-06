/**
 * Seed geocache with countries and capital cities from mledoze/countries dataset.
 * Also seeds major world cities from a curated list.
 *
 * Usage: npx tsx server/scripts/seedGeocache.ts
 */

import { getDatabase } from '../database/db.js'
import { sql } from 'drizzle-orm'

const COUNTRIES_URL = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json'

// Major world cities not covered by capitals (population > 1M or news-relevant)
const MAJOR_CITIES: Array<{ name: string; lat: number; lon: number }> = [
  // Americas
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'New York City', lat: 40.7128, lon: -74.006 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Houston', lat: 29.7604, lon: -95.3698 },
  { name: 'Miami', lat: 25.7617, lon: -80.1918 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'Toronto', lat: 43.6532, lon: -79.3832 },
  { name: 'Vancouver', lat: 49.2827, lon: -123.1207 },
  { name: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { name: 'Buenos Aires', lat: -34.6037, lon: -58.3816 },
  { name: 'Caracas', lat: 10.4806, lon: -66.9036 },
  { name: 'Minneapolis', lat: 44.9778, lon: -93.265 },
  { name: 'Seattle', lat: 47.6062, lon: -122.3321 },
  { name: 'Boston', lat: 42.3601, lon: -71.0589 },
  { name: 'Philadelphia', lat: 39.9526, lon: -75.1652 },
  { name: 'Atlanta', lat: 33.749, lon: -84.388 },
  { name: 'Dallas', lat: 32.7767, lon: -96.797 },
  { name: 'Denver', lat: 39.7392, lon: -104.9903 },
  // Europe
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'Berlin', lat: 52.52, lon: 13.405 },
  { name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
  { name: 'Rome', lat: 41.9028, lon: 12.4964 },
  { name: 'Milan', lat: 45.4642, lon: 9.19 },
  { name: 'Munich', lat: 48.1351, lon: 11.582 },
  { name: 'München', lat: 48.1351, lon: 11.582 },
  { name: 'Hamburg', lat: 53.5511, lon: 9.9937 },
  { name: 'Frankfurt', lat: 50.1109, lon: 8.6821 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { name: 'Brussels', lat: 50.8503, lon: 4.3517 },
  { name: 'Vienna', lat: 48.2082, lon: 16.3738 },
  { name: 'Zurich', lat: 47.3769, lon: 8.5417 },
  { name: 'Geneva', lat: 46.2044, lon: 6.1432 },
  { name: 'Stockholm', lat: 59.3293, lon: 18.0686 },
  { name: 'Oslo', lat: 59.9139, lon: 10.7522 },
  { name: 'Copenhagen', lat: 55.6761, lon: 12.5683 },
  { name: 'Helsinki', lat: 60.1699, lon: 24.9384 },
  { name: 'Dublin', lat: 53.3498, lon: -6.2603 },
  { name: 'Lisbon', lat: 38.7223, lon: -9.1393 },
  { name: 'Prague', lat: 50.0755, lon: 14.4378 },
  { name: 'Warsaw', lat: 52.2297, lon: 21.0122 },
  { name: 'Budapest', lat: 47.4979, lon: 19.0402 },
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784 },
  { name: 'Moscow', lat: 55.7558, lon: 37.6173 },
  { name: 'St. Petersburg', lat: 59.9343, lon: 30.3351 },
  { name: 'Kyiv', lat: 50.4501, lon: 30.5234 },
  { name: 'Lyon', lat: 45.764, lon: 4.8357 },
  { name: 'Marseille', lat: 43.2965, lon: 5.3698 },
  { name: 'Valencia', lat: 39.4699, lon: -0.3763 },
  { name: 'Davos', lat: 46.8003, lon: 9.8361 },
  // Middle East & Africa
  { name: 'Dubai', lat: 25.2048, lon: 55.2708 },
  { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773 },
  { name: 'Tel Aviv', lat: 32.0853, lon: 34.7818 },
  { name: 'Jerusalem', lat: 31.7683, lon: 35.2137 },
  { name: 'Beirut', lat: 33.8938, lon: 35.5018 },
  { name: 'Tehran', lat: 35.6892, lon: 51.389 },
  { name: 'Téhéran', lat: 35.6892, lon: 51.389 },
  { name: 'Teheran', lat: 35.6892, lon: 51.389 },
  { name: 'Baghdad', lat: 33.3152, lon: 44.3661 },
  { name: 'Riyadh', lat: 24.7136, lon: 46.6753 },
  { name: 'Cairo', lat: 30.0444, lon: 31.2357 },
  { name: 'Lagos', lat: 6.5244, lon: 3.3792 },
  { name: 'Johannesburg', lat: -26.2041, lon: 28.0473 },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
  { name: 'Nairobi', lat: -1.2921, lon: 36.8219 },
  { name: 'Addis Ababa', lat: 9.0192, lon: 38.7525 },
  // Asia-Pacific
  { name: 'Beijing', lat: 39.9042, lon: 116.4074 },
  { name: 'Shanghai', lat: 31.2304, lon: 121.4737 },
  { name: 'Hong Kong', lat: 22.3193, lon: 114.1694 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Seoul', lat: 37.5665, lon: 126.978 },
  { name: 'Taipei', lat: 25.033, lon: 121.5654 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Mumbai', lat: 19.076, lon: 72.8777 },
  { name: 'New Delhi', lat: 28.6139, lon: 77.209 },
  { name: 'Islamabad', lat: 33.6844, lon: 73.0479 },
  { name: 'Karachi', lat: 24.8607, lon: 67.0011 },
  { name: 'Kabul', lat: 34.5553, lon: 69.2075 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', lat: -37.8136, lon: 144.9631 },
  { name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
  { name: 'Jakarta', lat: -6.2088, lon: 106.8456 },
  { name: 'Hanoi', lat: 21.0278, lon: 105.8342 },
  { name: 'Manila', lat: 14.5995, lon: 120.9842 },
  { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869 },
  // Regions & landmarks (common in news)
  { name: 'Gaza Strip', lat: 31.3547, lon: 34.3088 },
  { name: 'Gaza', lat: 31.5, lon: 34.47 },
  { name: 'West Bank', lat: 31.9466, lon: 35.3027 },
  { name: 'Crimea', lat: 45.3453, lon: 34.0549 },
  { name: 'Kashmir', lat: 34.0837, lon: 74.7973 },
  { name: 'Strait of Hormuz', lat: 26.5667, lon: 56.25 },
  { name: 'Straße von Hormus', lat: 26.5667, lon: 56.25 },
  { name: 'Persian Gulf', lat: 26.0, lon: 52.0 },
  { name: 'Middle East', lat: 29.0, lon: 41.0 },
  { name: 'Europe', lat: 54.526, lon: 15.2551 },
  { name: 'Asia', lat: 34.0479, lon: 100.6197 },
  { name: 'Africa', lat: -8.7832, lon: 34.5085 },
  { name: 'Kremlin', lat: 55.7520, lon: 37.6175 },
  { name: 'White House', lat: 38.8977, lon: -77.0365 },
  { name: 'Pentagon', lat: 38.8719, lon: -77.0563 },
  { name: 'Wall Street', lat: 40.7068, lon: -74.0089 },
  { name: 'Silicon Valley', lat: 37.3875, lon: -122.0575 },
  { name: 'Capitol Hill', lat: 38.8899, lon: -77.0091 },
  // US States (common in news)
  { name: 'California', lat: 36.7783, lon: -119.4179 },
  { name: 'Texas', lat: 31.9686, lon: -99.9018 },
  { name: 'Florida', lat: 27.6648, lon: -81.5158 },
  { name: 'Minnesota', lat: 46.7296, lon: -94.6859 },
  // German regions
  { name: 'Deutschland', lat: 51.1657, lon: 10.4515 },
  { name: 'Rheinland-Pfalz', lat: 49.9129, lon: 7.449 },
  // French / Spanish / other language variants
  { name: 'España', lat: 40.4637, lon: -3.7492 },
  { name: 'Estados Unidos', lat: 37.0902, lon: -95.7129 },
  { name: 'Hongrie', lat: 47.1625, lon: 19.5033 },
  { name: 'Liban', lat: 33.8547, lon: 35.8623 },
  { name: 'Irán', lat: 32.4279, lon: 53.688 },
  { name: 'Russie', lat: 61.524, lon: 105.3188 },
  { name: 'Allemagne', lat: 51.1657, lon: 10.4515 },
  { name: 'Royaume-Uni', lat: 55.3781, lon: -3.436 },
  { name: 'Chine', lat: 35.8617, lon: 104.1954 },
  { name: 'Japon', lat: 36.2048, lon: 138.2529 },
  { name: 'Corée du Sud', lat: 35.9078, lon: 127.7669 },
  { name: 'Corée du Nord', lat: 40.3399, lon: 127.5101 },
]

interface CountryData {
  name: { common: string; official: string }
  capital?: string[]
  latlng?: [number, number]
  capitalInfo?: { latlng?: [number, number] }
  altSpellings?: string[]
  translations?: Record<string, { common: string; official: string }>
}

async function main() {
  const db = getDatabase()

  console.log('[SeedGeocache] Fetching countries dataset...')
  const res = await fetch(COUNTRIES_URL)
  if (!res.ok) throw new Error(`Failed to fetch countries: ${res.status}`)
  const countries: CountryData[] = await res.json()
  console.log(`[SeedGeocache] Got ${countries.length} countries`)

  const entries: Array<{ name: string; lat: number; lon: number }> = []

  // Add countries
  for (const c of countries) {
    if (c.latlng && c.latlng.length === 2) {
      entries.push({ name: c.name.common, lat: c.latlng[0], lon: c.latlng[1] })
    }
    // Add capital with its own coordinates
    if (c.capital?.[0] && c.capitalInfo?.latlng?.length === 2) {
      entries.push({ name: c.capital[0], lat: c.capitalInfo.latlng[0], lon: c.capitalInfo.latlng[1] })
    }
    // Add common translations (French, Spanish, German)
    if (c.latlng && c.latlng.length === 2) {
      for (const lang of ['fra', 'spa', 'deu', 'por', 'ita']) {
        const t = c.translations?.[lang]
        if (t?.common && t.common !== c.name.common) {
          entries.push({ name: t.common, lat: c.latlng[0], lon: c.latlng[1] })
        }
      }
    }
  }

  // Add major cities
  entries.push(...MAJOR_CITIES)

  // Deduplicate by name (first entry wins)
  const seen = new Set<string>()
  const unique = entries.filter(e => {
    if (seen.has(e.name)) return false
    seen.add(e.name)
    return true
  })

  console.log(`[SeedGeocache] Seeding ${unique.length} locations...`)

  let inserted = 0
  let skipped = 0

  // Batch insert using ON CONFLICT
  for (const entry of unique) {
    try {
      const result: any = await db.execute(sql`
        INSERT INTO geocache (name, lat, lon, found)
        VALUES (${entry.name}, ${entry.lat}, ${entry.lon}, true)
        ON CONFLICT (name) DO NOTHING
      `)
      const rowCount = result?.rowCount ?? result?.changes ?? 0
      if (rowCount > 0) inserted++
      else skipped++
    } catch (e) {
      // Skip on any error
      skipped++
    }
  }

  console.log(`[SeedGeocache] Done: ${inserted} inserted, ${skipped} already cached`)

  // Show final stats
  const stats: any = await db.execute(sql`SELECT count(*) as total FROM geocache WHERE found = true`)
  const total = (stats.rows ?? stats)[0]?.total
  console.log(`[SeedGeocache] Total geocache entries: ${total}`)

  process.exit(0)
}

main().catch(e => {
  console.error('[SeedGeocache] Fatal error:', e)
  process.exit(1)
})
