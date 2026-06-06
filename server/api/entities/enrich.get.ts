import { getDatabase } from '~/server/database/db'
import { entities, entitySummaries } from '~/server/database/schema'
import { eq } from 'drizzle-orm'
import { enrichEntity } from '~/server/services/wikidataEnricher'

const STALENESS_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const entityId = parseInt(query.entityId as string)
  const force = query.force === 'true'

  if (!entityId || isNaN(entityId)) {
    throw createError({ statusCode: 400, statusMessage: 'entityId is required' })
  }

  const db = getDatabase()

  // Fetch the entity
  const [entity] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1)

  if (!entity) {
    throw createError({ statusCode: 404, statusMessage: 'Entity not found' })
  }

  // Check existing summary for cached enrichment data
  const [existing] = await db
    .select()
    .from(entitySummaries)
    .where(eq(entitySummaries.entityId, entityId))
    .limit(1)

  const existingMetadata = (existing?.metadata as Record<string, any>) || {}
  const lastUpdated = existing?.lastUpdated ? new Date(existing.lastUpdated).getTime() : 0
  const isFresh = (Date.now() - lastUpdated) < STALENESS_MS
  const hasEnrichment = existingMetadata?.wikidataId

  // Return cached data if fresh and not forced
  if (hasEnrichment && isFresh && !force) {
    setResponseHeaders(event, {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    })
    return {
      cached: true,
      wikidataId: existingMetadata.wikidataId,
      wikipediaUrl: existing?.wikiUrl || existingMetadata.wikipediaUrl,
      imageUrl: existing?.imageUrl || existingMetadata.imageUrl,
      description: existingMetadata.description,
      properties: existingMetadata.properties || {},
    }
  }

  // Fetch enrichment from Wikidata
  const result = await enrichEntity(entity.name, entity.type)

  if (!result) {
    // Mark as attempted so we don't retry every page load
    if (existing) {
      await db
        .update(entitySummaries)
        .set({
          metadata: { ...existingMetadata, enrichmentAttempted: true, enrichmentDate: new Date().toISOString() },
          lastUpdated: new Date(),
        })
        .where(eq(entitySummaries.entityId, entityId))
    }
    return { cached: false, wikidataId: null, wikipediaUrl: null, imageUrl: null, description: null, properties: {} }
  }

  // Persist enrichment to database
  const enrichmentMetadata = {
    ...existingMetadata,
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
        lastUpdated: new Date(),
      })
      .where(eq(entitySummaries.entityId, entityId))
  } else {
    await db
      .insert(entitySummaries)
      .values({
        entityId,
        metadata: enrichmentMetadata,
        wikiUrl: result.wikipediaUrl,
        imageUrl: result.imageUrl,
        shortDescription: result.description?.slice(0, 500) || null,
        mentionCount: 0,
        trendingScore: 0,
        lastUpdated: new Date(),
      })
  }

  setResponseHeaders(event, {
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
  })

  return {
    cached: false,
    wikidataId: result.wikidataId,
    wikipediaUrl: result.wikipediaUrl,
    imageUrl: result.imageUrl,
    description: result.description,
    properties: result.properties,
  }
})
