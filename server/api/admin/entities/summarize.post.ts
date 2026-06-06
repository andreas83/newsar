import { batchGenerateSummaries, updateEntityTrendingScores } from '../../../services/entitySummarizer'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const limit = parseInt(body?.limit || '20')
    const force = body?.force === true

    if (limit < 1 || limit > 500) {
      throw createError({
        statusCode: 400,
        message: 'Limit must be between 1 and 500'
      })
    }

    // Update trending scores first
    await updateEntityTrendingScores()

    // Generate summaries for top entities
    const result = await batchGenerateSummaries(limit, force)

    return {
      success: true,
      processed: result.processed,
      failed: result.failed,
      total: result.total,
      message: `Successfully generated ${result.processed} entity summaries${force ? ' (forced regeneration)' : ''}`
    }
  } catch (error: any) {
    console.error('Error generating entity summaries:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to generate entity summaries'
    })
  }
})
