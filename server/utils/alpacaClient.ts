/**
 * Alpaca Markets Data API client for historical stock price backfill.
 * Free paper trading account: 200 req/min, multi-symbol batch support.
 * Docs: https://docs.alpaca.markets/reference/stockbars
 */

const BASE_URL = 'https://data.alpaca.markets/v2'

function getCredentials(): { key: string; secret: string } {
  const key = process.env.ALPACA_API_KEY
  const secret = process.env.ALPACA_API_SECRET
  if (!key || !secret) throw new Error('[Alpaca] ALPACA_API_KEY and ALPACA_API_SECRET must be set')
  return { key, secret }
}

// Rate limiter: 200 req/min
let requestTimestamps: number[] = []
const MAX_PER_MINUTE = 190 // conservative margin

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now()
  requestTimestamps = requestTimestamps.filter(t => now - t < 60_000)

  if (requestTimestamps.length >= MAX_PER_MINUTE) {
    const waitMs = 60_000 - (now - requestTimestamps[0]) + 200
    console.log(`[Alpaca] Rate limit approached, waiting ${Math.round(waitMs / 1000)}s...`)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    return rateLimitedFetch(url)
  }

  const { key, secret } = getCredentials()
  requestTimestamps.push(Date.now())

  const response = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    },
  })

  if (response.status === 429) {
    console.warn('[Alpaca] 429 Too Many Requests, backing off 15s...')
    await new Promise(resolve => setTimeout(resolve, 15_000))
    return rateLimitedFetch(url)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`[Alpaca] HTTP ${response.status}: ${body}`)
  }

  return response
}

export interface AlpacaBar {
  t: string  // timestamp ISO
  o: number  // open
  h: number  // high
  l: number  // low
  c: number  // close
  v: number  // volume
  n: number  // number of trades
  vw: number // volume weighted avg price
}

/**
 * Fetch daily bars for a single ticker.
 * @param ticker Stock symbol
 * @param start Start date YYYY-MM-DD
 * @param end End date YYYY-MM-DD
 */
export async function getDailyBars(ticker: string, start: string, end: string): Promise<AlpacaBar[]> {
  const allBars: AlpacaBar[] = []
  let pageToken: string | null = null

  do {
    const params = new URLSearchParams({
      start,
      end,
      timeframe: '1Day',
      limit: '10000',
      adjustment: 'split',
      feed: 'iex',
    })
    if (pageToken) params.set('page_token', pageToken)

    const url = `${BASE_URL}/stocks/${encodeURIComponent(ticker)}/bars?${params}`
    const response = await rateLimitedFetch(url)
    const data = await response.json()

    if (data.bars) {
      allBars.push(...data.bars)
    }

    pageToken = data.next_page_token || null
  } while (pageToken)

  return allBars
}

/**
 * Fetch daily bars for multiple tickers in one request (up to 200).
 * Much more efficient than single-ticker requests.
 * @param tickers Array of symbols
 * @param start Start date YYYY-MM-DD
 * @param end End date YYYY-MM-DD
 */
export async function getMultiDailyBars(
  tickers: string[],
  start: string,
  end: string
): Promise<Record<string, AlpacaBar[]>> {
  const result: Record<string, AlpacaBar[]> = {}
  for (const t of tickers) result[t] = []

  let pageToken: string | null = null

  do {
    const params = new URLSearchParams({
      symbols: tickers.join(','),
      start,
      end,
      timeframe: '1Day',
      limit: '10000',
      adjustment: 'split',
      feed: 'iex',
    })
    if (pageToken) params.set('page_token', pageToken)

    const url = `${BASE_URL}/stocks/bars?${params}`
    const response = await rateLimitedFetch(url)
    const data = await response.json()

    if (data.bars) {
      for (const [ticker, bars] of Object.entries(data.bars)) {
        if (!result[ticker]) result[ticker] = []
        result[ticker].push(...(bars as AlpacaBar[]))
      }
    }

    pageToken = data.next_page_token || null
  } while (pageToken)

  return result
}

/**
 * Check if Alpaca credentials are configured.
 */
export function isAlpacaAvailable(): boolean {
  return !!(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET)
}
