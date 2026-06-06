/**
 * GET /api/network/graph
 *
 * Returns entity network graph data for visualization.
 * Supports filtering by entity IDs, date range, and relationship strength.
 */

import { getEntityNetworkGraph } from '~/server/services/entityRelationshipComputer'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  // Parse query parameters
  const entityIds = query.entityIds
    ? (Array.isArray(query.entityIds) ? query.entityIds : [query.entityIds])
      .map((id: any) => parseInt(id))
      .filter((id: number) => !isNaN(id))
    : undefined

  const minStrength = query.minStrength
    ? parseFloat(query.minStrength as string)
    : 0.1

  const fromDate = query.fromDate
    ? new Date(query.fromDate as string)
    : undefined

  const toDate = query.toDate
    ? new Date(query.toDate as string)
    : undefined

  const limit = query.limit
    ? parseInt(query.limit as string)
    : 500

  try {
    const graph = await getEntityNetworkGraph({
      entityIds,
      minStrength,
      fromDate,
      toDate,
      limit,
    })

    return {
      success: true,
      data: graph,
      filters: {
        entityIds,
        minStrength,
        fromDate: fromDate?.toISOString(),
        toDate: toDate?.toISOString(),
        limit,
      },
      stats: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
      },
    }
  } catch (error: any) {
    console.error('Error fetching network graph:', error)
    return {
      success: false,
      error: error.message || 'Failed to fetch network graph',
    }
  }
})
