import { getDatabase } from '~/server/database/db'
import { stockWatchlist } from '~/server/database/schema'
import { getCompanyProfile } from '~/server/utils/finnhubClient'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.ticker) {
    throw createError({ statusCode: 400, message: 'Ticker is required' })
  }

  const ticker = body.ticker.toUpperCase().trim()
  const db = getDatabase()

  try {
    // Fetch company profile from Finnhub
    let profile: any = null
    let companyName = body.companyName || ticker
    let sector = body.sector || null

    try {
      profile = await getCompanyProfile(ticker)
      if (profile && profile.name) {
        companyName = profile.name
        sector = profile.finnhubIndustry || sector
      }
    } catch (e) {
      console.warn(`[Admin] Could not fetch Finnhub profile for ${ticker}`)
    }

    const [inserted] = await db.insert(stockWatchlist).values({
      ticker,
      companyName,
      exchange: body.exchange || 'US',
      sector,
      entityId: body.entityId || null,
      mappingMethod: body.entityId ? 'manual' : null,
      mappingConfidence: body.entityId ? 1.0 : null,
      isActive: true,
      finnhubProfile: profile,
    }).returning()

    return { item: inserted }
  } catch (error: any) {
    if (error.code === '23505') {
      throw createError({ statusCode: 409, message: `Ticker ${ticker} already exists` })
    }
    console.error('Error adding ticker:', error)
    throw createError({ statusCode: 500, message: 'Failed to add ticker' })
  }
})
