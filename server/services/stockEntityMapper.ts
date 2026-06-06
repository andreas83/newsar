/**
 * Stock-to-entity mapping service.
 * Links stock_watchlist entries to organization entities via
 * Wikidata, name matching, or manual assignment.
 */

import { getDatabase } from '../database/db.js'
import { stockWatchlist, stockPrices, entities } from '../database/schema.js'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { searchSymbol } from '../utils/finnhubClient.js'

/**
 * Normalize a company name for fuzzy matching.
 * Strips common suffixes like Inc, Corp, Ltd, etc.
 */
function normalizeCompanyName(name: string): string {
  return name
    .replace(/\.com\b/gi, '')
    .replace(/\b(Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|LLC|PLC|S\.?A\.?|AG|SE|N\.?V\.?|Group|Holdings?|Company|International)\b/gi, '')
    .replace(/&\s*Co\.?\b/gi, '') // "& Co" as a unit
    .replace(/[.,&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Manually map an entity to a ticker.
 */
export async function mapEntityToTicker(entityId: number, ticker: string): Promise<boolean> {
  const db = getDatabase()

  const [item] = await db.select()
    .from(stockWatchlist)
    .where(eq(stockWatchlist.ticker, ticker.toUpperCase()))
    .limit(1)

  if (!item) return false

  await db.update(stockWatchlist)
    .set({
      entityId,
      mappingMethod: 'manual',
      mappingConfidence: 1.0,
      updatedAt: new Date(),
    })
    .where(eq(stockWatchlist.id, item.id))

  return true
}

/**
 * Suggest a ticker for an entity by searching Finnhub by name.
 */
export async function suggestTickerForEntity(entityId: number): Promise<{ ticker: string; name: string; type: string }[]> {
  const db = getDatabase()

  const [entity] = await db.select({
    name: entities.name,
    canonicalName: entities.canonicalName,
  })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1)

  if (!entity) return []

  const searchName = entity.canonicalName || entity.name
  const results = await searchSymbol(searchName)

  // Filter to common stock types
  return results
    .filter(r => r.type === 'Common Stock' || r.type === 'ETP' || r.type === 'ADR')
    .slice(0, 10)
    .map(r => ({
      ticker: r.symbol,
      name: r.description,
      type: r.type,
    }))
}

/**
 * Auto-map entities to tickers by matching names.
 * Tries: 1) Wikidata ticker property, 2) Name similarity matching.
 */
export async function autoMapEntities(limit: number = 50): Promise<{ mapped: number; total: number }> {
  const db = getDatabase()

  // Get unmapped active watchlist items
  const unmapped = await db.select({
    id: stockWatchlist.id,
    ticker: stockWatchlist.ticker,
    companyName: stockWatchlist.companyName,
  })
    .from(stockWatchlist)
    .where(and(
      eq(stockWatchlist.isActive, true),
      isNull(stockWatchlist.entityId),
    ))
    .limit(limit)

  console.log(`[StockMapper] Found ${unmapped.length} unmapped tickers`)

  let mapped = 0

  for (const item of unmapped) {
    // Strategy 1: Check if any entity has this ticker in its Wikidata metadata
    const wikidataResult = await db.execute(sql`
      SELECT id FROM entities
      WHERE type = 'organization'
        AND metadata IS NOT NULL
        AND (
          metadata->>'ticker' = ${item.ticker}
          OR metadata->'wikidata'->>'P414' IS NOT NULL
        )
      LIMIT 1
    `)

    if (wikidataResult.rows?.[0]) {
      const entityId = (wikidataResult.rows[0] as any).id
      await db.update(stockWatchlist)
        .set({
          entityId,
          mappingMethod: 'wikidata',
          mappingConfidence: 0.95,
          updatedAt: new Date(),
        })
        .where(eq(stockWatchlist.id, item.id))
      console.log(`[StockMapper] Wikidata match: ${item.ticker} → entity #${entityId}`)
      mapped++
      continue
    }

    // Strategy 2: Try ticker symbol as entity name (e.g. IBM → "IBM")
    const tickerMatches = await db.select({
      id: entities.id,
      name: entities.name,
      canonicalName: entities.canonicalName,
    })
      .from(entities)
      .where(and(
        eq(entities.type, 'organization'),
        sql`LOWER(${entities.canonicalName}) = ${item.ticker.toLowerCase()}
            OR LOWER(${entities.name}) = ${item.ticker.toLowerCase()}`,
      ))
      .limit(1)

    if (tickerMatches.length === 1) {
      await db.update(stockWatchlist)
        .set({
          entityId: tickerMatches[0].id,
          mappingMethod: 'name_match',
          mappingConfidence: 0.9,
          updatedAt: new Date(),
        })
        .where(eq(stockWatchlist.id, item.id))
      console.log(`[StockMapper] Ticker-name match: ${item.ticker} → ${tickerMatches[0].name}`)
      mapped++
      continue
    }

    // Strategy 3: Name matching
    const normalized = normalizeCompanyName(item.companyName)
    if (normalized.length < 3) continue

    // First try exact match on canonical_name or name (case-insensitive)
    const exactMatches = await db.select({
      id: entities.id,
      name: entities.name,
      canonicalName: entities.canonicalName,
    })
      .from(entities)
      .where(and(
        eq(entities.type, 'organization'),
        sql`LOWER(${entities.canonicalName}) = ${normalized}
            OR LOWER(${entities.name}) = ${normalized}`,
      ))
      .limit(5)

    if (exactMatches.length >= 1) {
      const best = exactMatches[0]
      await db.update(stockWatchlist)
        .set({
          entityId: best.id,
          mappingMethod: 'name_match',
          mappingConfidence: exactMatches.length === 1 ? 0.95 : 0.8,
          updatedAt: new Date(),
        })
        .where(eq(stockWatchlist.id, item.id))
      console.log(`[StockMapper] Exact match: ${item.ticker} (${item.companyName}) → ${best.name}`)
      mapped++
      continue
    }

    // Fall back to substring match, but require the entity name starts with the normalized term
    // to avoid "intel" matching "intelligence"
    const substringMatches = await db.select({
      id: entities.id,
      name: entities.name,
      canonicalName: entities.canonicalName,
    })
      .from(entities)
      .where(and(
        eq(entities.type, 'organization'),
        sql`LOWER(${entities.canonicalName}) LIKE ${normalized + '%'}
            OR LOWER(${entities.name}) LIKE ${normalized + '%'}`,
      ))
      .limit(5)

    if (substringMatches.length === 1) {
      await db.update(stockWatchlist)
        .set({
          entityId: substringMatches[0].id,
          mappingMethod: 'name_match',
          mappingConfidence: 0.8,
          updatedAt: new Date(),
        })
        .where(eq(stockWatchlist.id, item.id))
      console.log(`[StockMapper] Name match: ${item.ticker} (${item.companyName}) → ${substringMatches[0].name}`)
      mapped++
    } else if (substringMatches.length > 1) {
      const best = substringMatches.find(m =>
        normalizeCompanyName(m.canonicalName || m.name) === normalized
      ) || substringMatches[0]

      await db.update(stockWatchlist)
        .set({
          entityId: best.id,
          mappingMethod: 'name_match',
          mappingConfidence: 0.6,
          updatedAt: new Date(),
        })
        .where(eq(stockWatchlist.id, item.id))
      console.log(`[StockMapper] Fuzzy match: ${item.ticker} (${item.companyName}) → ${best.name} (${substringMatches.length} candidates)`)
      mapped++
    }
  }

  console.log(`[StockMapper] Mapped ${mapped} of ${unmapped.length} tickers`)
  return { mapped, total: unmapped.length }
}

/**
 * Get stock data for an entity (if it has a linked ticker).
 */
export async function getStockDataForEntity(entityId: number) {
  const db = getDatabase()

  const [item] = await db.select({
    id: stockWatchlist.id,
    ticker: stockWatchlist.ticker,
    companyName: stockWatchlist.companyName,
    exchange: stockWatchlist.exchange,
    sector: stockWatchlist.sector,
    lastPriceAt: stockWatchlist.lastPriceAt,
  })
    .from(stockWatchlist)
    .where(and(
      eq(stockWatchlist.entityId, entityId),
      eq(stockWatchlist.isActive, true),
    ))
    .limit(1)

  if (!item) return null

  // Get latest price
  const [latestPrice] = await db.select()
    .from(stockPrices)
    .where(eq(stockPrices.watchlistId, item.id))
    .orderBy(sql`${stockPrices.fetchedAt} DESC`)
    .limit(1)

  return {
    ticker: item.ticker,
    companyName: item.companyName,
    exchange: item.exchange,
    sector: item.sector,
    price: latestPrice?.price ?? null,
    changeAmount: latestPrice?.changeAmount ?? null,
    changePercent: latestPrice?.changePercent ?? null,
    previousClose: latestPrice?.previousClose ?? null,
    marketStatus: latestPrice?.marketStatus ?? null,
    fetchedAt: latestPrice?.fetchedAt ?? null,
  }
}
