/**
 * BTC Feature Builder
 *
 * Computes daily feature rows for ML training. Unlike stocks which use anomaly events
 * as rows, BTC uses calendar days. Each row has ~40 features from:
 * - Technical indicators (from btc_prices)
 * - Macro news sentiment (from articles + article_entities + entities)
 * - Calendar events (from btc_calendar_events)
 * - Market regime (from stock_prices SPY data)
 * - Temporal features
 */

import { getDatabase } from '../database/db'
import { sql } from 'drizzle-orm'
import { entitySentimentAvg } from '../utils/entitySentiment'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PriceRow {
  price: number
  open_price: number | null
  high_price: number | null
  low_price: number | null
  volume_24h: number | null
  fetched_at: string
}

interface FeatureRow {
  // Technical (12)
  rsi_14: number | null
  sma_ratio_20: number | null
  sma_ratio_50: number | null
  volatility_20d: number | null
  bollinger_pct_b: number | null
  volume_ratio: number | null
  volume_trend_5d: number | null
  return_1d: number | null
  return_3d: number | null
  return_7d: number | null
  return_14d: number | null
  atr_14: number | null

  // Macro news sentiment (8)
  geopolitical_tension_score: number | null
  fed_mention_count: number | null
  fed_sentiment: number | null
  trump_mention_count: number | null
  trump_sentiment: number | null
  crypto_mention_count: number | null
  crypto_sentiment: number | null
  overall_news_fear: number | null

  // Calendar events (10)
  is_fomc_week: number
  is_fomc_day: number
  is_us_holiday: number
  days_to_tax_deadline: number | null
  is_options_expiry_week: number
  is_election_month: number
  is_cpi_week: number
  is_weekend: number
  is_quarter_end: number
  days_since_halving: number

  // Market regime (4)
  spy_5d_return: number | null
  spy_20d_return: number | null
  spy_volatility_20d: number | null
  btc_spy_correlation_30d: number | null

  // Temporal (4)
  day_of_week: number
  month: number
  is_earnings_season: number
  // is_weekend already in calendar section
}

// ─── Technical indicator helpers ─────────────────────────────────────────────

function computeRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null

  let avgGain = 0
  let avgLoss = 0

  // Initial average gain/loss over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= period
  avgLoss /= period

  // Smooth using Wilder's method for remaining data
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period
      avgLoss = (avgLoss * (period - 1)) / period
    } else {
      avgGain = (avgGain * (period - 1)) / period
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period
    }
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function computeSMA(values: number[], period: number): number | null {
  if (values.length < period) return null
  const slice = values.slice(values.length - period)
  return slice.reduce((s, v) => s + v, 0) / period
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function computeDailyReturns(closes: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1])
    } else {
      returns.push(0)
    }
  }
  return returns
}

function computeATR(prices: PriceRow[], period: number = 14): number | null {
  if (prices.length < period + 1) return null

  const trueRanges: number[] = []
  for (let i = 1; i < prices.length; i++) {
    const high = prices[i].high_price ?? prices[i].price
    const low = prices[i].low_price ?? prices[i].price
    const prevClose = prices[i - 1].price

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
    trueRanges.push(tr)
  }

  if (trueRanges.length < period) return null

  // Simple average of last `period` true ranges
  const slice = trueRanges.slice(trueRanges.length - period)
  return slice.reduce((s, v) => s + v, 0) / period
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 5) return null

  const xSlice = xs.slice(xs.length - n)
  const ySlice = ys.slice(ys.length - n)

  const xMean = xSlice.reduce((s, v) => s + v, 0) / n
  const yMean = ySlice.reduce((s, v) => s + v, 0) / n

  let num = 0, denomX = 0, denomY = 0
  for (let i = 0; i < n; i++) {
    const dx = xSlice[i] - xMean
    const dy = ySlice[i] - yMean
    num += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  const denom = Math.sqrt(denomX * denomY)
  if (denom === 0) return null
  return num / denom
}

// ─── Feature computation ─────────────────────────────────────────────────────

/**
 * Compute technical features from btc_prices for a given date.
 * Queries last 50 days of daily prices before and including the target date.
 */
async function computeTechnicalFeatures(dateStr: string): Promise<Partial<FeatureRow>> {
  const result = await getDb().execute(sql`
    SELECT DISTINCT ON (DATE(fetched_at))
      price,
      open_price,
      high_price,
      low_price,
      volume_24h,
      fetched_at::text as fetched_at
    FROM btc_prices
    WHERE DATE(fetched_at) <= ${dateStr}::date
    ORDER BY DATE(fetched_at) DESC, fetched_at DESC
    LIMIT 55
  `)

  const rows = (result.rows as any[]).map(r => ({
    price: parseFloat(r.price),
    open_price: r.open_price != null ? parseFloat(r.open_price) : null,
    high_price: r.high_price != null ? parseFloat(r.high_price) : null,
    low_price: r.low_price != null ? parseFloat(r.low_price) : null,
    volume_24h: r.volume_24h != null ? parseFloat(r.volume_24h) : null,
    fetched_at: r.fetched_at,
  })) as PriceRow[]

  // Rows are newest-first from the query; reverse to chronological order
  rows.reverse()

  if (rows.length < 2) {
    return {
      rsi_14: null, sma_ratio_20: null, sma_ratio_50: null,
      volatility_20d: null, bollinger_pct_b: null, volume_ratio: null,
      volume_trend_5d: null, return_1d: null, return_3d: null,
      return_7d: null, return_14d: null, atr_14: null,
    }
  }

  const closes = rows.map(r => r.price)
  const volumes = rows.map(r => r.volume_24h).filter(v => v != null) as number[]
  const currentPrice = closes[closes.length - 1]

  // Returns
  const return_1d = closes.length >= 2
    ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]
    : null
  const return_3d = closes.length >= 4
    ? (closes[closes.length - 1] - closes[closes.length - 4]) / closes[closes.length - 4]
    : null
  const return_7d = closes.length >= 8
    ? (closes[closes.length - 1] - closes[closes.length - 8]) / closes[closes.length - 8]
    : null
  const return_14d = closes.length >= 15
    ? (closes[closes.length - 1] - closes[closes.length - 15]) / closes[closes.length - 15]
    : null

  // RSI
  const rsi_14 = computeRSI(closes, 14)

  // SMA ratios
  const sma20 = computeSMA(closes, 20)
  const sma50 = computeSMA(closes, 50)
  const sma_ratio_20 = sma20 != null && sma20 > 0 ? currentPrice / sma20 : null
  const sma_ratio_50 = sma50 != null && sma50 > 0 ? currentPrice / sma50 : null

  // Volatility (stddev of daily returns over last 20 days)
  const dailyReturns = computeDailyReturns(closes)
  const last20Returns = dailyReturns.slice(Math.max(0, dailyReturns.length - 20))
  const volatility_20d = last20Returns.length >= 10 ? computeStdDev(last20Returns) : null

  // Bollinger %B: (price - lower) / (upper - lower)
  // where upper/lower = SMA20 +/- 2*stddev
  let bollinger_pct_b: number | null = null
  if (sma20 != null && volatility_20d != null && volatility_20d > 0) {
    // Need stddev of prices (not returns) for traditional Bollinger
    const last20Prices = closes.slice(Math.max(0, closes.length - 20))
    const priceStdDev = computeStdDev(last20Prices)
    const upper = sma20 + 2 * priceStdDev
    const lower = sma20 - 2 * priceStdDev
    if (upper !== lower) {
      bollinger_pct_b = (currentPrice - lower) / (upper - lower)
    }
  }

  // Volume ratio (current vs 20d average)
  let volume_ratio: number | null = null
  if (volumes.length >= 20) {
    const last20Volumes = volumes.slice(volumes.length - 20)
    const avgVol = last20Volumes.reduce((s, v) => s + v, 0) / 20
    const currentVol = volumes[volumes.length - 1]
    volume_ratio = avgVol > 0 ? currentVol / avgVol : null
  }

  // Volume trend 5d: slope of last 5 volume values (normalized)
  let volume_trend_5d: number | null = null
  if (volumes.length >= 5) {
    const last5 = volumes.slice(volumes.length - 5)
    const avgLast5 = last5.reduce((s, v) => s + v, 0) / 5
    const first2Avg = (last5[0] + last5[1]) / 2
    const last2Avg = (last5[3] + last5[4]) / 2
    volume_trend_5d = first2Avg > 0 ? (last2Avg - first2Avg) / first2Avg : null
  }

  // ATR
  const atr_14 = computeATR(rows, 14)

  return {
    rsi_14: rsi_14 != null ? +rsi_14.toFixed(4) : null,
    sma_ratio_20: sma_ratio_20 != null ? +sma_ratio_20.toFixed(6) : null,
    sma_ratio_50: sma_ratio_50 != null ? +sma_ratio_50.toFixed(6) : null,
    volatility_20d: volatility_20d != null ? +volatility_20d.toFixed(6) : null,
    bollinger_pct_b: bollinger_pct_b != null ? +bollinger_pct_b.toFixed(4) : null,
    volume_ratio: volume_ratio != null ? +volume_ratio.toFixed(4) : null,
    volume_trend_5d: volume_trend_5d != null ? +volume_trend_5d.toFixed(4) : null,
    return_1d: return_1d != null ? +return_1d.toFixed(6) : null,
    return_3d: return_3d != null ? +return_3d.toFixed(6) : null,
    return_7d: return_7d != null ? +return_7d.toFixed(6) : null,
    return_14d: return_14d != null ? +return_14d.toFixed(6) : null,
    atr_14: atr_14 != null ? +atr_14.toFixed(2) : null,
  }
}

// Both storage formats, shared with the rest of the app.
const ENTITY_SENTIMENT_AVG = sql`${entitySentimentAvg('ae')}::float`

/**
 * Compute macro news sentiment features for a given date.
 * Queries articles + article_entities + entities for entity-based sentiment signals.
 */
async function computeMacroSentimentFeatures(dateStr: string): Promise<Partial<FeatureRow>> {
  // ── Geopolitical tension score ──
  // Count articles mentioning war/conflict entities on target date
  const geoResult = await getDb().execute(sql`
    SELECT COUNT(DISTINCT ae.article_id)::int as cnt
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND (e.name ILIKE '%war%' OR e.name ILIKE '%conflict%' OR e.name ILIKE '%nato%'
           OR e.name ILIKE '%military%' OR e.name ILIKE '%ukraine%' OR e.name ILIKE '%iran%')
  `)
  const geoCnt = parseInt((geoResult.rows[0] as any)?.cnt) || 0

  // 30-day baseline for geopolitical mentions
  const geoBaselineResult = await getDb().execute(sql`
    SELECT COALESCE(COUNT(DISTINCT ae.article_id)::float / 30, 0) as avg_daily
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE a.published_at >= (${dateStr}::date - interval '30 days')
      AND a.published_at < ${dateStr}::date
      AND a.excluded = false
      AND (e.name ILIKE '%war%' OR e.name ILIKE '%conflict%' OR e.name ILIKE '%nato%'
           OR e.name ILIKE '%military%' OR e.name ILIKE '%ukraine%' OR e.name ILIKE '%iran%')
  `)
  const geoBaseline = parseFloat((geoBaselineResult.rows[0] as any)?.avg_daily) || 0
  const geopolitical_tension_score = geoBaseline > 0 ? geoCnt / geoBaseline : (geoCnt > 0 ? 2.0 : 0)

  // ── Fed mentions and sentiment ──
  const fedResult = await getDb().execute(sql`
    SELECT
      COUNT(DISTINCT ae.article_id)::int as cnt,
      ${ENTITY_SENTIMENT_AVG} as avg_sent
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND (e.name = 'Federal Reserve' OR e.name = 'Fed'
           OR e.name ILIKE '%federal reserve%')
  `)
  const fed_mention_count = parseInt((fedResult.rows[0] as any)?.cnt) || 0
  const fed_sentiment = (fedResult.rows[0] as any)?.avg_sent != null
    ? +parseFloat((fedResult.rows[0] as any).avg_sent).toFixed(4)
    : null

  // ── Trump mentions and sentiment ──
  const trumpResult = await getDb().execute(sql`
    SELECT
      COUNT(DISTINCT ae.article_id)::int as cnt,
      ${ENTITY_SENTIMENT_AVG} as avg_sent
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND (e.name = 'Donald Trump' OR e.name = 'Trump'
           OR e.name ILIKE '%donald trump%')
  `)
  const trump_mention_count = parseInt((trumpResult.rows[0] as any)?.cnt) || 0
  const trump_sentiment = (trumpResult.rows[0] as any)?.avg_sent != null
    ? +parseFloat((trumpResult.rows[0] as any).avg_sent).toFixed(4)
    : null

  // ── Crypto mentions and sentiment ──
  const cryptoResult = await getDb().execute(sql`
    SELECT
      COUNT(DISTINCT ae.article_id)::int as cnt,
      ${ENTITY_SENTIMENT_AVG} as avg_sent
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    JOIN entities e ON e.id = ae.entity_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND (e.name = 'Bitcoin' OR e.name = 'Cryptocurrency'
           OR e.name ILIKE '%bitcoin%' OR e.name ILIKE '%crypto%')
      -- 'Crypto.com Arena' is a basketball venue, not crypto news
      AND e.name NOT ILIKE '%crypto.com arena%'
  `)
  const crypto_mention_count = parseInt((cryptoResult.rows[0] as any)?.cnt) || 0
  const crypto_sentiment = (cryptoResult.rows[0] as any)?.avg_sent != null
    ? +parseFloat((cryptoResult.rows[0] as any).avg_sent).toFixed(4)
    : null

  // ── Overall news fear ──
  // Percentage of articles with negative sentiment on that day
  const fearResult = await getDb().execute(sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE an.sentiment < -0.2)::int as negative_cnt
    FROM analyses an
    JOIN articles a ON a.id = an.article_id
    WHERE DATE(a.published_at) = ${dateStr}::date
      AND a.excluded = false
      AND an.sentiment IS NOT NULL
  `)
  const totalArticles = parseInt((fearResult.rows[0] as any)?.total) || 0
  const negativeCnt = parseInt((fearResult.rows[0] as any)?.negative_cnt) || 0
  const overall_news_fear = totalArticles > 0
    ? +(negativeCnt / totalArticles).toFixed(4)
    : null

  return {
    geopolitical_tension_score: +geopolitical_tension_score.toFixed(4),
    fed_mention_count,
    fed_sentiment,
    trump_mention_count,
    trump_sentiment,
    crypto_mention_count,
    crypto_sentiment,
    overall_news_fear,
  }
}

/**
 * Compute calendar event features for a given date.
 * Queries btc_calendar_events for events near the target date.
 */
async function computeCalendarFeatures(dateStr: string): Promise<Partial<FeatureRow>> {
  // Query calendar events within a +-7 day window
  const calResult = await getDb().execute(sql`
    SELECT event_type, event_date::text as event_date
    FROM btc_calendar_events
    WHERE event_date >= (${dateStr}::date - interval '7 days')
      AND event_date <= (${dateStr}::date + interval '7 days')
  `)

  const events = (calResult.rows as any[]).map(r => ({
    eventType: r.event_type as string,
    eventDate: r.event_date.substring(0, 10),
  }))

  const targetDateObj = new Date(dateStr + 'T00:00:00Z')
  const dayOfWeek = targetDateObj.getUTCDay() // 0=Sun, 6=Sat

  // FOMC
  const fomcEvents = events.filter(e => e.eventType === 'fomc')
  const is_fomc_day = fomcEvents.some(e => e.eventDate === dateStr) ? 1 : 0
  const is_fomc_week = fomcEvents.length > 0 ? 1 : 0

  // US Holiday
  const holidayEvents = events.filter(e => e.eventType === 'us_holiday')
  const is_us_holiday = holidayEvents.some(e => e.eventDate === dateStr) ? 1 : 0

  // Tax deadline (April 15 each year)
  const year = targetDateObj.getUTCFullYear()
  const taxDeadline = new Date(Date.UTC(year, 3, 15)) // April 15
  const diffMs = taxDeadline.getTime() - targetDateObj.getTime()
  const days_to_tax_deadline = Math.round(diffMs / (1000 * 60 * 60 * 24))

  // Options expiry week (third Friday of each month is monthly BTC options expiry)
  // Check if the target date falls within Mon-Fri of the week containing the third Friday
  const monthStart = new Date(Date.UTC(targetDateObj.getUTCFullYear(), targetDateObj.getUTCMonth(), 1))
  const firstDayOfWeek = monthStart.getUTCDay()
  // Third Friday: first Friday + 14 days
  const firstFriday = firstDayOfWeek <= 5
    ? 1 + ((5 - firstDayOfWeek + 7) % 7)
    : 1 + ((5 - firstDayOfWeek + 7) % 7)
  const thirdFriday = firstFriday + 14
  const thirdFridayDate = new Date(Date.UTC(targetDateObj.getUTCFullYear(), targetDateObj.getUTCMonth(), thirdFriday))
  // Expiry week = Mon through Fri containing thirdFriday
  const expiryWeekMonday = new Date(thirdFridayDate)
  expiryWeekMonday.setUTCDate(thirdFridayDate.getUTCDate() - 4) // Friday - 4 = Monday
  const expiryWeekFriday = thirdFridayDate
  const is_options_expiry_week = (targetDateObj >= expiryWeekMonday && targetDateObj <= expiryWeekFriday) ? 1 : 0

  // Election month (November of election years: 2024, 2028, etc.)
  const month = targetDateObj.getUTCMonth() + 1 // 1-12
  const isElectionYear = year % 4 === 0
  const is_election_month = (isElectionYear && month === 11) ? 1 : 0

  // CPI week
  const cpiEvents = events.filter(e => e.eventType === 'cpi')
  const is_cpi_week = cpiEvents.length > 0 ? 1 : 0

  // Weekend
  const is_weekend = (dayOfWeek === 0 || dayOfWeek === 6) ? 1 : 0

  // Quarter end (last 3 days of quarter)
  const quarterEndMonth = Math.ceil(month / 3) * 3 // 3, 6, 9, 12
  const isQuarterEndMonth = month === quarterEndMonth
  const dayOfMonth = targetDateObj.getUTCDate()
  const daysInMonth = new Date(Date.UTC(year, targetDateObj.getUTCMonth() + 1, 0)).getUTCDate()
  const is_quarter_end = (isQuarterEndMonth && dayOfMonth >= daysInMonth - 2) ? 1 : 0

  // Days since halving (last halving: April 20, 2024)
  const lastHalving = new Date(Date.UTC(2024, 3, 20)) // April 20, 2024
  const daysSinceHalving = Math.round((targetDateObj.getTime() - lastHalving.getTime()) / (1000 * 60 * 60 * 24))
  // If date is before halving, use previous halving cycle (~1460 days)
  const days_since_halving = daysSinceHalving >= 0 ? daysSinceHalving : daysSinceHalving + 1460

  return {
    is_fomc_week,
    is_fomc_day,
    is_us_holiday,
    days_to_tax_deadline,
    is_options_expiry_week,
    is_election_month,
    is_cpi_week,
    is_weekend,
    is_quarter_end,
    days_since_halving,
  }
}

/**
 * Compute market regime features from SPY data in stock_prices.
 */
async function computeMarketRegimeFeatures(dateStr: string): Promise<Partial<FeatureRow>> {
  // Get SPY prices from stock_prices joined with stock_watchlist
  const spyResult = await getDb().execute(sql`
    SELECT DISTINCT ON (DATE(sp.fetched_at))
      sp.price,
      sp.fetched_at::text as fetched_at
    FROM stock_prices sp
    JOIN stock_watchlist sw ON sw.id = sp.watchlist_id
    WHERE sw.ticker = 'SPY'
      AND DATE(sp.fetched_at) <= ${dateStr}::date
    ORDER BY DATE(sp.fetched_at) DESC, sp.fetched_at DESC
    LIMIT 35
  `)

  const spyRows = (spyResult.rows as any[]).map(r => ({
    price: parseFloat(r.price),
    fetched_at: r.fetched_at,
  }))

  // Reverse to chronological order
  spyRows.reverse()

  if (spyRows.length < 2) {
    return {
      spy_5d_return: null,
      spy_20d_return: null,
      spy_volatility_20d: null,
      btc_spy_correlation_30d: null,
    }
  }

  const spyCloses = spyRows.map(r => r.price)
  const currentSpy = spyCloses[spyCloses.length - 1]

  // SPY returns
  const spy_5d_return = spyCloses.length >= 6
    ? +((currentSpy - spyCloses[spyCloses.length - 6]) / spyCloses[spyCloses.length - 6]).toFixed(6)
    : null
  const spy_20d_return = spyCloses.length >= 21
    ? +((currentSpy - spyCloses[spyCloses.length - 21]) / spyCloses[spyCloses.length - 21]).toFixed(6)
    : null

  // SPY volatility 20d
  const spyReturns = computeDailyReturns(spyCloses)
  const last20SpyReturns = spyReturns.slice(Math.max(0, spyReturns.length - 20))
  const spy_volatility_20d = last20SpyReturns.length >= 10
    ? +computeStdDev(last20SpyReturns).toFixed(6)
    : null

  // BTC-SPY correlation over last 30 days
  // Need BTC returns for the same period
  const btcResult = await getDb().execute(sql`
    SELECT DISTINCT ON (DATE(fetched_at))
      price,
      fetched_at::text as fetched_at
    FROM btc_prices
    WHERE DATE(fetched_at) <= ${dateStr}::date
    ORDER BY DATE(fetched_at) DESC, fetched_at DESC
    LIMIT 35
  `)
  const btcRows = (btcResult.rows as any[]).reverse()
  const btcCloses = btcRows.map((r: any) => parseFloat(r.price))
  const btcReturns = computeDailyReturns(btcCloses)

  // Align the two return series to the shorter one (last 30 common days)
  const minLen = Math.min(btcReturns.length, spyReturns.length, 30)
  const btcRetSlice = btcReturns.slice(btcReturns.length - minLen)
  const spyRetSlice = spyReturns.slice(spyReturns.length - minLen)

  const btc_spy_correlation_30d = pearsonCorrelation(btcRetSlice, spyRetSlice)

  return {
    spy_5d_return,
    spy_20d_return,
    spy_volatility_20d,
    btc_spy_correlation_30d: btc_spy_correlation_30d != null
      ? +btc_spy_correlation_30d.toFixed(4)
      : null,
  }
}

/**
 * Compute temporal features for a given date.
 */
function computeTemporalFeatures(dateStr: string): Partial<FeatureRow> {
  const d = new Date(dateStr + 'T00:00:00Z')
  const month = d.getUTCMonth() + 1 // 1-12
  const day_of_week = d.getUTCDay() // 0=Sun, 6=Sat
  const is_weekend = (day_of_week === 0 || day_of_week === 6) ? 1 : 0

  // Earnings season: January, April, July, October
  const is_earnings_season = [1, 4, 7, 10].includes(month) ? 1 : 0

  return {
    day_of_week,
    month,
    is_earnings_season,
    // is_weekend computed in calendar features
  }
}

/**
 * Compute all features for a single date.
 */
async function computeFeaturesForDate(dateStr: string): Promise<FeatureRow> {
  const [technical, macro, calendar, regime, temporal] = await Promise.all([
    computeTechnicalFeatures(dateStr),
    computeMacroSentimentFeatures(dateStr),
    computeCalendarFeatures(dateStr),
    computeMarketRegimeFeatures(dateStr),
    Promise.resolve(computeTemporalFeatures(dateStr)),
  ])

  return {
    // Technical (12)
    rsi_14: null,
    sma_ratio_20: null,
    sma_ratio_50: null,
    volatility_20d: null,
    bollinger_pct_b: null,
    volume_ratio: null,
    volume_trend_5d: null,
    return_1d: null,
    return_3d: null,
    return_7d: null,
    return_14d: null,
    atr_14: null,

    // Macro (8)
    geopolitical_tension_score: null,
    fed_mention_count: null,
    fed_sentiment: null,
    trump_mention_count: null,
    trump_sentiment: null,
    crypto_mention_count: null,
    crypto_sentiment: null,
    overall_news_fear: null,

    // Calendar (10)
    is_fomc_week: 0,
    is_fomc_day: 0,
    is_us_holiday: 0,
    days_to_tax_deadline: null,
    is_options_expiry_week: 0,
    is_election_month: 0,
    is_cpi_week: 0,
    is_weekend: 0,
    is_quarter_end: 0,
    days_since_halving: 0,

    // Market regime (4)
    spy_5d_return: null,
    spy_20d_return: null,
    spy_volatility_20d: null,
    btc_spy_correlation_30d: null,

    // Temporal (4)
    day_of_week: 0,
    month: 1,
    is_earnings_season: 0,

    // Override with computed values
    ...technical,
    ...macro,
    ...calendar,
    ...regime,
    ...temporal,
  } as FeatureRow
}

// ─── Date range helpers ──────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().substring(0, 10)
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setUTCDate(result.getUTCDate() + n)
  return result
}

function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  let current = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')
  while (current <= end) {
    dates.push(formatDate(current))
    current = addDays(current, 1)
  }
  return dates
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Build feature rows and upsert into btc_daily_features.
 *
 * @param options.backfill - If true, process from earliest btc_prices date to today.
 *                           Otherwise, just yesterday and today.
 */
export async function buildFeatures(options: { backfill?: boolean } = {}): Promise<{
  datesProcessed: number
  errors: number
}> {
  let startDate: string
  let endDate: string = formatDate(new Date())

  if (options.backfill) {
    // Find earliest btc_prices date
    const earliest = await getDb().execute(sql`
      SELECT MIN(DATE(fetched_at))::text as min_date FROM btc_prices
    `)
    const minDate = (earliest.rows[0] as any)?.min_date
    if (!minDate) {
      console.log('[BtcFeatures] No btc_prices data found, nothing to backfill')
      return { datesProcessed: 0, errors: 0 }
    }
    startDate = minDate.substring(0, 10)
    console.log(`[BtcFeatures] Backfill mode: ${startDate} → ${endDate}`)
  } else {
    // Just yesterday and today
    const yesterday = addDays(new Date(), -1)
    startDate = formatDate(yesterday)
    console.log(`[BtcFeatures] Incremental mode: ${startDate} → ${endDate}`)
  }

  const dates = generateDateRange(startDate, endDate)
  console.log(`[BtcFeatures] Processing ${dates.length} dates...`)

  let processed = 0
  let errors = 0

  for (const dateStr of dates) {
    try {
      const features = await computeFeaturesForDate(dateStr)

      // Upsert into btc_daily_features
      await getDb().execute(sql`
        INSERT INTO btc_daily_features (feature_date, features, created_at)
        VALUES (${dateStr}::date, ${JSON.stringify(features)}::jsonb, NOW())
        ON CONFLICT (feature_date) DO UPDATE SET features = EXCLUDED.features
      `)

      processed++

      if (processed % 50 === 0 || processed === dates.length) {
        console.log(`[BtcFeatures] Progress: ${processed}/${dates.length} dates`)
      }
    } catch (err) {
      errors++
      console.error(`[BtcFeatures] Error on ${dateStr}:`, err)
    }
  }

  console.log(`[BtcFeatures] Done. Processed: ${processed}, Errors: ${errors}`)
  return { datesProcessed: processed, errors }
}
