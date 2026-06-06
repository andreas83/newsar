import { getAutoPipeline } from '../../../services/autoPipeline'

export default defineEventHandler(async (event) => {
  const pipeline = getAutoPipeline()
  return await pipeline.getStatus()
})
