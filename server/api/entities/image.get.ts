/**
 * GET /api/entities/image
 *
 * Fetches an entity portrait/logo image from Wikidata.
 * Query params:
 *   - name: entity name (required)
 *   - type: entity type - person, organization, location, event (required)
 *   - entityId: optional entity ID to persist the image URL to the database
 *
 * Returns: { imageUrl: string | null }
 */

import { fetchEntityImage } from '../../services/wikiImageFetcher'
import { getDatabase } from '../../database/db'
import { entitySummaries } from '../../database/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const name = query.name as string
  const type = query.type as string
  const entityId = query.entityId ? parseInt(query.entityId as string) : undefined

  if (!name || !type) {
    throw createError({
      statusCode: 400,
      message: 'Both "name" and "type" query parameters are required',
    })
  }

  const validTypes = ['person', 'organization', 'location', 'event', 'topic']
  if (!validTypes.includes(type)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid entity type. Must be one of: person, organization, location, event, topic',
    })
  }

  try {
    const imageUrl = await fetchEntityImage(name, type)

    // If we got an image and have an entityId, persist it to the database
    if (imageUrl && entityId) {
      try {
        const db = getDatabase()
        await db
          .update(entitySummaries)
          .set({ imageUrl })
          .where(eq(entitySummaries.entityId, entityId))
      } catch (dbError) {
        // Non-fatal: log but don't fail the request
        console.warn(`[EntityImage] Failed to persist image URL for entity ${entityId}:`, dbError)
      }
    }

    // Set cache headers (cache for 24 hours, stale-while-revalidate for 7 days)
    setResponseHeaders(event, {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    })

    return { imageUrl }
  } catch (error) {
    console.error(`[EntityImage] Error fetching image for "${name}" (${type}):`, error)
    return { imageUrl: null }
  }
})
