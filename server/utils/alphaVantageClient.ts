/**
 * Alpha Vantage API client for historical stock price backfill.
 * Rate limited to 25 req/day (free tier), 5 req/min.
 */

const BASE_URL = 'https://www.alphavantage.co/query'

// In-memory rate limiters
let minuteTimestamps: number[] = []
let dailyCount = 0
let dailyCountResetDate = ''
const MAX_PER_MINUTE = 5
const MAX_PER_DAY = 25

function getApiKey(): string {
  const key = process.env.ALPHAVANTAGE_API_KEY
  if (!key) throw new Error('[AlphaVantage] ALPHAVANTAGE_API_KEY not set')
  return key
}

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10)
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const today = getTodayString()
  if (dailyCountResetDate !== today) {
    dailyCount = 0
    dailyCountResetDate = today
  }

  if (dailyCount >= MAX_PER_DAY) {
    throw new Error(`[AlphaVantage] Daily limit of ${MAX_PER_DAY} requests reached. Try again tomorrow.`)
  }

  const now = Date.now()
  minuteTimestamps = minuteTimestamps.filter(t => now - t < 60_000)

  if (minuteTimestamps.length >= MAX_PER_MINUTE) {
    const waitMs = 60_000 - (now - minuteTimestamps[0]) + 200
    console.log(`[AlphaVantage] Per-minute limit reached, waiting ${Math.round(waitMs / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    return rateLimitedFetch(url)
  }

  minuteTimestamps.push(Date.now())
  dailyCount++

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`[AlphaVantage] HTTP ${response.status}: ${response.statusText}`)
  }

  return response
}

export interface AlphaVantageDailyEntry {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Fetch daily historical prices for a ticker.
 * @param ticker Stock symbol (e.g. "AAPL")
 * @param outputSize 'compact' (100 days) or 'full' (20 years)
 */
export async function getDailyHistory(ticker: string, outputSize: 'compact' | 'full' = 'compact'): Promise<AlphaVantageDailyEntry[]> {
  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=${outputSize}&apikey=${getApiKey()}`
  const response = await rateLimitedFetch(url)
  const data = await response.json()

  const timeSeries = data['Time Series (Daily)']
  if (!timeSeries) {
    const note = data['Note'] || data['Information'] || data['Error Message']
    if (note) throw new Error(`[AlphaVantage] ${note}`)
    throw new Error(`[AlphaVantage] No time series data returned for ${ticker}`)
  }

  const entries: AlphaVantageDailyEntry[] = []
  for (const [date, values] of Object.entries(timeSeries)) {
    const v = values as Record<string, string>
    entries.push({
      date,
      open: parseFloat(v['1. open']),
      high: parseFloat(v['2. high']),
      low: parseFloat(v['3. low']),
      close: parseFloat(v['4. close']),
      volume: parseInt(v['5. volume'], 10),
    })
  }

  // Sort by date descending (most recent first)
  entries.sort((a, b) => b.date.localeCompare(a.date))
  return entries
}

export function getRemainingDailyQuota(): number {
  const today = getTodayString()
  if (dailyCountResetDate !== today) return MAX_PER_DAY
  return Math.max(0, MAX_PER_DAY - dailyCount)
}
