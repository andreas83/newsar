import { getDatabase } from '../../../database/db'
import { entities, entitySummaries } from '../../../database/schema'
import { sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    // Get entity counts by type
    const entityCountsByType = await db
      .select({
        type: entities.type,
        count: sql<number>`COUNT(*)`,
      })
      .from(entities)
      .groupBy(entities.type)

    // Get summary statistics
    const [summaryStats] = await db
      .select({
        totalSummaries: sql<number>`COUNT(*)`,
        withDescription: sql<number>`COUNT(CASE WHEN short_description IS NOT NULL THEN 1 END)`,
        avgMentions: sql<number>`AVG(mention_count)`,
        maxMentions: sql<number>`MAX(mention_count)`,
      })
      .from(entitySummaries)

    // Get top trending entities
    const topTrending = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        slug: entities.slug,
        mentionCount: entitySummaries.mentionCount,
        trendingScore: entitySummaries.trendingScore,
        hasSummary: sql<boolean>`${entitySummaries.summary} IS NOT NULL`,
      })
      .from(entities)
      .innerJoin(entitySummaries, sql`${entities.id} = ${entitySummaries.entityId}`)
      .orderBy(sql`${entitySummaries.trendingScore} DESC`, sql`${entitySummaries.mentionCount} DESC`)
      .limit(20)

    // Get entities needing summaries
    const [needSummary] = await db
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(entities)
      .leftJoin(entitySummaries, sql`${entities.id} = ${entitySummaries.entityId}`)
      .where(sql`${entitySummaries.id} IS NULL`)

    // Format entity counts
    const entityCounts = entityCountsByType.reduce((acc, row) => {
      acc[row.type] = Number(row.count)
      return acc
    }, {} as Record<string, number>)

    return {
      entityCounts,
      summaryStats: {
        total: Number(summaryStats?.totalSummaries || 0),
        withDescription: Number(summaryStats?.withDescription || 0),
        avgMentions: Math.round(Number(summaryStats?.avgMentions || 0)),
        maxMentions: Number(summaryStats?.maxMentions || 0),
      },
      needSummary: Number(needSummary?.count || 0),
      topTrending,
    }
  } catch (error) {
    console.error('Error fetching entity stats:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch entity statistics'
    })
  }
})
