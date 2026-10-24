import { getDatabase } from '~/server/database/db'
import { feeds } from '~/server/database/schema'
import { z } from 'zod'

// Validation schema
const createFeedSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  name: z.string().min(1, 'Name is required'),
  category: z.string().optional(),
  knownBias: z.number().min(-1).max(1).optional(), // -1 (left) to 1 (right)
  region: z.string().optional(),
  publisher: z.string().optional(),
  publisherAliases: z.array(z.string().min(1)).optional(),
  ownership: z.enum(['private', 'public', 'state', 'nonprofit', 'trust']).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  leanApplicable: z.boolean().optional(),
  isActive: z.number().int().min(0).max(1).default(1), // 1 = active, 0 = inactive
})

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  try {
    const body = await readBody(event)

    // Validate input
    const validatedData = createFeedSchema.parse(body)

    // Insert feed
    const [newFeed] = await db
      .insert(feeds)
      .values({
        url: validatedData.url,
        name: validatedData.name,
        category: validatedData.category,
        knownBias: validatedData.knownBias,
        region: validatedData.region,
        publisher: validatedData.publisher,
        publisherAliases: validatedData.publisherAliases,
        ownership: validatedData.ownership,
        country: validatedData.country,
        leanApplicable: validatedData.leanApplicable,
        isActive: validatedData.isActive,
      })
      .returning()

    return {
      success: true,
      data: newFeed,
      message: 'Feed created successfully',
    }
  } catch (error: any) {
    console.error('Error creating feed:', error)

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
      // PostgreSQL unique constraint violation
      throw createError({
        statusCode: 409,
        statusMessage: 'Feed URL already exists',
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to create feed',
    })
  }
})
