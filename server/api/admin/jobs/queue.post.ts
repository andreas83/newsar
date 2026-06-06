import {
  queueAllActiveFeeds,
  queuePendingExtractions,
  queuePendingImageExtractions,
  queuePendingClassifications,
  queuePendingEmbeddings,
  queuePendingAnalyses,
  queueArticleClustering,
} from '../../../queues/feedQueue'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { action, options } = body

  try {
    let result

    switch (action) {
      // Feed queue actions
      case 'fetch-all-feeds':
        result = await queueAllActiveFeeds()
        break

      case 'extract-content':
        result = await queuePendingExtractions(options?.limit || 100)
        break

      case 'extract-images':
        result = await queuePendingImageExtractions(options?.limit || 100)
        break

      case 'classify-articles':
        result = await queuePendingClassifications(options?.limit || 50)
        break

      case 'generate-embeddings':
        result = await queuePendingEmbeddings(options?.limit || 20)
        break

      case 'analyze-articles':
        result = await queuePendingAnalyses(options?.limit || 30)
        break

      case 'cluster-articles':
        result = await queueArticleClustering(options)
        break

      default:
        throw createError({
          statusCode: 400,
          statusMessage: `Unknown action: ${action}`,
        })
    }

    return {
      success: true,
      action,
      queuedJobs: Array.isArray(result) ? result.length : 1,
      message: `Successfully queued ${action}`,
    }
  } catch (error: any) {
    console.error(`Error queueing ${action}:`, error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Failed to queue job',
    })
  }
})
