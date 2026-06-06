import { getDatabase } from '~/server/database/db'
import { feeds, articles } from '~/server/database/schema'
import { eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()
  const id = parseInt(event.context.params?.id || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Feed ID is required',
    })
  }

  try {
    // Get feed
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

    // Get article count for this feed
    const [articleCount] = await db
      .select({ count: count() })
      .from(articles)
      .where(eq(articles.feedId, id))

    return {
      ...feed,
      articleCount: articleCount?.count || 0,
    }
  } catch (error) {
    console.error('Error fetching feed details:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch feed details',
    })
  }
})
