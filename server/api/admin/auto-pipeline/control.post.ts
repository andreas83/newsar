import { getAutoPipeline } from '../../../services/autoPipeline'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { action } = body

  const pipeline = getAutoPipeline()

  switch (action) {
    case 'start':
      pipeline.start()
      return { success: true, message: 'Auto pipeline started' }

    case 'stop':
      pipeline.stop()
      return { success: true, message: 'Auto pipeline stopped' }

    default:
      throw createError({
        statusCode: 400,
        message: `Unknown action: ${action}`,
      })
  }
})
