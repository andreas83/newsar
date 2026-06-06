import { updateEntitySummary } from '../../../services/entitySummarizer.js'

export default defineEventHandler(async (event) => {
  const entityId = parseInt(getRouterParam(event, 'id') || '')

  if (!entityId || isNaN(entityId)) {
    throw createError({
      statusCode: 400,
      message: 'Valid entity ID is required'
    })
  }

  try {
    // Trigger summary generation
    await updateEntitySummary(entityId)

    return {
      success: true,
      message: `Summary generated successfully for entity ${entityId}`,
      entityId
    }
  } catch (error) {
    console.error(`Error generating summary for entity ${entityId}:`, error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Return specific error messages
    if (errorMessage.includes('not found')) {
      throw createError({
        statusCode: 404,
        message: `Entity ${entityId} not found`
      })
    }

    if (errorMessage.includes('No articles found')) {
      throw createError({
        statusCode: 422,
        message: 'Cannot generate summary: No articles found for this entity'
      })
    }

    throw createError({
      statusCode: 500,
      message: `Failed to generate summary: ${errorMessage}`
    })
  }
})
