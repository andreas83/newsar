import { sql } from 'drizzle-orm'
import { getDatabase } from '~/server/database/db'
import { detectBot, detectStaleBrowser, parseUserAgent, getClientIp, getVisitorHash, checkRateBot } from '~/server/utils/visitorStats'

/**
 * Page view beacon from app/plugins/analytics.client.ts.
 * Body (sent with navigator.sendBeacon as text/plain JSON):
 *   { t: 'pv', id, p, r?, u?, h? }  new page view (path, referrer, utm_source, headless signals)
 *   { t: 'e', id }                  the reader interacted or stayed 15s
 *   { t: 'end', id, d }             visible time on page in ms
 * Always answers 204 so a broken beacon never shows up as a page error.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_DURATION_MS = 30 * 60 * 1000

function referrerHost(referrer: unknown, ownHost: string | undefined): string | null {
  if (typeof referrer !== 'string' || !referrer) return null
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase()
    if (!host || host === ownHost?.replace(/^www\./, '').toLowerCase().split(':')[0]) return null
    return host.slice(0, 255)
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  setResponseStatus(event, 204)

  let body: any
  try {
    body = JSON.parse((await readRawBody(event)) || '')
  } catch {
    return null
  }
  if (!body || typeof body.id !== 'string' || !UUID_RE.test(body.id)) return null

  const db = getDatabase()

  try {
    if (body.t === 'e') {
      await db.execute(sql`
        UPDATE page_views SET engaged = true
        WHERE id = ${body.id} AND created_at > now() - interval '1 hour'
      `)
      return null
    }

    if (body.t === 'end') {
      const d = Math.round(Number(body.d))
      if (!Number.isFinite(d) || d < 0) return null
      await db.execute(sql`
        UPDATE page_views SET duration_ms = ${Math.min(d, MAX_DURATION_MS)}
        WHERE id = ${body.id} AND created_at > now() - interval '1 hour'
      `)
      return null
    }

    if (body.t !== 'pv' || typeof body.p !== 'string' || !body.p.startsWith('/')) return null

    // Don't count the people running the site
    const session = await getUserSession(event)
    if ((session.user as any)?.role === 'admin') return null

    const path = body.p.split(/[?#]/)[0].slice(0, 512)
    if (path.startsWith('/admin') || path === '/login') return null

    const userAgent = getRequestHeader(event, 'user-agent') || ''
    const ip = getClientIp(event)
    const visitorHash = await getVisitorHash(ip, userAgent)

    let botReason = detectBot(userAgent) || detectStaleBrowser(userAgent)
    if (!botReason && body.h) botReason = 'Headless signals'
    if (!botReason) botReason = await checkRateBot(ip, visitorHash)

    const { browser, os, device } = parseUserAgent(userAgent)
    const language = (getRequestHeader(event, 'accept-language') || '').split(/[,;]/)[0].trim().slice(0, 8) || null
    const utmSource = typeof body.u === 'string' && body.u ? body.u.slice(0, 100).toLowerCase() : null

    await db.execute(sql`
      INSERT INTO page_views (id, path, referrer_host, utm_source, visitor_hash, browser, os, device, language, bot_reason)
      VALUES (${body.id}, ${path}, ${referrerHost(body.r, getRequestHeader(event, 'host'))}, ${utmSource},
              ${visitorHash}, ${browser}, ${os}, ${device}, ${language}, ${botReason ? botReason.slice(0, 32) : null})
      ON CONFLICT (id) DO NOTHING
    `)
  } catch (error) {
    console.error('[VisitorStats] Failed to record beacon:', error)
  }

  return null
})
