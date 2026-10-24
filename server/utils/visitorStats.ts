import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { getRedisClient } from './redis'

/**
 * Helpers for cookieless visitor statistics (see migration 0026_visitor_stats.sql).
 */

// Matched against the lowercased user agent. Order matters: the first match
// becomes the bot name in bot_hits_daily, so specific names come before the
// generic catch-alls at the end.
const BOT_PATTERNS: Array<[string, RegExp]> = [
  ['Googlebot', /googlebot|google-inspectiontool|googleother|google-extended|adsbot-google|mediapartners-google|apis-google|feedfetcher-google|storebot-google/],
  ['Bingbot', /bingbot|bingpreview|msnbot|adidxbot/],
  ['Applebot', /applebot/],
  ['Baiduspider', /baiduspider/],
  ['YandexBot', /yandex/],
  ['DuckDuckBot', /duckduckbot|duckassistbot/],
  ['GPTBot', /gptbot|chatgpt-user|oai-searchbot/],
  ['ClaudeBot', /claudebot|claude-web|claude-user|claude-searchbot|anthropic-ai/],
  ['PerplexityBot', /perplexity/],
  ['Reflectionbot', /reflectionbot/],
  ['ExaSearchBot', /exasearchbot|exa\.ai/],
  ['YouBot', /youbot/],
  ['Amazonbot', /amazonbot/],
  ['Meta', /facebookexternalhit|facebookcatalog|meta-externalagent|meta-externalfetcher|facebookbot/],
  ['Bytespider', /bytespider|tiktokspider/],
  ['CCBot', /ccbot/],
  ['AhrefsBot', /ahrefs/],
  ['SemrushBot', /semrush/],
  ['DataForSeoBot', /dataforseo/],
  ['MJ12bot', /mj12bot/],
  ['DotBot', /dotbot/],
  ['PetalBot', /petalbot|aspiegelbot/],
  ['SeznamBot', /seznambot/],
  ['Twitterbot', /twitterbot/],
  ['LinkedInBot', /linkedinbot/],
  ['Slack', /slackbot|slack-imgproxy/],
  ['Discordbot', /discordbot/],
  ['TelegramBot', /telegrambot/],
  ['WhatsApp', /whatsapp/],
  ['Headless browser', /headlesschrome|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|chrome-lighthouse|pagespeed/],
  ['HTTP library', /^(curl|wget|python|python-requests|aiohttp|httpx|go-http-client|java|okhttp|apache-httpclient|node-fetch|axios|undici|libwww-perl|ruby|php|guzzle|scrapy|http\.rb)/],
  ['Monitoring', /uptimerobot|pingdom|statuscake|site24x7|betteruptime|uptime-kuma|newrelicpinger|datadog/],
  ['Feed reader', /feedly|inoreader|newsblur|feedbin|tiny tiny rss|freshrss|miniflux|rss/],
  ['Other bot', /bot\b|bot\/|crawl|spider|slurp|scrape|archiver|fetcher|preview|checker|scan|monitor/],
]

export function detectBot(userAgent: string | undefined | null): string | null {
  if (!userAgent?.trim()) return 'No user agent'
  const ua = userAgent.toLowerCase()
  for (const [name, pattern] of BOT_PATTERNS) {
    if (pattern.test(ua)) return name
  }
  // Every mainstream browser sends a long "Mozilla/5.0 (...)" UA
  if (!ua.startsWith('mozilla/5.0 (')) return 'Other bot'
  return null
}

// Chrome auto-updates every ~4 weeks (Chrome 100 shipped 2022-03-29). Scrapers
// often keep a years-old hard-coded UA, so a version ~2 years behind is a bot
// signal. Only applied to beacons, not to bot_hits_daily (those name themselves).
const CHROME_100_RELEASE = Date.UTC(2022, 2, 29)
const STALE_CHROME_VERSIONS = 30

export function detectStaleBrowser(userAgent: string): string | null {
  const match = userAgent.match(/(?:Chrome|CriOS)\/(\d+)\./)
  if (!match) return null
  const expected = 100 + Math.floor((Date.now() - CHROME_100_RELEASE) / (28 * 86400 * 1000))
  return Number(match[1]) < expected - STALE_CHROME_VERSIONS ? 'Outdated browser' : null
}

export function parseUserAgent(userAgent: string) {
  const ua = userAgent

  let browser = 'Other'
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet'
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  let os = 'Other'
  if (/Windows NT/.test(ua)) os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  let device = 'Desktop'
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'Tablet'
  else if (/Mobi|iPhone|iPod|Android/.test(ua)) device = 'Mobile'

  return { browser, os, device }
}

/** nginx sets X-Real-IP from the socket, so it can't be spoofed by the client */
export function getClientIp(event: H3Event): string {
  return getRequestHeader(event, 'x-real-ip')
    || getRequestHeader(event, 'x-forwarded-for')?.split(',')[0].trim()
    || getRequestIP(event)
    || 'unknown'
}

/** /24 for IPv4, /48 for IPv6: crawler fleets rotate through addresses in one block */
function ipBlock(ip: string): string {
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':')
  return ip.split('.').slice(0, 3).join('.')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const localSalts = new Map<string, string>()

/**
 * One random salt per UTC day, shared by all app processes through Redis and
 * expired after two days. Once it is gone, nobody (including us) can link a
 * visitor hash back to an IP address.
 */
async function getDailySalt(day: string): Promise<string> {
  const cached = localSalts.get(day)
  if (cached) return cached

  const key = `analytics:salt:${day}`
  const redis = getRedisClient()
  await redis.set(key, randomBytes(32).toString('hex'), 'EX', 2 * 86400, 'NX')
  const salt = await redis.get(key)
  if (!salt) throw new Error('analytics salt missing')

  localSalts.clear()
  localSalts.set(day, salt)
  return salt
}

export async function getVisitorHash(ip: string, userAgent: string): Promise<string> {
  const salt = await getDailySalt(today())
  return createHash('sha256').update(`${salt}|${ip}|${userAgent}`).digest('hex').slice(0, 16)
}

// A reader on this site doesn't open hundreds of pages a day, and a single
// network block doesn't send thousands. The Redis counters expire with the day.
const MAX_VIEWS_PER_VISITOR = 150
const MAX_VIEWS_PER_IP_BLOCK = 1000

export async function checkRateBot(ip: string, visitorHash: string): Promise<string | null> {
  const day = today()
  const redis = getRedisClient()
  const visitorKey = `analytics:pv:v:${day}:${visitorHash}`
  const blockKey = `analytics:pv:b:${day}:${createHash('sha256').update(ipBlock(ip)).digest('hex').slice(0, 16)}`

  const [[, visitorCount], [, blockCount]] = await redis.multi()
    .incr(visitorKey).expire(visitorKey, 86400 + 3600)
    .incr(blockKey).expire(blockKey, 86400 + 3600)
    .exec()
    .then(r => [r![0], r![2]] as Array<[unknown, number]>)

  if (visitorCount > MAX_VIEWS_PER_VISITOR) return 'Rate: visitor'
  if (blockCount > MAX_VIEWS_PER_IP_BLOCK) return 'Rate: network'
  return null
}
