import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'

// Entity network for one article: the article's own entities, the ties between
// them across all coverage, and the outside entities that bridge several of them.
export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const query = getQuery(event)

  const articleId = parseInt(query.id as string)
  const maxNodes = Math.min(parseInt(query.maxNodes as string || '14'), 24)
  const maxContext = Math.min(parseInt(query.maxContext as string || '8'), 16)

  if (!articleId || isNaN(articleId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Article ID is required (?id=123)',
    })
  }

  try {
    const entityRows = await db.execute(sql`
      SELECT e.id, e.name, e.type, e.slug, ae.relevance_score AS relevance, ae.role
      FROM article_entities ae
      JOIN entities e ON e.id = ae.entity_id
      WHERE ae.article_id = ${articleId}
      ORDER BY ae.relevance_score DESC NULLS LAST, ae.mention_count DESC NULLS LAST
      LIMIT ${maxNodes}
    `)
    const articleEntities = entityRows.rows as any[]
    if (articleEntities.length === 0) return { nodes: [], edges: [] }

    const ids = articleEntities.map(e => Number(e.id))
    const idList = sql.join(ids.map(id => sql`${id}`), sql`, `)

    // Ties among the article's own entities
    const innerRows = await db.execute(sql`
      SELECT source_entity_id AS a, target_entity_id AS b, cooccurrence_count AS co
      FROM entity_relationships
      WHERE source_entity_id IN (${idList})
        AND target_entity_id IN (${idList})
        AND source_entity_id <> target_entity_id
    `)

    // Outside entities, ranked by how many of the article's entities they link
    const contextRows = await db.execute(sql`
      WITH rel AS (
        SELECT source_entity_id AS a, target_entity_id AS b, cooccurrence_count AS co
        FROM entity_relationships WHERE source_entity_id IN (${idList})
        UNION ALL
        SELECT target_entity_id, source_entity_id, cooccurrence_count
        FROM entity_relationships WHERE target_entity_id IN (${idList})
      ),
      ranked AS (
        SELECT b, COUNT(DISTINCT a) AS links, SUM(co) AS total
        FROM rel
        WHERE b NOT IN (${idList}) AND co >= 2
        GROUP BY b
        HAVING COUNT(DISTINCT a) >= 2
        ORDER BY links DESC, total DESC
        LIMIT ${maxContext}
      )
      SELECT r.a, r.b, r.co, e.name, e.type, e.slug, k.links
      FROM ranked k
      JOIN rel r ON r.b = k.b AND r.co >= 2
      JOIN entities e ON e.id = k.b
    `)

    const nodes = articleEntities.map(e => ({
      id: `e${e.id}`,
      label: e.name,
      type: e.type,
      slug: e.slug,
      inArticle: true,
      relevance: e.relevance != null ? Number(e.relevance) : 0.5,
      role: e.role || null,
    }))

    // A pair can be stored in both directions; keep the larger count
    const edgeMap = new Map<string, { from: string; to: string; count: number; context: boolean }>()
    const addEdge = (a: number, b: number, count: number, context: boolean) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      const prev = edgeMap.get(key)
      if (!prev || prev.count < count) edgeMap.set(key, { from: `e${a}`, to: `e${b}`, count, context })
    }

    for (const r of innerRows.rows as any[]) addEdge(Number(r.a), Number(r.b), Number(r.co), false)

    const seenContext = new Set<number>()
    for (const r of contextRows.rows as any[]) {
      const b = Number(r.b)
      if (!seenContext.has(b)) {
        seenContext.add(b)
        nodes.push({
          id: `e${b}`,
          label: r.name,
          type: r.type,
          slug: r.slug,
          inArticle: false,
          relevance: 0,
          role: null,
        })
      }
      addEdge(Number(r.a), b, Number(r.co), true)
    }

    return { nodes, edges: Array.from(edgeMap.values()) }
  } catch (error) {
    console.error('Error fetching article network:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch article network',
    })
  }
})
