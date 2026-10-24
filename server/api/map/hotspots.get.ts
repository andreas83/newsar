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

  // Activity: last 24 clock hours (current hour partial) + the 24h before for comparison.
  // published_at is a naive timestamp holding UTC; read it as UTC explicitly, since both the
  // session TimeZone and node-pg would otherwise interpret it as server-local time.
  const nowMs = Date.now()
  const HOUR = 3600_000
  const winStart = Math.floor(nowMs / HOUR) * HOUR - 23 * HOUR
  const prevStart = winStart - 24 * HOUR
  const actRes: any = await db.execute(sql`
    SELECT a.id AS article_id, a.title, f.name AS feed_name,
      (EXTRACT(EPOCH FROM a.published_at AT TIME ZONE 'UTC') * 1000)::float8 AS published_ms,
      (SELECT string_agg(sub.keyword, ' | ')
       FROM (
         SELECT keyword FROM keywords
         WHERE article_id = a.id AND category = 'topic'
         ORDER BY relevance_score DESC LIMIT 3
       ) sub
      ) AS top_keywords
    FROM articles a
    JOIN feeds f ON f.id = a.feed_id
    WHERE a.published_at >= (${new Date(prevStart).toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND a.published_at <= (NOW() AT TIME ZONE 'UTC')
      AND a.excluded = false
  `)
  const actRows = (actRes.rows ?? actRes) as any[]
  const actIds = actRows.map(r => r.article_id)

  // Location mentions for those articles, most relevant first
  const placesByArticle = new Map<number, Array<{ id: number; name: string; slug: string }>>()
  if (actIds.length > 0) {
    const locRes: any = await db.execute(sql`
      SELECT ae.article_id, e.id, e.name, e.slug
      FROM article_entities ae
      JOIN entities e ON e.id = ae.entity_id AND e.type = 'location' AND e.slug IS NOT NULL
      WHERE ae.article_id = ANY(${sql.raw(`ARRAY[${actIds.join(',')}]::int[]`)})
      ORDER BY ae.article_id, ae.relevance_score DESC NULLS LAST
    `)
    for (const r of (locRes.rows ?? locRes) as any[]) {
      const list = placesByArticle.get(r.article_id) || []
      if (!list.some(p => p.id === r.id)) list.push({ id: r.id, name: r.name, slug: r.slug })
      placesByArticle.set(r.article_id, list)
    }
  }

  // Articles without topic keywords haven't been analyzed yet — keep them apart from 'other'
  const categoryOf = (kw: string | null) => kw ? classifyByKeywords(kw) : 'pending'
  const hourBuckets = Array.from({ length: 24 }, (_, i) => ({
    hour: new Date(winStart + i * HOUR).toISOString(),
    total: 0,
    prev: 0,
    partial: i === 23,
    cats: {} as Record<string, number>,
    prevCats: {} as Record<string, number>,
  }))
  const catCur: Record<string, number> = {}
  const catPrev: Record<string, number> = {}
  const placeAgg = new Map<number, { id: number; name: string; slug: string; n: number; prev: number; hours: number[] }>()
  const activityArticles: any[] = []
  for (const r of actRows) {
    const t = Number(r.published_ms)
    const cat = categoryOf(r.top_keywords)
    const places = placesByArticle.get(r.article_id) || []
    if (t >= winStart) {
      const i = Math.min(23, Math.floor((t - winStart) / HOUR))
      const b = hourBuckets[i]!
      b.total++
      b.cats[cat] = (b.cats[cat] || 0) + 1
      catCur[cat] = (catCur[cat] || 0) + 1
      for (const p of places) {
        const agg = placeAgg.get(p.id) || { ...p, n: 0, prev: 0, hours: new Array(24).fill(0) }
        agg.n++
        agg.hours[i]++
        placeAgg.set(p.id, agg)
      }
      activityArticles.push({
        articleId: r.article_id,
        title: r.title,
        publishedAt: new Date(t).toISOString(),
        feedName: r.feed_name,
        category: cat,
        hourIndex: i,
        places: places.slice(0, 3).map(p => ({ name: p.name, slug: p.slug })),
      })
    } else if (t < nowMs - 24 * HOUR) {
      // Same elapsed slice one day earlier, so the partial current hour compares like-for-like
      const i = Math.floor((t - prevStart) / HOUR)
      const pb = hourBuckets[i]!
      pb.prev++
      pb.prevCats[cat] = (pb.prevCats[cat] || 0) + 1
      catPrev[cat] = (catPrev[cat] || 0) + 1
      for (const p of places) {
        const agg = placeAgg.get(p.id) || { ...p, n: 0, prev: 0, hours: new Array(24).fill(0) }
        agg.prev++
        placeAgg.set(p.id, agg)
      }
    }
  }
  activityArticles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const activity = {
    windowStart: new Date(winStart).toISOString(),
    generatedAt: new Date(nowMs).toISOString(),
    total: hourBuckets.reduce((s, b) => s + b.total, 0),
    prevTotal: hourBuckets.reduce((s, b) => s + b.prev, 0),
    hours: hourBuckets,
    categories: Object.fromEntries(
      [...new Set([...Object.keys(catCur), ...Object.keys(catPrev)])]
        .map(c => [c, { n: catCur[c] || 0, prev: catPrev[c] || 0 }])
    ),
    places: [...placeAgg.values()]
      .filter(p => p.n > 0)
      .sort((a, b) => b.n - a.n || (b.n - b.prev) - (a.n - a.prev))
      .slice(0, 10),
    placeCount: [...placeAgg.values()].filter(p => p.n > 0).length,
    articles: activityArticles.slice(0, 400),
  }

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

  return {
    hotspots,
    activity,
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
