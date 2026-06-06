import { getDatabase } from '../../database/db.js'
import { sql } from 'drizzle-orm'

function classifyByKeywords(keywords: string | null): string {
  if (!keywords) return 'other'
  const s = keywords.toLowerCase()
  // Order matters: more specific categories first
  if (/war|conflict|military|attack|bomb|troops|weapon|missile|invasion|ceasefire|casualties|battle|airstrike|combat|siege|blockade|krieg|guerre|guerra|peace|humanitarian crisis|middle east|moyen-orient|drones/.test(s)) return 'conflict'
  if (/diplomat|treaty|sanction|summit|bilateral|ambassador|negotiation|foreign policy|foreign affairs|international relation|négociation|política exterior/.test(s)) return 'diplomacy'
  if (/election|politic|parliament|vote|minister|legislation|reform|coalition|governor|senator|congress|opposition|campaign|corruption|corrupción|protest|politik|politique|política|gouvernement|enquête|investigation|investigación|proposition de loi|juicio|immigrant|inmigrante|refugee|asylum|antisémit|strike|streik|grève/.test(s)) return 'politics'
  if (/business|economy|finance|market|trade|inflation|stock|bank|invest|gdp|tariff|tax|recession|currency|oil price|crypto|wirtschaft|économie|economía|energiepreise|spritpreise|mineralölsteuer|energy crisis|energiesteuer|ölpreise|prix des carburants|tankrabatt|fuel price/.test(s)) return 'economy'
  if (/health|medical|disease|vaccine|hospital|pandemic|virus|cancer|epidemic|gesundheit|santé/.test(s)) return 'health'
  if (/climate|environment|emission|renewable|pollution|energy price|warming|carbon|wildfire|flood|drought|earthquake/.test(s)) return 'environment'
  if (/\bai\b|artificial intelligence|inteligencia artificial|intelligence artificielle|digital|cyber|software|startup|internet|robot|algorithm|social media|tech/.test(s)) return 'technology'
  if (/sport|football|soccer|tennis|tenis|olympic|champion|league|tournament|basketball|cricket|rugby|bundesliga|culture|entertain|film|movie|music|violences sexuelles|agresión sexual/.test(s)) return 'society'
  return 'other'
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const hours = Math.min(parseInt(query.hours as string) || 168, 24 * 30)
  const limit = Math.min(parseInt(query.limit as string) || 40, 100)

  const db = getDatabase()

  // Top location entities in window
  const topRes: any = await db.execute(sql`
    WITH recent_mentions AS (
      SELECT ae.entity_id, ae.article_id, a.published_at, f.category AS feed_category,
             c.political_bias, c.sensationalism, c.propaganda_risk
      FROM article_entities ae
      JOIN articles a ON a.id = ae.article_id AND a.excluded = false
      JOIN feeds f ON f.id = a.feed_id
      LEFT JOIN classifications c ON c.article_id = a.id
      WHERE a.published_at > NOW() - (INTERVAL '1 hour' * ${hours})
    )
    SELECT
      e.id, e.name, e.slug,
      es.short_description, es.image_url,
      COALESCE(es.mention_count, 0) AS mention_count,
      es.trending_score,
      COUNT(DISTINCT rm.article_id)::int AS article_count,
      COUNT(DISTINCT CASE WHEN rm.published_at > NOW() - INTERVAL '24 hours' THEN rm.article_id END)::int AS article_count_24h,
      MAX(rm.published_at) AS last_mentioned,
      AVG(rm.political_bias)::real AS avg_bias,
      AVG(rm.sensationalism)::real AS avg_sensationalism,
      AVG(rm.propaganda_risk)::real AS avg_propaganda
    FROM entities e
    JOIN recent_mentions rm ON rm.entity_id = e.id
    LEFT JOIN entity_summaries es ON es.entity_id = e.id
    WHERE e.type = 'location' AND e.slug IS NOT NULL
    GROUP BY e.id, e.name, e.slug, es.short_description, es.image_url, es.mention_count, es.trending_score
    HAVING COUNT(DISTINCT rm.article_id) >= 2
    ORDER BY COUNT(DISTINCT rm.article_id) DESC
    LIMIT ${limit}
  `)
  const rows = (topRes.rows ?? topRes) as any[]
  const ids = rows.map(r => r.id)

  // Per-entity category breakdown (keyword-based)
  let catMap = new Map<number, Record<string, number>>()
  if (ids.length > 0) {
    const catRes: any = await db.execute(sql`
      SELECT ae.entity_id, ae.article_id,
        (SELECT string_agg(sub.keyword, ' | ')
         FROM (
           SELECT keyword FROM keywords
           WHERE article_id = ae.article_id AND category = 'topic'
           ORDER BY relevance_score DESC LIMIT 5
         ) sub
        ) AS top_keywords
      FROM article_entities ae
      JOIN articles a ON a.id = ae.article_id AND a.excluded = false
      WHERE ae.entity_id = ANY(${sql.raw(`ARRAY[${ids.join(',')}]::int[]`)})
        AND a.published_at > NOW() - (INTERVAL '1 hour' * ${hours})
    `)
    for (const r of (catRes.rows ?? catRes) as any[]) {
      const entry = catMap.get(r.entity_id) || {}
      const c = classifyByKeywords(r.top_keywords)
      entry[c] = (entry[c] || 0) + 1
      catMap.set(r.entity_id, entry)
    }
  }

  // 24h hourly volume by category (keyword-based)
  const tlRes: any = await db.execute(sql`
    SELECT a.id AS article_id, date_trunc('hour', a.published_at) AS hour,
      (SELECT string_agg(sub.keyword, ' | ')
       FROM (
         SELECT keyword FROM keywords
         WHERE article_id = a.id AND category = 'topic'
         ORDER BY relevance_score DESC LIMIT 3
       ) sub
      ) AS top_keywords
    FROM articles a
    WHERE a.published_at > NOW() - INTERVAL '24 hours'
      AND a.excluded = false
  `)

  // Recent pings
  const pingRes: any = await db.execute(sql`
    SELECT DISTINCT ON (a.id)
      a.id AS article_id, a.title, a.published_at,
      f.name AS feed_name,
      e.name AS location_name, e.slug AS location_slug,
      c.sensationalism,
      (SELECT string_agg(sub.keyword, ' | ')
       FROM (
         SELECT keyword FROM keywords
         WHERE article_id = a.id AND category = 'topic'
         ORDER BY relevance_score DESC LIMIT 3
       ) sub
      ) AS top_keywords
    FROM articles a
    JOIN feeds f ON f.id = a.feed_id
    JOIN article_entities ae ON ae.article_id = a.id
    JOIN entities e ON e.id = ae.entity_id AND e.type = 'location' AND e.slug IS NOT NULL
    LEFT JOIN classifications c ON c.article_id = a.id
    WHERE a.published_at > NOW() - INTERVAL '24 hours'
      AND a.excluded = false
    ORDER BY a.id DESC, ae.relevance_score DESC
    LIMIT 15
  `)

  // Fetch cached coordinates for all hotspot names
  let coordMap = new Map<string, { lat: number; lon: number }>()
  if (rows.length > 0) {
    const names = rows.map((r: any) => r.name)
    const inClause = sql.join(names.map((n: string) => sql`${n}`), sql`, `)
    const geoRes: any = await db.execute(sql`
      SELECT name, lat, lon FROM geocache WHERE found = true AND name IN (${inClause})
    `)
    for (const r of (geoRes.rows ?? geoRes) as any[]) {
      if (r.lat !== null && r.lon !== null) {
        coordMap.set(r.name, { lat: r.lat, lon: r.lon })
      }
    }
  }

  // Compute scores first, then assign severity by percentile
  const days = Math.max(hours / 24, 1)
  const scored = rows.map(r => {
    const cats = catMap.get(r.id) || {}
    const a24 = Number(r.article_count_24h || 0)
    const total = Number(r.article_count || 0)
    const sens = Number(r.avg_sensationalism || 0)
    // Normalize total by window size so longer windows don't inflate scores
    const score = a24 * 3 + (total / days) * 1.5 + sens * 8
    const topCategory = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other'
    return { r, cats, a24, total, sens, score, topCategory }
  })

  // Percentile-based severity: ~10% critical, ~20% high, ~30% medium, ~40% low
  const sortedScores = scored.map(s => s.score).sort((a, b) => b - a)
  const p90 = sortedScores[Math.max(0, Math.floor(sortedScores.length * 0.1) - 1)] ?? 0
  const p70 = sortedScores[Math.max(0, Math.floor(sortedScores.length * 0.3) - 1)] ?? 0
  const p40 = sortedScores[Math.max(0, Math.floor(sortedScores.length * 0.6) - 1)] ?? 0

  const hotspots = scored.map(({ r, cats, a24, total, sens, score, topCategory }) => {
    let severity: 'critical' | 'high' | 'medium' | 'low' = 'low'
    if (sortedScores.length <= 4) {
      // Too few items for percentiles — use absolute thresholds
      if (score >= 20) severity = 'critical'
      else if (score >= 10) severity = 'high'
      else if (score >= 4) severity = 'medium'
    } else {
      if (score >= p90) severity = 'critical'
      else if (score >= p70) severity = 'high'
      else if (score >= p40) severity = 'medium'
    }
    const coords = coordMap.get(r.name)
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      shortDescription: r.short_description,
      imageUrl: r.image_url,
      mentionCount: Number(r.mention_count || 0),
      trendingScore: r.trending_score ? Number(r.trending_score) : 0,
      articleCount: total,
      articleCount24h: a24,
      lastMentioned: r.last_mentioned,
      avgBias: r.avg_bias !== null ? Number(r.avg_bias) : null,
      avgSensationalism: sens,
      avgPropaganda: r.avg_propaganda !== null ? Number(r.avg_propaganda) : null,
      categories: cats,
      topCategory,
      severity,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
    }
  })

  const bySev = hotspots.reduce((acc: any, h) => {
    acc[h.severity] = (acc[h.severity] || 0) + 1
    return acc
  }, { critical: 0, high: 0, medium: 0, low: 0 })

  const categoryTotals: Record<string, number> = {}
  for (const h of hotspots) {
    for (const [c, v] of Object.entries(h.categories)) {
      categoryTotals[c] = (categoryTotals[c] || 0) + (v as number)
    }
  }

  const hourMap: Record<string, Record<string, number>> = {}
  for (const r of (tlRes.rows ?? tlRes) as any[]) {
    const iso = new Date(r.hour).toISOString()
    const cat = classifyByKeywords(r.top_keywords)
    hourMap[iso] = hourMap[iso] || {}
    hourMap[iso][cat] = (hourMap[iso][cat] || 0) + 1
  }
  const timelineBuckets = Object.entries(hourMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, cats]) => ({ hour, ...cats }))

  return {
    hotspots,
    timeline: timelineBuckets,
    pings: ((pingRes.rows ?? pingRes) as any[]).map(p => ({
      articleId: p.article_id,
      title: p.title,
      publishedAt: p.published_at,
      feedName: p.feed_name,
      category: classifyByKeywords(p.top_keywords),
      locationName: p.location_name,
      locationSlug: p.location_slug,
      sensationalism: p.sensationalism ? Number(p.sensationalism) : null,
    })),
    stats: {
      hotspotCount: hotspots.length,
      critical: bySev.critical,
      high: bySev.high,
      medium: bySev.medium,
      low: bySev.low,
      categoryTotals,
      windowHours: hours,
    },
  }
})
