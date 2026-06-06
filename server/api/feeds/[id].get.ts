import { getDatabase } from '~/server/database/db'
import { feeds } from '~/server/database/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid feed ID',
    })
  }

  try {
    const [feed] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.id, id))
      .limit(1)

    if (!feed) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Feed not found',
      })
    }

    return {
      success: true,
      data: feed,
    }
  } catch (error) {
    console.error('Error fetching feed:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch feed',
    })
  }
})
