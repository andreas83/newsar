/**
 * BTC Live Trading API — Write Endpoints
 *
 * POST /api/bitcoin/live-trading
 *   action=emergency_close              — Close all open positions via market orders
 *   action=toggle_kill_switch + active   — Enable/disable trading
 */
import { getDatabase } from '~/server/database/db'
import { sql } from 'drizzle-orm'
import { emergencyCloseAll, toggleKillSwitch } from '~/server/services/btcLiveTradingEngine'
import { getEnvironmentLabel } from '~/server/utils/binanceClient'

export default defineEventHandler(async (event) => {
  // Admin-only: requires authenticated session
  const session = await getUserSession(event)
  if (!session.user || (session.user as any).role !== 'admin') {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const body = await readBody(event)
  const action = body?.action as string
  const db = getDatabase()
  const env = getEnvironmentLabel().toLowerCase()

  // Get portfolio
  const portResult = await db.execute(sql`
    SELECT id FROM btc_live_portfolio WHERE environment = ${env} LIMIT 1
  `)
  if (portResult.rows.length === 0) {
    return { error: 'No portfolio found' }
  }
  const portfolioId = parseInt((portResult.rows[0] as any).id)

  if (action === 'emergency_close') {
    const result = await emergencyCloseAll(portfolioId)
    return { success: true, ...result }
  }

  if (action === 'toggle_kill_switch') {
    const active = body.active === true || body.active === 'true'
    const reason = body.reason as string | undefined
    await toggleKillSwitch(portfolioId, active, reason)
    return { success: true, isActive: active }
  }

  return { error: `Unknown action: ${action}` }
})
