/**
 * Seed initial RSS feeds
 *
 * Run with: npx tsx server/scripts/seedFeeds.ts
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { feeds } from '../database/schema'

// Load environment variables
config()

const initialFeeds = [
  // Center - Neutral Sources
  {
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    name: 'BBC News - World',
    category: 'World News',
    knownBias: 0.0, // Center
    region: 'UK',
    isActive: 1,
  },
  {
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    name: 'Al Jazeera',
    category: 'World News',
    knownBias: 0.0, // Center (non-Western perspective)
    region: 'Qatar',
    isActive: 1,
  },
  {
    url: 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best',
    name: 'Reuters - World News',
    category: 'World News',
    knownBias: 0.0, // Center
    region: 'Global',
    isActive: 1,
  },

  // Left-Leaning Sources
  {
    url: 'https://www.theguardian.com/world/rss',
    name: 'The Guardian - World News',
    category: 'World News',
    knownBias: -0.4, // Center-left
    region: 'UK',
    isActive: 1,
  },
  {
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    name: 'New York Times - World',
    category: 'World News',
    knownBias: -0.3, // Center-left
    region: 'US',
    isActive: 1,
  },

  // Right-Leaning Sources
  {
    url: 'https://moxie.foxnews.com/google-publisher/world.xml',
    name: 'Fox News - World',
    category: 'World News',
    knownBias: 0.5, // Right
    region: 'US',
    isActive: 1,
  },
]

async function seedFeeds() {
  const db = getDatabase()

  console.log('🌱 Seeding initial RSS feeds...\n')

  try {
    for (const feed of initialFeeds) {
      try {
        const [inserted] = await db
          .insert(feeds)
          .values(feed)
          .returning()

        console.log(`✅ Added: ${inserted.name}`)
        console.log(`   URL: ${inserted.url}`)
        console.log(`   Bias: ${inserted.knownBias}`)
        console.log(`   Region: ${inserted.region}\n`)
      } catch (error: any) {
        if (error.code === '23505') {
          // Duplicate URL
          console.log(`⏭️  Skipped (already exists): ${feed.name}\n`)
        } else {
          throw error
        }
      }
    }

    console.log('✨ Feed seeding complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('❌ Error seeding feeds:', error)
    process.exit(1)
  }
}

seedFeeds()
