// Load environment variables first
import { config } from 'dotenv'
config()

import { getDatabase } from '../database/db.js'
import { entities, entitySummaries } from '../database/schema.js'
import { eq, sql, desc, isNull } from 'drizzle-orm'
import { enrichEntity } from '../services/wikidataEnricher.js'

async function main() {
  const limit = parseInt(process.argv[2] || '100')
  const delayMs = parseInt(process.argv[3] || '500')

  console.log('=== Batch Wikidata Enrichment Script ===')
  console.log(`Limit: ${limit}, Delay: ${delayMs}ms between requests\n`)

  const db = getDatabase()

  // Find top entities by mention count that lack enrichment data
  // Left join with entity_summaries to find those without wikidataId in metadata
  const topEntities = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      metadata: entitySummaries.metadata,
    })
    .from(entities)
    .leftJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
    .where(
      sql`(${entitySummaries.metadata} IS NULL OR ${entitySummaries.metadata}->>'wikidataId' IS NULL)`
    )
    .orderBy(desc(sql`COALESCE(${entitySummaries.mentionCount}, 0)`))
    .limit(limit)

  console.log(`Found ${topEntities.length} entities needing enrichment\n`)

  if (topEntities.length === 0) {
    console.log('All entities are already enriched. Exiting.')
    process.exit(0)
  }

  let success = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < topEntities.length; i++) {
    const entity = topEntities[i]
    process.stdout.write(`[${i + 1}/${topEntities.length}] ${entity.name} (${entity.type})... `)

    try {
      const result = await enrichEntity(entity.name, entity.type)

      if (!result) {
        console.log('no Wikidata match')
        skipped++

        // Mark as attempted in existing summary or create new one
        const [existing] = await db
          .select()
          .from(entitySummaries)
          .where(eq(entitySummaries.entityId, entity.id))
          .limit(1)

        const enrichmentMetadata = {
          ...((existing?.metadata as Record<string, any>) || {}),
          enrichmentAttempted: true,
          enrichmentDate: new Date().toISOString(),
        }

        if (existing) {
          await db
            .update(entitySummaries)
            .set({ metadata: enrichmentMetadata, lastUpdated: new Date() })
            .where(eq(entitySummaries.entityId, entity.id))
        } else {
          await db
            .insert(entitySummaries)
            .values({
              entityId: entity.id,
              metadata: enrichmentMetadata,
              mentionCount: 0,
              trendingScore: 0,
              lastUpdated: new Date(),
            })
        }
      } else {
        // Persist enrichment
        const [existing] = await db
          .select()
          .from(entitySummaries)
          .where(eq(entitySummaries.entityId, entity.id))
          .limit(1)

        const enrichmentMetadata = {
          ...((existing?.metadata as Record<string, any>) || {}),
          wikidataId: result.wikidataId,
          wikipediaUrl: result.wikipediaUrl,
          description: result.description,
          properties: result.properties,
          enrichmentDate: new Date().toISOString(),
        }

        if (existing) {
          await db
            .update(entitySummaries)
            .set({
              metadata: enrichmentMetadata,
              wikiUrl: result.wikipediaUrl || existing.wikiUrl,
              imageUrl: result.imageUrl || existing.imageUrl,
              shortDescription: result.description?.slice(0, 500) || existing.shortDescription,
              lastUpdated: new Date(),
            })
            .where(eq(entitySummaries.entityId, entity.id))
        } else {
          await db
            .insert(entitySummaries)
            .values({
              entityId: entity.id,
              metadata: enrichmentMetadata,
              wikiUrl: result.wikipediaUrl,
              imageUrl: result.imageUrl,
              shortDescription: result.description?.slice(0, 500) || null,
              mentionCount: 0,
              trendingScore: 0,
              lastUpdated: new Date(),
            })
        }

        const propCount = Object.keys(result.properties).length
        console.log(`enriched (${propCount} properties, ${result.wikipediaUrl ? 'wiki' : 'no wiki'})`)
        success++
      }
    } catch (error) {
      console.log(`error: ${(error as Error).message}`)
      failed++
    }

    // Rate limiting
    if (i < topEntities.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  console.log('\n=== Enrichment Complete ===')
  console.log(`Success: ${success}`)
  console.log(`No match: ${skipped}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${topEntities.length}`)

  process.exit(0)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
