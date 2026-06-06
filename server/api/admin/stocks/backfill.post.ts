import { backfillTicker, backfillAll } from '~/server/services/stockHistoryBackfiller'
import { isAlpacaAvailable } from '~/server/utils/alpacaClient'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const days = body.days || 365

  if (body.all) {
    const result = await backfillAll(days)
    return { ...result, provider: isAlpacaAvailable() ? 'alpaca' : 'alphavantage' }
  }

  if (!body.ticker) {
    throw createError({ statusCode: 400, message: 'Ticker is required (or set all: true)' })
  }

  const result = await backfillTicker(body.ticker, days)
  return { ...result, provider: isAlpacaAvailable() ? 'alpaca' : 'alphavantage' }
})
