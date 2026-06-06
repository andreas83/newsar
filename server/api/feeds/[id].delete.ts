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
    // Check if feed exists
    const [existingFeed] = await db
      .select()
      .from(feeds)
      .where(eq(feeds.id, id))
      .limit(1)

    if (!existingFeed) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Feed not found',
      })
    }

    // Delete feed
    await db.delete(feeds).where(eq(feeds.id, id))

    return {
      success: true,
      message: 'Feed deleted successfully',
    }
  } catch (error: any) {
    console.error('Error deleting feed:', error)

    if (error.statusCode) {
      throw error
    }

    // Handle foreign key constraint error (feed has articles)
    if (error.code === '23503') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot delete feed with existing articles',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to delete feed',
    })
  }
})
