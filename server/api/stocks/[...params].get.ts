import { getDatabase } from '~/server/database/db'
import { stockWatchlist, stockPrices, stockNewsCorrelations, articleEntities, articles, entities } from '~/server/database/schema'
import { eq, desc, sql, and, gte } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const params = getRouterParam(event, 'params')
  const pathParts = params ? params.split('/') : []

  if (pathParts.length < 1) {
    throw createError({ statusCode: 400, message: 'Ticker required' })
  }

  const query = getQuery(event)
  const db = getDatabase()

  // ---- Global routes (not ticker-specific) ----
  if (pathParts[0] === 'recommendations') {
    return handleRecommendations(db, query)
  }
  if (pathParts[0] === 'signal-stats') {
    return handleSignalStats(db)
  }

  const ticker = pathParts[0].toUpperCase()
  const action = pathParts[1] || 'history'

  // Find watchlist entry with entity slug
  const watchlistResult = await db.select({
    id: stockWatchlist.id,
    ticker: stockWatchlist.ticker,
    companyName: stockWatchlist.companyName,
    exchange: stockWatchlist.exchange,
    sector: stockWatchlist.sector,
    entityId: stockWatchlist.entityId,
    entitySlug: entities.slug,
  })
    .from(stockWatchlist)
    .leftJoin(entities, eq(stockWatchlist.entityId, entities.id))
    .where(eq(stockWatchlist.ticker, ticker))
    .limit(1)

  const item = watchlistResult[0]
  if (!item) {
    throw createError({ statusCode: 404, message: `Ticker ${ticker} not found` })
  }

  if (action === 'history') {
    const days = parseInt(query.days as string || '30')
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const prices = await db.select({
      price: stockPrices.price,
      openPrice: stockPrices.openPrice,
      highPrice: stockPrices.highPrice,
      lowPrice: stockPrices.lowPrice,
      previousClose: stockPrices.previousClose,
      changeAmount: stockPrices.changeAmount,
      changePercent: stockPrices.changePercent,
      volume: stockPrices.volume,
      marketStatus: stockPrices.marketStatus,
      source: stockPrices.source,
      fetchedAt: stockPrices.fetchedAt,
    })
      .from(stockPrices)
      .where(and(
        eq(stockPrices.watchlistId, item.id),
        gte(stockPrices.fetchedAt, cutoff),
      ))
      .orderBy(desc(stockPrices.fetchedAt))

    return {
      ticker: item.ticker,
      companyName: item.companyName,
      sector: item.sector,
      exchange: item.exchange,
      entityId: item.entityId,
      entitySlug: item.entitySlug,
      prices,
    }
  }

  if (action === 'mentions') {
    if (!item.entityId) {
      return { ticker: item.ticker, mentions: [], entityId: null }
    }

    const days = parseInt(query.days as string || '30')
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const mentions = await db.select({
      articleId: articles.id,
      title: articles.title,
      publishedAt: articles.publishedAt,
      relevanceScore: articleEntities.relevanceScore,
      sentiment: articleEntities.sentiment,
    })
      .from(articleEntities)
      .innerJoin(articles, eq(articleEntities.articleId, articles.id))
      .where(and(
        eq(articleEntities.entityId, item.entityId),
        gte(articles.publishedAt, cutoff),
      ))
      .orderBy(desc(articles.publishedAt))
      .limit(50)

    return {
      ticker: item.ticker,
      entityId: item.entityId,
      mentions,
    }
  }

  if (action === 'people') {
    if (!item.entityId) {
      return { ticker: item.ticker, people: [], entityId: null }
    }

    const result = await db.execute(sql`
      SELECT
        e.id, e.name, e.slug,
        es.short_description, es.image_url, es.trending_score,
        er.cooccurrence_count,
        er.metadata->>'relationship_type' as relationship_type,
        er.metadata->>'role_label' as role_label,
        er.strength
      FROM entity_relationships er
      JOIN entities e ON (
        CASE WHEN er.source_entity_id = ${item.entityId}
          THEN er.target_entity_id ELSE er.source_entity_id END
      ) = e.id
      LEFT JOIN entity_summaries es ON e.id = es.entity_id
      WHERE (er.source_entity_id = ${item.entityId} OR er.target_entity_id = ${item.entityId})
        AND e.type = 'person'
        AND er.cooccurrence_count >= 3
        AND er.metadata IS NOT NULL
        AND er.metadata->>'stock_ticker' = ${item.ticker}
      ORDER BY
        CASE WHEN er.metadata->>'relationship_type' = 'executive' THEN 0
             WHEN er.metadata->>'relationship_type' = 'associated' THEN 1
             WHEN er.metadata->>'relationship_type' = 'political' THEN 2
             ELSE 3 END,
        er.cooccurrence_count DESC
      LIMIT 10
    `)

    return {
      ticker: item.ticker,
      entityId: item.entityId,
      people: result.rows.map((r: any) => ({
        id: parseInt(r.id),
        name: r.name,
        slug: r.slug,
        shortDescription: r.short_description,
        imageUrl: r.image_url,
        trendingScore: parseFloat(r.trending_score) || 0,
        coOccurrenceCount: parseInt(r.cooccurrence_count),
        relationshipType: r.relationship_type || 'associated',
        roleLabel: r.role_label || 'Associated',
        strength: parseFloat(r.strength),
      })),
    }
  }

  if (action === 'volume') {
    if (!item.entityId) {
      return { ticker: item.ticker, entityId: null, dailyVolume: [], anomalies: [] }
    }

    const days = parseInt(query.days as string || '90')
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    // Daily mention counts with source diversity
    const volumeResult = await db.execute(sql`
      SELECT
        DATE(a.published_at)::text as date,
        COUNT(DISTINCT ae.article_id)::int as mention_count,
        COUNT(DISTINCT a.feed_id)::int as source_count
      FROM article_entities ae
      JOIN articles a ON ae.article_id = a.id
      WHERE ae.entity_id = ${item.entityId}
        AND a.published_at >= ${cutoff}
        AND a.excluded = false
      GROUP BY DATE(a.published_at)
      ORDER BY date ASC
    `)

    // Anomaly events
    const anomalies = await db.select({
      eventType: stockNewsCorrelations.eventType,
      eventDate: stockNewsCorrelations.eventDate,
      mentionCountWindow: stockNewsCorrelations.mentionCountWindow,
      priceChangePercent: stockNewsCorrelations.priceChangePercent,
      confidence: stockNewsCorrelations.confidence,
      metadata: stockNewsCorrelations.metadata,
    })
      .from(stockNewsCorrelations)
      .where(and(
        eq(stockNewsCorrelations.watchlistId, item.id),
        gte(stockNewsCorrelations.eventDate, cutoff),
      ))
      .orderBy(desc(stockNewsCorrelations.eventDate))

    return {
      ticker: item.ticker,
      entityId: item.entityId,
      dailyVolume: volumeResult.rows.map((r: any) => ({
        date: r.date,
        mentionCount: parseInt(r.mention_count),
        sourceCount: parseInt(r.source_count),
      })),
      anomalies: anomalies.map(a => ({
        eventType: a.eventType,
        eventDate: a.eventDate,
        mentionCount: a.mentionCountWindow,
        priceChangePercent: a.priceChangePercent,
        confidence: a.confidence,
        metadata: a.metadata,
      })),
    }
  }

  if (action === 'signals') {
    // Active + recent recommendations for this ticker
    const signals = await db.execute(sql`
      SELECT
        r.id, r.signal_direction, r.signal_strength,
        r.short_term_direction, r.short_term_confidence, r.short_term_expected_change,
        r.medium_term_direction, r.medium_term_confidence, r.medium_term_expected_change,
        r.event_strength, r.historical_winrate, r.anomaly_confidence,
        r.source_diversity, r.mention_multiplier,
        r.event_type, r.event_date, r.trigger_metadata,
        r.status, r.expires_at,
        r.actual_change_5d, r.actual_change_4w, r.validated_at,
        r.created_at
      FROM stock_recommendations r
      WHERE r.watchlist_id = ${item.id}
      ORDER BY r.created_at DESC
      LIMIT 20
    `)

    return {
      ticker: item.ticker,
      companyName: item.companyName,
      entitySlug: item.entitySlug,
      signals: signals.rows.map((r: any) => ({
        id: parseInt(r.id),
        signalDirection: r.signal_direction,
        signalStrength: parseFloat(r.signal_strength),
        shortTerm: {
          direction: r.short_term_direction,
          confidence: parseFloat(r.short_term_confidence) || 0,
          expectedChange: parseFloat(r.short_term_expected_change) || null,
        },
        mediumTerm: {
          direction: r.medium_term_direction,
          confidence: parseFloat(r.medium_term_confidence) || 0,
          expectedChange: parseFloat(r.medium_term_expected_change) || null,
        },
        scoring: {
          eventStrength: parseFloat(r.event_strength) || 0,
          historicalWinrate: parseFloat(r.historical_winrate) || 0,
          anomalyConfidence: parseFloat(r.anomaly_confidence) || 0,
          sourceDiversity: parseFloat(r.source_diversity) || 0,
          mentionMultiplier: parseFloat(r.mention_multiplier) || 0,
        },
        eventType: r.event_type,
        eventDate: r.event_date,
        triggerMetadata: r.trigger_metadata,
        status: r.status,
        expiresAt: r.expires_at,
        actualChange5d: parseFloat(r.actual_change_5d) || null,
        actualChange4w: parseFloat(r.actual_change_4w) || null,
        validatedAt: r.validated_at,
        createdAt: r.created_at,
      })),
    }
  }

  if (action === 'profile') {
    const profiles = await db.execute(sql`
      SELECT
        sp.id, sp.event_type, sp.sample_count,
        sp.avg_change_1d, sp.avg_change_3d, sp.avg_change_5d,
        sp.avg_change_1w, sp.avg_change_2w, sp.avg_change_4w,
        sp.win_rate_1d, sp.win_rate_3d, sp.win_rate_5d,
        sp.win_rate_1w, sp.win_rate_2w, sp.win_rate_4w,
        sp.stddev_5d, sp.stddev_4w,
        sp.avg_alpha_5d, sp.avg_alpha_4w,
        sp.profile_confidence
      FROM stock_signal_profiles sp
      WHERE sp.watchlist_id = ${item.id}
      ORDER BY sp.sample_count DESC
    `)

    return {
      ticker: item.ticker,
      companyName: item.companyName,
      entitySlug: item.entitySlug,
      profiles: profiles.rows.map((r: any) => ({
        id: parseInt(r.id),
        eventType: r.event_type,
        sampleCount: parseInt(r.sample_count),
        avgChange: {
          '1d': parseFloat(r.avg_change_1d) || null,
          '3d': parseFloat(r.avg_change_3d) || null,
          '5d': parseFloat(r.avg_change_5d) || null,
          '1w': parseFloat(r.avg_change_1w) || null,
          '2w': parseFloat(r.avg_change_2w) || null,
          '4w': parseFloat(r.avg_change_4w) || null,
        },
        winRate: {
          '1d': parseFloat(r.win_rate_1d) || null,
          '3d': parseFloat(r.win_rate_3d) || null,
          '5d': parseFloat(r.win_rate_5d) || null,
          '1w': parseFloat(r.win_rate_1w) || null,
          '2w': parseFloat(r.win_rate_2w) || null,
          '4w': parseFloat(r.win_rate_4w) || null,
        },
        stddev5d: parseFloat(r.stddev_5d) || null,
        stddev4w: parseFloat(r.stddev_4w) || null,
        alpha5d: parseFloat(r.avg_alpha_5d) || null,
        alpha4w: parseFloat(r.avg_alpha_4w) || null,
        profileConfidence: parseFloat(r.profile_confidence) || 0,
      })),
    }
  }

  throw createError({ statusCode: 400, message: `Unknown action: ${action}` })
})

// ---- Handler: GET /api/stocks/recommendations ----
async function handleRecommendations(db: any, query: any) {
  const sector = query.sector as string | undefined
  const status = (query.status as string) || 'active'
  const limit = Math.min(parseInt(query.limit as string || '30'), 100)

  const sectorFilter = sector ? sql`AND sw.sector = ${sector}` : sql``
  const statusFilter = status === 'all' ? sql`` : sql`AND r.status = ${status}`

  const result = await db.execute(sql`
    SELECT
      r.id, r.watchlist_id, r.correlation_id,
      r.signal_direction, r.signal_strength,
      r.short_term_direction, r.short_term_confidence, r.short_term_expected_change,
      r.medium_term_direction, r.medium_term_confidence, r.medium_term_expected_change,
      r.event_strength, r.historical_winrate, r.anomaly_confidence,
      r.source_diversity, r.mention_multiplier,
      r.event_type, r.event_date, r.trigger_metadata,
      r.status, r.expires_at,
      r.actual_change_5d, r.actual_change_4w, r.validated_at, r.created_at,
      sw.ticker, sw.company_name, sw.sector, sw.exchange,
      e.slug as entity_slug,
      lp.price as current_price, lp.change_percent as current_change_percent
    FROM stock_recommendations r
    JOIN stock_watchlist sw ON sw.id = r.watchlist_id
    LEFT JOIN entities e ON sw.entity_id = e.id
    LEFT JOIN LATERAL (
      SELECT price, change_percent FROM stock_prices
      WHERE watchlist_id = r.watchlist_id ORDER BY fetched_at DESC LIMIT 1
    ) lp ON true
    WHERE 1=1 ${statusFilter} ${sectorFilter}
    ORDER BY r.signal_strength DESC, r.created_at DESC
    LIMIT ${limit}
  `)

  return {
    recommendations: result.rows.map((r: any) => ({
      id: parseInt(r.id),
      watchlistId: parseInt(r.watchlist_id),
      correlationId: parseInt(r.correlation_id),
      signalDirection: r.signal_direction,
      signalStrength: parseFloat(r.signal_strength),
      shortTerm: {
        direction: r.short_term_direction,
        confidence: parseFloat(r.short_term_confidence) || 0,
        expectedChange: parseFloat(r.short_term_expected_change) || null,
      },
      mediumTerm: {
        direction: r.medium_term_direction,
        confidence: parseFloat(r.medium_term_confidence) || 0,
        expectedChange: parseFloat(r.medium_term_expected_change) || null,
      },
      scoring: {
        eventStrength: parseFloat(r.event_strength) || 0,
        historicalWinrate: parseFloat(r.historical_winrate) || 0,
        anomalyConfidence: parseFloat(r.anomaly_confidence) || 0,
        sourceDiversity: parseFloat(r.source_diversity) || 0,
        mentionMultiplier: parseFloat(r.mention_multiplier) || 0,
      },
      eventType: r.event_type,
      eventDate: r.event_date,
      triggerMetadata: r.trigger_metadata,
      status: r.status,
      expiresAt: r.expires_at,
      actualChange5d: parseFloat(r.actual_change_5d) || null,
      actualChange4w: parseFloat(r.actual_change_4w) || null,
      validatedAt: r.validated_at,
      createdAt: r.created_at,
      ticker: r.ticker,
      companyName: r.company_name,
      sector: r.sector,
      exchange: r.exchange,
      entitySlug: r.entity_slug,
      currentPrice: parseFloat(r.current_price) || null,
      currentChangePercent: parseFloat(r.current_change_percent) || null,
    })),
    count: result.rows.length,
  }
}

// ---- Handler: GET /api/stocks/signal-stats ----
async function handleSignalStats(db: any) {
  const overallResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_signals,
      COUNT(*) FILTER (WHERE status = 'validated')::int as validated_count,
      COUNT(*) FILTER (WHERE status = 'active')::int as active_count,
      AVG(CASE
        WHEN status = 'validated' AND actual_change_5d IS NOT NULL THEN
          CASE
            WHEN signal_direction = 'bullish' AND actual_change_5d > 0 THEN 1.0
            WHEN signal_direction = 'bearish' AND actual_change_5d < 0 THEN 1.0
            WHEN signal_direction = 'neutral' THEN NULL
            ELSE 0.0
          END
        ELSE NULL
      END) as win_rate_5d,
      AVG(CASE
        WHEN status = 'validated' AND actual_change_4w IS NOT NULL THEN
          CASE
            WHEN signal_direction = 'bullish' AND actual_change_4w > 0 THEN 1.0
            WHEN signal_direction = 'bearish' AND actual_change_4w < 0 THEN 1.0
            WHEN signal_direction = 'neutral' THEN NULL
            ELSE 0.0
          END
        ELSE NULL
      END) as win_rate_4w,
      AVG(actual_change_5d) FILTER (WHERE status = 'validated' AND actual_change_5d IS NOT NULL) as avg_return_5d,
      AVG(actual_change_4w) FILTER (WHERE status = 'validated' AND actual_change_4w IS NOT NULL) as avg_return_4w,
      AVG(signal_strength) as avg_signal_strength
    FROM stock_recommendations
  `)

  const eventTypeResult = await db.execute(sql`
    SELECT
      event_type, COUNT(*)::int as count,
      COUNT(*) FILTER (WHERE status = 'validated')::int as validated,
      AVG(signal_strength) as avg_strength,
      AVG(actual_change_5d) FILTER (WHERE status = 'validated') as avg_return_5d,
      AVG(CASE
        WHEN status = 'validated' AND actual_change_5d IS NOT NULL THEN
          CASE
            WHEN signal_direction = 'bullish' AND actual_change_5d > 0 THEN 1.0
            WHEN signal_direction = 'bearish' AND actual_change_5d < 0 THEN 1.0
            WHEN signal_direction = 'neutral' THEN NULL
            ELSE 0.0
          END
        ELSE NULL
      END) as win_rate
    FROM stock_recommendations
    GROUP BY event_type ORDER BY count DESC
  `)

  const tickerResult = await db.execute(sql`
    SELECT sw.ticker, sw.company_name, COUNT(*)::int as signal_count,
      AVG(r.actual_change_5d) as avg_return_5d,
      AVG(CASE
        WHEN r.signal_direction = 'bullish' AND r.actual_change_5d > 0 THEN 1.0
        WHEN r.signal_direction = 'bearish' AND r.actual_change_5d < 0 THEN 1.0
        WHEN r.signal_direction = 'neutral' THEN NULL
        ELSE 0.0
      END) as win_rate
    FROM stock_recommendations r
    JOIN stock_watchlist sw ON sw.id = r.watchlist_id
    WHERE r.status = 'validated' AND r.actual_change_5d IS NOT NULL
    GROUP BY sw.ticker, sw.company_name
    HAVING COUNT(*) >= 2
    ORDER BY AVG(r.actual_change_5d) DESC
  `)

  const profileResult = await db.execute(sql`
    SELECT COUNT(DISTINCT watchlist_id)::int as tickers_with_profiles,
      COUNT(*)::int as total_profiles,
      AVG(sample_count) as avg_sample_count,
      AVG(profile_confidence) as avg_confidence
    FROM stock_signal_profiles
  `)

  const overall = overallResult.rows[0] as any
  const profileStats = profileResult.rows[0] as any

  return {
    overall: {
      totalSignals: parseInt(overall?.total_signals) || 0,
      validatedCount: parseInt(overall?.validated_count) || 0,
      activeCount: parseInt(overall?.active_count) || 0,
      winRate5d: parseFloat(overall?.win_rate_5d) || null,
      winRate4w: parseFloat(overall?.win_rate_4w) || null,
      avgReturn5d: parseFloat(overall?.avg_return_5d) || null,
      avgReturn4w: parseFloat(overall?.avg_return_4w) || null,
      avgSignalStrength: parseFloat(overall?.avg_signal_strength) || 0,
    },
    byEventType: eventTypeResult.rows.map((r: any) => ({
      eventType: r.event_type,
      count: parseInt(r.count),
      validated: parseInt(r.validated),
      avgStrength: parseFloat(r.avg_strength) || 0,
      avgReturn5d: parseFloat(r.avg_return_5d) || null,
      winRate: parseFloat(r.win_rate) || null,
    })),
    tickers: tickerResult.rows.map((r: any) => ({
      ticker: r.ticker,
      companyName: r.company_name,
      signalCount: parseInt(r.signal_count),
      avgReturn5d: parseFloat(r.avg_return_5d) || null,
      winRate: parseFloat(r.win_rate) || null,
    })),
    profiles: {
      tickersWithProfiles: parseInt(profileStats?.tickers_with_profiles) || 0,
      totalProfiles: parseInt(profileStats?.total_profiles) || 0,
      avgSampleCount: parseFloat(profileStats?.avg_sample_count) || 0,
      avgConfidence: parseFloat(profileStats?.avg_confidence) || 0,
    },
  }
}
