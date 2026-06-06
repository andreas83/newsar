import { getDatabase } from '~/server/database/db'
import { entityRelationships, entities } from '~/server/database/schema'
import { sql, eq, or, and, gte, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const center = query.center as string | undefined
  const minStrength = parseFloat(query.minStrength as string || '0.3')
  const limit = Math.min(parseInt(query.limit as string || '100'), 500)
  const days = parseInt(query.days as string || '30')

  try {
    // Calculate date filter
    const dateFilter = new Date()
    dateFilter.setDate(dateFilter.getDate() - days)

    let relationships: any[] = []

    if (center) {
      // Find entity by name (case-insensitive search)
      // Prefer entities with more relationships (more important/relevant)
      const searchPattern = `%${center}%`
      const centerEntity = await db.execute(sql`
        SELECT e.id, COUNT(er.id) as rel_count
        FROM entities e
        LEFT JOIN entity_relationships er ON e.id = er.source_entity_id OR e.id = er.target_entity_id
        WHERE LOWER(e.name) LIKE LOWER(${searchPattern})
        GROUP BY e.id
        ORDER BY rel_count DESC
        LIMIT 1
      `)
      const entityResult = centerEntity.rows as { id: number; rel_count: number }[]

      if (entityResult.length > 0) {
        const centerId = entityResult[0].id

        // Get relationships for centered entity (both as source and target)
        const result = await db.execute(sql`
          SELECT
            er.id,
            er.source_entity_id,
            er.target_entity_id,
            er.cooccurrence_count,
            er.strength,
            er.sentiment_correlation,
            se.name as source_name,
            se.type as source_type,
            se.slug as source_slug,
            te.name as target_name,
            te.type as target_type,
            te.slug as target_slug
          FROM entity_relationships er
          JOIN entities se ON er.source_entity_id = se.id
          JOIN entities te ON er.target_entity_id = te.id
          WHERE (er.source_entity_id = ${centerId} OR er.target_entity_id = ${centerId})
            AND er.strength >= ${minStrength}
            AND er.last_co_occurrence >= ${dateFilter.toISOString()}
          ORDER BY er.strength DESC
          LIMIT ${limit}
        `)
        relationships = result.rows as any[]
      }
    } else {
      // Get top relationships by strength
      const result = await db.execute(sql`
        SELECT
          er.id,
          er.source_entity_id,
          er.target_entity_id,
          er.cooccurrence_count,
          er.strength,
          er.sentiment_correlation,
          se.name as source_name,
          se.type as source_type,
          se.slug as source_slug,
          te.name as target_name,
          te.type as target_type,
          te.slug as target_slug
        FROM entity_relationships er
        JOIN entities se ON er.source_entity_id = se.id
        JOIN entities te ON er.target_entity_id = te.id
        WHERE er.strength >= ${minStrength}
          AND er.last_co_occurrence >= ${dateFilter.toISOString()}
        ORDER BY er.strength DESC, er.cooccurrence_count DESC
        LIMIT ${limit}
      `)
      relationships = result.rows as any[]
    }

    // Build nodes and edges
    const nodeMap = new Map<string, any>()
    const edges: any[] = []

    // Entity type to color category mapping
    const typeToCategory = (type: string): string => {
      switch (type?.toLowerCase()) {
        case 'person': return 'person'
        case 'organization': return 'organization'
        case 'location': return 'location'
        case 'event': return 'event'
        default: return 'entity'
      }
    }

    for (const rel of relationships) {
      // Add source node
      const sourceKey = `entity-${rel.source_entity_id}`
      if (!nodeMap.has(sourceKey)) {
        nodeMap.set(sourceKey, {
          id: sourceKey,
          entityId: rel.source_entity_id,
          label: rel.source_name,
          type: rel.source_type,
          slug: rel.source_slug,
          category: typeToCategory(rel.source_type),
          size: 12,
          connections: 0,
        })
      }
      nodeMap.get(sourceKey).connections++
      nodeMap.get(sourceKey).size = Math.min(30, 10 + nodeMap.get(sourceKey).connections * 2)

      // Add target node
      const targetKey = `entity-${rel.target_entity_id}`
      if (!nodeMap.has(targetKey)) {
        nodeMap.set(targetKey, {
          id: targetKey,
          entityId: rel.target_entity_id,
          label: rel.target_name,
          type: rel.target_type,
          slug: rel.target_slug,
          category: typeToCategory(rel.target_type),
          size: 12,
          connections: 0,
        })
      }
      nodeMap.get(targetKey).connections++
      nodeMap.get(targetKey).size = Math.min(30, 10 + nodeMap.get(targetKey).connections * 2)

      // Add edge
      edges.push({
        from: sourceKey,
        to: targetKey,
        type: 'co_occurrence',
        strength: Number(rel.strength),
        cooccurrenceCount: rel.cooccurrence_count,
        sentimentCorrelation: rel.sentiment_correlation,
        width: Math.max(1, Math.round(Number(rel.strength) * 5)),
      })
    }

    const nodes = Array.from(nodeMap.values())

    return {
      nodes,
      edges,
      meta: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        center: center || null,
        minStrength,
        days,
      },
    }
  } catch (error) {
    console.error('Error fetching topic graph:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch topic graph',
    })
  }
})
