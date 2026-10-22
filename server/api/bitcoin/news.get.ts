/**
 * BTC News API
 * GET /api/bitcoin/news?limit=20
 * Returns recent articles mentioning Bitcoin/Cryptocurrency entities.
 */
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'

/**
 * article_entities.sentiment is a varchar holding either a label
 * ('positive' | 'negative' | 'neutral', written by the classifier before
 * 2026-04-19) or a numeric FinBERT score (written by ml/btc_sentiment.py).
 */
function parseSentiment(value: unknown): number | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (raw === 'positive') return 1
  if (raw === 'negative') return -1
  if (raw === 'neutral') return 0
  const num = parseFloat(raw)
  return Number.isFinite(num) ? num : null
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = Math.min(parseInt(query.limit as string) || 20, 50)
  const db = getDatabase()

  // Collect matching article ids first, then order by recency. Ordering inside
  // a DISTINCT ON must lead with the distinct key, so the LIMIT there would
  // slice by article id (i.e. the oldest articles) instead of by date.
  const result = await db.execute(sql`
    WITH crypto_articles AS (
      SELECT DISTINCT ON (ae.article_id)
        ae.article_id,
        ae.sentiment,
        e.name AS entity_name
      FROM article_entities ae
      JOIN entities e ON e.id = ae.entity_id
      WHERE (e.name ILIKE '%bitcoin%' OR e.name ILIKE '%cryptocurrency%' OR e.name ILIKE '%crypto%')
        -- 'Crypto.com Arena' is a basketball venue, not crypto news
        AND e.name NOT ILIKE '%crypto.com arena%'
      ORDER BY ae.article_id, ae.relevance_score DESC
    )
    SELECT
      a.id, a.title, a.url, a.published_at, a.image_url, a.image_local_path,
      f.name as feed_name,
      ca.sentiment,
      ca.entity_name
    FROM crypto_articles ca
    JOIN articles a ON a.id = ca.article_id
    JOIN feeds f ON f.id = a.feed_id
    WHERE a.excluded = false
    ORDER BY a.published_at DESC
    LIMIT ${limit}
  `)

  const articles = result.rows as any[]

  return {
    articles: articles.map((r: any) => ({
      id: parseInt(r.id),
      title: r.title,
      url: r.url,
      publishedAt: r.published_at,
      imageUrl: r.image_local_path || r.image_url,
      feedName: r.feed_name,
      sentiment: parseSentiment(r.sentiment),
      entityName: r.entity_name,
    })),
    count: articles.length,
  }
})
