import { autoMapEntities } from '~/server/services/stockEntityMapper'

export default defineEventHandler(async () => {
  const result = await autoMapEntities()
  return result
})
