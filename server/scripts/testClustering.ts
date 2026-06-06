/**
 * Test entity-based article clustering
 *
 * Run with: npm run test:cluster [threshold] [minClusterSize] [maxClusterSize]
 *
 * Example:
 *   npm run test:cluster 0.35 2 80    # 35% threshold, min 2, max 80
 *   npm run test:cluster              # Use defaults (0.35, 2, 80)
 */

import { config } from 'dotenv'
import { getDatabase } from '../database/db'
import { articles, stories, storyMembers, storyCoverage, storyEntities, storyMetrics } from '../database/schema'
import { clusterWithEntities } from '../services/entityClustering'
import { eq, isNotNull, sql } from 'drizzle-orm'

// Load environment variables
config()

async function testClustering() {
  const db = getDatabase()

  // Parse command line arguments
  const threshold = parseFloat(process.argv[2]) || 0.35
  const minClusterSize = parseInt(process.argv[3]) || 2
  const maxClusterSize = parseInt(process.argv[4]) || 80

  console.log(`\n🔮 Testing Entity-Based Article Clustering`)
  console.log(`   Affinity Threshold: ${threshold}`)
  console.log(`   Min Cluster Size: ${minClusterSize} articles`)
  console.log(`   Max Cluster Size: ${maxClusterSize} articles`)

  try {
    // Clear existing stories and all dependent tables (for testing)
    console.log(`\n🗑️  Clearing existing stories...`)
    await db.delete(storyMetrics)
    await db.delete(storyCoverage)
    await db.delete(storyEntities)
    await db.delete(storyMembers)
    await db.update(articles).set({ storyId: null }).where(isNotNull(articles.storyId))
    await db.delete(stories)

    // Run entity-based clustering
    const result = await clusterWithEntities(threshold, minClusterSize, maxClusterSize)

    if (!result.success) {
      console.log(`\n❌ Clustering failed: ${result.error}\n`)
      process.exit(1)
    }

    console.log(`\n\n📊 CLUSTERING RESULTS`)
    console.log('=' .repeat(70))
    console.log(`Stories Created:    ${result.groupsCreated}`)
    console.log(`Articles Grouped:   ${result.articlesGrouped}`)
    console.log(`Orphans Assigned:   ${result.orphansAssigned}`)
    console.log(`Candidate Pairs:    ${result.candidatePairs.toLocaleString()}`)

    if (result.groupsCreated === 0) {
      console.log(`\n⚠️  No stories created. Try lowering the threshold.`)
      console.log(`   Current threshold: ${threshold}`)
      console.log(`   Suggested: 0.30 or 0.25\n`)
      process.exit(0)
    }

    // Show top 20 stories by article count
    const topStories = await db
      .select()
      .from(stories)
      .orderBy(sql`${stories.articleCount} DESC`)
      .limit(20)

    console.log(`\n📰 Top 20 Stories by Size:\n`)
    console.log('=' .repeat(70))

    for (const story of topStories) {
      console.log(`\nStory ${story.id}:`)
      console.log(`  Label:   "${story.topicLabel || story.representativeTitle}"`)
      console.log(`  Region:  ${story.primaryRegion || 'N/A'}`)
      console.log(`  Articles: ${story.articleCount}, Sources: ${story.sourceCount}`)
      console.log(`  Time Span: ${(story.timeSpanHours || 0).toFixed(1)} hours`)
      console.log(`  Version: ${story.clusterVersion}`)

      // Show primary entities
      const primaryEnts = story.primaryEntities as Array<{ id: number; name: string; type: string }> | null
      if (primaryEnts && primaryEnts.length > 0) {
        console.log(`  Entities: ${primaryEnts.map(e => `${e.name} (${e.type})`).join(', ')}`)
      }

      // Show first 3 article titles
      const memberArticles = await db
        .select({
          title: articles.title,
          publishedAt: articles.publishedAt,
        })
        .from(storyMembers)
        .innerJoin(articles, eq(storyMembers.articleId, articles.id))
        .where(eq(storyMembers.storyId, story.id))
        .orderBy(sql`${articles.publishedAt} DESC`)
        .limit(3)

      console.log(`  Sample articles:`)
      memberArticles.forEach((article, idx) => {
        const date = article.publishedAt?.toISOString().split('T')[0] || 'unknown'
        console.log(`    ${idx + 1}. [${date}] ${article.title.substring(0, 60)}...`)
      })

      if (story.articleCount > 3) {
        console.log(`    ... and ${story.articleCount - 3} more`)
      }
    }

    // Statistics
    console.log(`\n\n📈 Statistics:`)
    console.log('=' .repeat(70))

    const [{ total }] = await db
      .select({ total: sql<string>`COUNT(*)` })
      .from(articles)
    const totalArticles = parseInt(total)

    const groupedPercentage = (result.articlesGrouped / totalArticles) * 100

    console.log(`Total articles in DB: ${totalArticles}`)
    console.log(`Articles in stories: ${result.articlesGrouped} (${groupedPercentage.toFixed(1)}%)`)
    console.log(`Articles ungrouped: ${totalArticles - result.articlesGrouped}`)
    console.log(`Orphans assigned (entity-less): ${result.orphansAssigned}`)
    console.log(`Candidate pairs evaluated: ${result.candidatePairs.toLocaleString()}`)

    const allStories = await db.select().from(stories)

    if (allStories.length > 0) {
      const avgGroupSize = result.articlesGrouped / result.groupsCreated
      const sizes = allStories.map(s => s.articleCount)
      const maxGroupSize = Math.max(...sizes)
      const minGroupSize = Math.min(...sizes)
      const median = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)]

      console.log(`\nAverage story size: ${avgGroupSize.toFixed(1)} articles`)
      console.log(`Median story size: ${median} articles`)
      console.log(`Largest story: ${maxGroupSize} articles`)
      console.log(`Smallest story: ${minGroupSize} articles`)

      // Size distribution
      const sizeRanges = [
        { label: '2-5', min: 2, max: 5 },
        { label: '6-10', min: 6, max: 10 },
        { label: '11-20', min: 11, max: 20 },
        { label: '21-50', min: 21, max: 50 },
        { label: '51-80', min: 51, max: 80 },
        { label: '80+', min: 81, max: Infinity },
      ]

      console.log(`\nSize distribution:`)
      for (const range of sizeRanges) {
        const count = allStories.filter(s => s.articleCount >= range.min && s.articleCount <= range.max).length
        if (count > 0) {
          console.log(`  ${range.label} articles: ${count} stories`)
        }
      }

      // Region distribution
      const regionCounts = new Map<string, number>()
      for (const story of allStories) {
        const region = story.primaryRegion || 'Unknown'
        regionCounts.set(region, (regionCounts.get(region) || 0) + 1)
      }

      console.log(`\nRegion distribution:`)
      const sortedRegions = Array.from(regionCounts.entries()).sort((a, b) => b[1] - a[1])
      for (const [region, count] of sortedRegions.slice(0, 15)) {
        console.log(`  ${region}: ${count} stories`)
      }

      // Time span stats
      const timeSpans = allStories.map(s => s.timeSpanHours || 0).filter(t => t > 0)
      if (timeSpans.length > 0) {
        const avgSpan = timeSpans.reduce((a, b) => a + b, 0) / timeSpans.length
        console.log(`\nAverage time span: ${avgSpan.toFixed(1)} hours (${(avgSpan / 24).toFixed(1)} days)`)
      }
    }

    console.log('\n✨ Entity-based clustering complete!\n')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Clustering test failed:', error)
    process.exit(1)
  }
}

testClustering()
