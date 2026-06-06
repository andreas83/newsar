/**
 * Google News URL Resolver
 *
 * Strategies:
 * 1. Puppeteer headless browser (follows JS redirects)
 * 2. Title-based web search (finds original article)
 * 3. RSS content fallback
 */

import puppeteer, { Browser } from 'puppeteer'

let browserInstance: Browser | null = null
let browserPid: number | undefined = undefined

/**
 * Get or create browser instance (reuse for performance)
 * Properly cleans up disconnected browsers before creating new ones.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && !browserInstance.connected) {
    // Old browser disconnected — kill its process tree to prevent orphans
    console.log(`Puppeteer browser disconnected (pid ${browserPid}), cleaning up...`)
    try {
      if (browserPid) {
        process.kill(browserPid, 'SIGKILL')
      }
    } catch (_) { /* already dead */ }
    browserInstance = null
    browserPid = undefined
  }

  if (!browserInstance) {
    console.log('Launching Puppeteer browser...')
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    })
    browserPid = browserInstance.process()?.pid
    console.log(`Puppeteer browser launched (pid ${browserPid})`)
  }
  return browserInstance
}

/**
 * Close browser instance (call this on shutdown)
 */
export async function closeBrowser() {
  if (browserInstance) {
    const pid = browserPid
    try {
      await browserInstance.close()
    } catch (_) {
      // Force kill if close() fails
      if (pid) {
        try { process.kill(pid, 'SIGKILL') } catch (_) { /* already dead */ }
      }
    }
    browserInstance = null
    browserPid = undefined
  }
}

// Register cleanup handlers so Chrome processes don't leak on restart
const shutdownBrowser = () => {
  if (browserPid) {
    try { process.kill(browserPid, 'SIGKILL') } catch (_) { /* already dead */ }
  }
  browserInstance = null
  browserPid = undefined
}
process.on('exit', shutdownBrowser)
process.on('SIGTERM', shutdownBrowser)
process.on('SIGINT', shutdownBrowser)

/**
 * Resolve Google News redirect URL using Puppeteer
 * This handles JavaScript redirects that fetch() can't follow
 */
export async function resolveWithPuppeteer(googleNewsUrl: string, timeout: number = 15000): Promise<string | null> {
  let page = null

  try {
    const browser = await getBrowser()
    page = await browser.newPage()

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    // Set timeout
    page.setDefaultNavigationTimeout(timeout)
    page.setDefaultTimeout(timeout)

    // Listen for all requests to catch final URL
    let finalUrl = googleNewsUrl

    page.on('response', (response) => {
      const url = response.url()
      // Track the last non-Google URL we see
      if (url && !url.includes('google.com') && !url.includes('googleadservices')) {
        finalUrl = url
      }
    })

    // Navigate to Google News URL
    await page.goto(googleNewsUrl, {
      waitUntil: 'domcontentloaded',
      timeout,
    })

    // Wait a bit for redirects to complete
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get final URL after all redirects
    const currentUrl = page.url()

    // Use the current URL if it's not Google, otherwise use tracked finalUrl
    const resolvedUrl = !currentUrl.includes('google.com') ? currentUrl : finalUrl

    // Check if we got a real article URL
    if (resolvedUrl && resolvedUrl !== googleNewsUrl && !resolvedUrl.includes('google.com')) {
      console.log(`  Puppeteer resolved: ${resolvedUrl.substring(0, 80)}...`)
      return resolvedUrl
    }

    return null
  } catch (error) {
    console.error('Puppeteer resolution error:', error instanceof Error ? error.message : error)
    return null
  } finally {
    if (page) {
      await page.close()
    }
  }
}

/**
 * Search for article by title to find original URL
 * Uses DuckDuckGo (no API key needed, respects privacy)
 */
export async function findUrlByTitle(title: string): Promise<string | null> {
  try {
    // Clean title for search
    const cleanTitle = title
      .replace(/\s*-\s*(Reuters|BBC|CNN|Guardian|Al Jazeera|Fox News|New York Times).*$/i, '')
      .trim()

    // Build search query
    const searchQuery = encodeURIComponent(`"${cleanTitle}"`)

    // Use DuckDuckGo Lite (HTML version, easier to parse)
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${searchQuery}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      return null
    }

    const html = await response.text()

    // Extract first result link (very basic parsing)
    // DuckDuckGo Lite has links like: <a rel="nofollow" href="https://...">
    const linkMatch = html.match(/<a rel="nofollow" href="(https?:\/\/[^"]+)"/i)

    if (linkMatch && linkMatch[1]) {
      const url = linkMatch[1]

      // Filter out unwanted domains
      const excludeDomains = ['google.com', 'facebook.com', 'twitter.com', 'youtube.com', 'wikipedia.org']
      const isExcluded = excludeDomains.some(domain => url.includes(domain))

      if (!isExcluded) {
        console.log(`  Title search found: ${url.substring(0, 80)}...`)
        return url
      }
    }

    return null
  } catch (error) {
    console.error('Title search error:', error)
    return null
  }
}

/**
 * Main resolver: tries multiple strategies
 */
export async function resolveGoogleNewsArticle(
  googleNewsUrl: string,
  articleTitle: string,
  options: {
    usePuppeteer?: boolean
    useTitleSearch?: boolean
    timeout?: number
  } = {}
): Promise<{
  url: string | null
  method: 'puppeteer' | 'title-search' | 'failed'
  success: boolean
}> {
  const {
    usePuppeteer = true,
    useTitleSearch = true,
    timeout = 15000,
  } = options

  // Strategy 1: Puppeteer (most reliable for Google News)
  if (usePuppeteer) {
    try {
      const url = await resolveWithPuppeteer(googleNewsUrl, timeout)
      if (url) {
        return { url, method: 'puppeteer', success: true }
      }
    } catch (error) {
      console.error('Puppeteer strategy failed:', error)
    }
  }

  // Strategy 2: Title-based search
  if (useTitleSearch && articleTitle) {
    try {
      const url = await findUrlByTitle(articleTitle)
      if (url) {
        return { url, method: 'title-search', success: true }
      }
    } catch (error) {
      console.error('Title search strategy failed:', error)
    }
  }

  // All strategies failed
  return { url: null, method: 'failed', success: false }
}

/**
 * Batch resolve multiple Google News URLs
 * Processes them sequentially to avoid overwhelming the browser
 */
export async function batchResolve(
  articles: Array<{ url: string; title: string; id: number }>,
  options: {
    concurrency?: number
    timeout?: number
  } = {}
): Promise<Array<{ id: number; originalUrl: string; resolvedUrl: string | null; method: string }>> {
  const { concurrency = 3, timeout = 15000 } = options
  const results: Array<{ id: number; originalUrl: string; resolvedUrl: string | null; method: string }> = []

  console.log(`Resolving ${articles.length} Google News URLs (concurrency: ${concurrency})`)

  // Process in batches for better performance
  for (let i = 0; i < articles.length; i += concurrency) {
    const batch = articles.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async (article) => {
        const { url, method } = await resolveGoogleNewsArticle(article.url, article.title, { timeout })

        return {
          id: article.id,
          originalUrl: article.url,
          resolvedUrl: url,
          method,
        }
      })
    )

    results.push(...batchResults)

    // Small delay between batches
    if (i + concurrency < articles.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  return results
}

/**
 * Check if URL is a Google News redirect
 */
export function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com/rss/articles/') ||
         url.includes('news.google.com/articles/')
}
