/**
 * Simple test to fetch a single RSS feed URL
 */

import Parser from 'rss-parser'

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['content:encoded', 'contentEncoded'],
      ['description', 'description'],
    ],
  },
  timeout: 10000, // 10 second timeout
})

async function testFeed() {
  const url = process.argv[2] || 'https://www.euronews.com/rss'

  console.log(`\n📡 Testing RSS feed: ${url}\n`)

  try {
    const feed = await parser.parseURL(url)

    console.log(`✅ Success!`)
    console.log(`   Feed Title: ${feed.title}`)
    console.log(`   Feed Description: ${feed.description}`)
    console.log(`   Items found: ${feed.items.length}`)
    console.log(`\n   First 3 items:`)

    feed.items.slice(0, 3).forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.title}`)
      console.log(`      URL: ${item.link}`)
    })

    process.exit(0)
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`)
    console.error(error)
    process.exit(1)
  }
}

testFeed()
