import { updateEntitySummary, updateEntityTrendingScores } from '../../../services/entitySummarizer'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const entityIds = body?.entityIds || []

    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      throw createError({
        statusCode: 400,
        message: 'entityIds must be a non-empty array'
      })
    }

    if (entityIds.length > 100) {
      throw createError({
        statusCode: 400,
        message: 'Cannot process more than 100 entities at once'
      })
    }

    // Update trending scores first
    await updateEntityTrendingScores()

    console.log(`Generating summaries for ${entityIds.length} manually selected entities...`)

    let processed = 0
    let failed = 0

    for (const entityId of entityIds) {
      try {
        await updateEntitySummary(entityId)
        processed++
        console.log(`✅ Generated summary for entity ${entityId} (${processed}/${entityIds.length})`)
        // Small delay to avoid overwhelming Ollama
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) {
        console.error(`Failed to generate summary for entity ${entityId}:`, error)
        failed++
      }
    }

    console.log(`✅ Manual summary generation complete: ${processed} succeeded, ${failed} failed`)

    return {
      success: true,
      processed,
      failed,
      total: entityIds.length,
      message: `Successfully generated ${processed} entity summaries`
    }
  } catch (error: any) {
    console.error('Error generating entity summaries:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to generate entity summaries'
    })
  }
})
