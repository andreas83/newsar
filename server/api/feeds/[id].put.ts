import { getDatabase } from '~/server/database/db'
import { feeds } from '~/server/database/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

// Validation schema for update (all fields optional)
const updateFeedSchema = z.object({
  url: z.string().url('Must be a valid URL').optional(),
  name: z.string().min(1, 'Name cannot be empty').optional(),
  category: z.string().optional().nullable(),
  knownBias: z.number().min(-1).max(1).optional().nullable(),
  region: z.string().optional().nullable(),
  isActive: z.number().int().min(0).max(1).optional(),
})

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
    const body = await readBody(event)

    // Validate input
    const validatedData = updateFeedSchema.parse(body)

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

    // Update feed
    const [updatedFeed] = await db
      .update(feeds)
      .set({
        ...validatedData,
        updatedAt: new Date(),
      })
      .where(eq(feeds.id, id))
      .returning()

    return {
      success: true,
      data: updatedFeed,
      message: 'Feed updated successfully',
    }
  } catch (error: any) {
    console.error('Error updating feed:', error)

    if (error.statusCode) {
      throw error
    }

    // Handle validation errors
    if (error.name === 'ZodError') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Validation failed',
        data: error.errors,
      })
    }

    // Handle duplicate URL error
    if (error.code === '23505') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Feed URL already exists',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to update feed',
    })
  }
})
