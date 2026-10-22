/**
 * CoinGecko API client for Bitcoin price data, historical charts, and OHLC.
 * Rate limited to 10 req/min (free tier conservative).
 * Optional COINGECKO_API_KEY env var for higher limits (demo tier).
 */

const BASE_URL = 'https://api.coingecko.com/api/v3'

// In-memory rate limiter
let requestTimestamps: number[] = []
const MAX_REQUESTS_PER_MINUTE = 10

function getApiKey(): string | undefined {
  return process.env.COINGECKO_API_KEY || undefined
}

function buildUrl(path: string): string {
  return `${BASE_URL}${path}`
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  const apiKey = getApiKey()
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey
  }
  return headers
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now()
  // Remove timestamps older than 1 minute
  requestTimestamps = requestTimestamps.filter(t => now - t < 60_000)

  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldestInWindow = requestTimestamps[0]
    const waitMs = 60_000 - (now - oldestInWindow) + 100
    console.log(`[CoinGecko] Rate limit reached, waiting ${Math.round(waitMs / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    return rateLimitedFetch(url) // Retry after wait
  }

  requestTimestamps.push(Date.now())
  const response = await fetch(url, { headers: getHeaders() })

  if (response.status === 429) {
    console.warn('[CoinGecko] 429 Too Many Requests, backing off 60s...')
    await new Promise(resolve => setTimeout(resolve, 60_000))
    return rateLimitedFetch(url)
  }

  if (!response.ok) {
    throw new Error(`[CoinGecko] HTTP ${response.status}: ${response.statusText}`)
  }

  return response
}

// --- Interfaces ---

export interface CoinGeckoPrice {
  price: number
  volume24h: number
  marketCap: number
  changePercent24h: number
  high24h: number
  low24h: number
}

export interface CoinGeckoHistoricalPoint {
  timestamp: number
  price: number
  volume: number
  marketCap: number
}

export interface CoinGeckoOHLC {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

// --- Exported Functions ---

/**
 * Get current Bitcoin price with 24h stats.
 * Uses /simple/price with all optional fields enabled.
 */
export async function getCurrentPrice(): Promise<CoinGeckoPrice> {
  const url = buildUrl(
    '/simple/price?ids=bitcoin&vs_currencies=usd'
    + '&include_market_cap=true'
    + '&include_24hr_vol=true'
    + '&include_24hr_change=true'
    + '&include_24h_high_low=true'
  )
  const response = await rateLimitedFetch(url)
  const data = await response.json()

  // CoinGecko nests everything under the coin id
  const btc = data.bitcoin
  if (!btc) {
    throw new Error('[CoinGecko] No bitcoin data in response')
  }

  return {
    price: btc.usd,
    volume24h: btc.usd_24h_vol,
    marketCap: btc.usd_market_cap,
    changePercent24h: btc.usd_24h_change,
    high24h: btc.usd_24h_high,
    low24h: btc.usd_24h_low,
  }
}

/**
 * Get historical daily price, volume, and market cap data.
 * Uses /coins/bitcoin/market_chart with daily interval.
 * @param days - Number of days of history (1, 7, 14, 30, 90, 180, 365, max)
 */
export async function getHistoricalDaily(days: number): Promise<CoinGeckoHistoricalPoint[]> {
  const url = buildUrl(
    `/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`
  )
  const response = await rateLimitedFetch(url)
  const data = await response.json()

  // CoinGecko returns { prices: [[ts, val], ...], market_caps: [...], total_volumes: [...] }
  const prices: [number, number][] = data.prices || []
  const volumes: [number, number][] = data.total_volumes || []
  const marketCaps: [number, number][] = data.market_caps || []

  return prices.map((entry, i) => ({
    timestamp: entry[0],
    price: entry[1],
    volume: volumes[i]?.[1] ?? 0,
    marketCap: marketCaps[i]?.[1] ?? 0,
  }))
}

/**
 * Get OHLC candlestick data for Bitcoin.
 * Uses /coins/bitcoin/ohlc.
 * @param days - Candle granularity: 1/7/14/30/90/180/365/max
 *   1-2 days = 30min candles, 3-30 days = 4hr candles, 31+ days = daily candles
 */
export async function getOHLC(days: number): Promise<CoinGeckoOHLC[]> {
  const url = buildUrl(
    `/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`
  )
  const response = await rateLimitedFetch(url)
  const data: [number, number, number, number, number][] = await response.json()

  // CoinGecko returns array of [timestamp, open, high, low, close]
  return data.map(([timestamp, open, high, low, close]) => ({
    timestamp,
    open,
    high,
    low,
    close,
  }))
}
