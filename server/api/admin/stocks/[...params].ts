import { getDatabase } from '~/server/database/db'
import { stockWatchlist } from '~/server/database/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const method = event.method
  const params = getRouterParam(event, 'params')
  const pathParts = params ? params.split('/') : []

  if (pathParts.length < 1) {
    throw createError({ statusCode: 400, message: 'ID required' })
  }

  const id = parseInt(pathParts[0])
  if (isNaN(id)) {
    throw createError({ statusCode: 400, message: 'Invalid ID' })
  }

  const db = getDatabase()

  if (method === 'DELETE') {
    await db.delete(stockWatchlist).where(eq(stockWatchlist.id, id))
    return { success: true }
  }

  if (method === 'PATCH') {
    const body = await readBody(event)
    const updates: Record<string, any> = { updatedAt: new Date() }

    if (body.isActive !== undefined) updates.isActive = body.isActive
    if (body.sector !== undefined) updates.sector = body.sector
    if (body.entityId !== undefined) {
      updates.entityId = body.entityId
      updates.mappingMethod = 'manual'
      updates.mappingConfidence = 1.0
    }
    if (body.companyName !== undefined) updates.companyName = body.companyName

    const [updated] = await db.update(stockWatchlist)
      .set(updates)
      .where(eq(stockWatchlist.id, id))
      .returning()

    return { item: updated }
  }

  throw createError({ statusCode: 405, message: 'Method not allowed' })
})
