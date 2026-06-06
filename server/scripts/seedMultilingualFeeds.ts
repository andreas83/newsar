/**
 * Seed multilingual news sources (German, Spanish, French)
 *
 * Run with: npm run seed:multilingual
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db.js'
import { feeds } from '../database/schema.js'

config()

const multilingualFeeds = [
  // German Sources
  {
    name: 'Tagesschau (ARD)',
    url: 'https://www.tagesschau.de/xml/rss2/',
    category: 'world',
    region: 'europe',
    language: 'de',
    knownBias: 0.0,
    isActive: 1,
  },
  {
    name: 'Der Spiegel',
    url: 'https://www.spiegel.de/schlagzeilen/tops/index.rss',
    category: 'world',
    region: 'europe',
    language: 'de',
    knownBias: -0.3,
    isActive: 1,
  },
  {
    name: 'FAZ',
    url: 'https://www.faz.net/rss/aktuell/',
    category: 'world',
    region: 'europe',
    language: 'de',
    knownBias: 0.3,
    isActive: 1,
  },
  {
    name: 'Sueddeutsche Zeitung',
    url: 'https://rss.sueddeutsche.de/rss/Topthemen',
    category: 'world',
    region: 'europe',
    language: 'de',
    knownBias: -0.3,
    isActive: 1,
  },
  {
    name: 'Die Welt',
    url: 'https://www.welt.de/feeds/latest.rss',
    category: 'world',
    region: 'europe',
    language: 'de',
    knownBias: 0.3,
    isActive: 1,
  },
  {
    name: 'Deutsche Welle (DE)',
    url: 'https://rss.dw.com/rdf/rss-de-all',
    category: 'world',
    region: 'europe',
    language: 'de',
    knownBias: 0.0,
    isActive: 1,
  },

  // Spanish Sources
  {
    name: 'El Pais',
    url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada',
    category: 'world',
    region: 'europe',
    language: 'es',
    knownBias: -0.3,
    isActive: 1,
  },
  {
    name: 'El Mundo',
    url: 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml',
    category: 'world',
    region: 'europe',
    language: 'es',
    knownBias: 0.3,
    isActive: 1,
  },
  {
    name: 'BBC Mundo',
    url: 'https://feeds.bbci.co.uk/mundo/rss.xml',
    category: 'world',
    region: 'global',
    language: 'es',
    knownBias: 0.0,
    isActive: 1,
  },
  {
    name: 'El Confidencial',
    url: 'https://rss.elconfidencial.com/',
    category: 'world',
    region: 'europe',
    language: 'es',
    knownBias: 0.1,
    isActive: 1,
  },
  {
    name: 'La Vanguardia',
    url: 'https://www.lavanguardia.com/rss/home.xml',
    category: 'world',
    region: 'europe',
    language: 'es',
    knownBias: 0.1,
    isActive: 1,
  },
  {
    name: '20 Minutos',
    url: 'https://www.20minutos.es/rss/',
    category: 'world',
    region: 'europe',
    language: 'es',
    knownBias: 0.0,
    isActive: 1,
  },

  // French Sources
  {
    name: 'Le Monde',
    url: 'https://www.lemonde.fr/rss/une.xml',
    category: 'world',
    region: 'europe',
    language: 'fr',
    knownBias: -0.2,
    isActive: 1,
  },
  {
    name: 'Le Figaro',
    url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml',
    category: 'world',
    region: 'europe',
    language: 'fr',
    knownBias: 0.3,
    isActive: 1,
  },
  {
    name: 'France Info',
    url: 'https://www.francetvinfo.fr/titres.rss',
    category: 'world',
    region: 'europe',
    language: 'fr',
    knownBias: 0.0,
    isActive: 1,
  },
  {
    name: 'Liberation',
    url: 'https://www.liberation.fr/arc/outboundfeeds/rss/',
    category: 'world',
    region: 'europe',
    language: 'fr',
    knownBias: -0.5,
    isActive: 1,
  },
  {
    name: 'RFI',
    url: 'https://www.rfi.fr/fr/rss',
    category: 'world',
    region: 'global',
    language: 'fr',
    knownBias: 0.0,
    isActive: 1,
  },
  {
    name: 'BFM TV Economie',
    url: 'https://www.bfmtv.com/rss/economie/',
    category: 'business',
    region: 'europe',
    language: 'fr',
    knownBias: 0.2,
    isActive: 1,
  },
]

async function seedMultilingualFeeds() {
  const db = getDatabase()

  console.log(`\nSeeding ${multilingualFeeds.length} multilingual news sources...\n`)

  try {
    let inserted = 0
    let skipped = 0

    for (const feed of multilingualFeeds) {
      try {
        await db.insert(feeds).values(feed)
        console.log(`  Added: ${feed.name} [${feed.language}]`)
        inserted++
      } catch (error: any) {
        if (error.code === '23505') {
          console.log(`  Skipped (exists): ${feed.name}`)
          skipped++
        } else {
          console.error(`  Error adding ${feed.name}:`, error.message)
        }
      }
    }

    console.log(`\nSummary:`)
    console.log(`   Inserted: ${inserted}`)
    console.log(`   Skipped:  ${skipped}`)
    console.log(`   Total:    ${multilingualFeeds.length}`)

    console.log(`\nSeeding complete!\n`)
    process.exit(0)
  } catch (error) {
    console.error('\nSeeding failed:', error)
    process.exit(1)
  }
}

seedMultilingualFeeds()
