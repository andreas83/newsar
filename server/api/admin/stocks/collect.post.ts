import { collectAllPrices, getCollectionStatus } from '~/server/services/stockPriceCollector'

export default defineEventHandler(async () => {
  const result = await collectAllPrices()
  const status = await getCollectionStatus()
  return { ...result, status }
})
