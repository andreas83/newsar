import { getDatabase } from '~/server/database/db'
import { feeds } from '~/server/database/schema'
import { eq } from 'drizzle-orm'
import { queueFeedFetch } from '~/server/queues/feedQueue'

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

    // Queue the feed fetch job
    const job = await queueFeedFetch(id, 5) // High priority

    return {
      success: true,
      message: 'Feed fetch queued successfully',
      data: {
        jobId: job.id,
        feedId: id,
        feedName: feed.name,
        status: 'queued',
      },
    }
  } catch (error: any) {
    console.error('Error queueing feed fetch:', error)

    if (error.statusCode) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to queue feed fetch',
    })
  }
})
