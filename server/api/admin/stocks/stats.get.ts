import { getCollectionStatus } from '~/server/services/stockPriceCollector'
import { getRemainingDailyQuota } from '~/server/utils/alphaVantageClient'

export default defineEventHandler(async () => {
  const status = await getCollectionStatus()
  return {
    ...status,
    alphaVantageQuota: getRemainingDailyQuota(),
  }
})
