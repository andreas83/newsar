/**
 * Count page requests from user agents that identify as bots.
 *
 * Bots don't run the page view beacon, so without this they'd be invisible in
 * the visitor stats. Counts are kept in memory and flushed to bot_hits_daily
 * once a minute (each cluster process adds its own counts). The same timer
 * deletes page_views older than 13 months once a day.
 */
import { sql } from 'drizzle-orm'
import { getDatabase } from '~/server/database/db'
import { detectBot } from '~/server/utils/visitorStats'

const FLUSH_INTERVAL_MS = 60 * 1000
const RETENTION = '13 months'

const pending = new Map<string, number>() // "YYYY-MM-DD|bot" -> hits
let lastCleanupDay = ''

async function flush() {
  if (pending.size === 0 && lastCleanupDay === new Date().toISOString().slice(0, 10)) return

  const rows = [...pending.entries()]
  pending.clear()
  const db = getDatabase()

  try {
    for (const [key, hits] of rows) {
      const [day, bot] = key.split('|')
      await db.execute(sql`
        INSERT INTO bot_hits_daily (day, bot, hits) VALUES (${day}, ${bot}, ${hits})
        ON CONFLICT (day, bot) DO UPDATE SET hits = bot_hits_daily.hits + EXCLUDED.hits
      `)
    }

    const day = new Date().toISOString().slice(0, 10)
    if (lastCleanupDay !== day) {
      lastCleanupDay = day
      await db.execute(sql`DELETE FROM page_views WHERE created_at < now() - ${RETENTION}::interval`)
    }
  } catch (error) {
    console.error('[VisitorStats] Failed to flush bot hits:', error)
  }
}

setInterval(flush, FLUSH_INTERVAL_MS).unref()

export default defineEventHandler((event) => {
  if (event.method !== 'GET') return

  const path = event.path || ''
  // Page requests only: no API calls, build assets, images or files with an extension
  if (path.startsWith('/api/') || path.startsWith('/_nuxt/') || path.startsWith('/__nuxt') || /\.[a-z0-9]{2,5}(\?|$)/i.test(path)) return

  const bot = detectBot(getRequestHeader(event, 'user-agent'))
  if (!bot) return

  const key = `${new Date().toISOString().slice(0, 10)}|${bot}`
  pending.set(key, (pending.get(key) || 0) + 1)
})
