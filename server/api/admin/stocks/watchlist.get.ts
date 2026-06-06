import { getDatabase } from '~/server/database/db'
import { stockWatchlist, entities } from '~/server/database/schema'
import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = getDatabase()

  const items = await db.select({
    id: stockWatchlist.id,
    ticker: stockWatchlist.ticker,
    companyName: stockWatchlist.companyName,
    exchange: stockWatchlist.exchange,
    sector: stockWatchlist.sector,
    entityId: stockWatchlist.entityId,
    mappingMethod: stockWatchlist.mappingMethod,
    mappingConfidence: stockWatchlist.mappingConfidence,
    isActive: stockWatchlist.isActive,
    lastPriceAt: stockWatchlist.lastPriceAt,
    createdAt: stockWatchlist.createdAt,
    entityName: entities.name,
    entitySlug: entities.slug,
  })
    .from(stockWatchlist)
    .leftJoin(entities, eq(stockWatchlist.entityId, entities.id))
    .orderBy(stockWatchlist.sector, stockWatchlist.ticker)

  return { items }
})
