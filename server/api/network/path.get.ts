/**
 * GET /api/network/path
 *
 * Finds the shortest path between two entities in the network graph.
 * Uses Dijkstra's algorithm with relationship strength as weights.
 */

import { getDatabase } from '~/server/database/db'
import { entities, entityRelationships } from '~/server/database/schema'
import { inArray } from 'drizzle-orm'

interface PathNode {
  entityId: number
  name: string
  type: string
  slug: string | null
}

interface PathEdge {
  source: number
  target: number
  weight: number
  cooccurrenceCount: number
}

type Graph = Map<number, Array<{ entityId: number; weight: number; cooccurrenceCount: number }>>

// The full relationship graph (~380k edges) is built once and shared by all requests
// for 10 minutes; rebuilding it per request cost ~2s and ~150 MB of heap each time.
const GRAPH_TTL_MS = 10 * 60 * 1000
let graphCache: { graph: Graph; builtAt: number } | null = null
let graphLoading: Promise<Graph> | null = null

async function getGraph(db: ReturnType<typeof getDatabase>): Promise<Graph> {
  if (graphCache && Date.now() - graphCache.builtAt < GRAPH_TTL_MS) return graphCache.graph
  if (!graphLoading) {
    graphLoading = buildGraph(db)
      .then((graph) => {
        graphCache = { graph, builtAt: Date.now() }
        return graph
      })
      .finally(() => { graphLoading = null })
  }
  return graphLoading
}

async function buildGraph(db: ReturnType<typeof getDatabase>): Promise<Graph> {
  // Fetch all relationships to build graph
  const relationships = await db
    .select({
      sourceEntityId: entityRelationships.sourceEntityId,
      targetEntityId: entityRelationships.targetEntityId,
      strength: entityRelationships.strength,
      cooccurrenceCount: entityRelationships.cooccurrenceCount,
    })
    .from(entityRelationships)

  // Build adjacency list (undirected graph)
  const adjacencyList: Graph = new Map()

  for (const rel of relationships) {
    const { sourceEntityId, targetEntityId, strength, cooccurrenceCount } = rel

    // Add edge in both directions (undirected)
    if (!adjacencyList.has(sourceEntityId)) {
      adjacencyList.set(sourceEntityId, [])
    }
    if (!adjacencyList.has(targetEntityId)) {
      adjacencyList.set(targetEntityId, [])
    }

    adjacencyList.get(sourceEntityId)!.push({
      entityId: targetEntityId,
      weight: strength || 0,
      cooccurrenceCount: cooccurrenceCount || 0,
    })
    adjacencyList.get(targetEntityId)!.push({
      entityId: sourceEntityId,
      weight: strength || 0,
      cooccurrenceCount: cooccurrenceCount || 0,
    })
  }

  return adjacencyList
}

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const sourceId = query.sourceId ? parseInt(query.sourceId as string) : null
  const targetId = query.targetId ? parseInt(query.targetId as string) : null
  const maxDepth = query.maxDepth ? parseInt(query.maxDepth as string) : 5

  if (!sourceId || !targetId) {
    return {
      success: false,
      error: 'Both sourceId and targetId are required',
    }
  }

  if (sourceId === targetId) {
    return {
      success: false,
      error: 'Source and target must be different entities',
    }
  }

  try {
    const adjacencyList = await getGraph(db)

    // Find shortest path using Dijkstra's algorithm (weighted by strength)
    const path = findShortestPath(adjacencyList, sourceId, targetId, maxDepth)

    if (!path) {
      return {
        success: false,
        error: `No path found between entities (max depth: ${maxDepth})`,
      }
    }

    // Fetch entity details for the path
    const entityIds = path.nodes.map(n => n.entityId)
    const entityDetails = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        slug: entities.slug,
      })
      .from(entities)
      .where(inArray(entities.id, entityIds))

    // Build entity map
    const entityMap = new Map(entityDetails.map(e => [e.id, e]))

    // Enrich path nodes with entity details
    const enrichedNodes = path.nodes.map(node => ({
      ...node,
      name: entityMap.get(node.entityId)?.name || 'Unknown',
      type: entityMap.get(node.entityId)?.type || 'unknown',
      slug: entityMap.get(node.entityId)?.slug || null,
    }))

    return {
      success: true,
      data: {
        path: enrichedNodes,
        edges: path.edges,
        length: path.nodes.length - 1,
        totalWeight: path.totalWeight,
      },
      params: {
        sourceId,
        targetId,
        maxDepth,
      },
    }
  } catch (error: any) {
    console.error('Error finding path:', error)
    return {
      success: false,
      error: error.message || 'Failed to find path',
    }
  }
})

/**
 * Find shortest path using Dijkstra's algorithm
 * Returns null if no path exists within maxDepth
 */
function findShortestPath(
  graph: Graph,
  sourceId: number,
  targetId: number,
  maxDepth: number
): {
  nodes: PathNode[]
  edges: PathEdge[]
  totalWeight: number
} | null {
  // Priority queue (binary min-heap on distance): [entityId, distance, depth]
  const queue = new MinHeap<{ entityId: number; distance: number; depth: number }>((a, b) => a.distance - b.distance)
  queue.push({ entityId: sourceId, distance: 0, depth: 0 })

  // Track best distances and previous nodes
  const distances = new Map<number, number>([[sourceId, 0]])
  const previous = new Map<number, { entityId: number; weight: number; cooccurrenceCount: number }>()
  const visited = new Set<number>()

  while (queue.size > 0) {
    // Get node with minimum distance
    const current = queue.pop()!

    if (visited.has(current.entityId)) continue
    visited.add(current.entityId)

    // Found target
    if (current.entityId === targetId) {
      return reconstructPath(sourceId, targetId, previous)
    }

    // Skip if max depth reached
    if (current.depth >= maxDepth) continue

    // Explore neighbors
    const neighbors = graph.get(current.entityId) || []

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.entityId)) continue

      // Use inverse of weight as distance (higher weight = shorter distance)
      const distance = current.distance + (1 - neighbor.weight)

      if (!distances.has(neighbor.entityId) || distance < distances.get(neighbor.entityId)!) {
        distances.set(neighbor.entityId, distance)
        previous.set(neighbor.entityId, {
          entityId: current.entityId,
          weight: neighbor.weight,
          cooccurrenceCount: neighbor.cooccurrenceCount,
        })

        queue.push({
          entityId: neighbor.entityId,
          distance,
          depth: current.depth + 1,
        })
      }
    }
  }

  return null // No path found
}

/**
 * Reconstruct path from previous map
 */
function reconstructPath(
  sourceId: number,
  targetId: number,
  previous: Map<number, { entityId: number; weight: number; cooccurrenceCount: number }>
): {
  nodes: PathNode[]
  edges: PathEdge[]
  totalWeight: number
} {
  const path: PathNode[] = []
  const edges: PathEdge[] = []
  let totalWeight = 0

  let current = targetId

  while (current !== sourceId) {
    path.unshift({ entityId: current, name: '', type: '', slug: null })

    const prev = previous.get(current)
    if (!prev) break

    edges.unshift({
      source: prev.entityId,
      target: current,
      weight: prev.weight,
      cooccurrenceCount: prev.cooccurrenceCount,
    })

    totalWeight += prev.weight
    current = prev.entityId
  }

  path.unshift({ entityId: sourceId, name: '', type: '', slug: null })

  return { nodes: path, edges, totalWeight }
}

class MinHeap<T> {
  private items: T[] = []
  constructor(private compare: (a: T, b: T) => number) {}

  get size() {
    return this.items.length
  }

  push(item: T) {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.compare(items[i]!, items[parent]!) >= 0) break
      ;[items[i], items[parent]] = [items[parent]!, items[i]!]
      i = parent
    }
  }

  pop(): T | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1, right = left + 1
        let smallest = i
        if (left < items.length && this.compare(items[left]!, items[smallest]!) < 0) smallest = left
        if (right < items.length && this.compare(items[right]!, items[smallest]!) < 0) smallest = right
        if (smallest === i) break
        ;[items[i], items[smallest]] = [items[smallest]!, items[i]!]
        i = smallest
      }
    }
    return top
  }
}
