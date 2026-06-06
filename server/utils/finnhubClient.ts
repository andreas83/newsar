/**
 * Finnhub API client for live stock quotes and company profiles.
 * Rate limited to 55 req/min (free tier allows 60).
 */

const BASE_URL = 'https://finnhub.io/api/v1'

// In-memory rate limiter
let requestTimestamps: number[] = []
const MAX_REQUESTS_PER_MINUTE = 55

function getApiKey(): string {
  const key = process.env.FINNHUB_API_KEY
  if (!key) throw new Error('[Finnhub] FINNHUB_API_KEY not set')
  return key
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now()
  // Remove timestamps older than 1 minute
  requestTimestamps = requestTimestamps.filter(t => now - t < 60_000)

  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    const oldestInWindow = requestTimestamps[0]
    const waitMs = 60_000 - (now - oldestInWindow) + 100
    console.log(`[Finnhub] Rate limit reached, waiting ${Math.round(waitMs / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    return rateLimitedFetch(url) // Retry after wait
  }

  requestTimestamps.push(Date.now())
  const response = await fetch(url)

  if (response.status === 429) {
    console.warn('[Finnhub] 429 Too Many Requests, backing off 30s...')
    await new Promise(resolve => setTimeout(resolve, 30_000))
    return rateLimitedFetch(url)
  }

  if (!response.ok) {
    throw new Error(`[Finnhub] HTTP ${response.status}: ${response.statusText}`)
  }

  return response
}

export interface FinnhubQuote {
  c: number   // Current price
  d: number   // Change
  dp: number  // Percent change
  h: number   // High price of the day
  l: number   // Low price of the day
  o: number   // Open price of the day
  pc: number  // Previous close price
  t: number   // Timestamp
}

export interface FinnhubProfile {
  country: string
  currency: string
  exchange: string
  finnhubIndustry: string
  ipo: string
  logo: string
  marketCapitalization: number
  name: string
  phone: string
  shareOutstanding: number
  ticker: string
  weburl: string
}

export interface FinnhubSymbolMatch {
  description: string
  displaySymbol: string
  symbol: string
  type: string
}

export async function getQuote(ticker: string): Promise<FinnhubQuote> {
  const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(ticker)}&token=${getApiKey()}`
  const response = await rateLimitedFetch(url)
  return response.json()
}

export async function getCompanyProfile(ticker: string): Promise<FinnhubProfile> {
  const url = `${BASE_URL}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${getApiKey()}`
  const response = await rateLimitedFetch(url)
  return response.json()
}

export async function searchSymbol(query: string): Promise<FinnhubSymbolMatch[]> {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&token=${getApiKey()}`
  const response = await rateLimitedFetch(url)
  const data = await response.json()
  return data.result || []
}

export async function getMarketStatus(): Promise<{ exchange: string; holiday: string | null; isOpen: boolean; session: string; t: number; timezone: string }> {
  const url = `${BASE_URL}/stock/market-status?exchange=US&token=${getApiKey()}`
  const response = await rateLimitedFetch(url)
  return response.json()
}
