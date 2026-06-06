/**
 * GET /api/network/entities
 *
 * Returns entity network graph filtered by entity type.
 * Used for the topics page to show networks for specific entity categories.
 */

import { getDatabase } from '~/server/database/db'
import { entities, entitySummaries, entityRelationships } from '~/server/database/schema'
import { eq, and, gte, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const entityType = query.entityType as string
  const centerEntity = query.centerEntity ? parseInt(query.centerEntity as string) : undefined
  const timeWindow = query.timeWindow ? parseInt(query.timeWindow as string) : 30 // days
  const minWeight = query.minWeight ? parseFloat(query.minWeight as string) : 0.1
  const limit = query.limit ? parseInt(query.limit as string) : 100

  // Validate entity type
  const validTypes = ['person', 'organization', 'location', 'event', 'topic']
  if (!entityType || !validTypes.includes(entityType)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid entity type. Must be one of: person, organization, location, event, topic'
    })
  }

  const db = getDatabase()

  try {
    // Calculate the date threshold
    const dateThreshold = new Date()
    dateThreshold.setDate(dateThreshold.getDate() - timeWindow)

    let entityIds: number[] = []

    // If centerEntity is provided, get entities related to it
    if (centerEntity) {
      // Get entities that have relationships with the center entity using raw SQL
      const result = await db.execute(sql`
        SELECT CASE
          WHEN source_entity_id = ${centerEntity} THEN target_entity_id
          WHEN target_entity_id = ${centerEntity} THEN source_entity_id
        END as entity_id
        FROM entity_relationships
        WHERE (source_entity_id = ${centerEntity} OR target_entity_id = ${centerEntity})
          AND strength >= ${minWeight}
          AND last_co_occurrence >= ${dateThreshold}
        LIMIT ${limit - 1}
      `)

      // Include center entity and related entities
      const relatedIds = result.rows.map((r: any) => r.entity_id).filter((id: number) => id !== null)
      entityIds = [centerEntity, ...relatedIds]
    } else {
      // Get top entities of this type
      const topEntities = await db
        .select({
          id: entities.id,
        })
        .from(entities)
        .innerJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
        .where(eq(entities.type, entityType))
        .orderBy(desc(entitySummaries.trendingScore), desc(entitySummaries.mentionCount))
        .limit(limit)

      entityIds = topEntities.map(e => e.id)
    }

    // Get entity details (use LEFT JOIN to include entities without summaries)
    const topEntities = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        subtype: entities.subtype,
        slug: entities.slug,
        trendingScore: entitySummaries.trendingScore,
        shortDescription: entitySummaries.shortDescription,
        imageUrl: entitySummaries.imageUrl,
      })
      .from(entities)
      .leftJoin(entitySummaries, eq(entities.id, entitySummaries.entityId))
      .where(sql`${entities.id} IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(sql`COALESCE(${entitySummaries.trendingScore}, 0)`))

    if (entityIds.length === 0) {
      return {
        nodes: [],
        edges: [],
      }
    }

    // Get relationships between these entities
    const relationships = await db
      .select({
        sourceId: entityRelationships.sourceEntityId,
        targetId: entityRelationships.targetEntityId,
        weight: entityRelationships.strength,
        cooccurrenceCount: entityRelationships.cooccurrenceCount,
        sentimentCorrelation: entityRelationships.sentimentCorrelation,
        lastSeen: entityRelationships.lastCooccurrence,
      })
      .from(entityRelationships)
      .where(
        and(
          sql`${entityRelationships.sourceEntityId} IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`,
          sql`${entityRelationships.targetEntityId} IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`,
          gte(entityRelationships.strength, minWeight),
          gte(entityRelationships.lastCooccurrence, dateThreshold)
        )
      )
      .orderBy(desc(entityRelationships.strength))

    // Build graph data
    const nodes = topEntities.map(entity => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      subtype: entity.subtype || null,
      slug: entity.slug,
      trendingScore: entity.trendingScore || 0,
      shortDescription: entity.shortDescription || null,
      imageUrl: entity.imageUrl || null,
    }))

    // Create a set of valid node IDs for quick lookup
    const nodeIdSet = new Set(nodes.map(n => n.id))

    // Filter edges to only include those where both source and target exist as nodes
    const edges = relationships
      .filter(rel => nodeIdSet.has(rel.sourceId) && nodeIdSet.has(rel.targetId))
      .map(rel => ({
        source: rel.sourceId,
        target: rel.targetId,
        weight: rel.weight,
        cooccurrenceCount: rel.cooccurrenceCount,
        sentimentCorrelation: rel.sentimentCorrelation,
        lastSeen: rel.lastSeen,
      }))

    return {
      nodes,
      edges,
      meta: {
        entityType,
        centerEntity,
        timeWindow,
        minWeight,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      }
    }
  } catch (error) {
    console.error('Error fetching entity network:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to fetch entity network'
    })
  }
})
