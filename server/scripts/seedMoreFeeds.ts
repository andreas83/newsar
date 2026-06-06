/**
 * Seed additional diverse news sources
 *
 * Run with: npm run seed:more-feeds
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db.js'
import { feeds } from '../database/schema.js'

config()

const newFeeds = [
  // European Sources
  {
    name: 'Deutsche Welle (DW)',
    url: 'https://rss.dw.com/rdf/rss-en-all',
    category: 'world',
    region: 'europe',
    knownBias: -0.1, // Slightly center-left
    isActive: 1,
  },
  {
    name: 'France 24',
    url: 'https://www.france24.com/en/rss',
    category: 'world',
    region: 'europe',
    knownBias: 0.0, // Center
    isActive: 1,
  },
  {
    name: 'Euronews',
    url: 'https://www.euronews.com/rss',
    category: 'world',
    region: 'europe',
    knownBias: 0.0, // Center
    isActive: 1,
  },

  // Asian Sources
  {
    name: 'South China Morning Post',
    url: 'https://www.scmp.com/rss/91/feed',
    category: 'world',
    region: 'asia',
    knownBias: 0.1, // Slightly center-right (pro-Beijing)
    isActive: 1,
  },
  {
    name: 'The Japan Times',
    url: 'https://www.japantimes.co.jp/feed/',
    category: 'world',
    region: 'asia',
    knownBias: 0.0, // Center
    isActive: 1,
  },
  {
    name: 'Times of India',
    url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    category: 'world',
    region: 'asia',
    knownBias: 0.2, // Center-right (nationalist)
    isActive: 1,
  },

  // Middle East
  {
    name: 'Middle East Eye',
    url: 'https://www.middleeasteye.net/rss',
    category: 'world',
    region: 'middle-east',
    knownBias: -0.2, // Center-left
    isActive: 1,
  },
  {
    name: 'Haaretz',
    url: 'https://www.haaretz.com/cmlink/1.628034',
    category: 'world',
    region: 'middle-east',
    knownBias: -0.3, // Center-left (Israeli liberal)
    isActive: 1,
  },

  // US - Additional perspectives
  {
    name: 'Associated Press (AP)',
    url: 'https://feeds.apnews.com/rss/apf-topnews',
    category: 'world',
    region: 'north-america',
    knownBias: 0.0, // Center (wire service)
    isActive: 1,
  },
  {
    name: 'NPR News',
    url: 'https://feeds.npr.org/1001/rss.xml',
    category: 'world',
    region: 'north-america',
    knownBias: -0.2, // Center-left
    isActive: 1,
  },
  {
    name: 'The Hill',
    url: 'https://thehill.com/feed/',
    category: 'politics',
    region: 'north-america',
    knownBias: 0.1, // Slightly center-right
    isActive: 1,
  },
  {
    name: 'Politico',
    url: 'https://www.politico.com/rss/politics08.xml',
    category: 'politics',
    region: 'north-america',
    knownBias: 0.0, // Center
    isActive: 1,
  },

  // Latin America
  {
    name: 'Buenos Aires Herald',
    url: 'https://buenosairesherald.com/rss',
    category: 'world',
    region: 'latin-america',
    knownBias: -0.1, // Slightly center-left
    isActive: 1,
  },

  // Technology & Business
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    category: 'technology',
    region: 'global',
    knownBias: 0.0, // Center
    isActive: 1,
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'technology',
    region: 'global',
    knownBias: -0.1, // Slightly center-left
    isActive: 1,
  },
  {
    name: 'Financial Times',
    url: 'https://www.ft.com/?format=rss',
    category: 'business',
    region: 'global',
    knownBias: 0.2, // Center-right (pro-business)
    isActive: 1,
  },
  {
    name: 'The Economist',
    url: 'https://www.economist.com/the-world-this-week/rss.xml',
    category: 'world',
    region: 'global',
    knownBias: 0.1, // Center-right (classical liberal)
    isActive: 1,
  },

  // Investigative/Alternative
  {
    name: 'ProPublica',
    url: 'https://www.propublica.org/feeds/propublica/main',
    category: 'general',
    region: 'north-america',
    knownBias: -0.3, // Center-left (investigative)
    isActive: 1,
  },
  {
    name: 'The Intercept',
    url: 'https://theintercept.com/feed/',
    category: 'general',
    region: 'global',
    knownBias: -0.5, // Left (progressive)
    isActive: 1,
  },

  // Science
  {
    name: 'Science Daily',
    url: 'https://www.sciencedaily.com/rss/all.xml',
    category: 'science',
    region: 'global',
    knownBias: 0.0, // Center
    isActive: 1,
  },
  {
    name: 'Nature News',
    url: 'https://www.nature.com/nature.rss',
    category: 'science',
    region: 'global',
    knownBias: 0.0, // Center
    isActive: 1,
  },

  // Africa
  {
    name: 'AllAfrica',
    url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf',
    category: 'world',
    region: 'africa',
    knownBias: 0.0, // Center
    isActive: 1,
  },
]

async function seedMoreFeeds() {
  const db = getDatabase()

  console.log(`\n🌍 Seeding ${newFeeds.length} additional news sources...\n`)

  try {
    let inserted = 0
    let skipped = 0

    for (const feed of newFeeds) {
      try {
        await db.insert(feeds).values(feed)
        console.log(`✅ Added: ${feed.name}`)
        inserted++
      } catch (error: any) {
        if (error.code === '23505') {
          // Unique constraint violation (already exists)
          console.log(`⏭️  Skipped (exists): ${feed.name}`)
          skipped++
        } else {
          console.error(`❌ Error adding ${feed.name}:`, error.message)
        }
      }
    }

    console.log(`\n📊 Summary:`)
    console.log(`   Inserted: ${inserted}`)
    console.log(`   Skipped:  ${skipped}`)
    console.log(`   Total:    ${newFeeds.length}`)

    console.log(`\n✨ Seeding complete!\n`)
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Seeding failed:', error)
    process.exit(1)
  }
}

seedMoreFeeds()
