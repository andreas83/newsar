import { sql } from 'drizzle-orm'
import { getDatabase } from '~/server/database/db'

/**
 * Visitor stats for /admin/analytics.
 * Query: ?days=1|7|30|90 (default 30)
 *
 * A "human" view is one with no bot_reason that was also engaged (see
 * migration 0026_visitor_stats.sql). Visitor hashes rotate daily, so
 * "visitors" is the sum of daily unique visitors, not people over the range.
 */

const HUMAN = sql.raw(`bot_reason IS NULL AND engaged`)

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const days = [1, 7, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30
  const since = sql`now() - ${`${days} days`}::interval`
  const db = getDatabase()

  const top = (column: string, limit = 10) => db.execute(sql`
    SELECT ${sql.raw(column)} AS name, COUNT(*)::int AS views, COUNT(DISTINCT (visitor_hash, created_at::date))::int AS visitors
    FROM page_views
    WHERE created_at >= ${since} AND ${HUMAN} AND ${sql.raw(column)} IS NOT NULL
    GROUP BY 1 ORDER BY views DESC LIMIT ${limit}
  `)

  const [totals, live, daily, botDaily, pages, referrers, campaigns, browsers, oses, devices, languages, filtered, bots] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${HUMAN})::int AS views,
        COUNT(DISTINCT (visitor_hash, created_at::date)) FILTER (WHERE ${HUMAN})::int AS visitors,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE ${HUMAN} AND duration_ms > 0))::int AS median_duration_ms,
        COUNT(*) FILTER (WHERE bot_reason IS NULL AND NOT engaged)::int AS unengaged_views,
        COUNT(*) FILTER (WHERE bot_reason IS NOT NULL)::int AS flagged_views
      FROM page_views WHERE created_at >= ${since}
    `),
    db.execute(sql`
      SELECT COUNT(DISTINCT visitor_hash)::int AS visitors
      FROM page_views WHERE created_at >= now() - interval '30 minutes' AND ${HUMAN}
    `),
    db.execute(sql`
      SELECT to_char(${sql.raw(days === 1 ? `date_trunc('hour', created_at)` : `created_at::date`)}, ${days === 1 ? 'YYYY-MM-DD"T"HH24:00' : 'YYYY-MM-DD'}) AS bucket,
        COUNT(*) FILTER (WHERE ${HUMAN})::int AS views,
        COUNT(DISTINCT visitor_hash) FILTER (WHERE ${HUMAN})::int AS visitors,
        COUNT(*) FILTER (WHERE NOT (${HUMAN}))::int AS filtered
      FROM page_views WHERE created_at >= ${since}
      GROUP BY 1 ORDER BY 1
    `),
    db.execute(sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS bucket, SUM(hits)::int AS hits
      FROM bot_hits_daily WHERE day >= (${since})::date
      GROUP BY 1 ORDER BY 1
    `),
    top('path', 15),
    top('referrer_host'),
    top('utm_source'),
    top('browser'),
    top('os'),
    top('device'),
    top('language'),
    db.execute(sql`
      SELECT COALESCE(bot_reason, 'Not engaged') AS name, COUNT(*)::int AS views
      FROM page_views WHERE created_at >= ${since} AND NOT (${HUMAN})
      GROUP BY 1 ORDER BY views DESC
    `),
    db.execute(sql`
      SELECT bot AS name, SUM(hits)::int AS hits
      FROM bot_hits_daily WHERE day >= (${since})::date
      GROUP BY 1 ORDER BY hits DESC LIMIT 20
    `),
  ])

  return {
    days,
    totals: { ...totals.rows[0], live_visitors: live.rows[0]?.visitors ?? 0 },
    daily: daily.rows,
    botDaily: botDaily.rows,
    pages: pages.rows,
    referrers: referrers.rows,
    campaigns: campaigns.rows,
    browsers: browsers.rows,
    oses: oses.rows,
    devices: devices.rows,
    languages: languages.rows,
    filtered: filtered.rows,
    bots: bots.rows,
  }
})
