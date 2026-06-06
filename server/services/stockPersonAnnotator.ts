/**
 * Stock Person Annotator
 *
 * Enriches entity_relationships.metadata for person-org pairs where the org
 * has a stock ticker. Classifies relationship types using structural heuristics
 * (co-occurrence ratio, article role distribution) — no AI needed.
 */

import { getDatabase } from '../database/db'
import { entityRelationships } from '../database/schema'
import { eq, sql } from 'drizzle-orm'

let db: ReturnType<typeof getDatabase> | null = null
function getDb() {
  if (!db) db = getDatabase()
  return db
}

interface PersonOrgCandidate {
  relationshipId: number
  personEntityId: number
  personName: string
  personSlug: string | null
  orgEntityId: number
  orgName: string
  ticker: string
  watchlistId: number
  cooccurrenceCount: number
  strength: number
}

interface RoleDistribution {
  protagonist: number
  antagonist: number
  neutral: number
  context: number
  total: number
}

interface AnnotationResult {
  annotated: number
  skipped: number
  errors: number
}

/**
 * Find all person-org entity_relationships where the org has a stock ticker
 */
async function findPersonOrgStockPairs(): Promise<PersonOrgCandidate[]> {
  const result = await getDb().execute(sql`
    SELECT
      er.id as relationship_id,
      ep.id as person_entity_id,
      ep.name as person_name,
      ep.slug as person_slug,
      eo.id as org_entity_id,
      eo.name as org_name,
      sw.ticker,
      sw.id as watchlist_id,
      er.cooccurrence_count,
      er.strength
    FROM entity_relationships er
    JOIN entities ep ON (
      CASE
        WHEN EXISTS (SELECT 1 FROM entities WHERE id = er.source_entity_id AND type = 'person')
        THEN er.source_entity_id
        ELSE er.target_entity_id
      END
    ) = ep.id AND ep.type = 'person'
    JOIN entities eo ON (
      CASE
        WHEN ep.id = er.source_entity_id
        THEN er.target_entity_id
        ELSE er.source_entity_id
      END
    ) = eo.id AND eo.type = 'organization'
    JOIN stock_watchlist sw ON sw.entity_id = eo.id AND sw.is_active = true
    WHERE er.cooccurrence_count >= 3
    ORDER BY er.cooccurrence_count DESC
  `)

  return result.rows.map((r: any) => ({
    relationshipId: parseInt(r.relationship_id),
    personEntityId: parseInt(r.person_entity_id),
    personName: r.person_name,
    personSlug: r.person_slug,
    orgEntityId: parseInt(r.org_entity_id),
    orgName: r.org_name,
    ticker: r.ticker,
    watchlistId: parseInt(r.watchlist_id),
    cooccurrenceCount: parseInt(r.cooccurrence_count),
    strength: parseFloat(r.strength),
  }))
}

/**
 * Get role distribution for a person-org pair from article_entities
 */
async function getRoleDistribution(personEntityId: number, orgEntityId: number): Promise<RoleDistribution> {
  const result = await getDb().execute(sql`
    SELECT
      COALESCE(ae_person.role, 'unknown') as role,
      COUNT(*)::int as cnt
    FROM article_entities ae_person
    INNER JOIN article_entities ae_org
      ON ae_person.article_id = ae_org.article_id
      AND ae_org.entity_id = ${orgEntityId}
    WHERE ae_person.entity_id = ${personEntityId}
    GROUP BY ae_person.role
  `)

  const dist: RoleDistribution = { protagonist: 0, antagonist: 0, neutral: 0, context: 0, total: 0 }
  for (const row of result.rows as any[]) {
    const role = row.role as string
    const cnt = parseInt(row.cnt)
    if (role === 'protagonist') dist.protagonist = cnt
    else if (role === 'antagonist') dist.antagonist = cnt
    else if (role === 'neutral') dist.neutral = cnt
    else if (role === 'context') dist.context = cnt
    dist.total += cnt
  }
  return dist
}

/**
 * Count how many distinct stock tickers a person co-occurs with.
 * Used to filter out "noise" persons (politicians, journalists) who appear
 * alongside many different companies without being executives.
 */
async function countDistinctStockTickers(personEntityId: number): Promise<number> {
  const result = await getDb().execute(sql`
    SELECT COUNT(DISTINCT sw.id)::int as ticker_count
    FROM entity_relationships er
    JOIN entities eo ON (
      CASE
        WHEN er.source_entity_id = ${personEntityId}
        THEN er.target_entity_id
        ELSE er.source_entity_id
      END
    ) = eo.id AND eo.type = 'organization'
    JOIN stock_watchlist sw ON sw.entity_id = eo.id AND sw.is_active = true
    WHERE (er.source_entity_id = ${personEntityId} OR er.target_entity_id = ${personEntityId})
      AND er.cooccurrence_count >= 3
  `)

  return parseInt((result.rows[0] as any)?.ticker_count || '0')
}

/**
 * Get total mention count for an org entity (for computing ratios)
 */
async function getOrgTotalMentions(orgEntityId: number): Promise<number> {
  const result = await getDb().execute(sql`
    SELECT COUNT(DISTINCT article_id)::int as total
    FROM article_entities
    WHERE entity_id = ${orgEntityId}
  `)
  return parseInt((result.rows[0] as any)?.total || '0')
}

/**
 * Classify the relationship type based on structural heuristics
 */
function classifyRelationship(
  cooccurrenceCount: number,
  orgTotalMentions: number,
  roles: RoleDistribution,
  distinctTickers: number,
): { type: string; label: string; confidence: number } {
  const mentionRatio = orgTotalMentions > 0 ? cooccurrenceCount / orgTotalMentions : 0
  const protagonistRatio = roles.total > 0 ? roles.protagonist / roles.total : 0
  const antagonistRatio = roles.total > 0 ? roles.antagonist / roles.total : 0

  // Politician / noise filter: appears with many distinct tickers
  // Someone co-occurring with 10+ tickers is almost certainly a politician/journalist, not an executive
  if (distinctTickers >= 10) {
    return { type: 'political', label: 'Political/Regulatory', confidence: 0.5 }
  }
  // 5-9 tickers: still likely noise unless they have a very strong ratio with this one org
  if (distinctTickers >= 5 && mentionRatio < 0.25) {
    return { type: 'political', label: 'Political/Regulatory', confidence: 0.5 }
  }

  // Executive: high co-occurrence ratio with the org + frequently a protagonist
  if (mentionRatio >= 0.12 && protagonistRatio >= 0.25 && cooccurrenceCount >= 8) {
    return { type: 'executive', label: 'Key Executive', confidence: 0.85 }
  }

  // Strong association: decent ratio, moderate co-occurrences
  if (mentionRatio >= 0.06 && cooccurrenceCount >= 5) {
    return { type: 'associated', label: 'Key Figure', confidence: 0.65 }
  }

  // Moderate association
  if (cooccurrenceCount >= 3 && mentionRatio >= 0.02) {
    return { type: 'associated', label: 'Associated', confidence: 0.45 }
  }

  return { type: 'minor', label: 'Mentioned', confidence: 0.3 }
}

/**
 * Main entry point: annotate all person-org stock relationships
 */
export async function annotateStockPeople(): Promise<AnnotationResult> {
  console.log('[StockPersonAnnotator] Finding person-org stock pairs...')

  const candidates = await findPersonOrgStockPairs()
  console.log(`[StockPersonAnnotator] Found ${candidates.length} person-org pairs with stock tickers`)

  if (candidates.length === 0) return { annotated: 0, skipped: 0, errors: 0 }

  // Pre-compute distinct ticker counts for all unique persons
  const personTickerCounts = new Map<number, number>()
  const uniquePersonIds = [...new Set(candidates.map(c => c.personEntityId))]

  console.log(`[StockPersonAnnotator] Computing ticker diversity for ${uniquePersonIds.length} persons...`)
  for (const personId of uniquePersonIds) {
    personTickerCounts.set(personId, await countDistinctStockTickers(personId))
  }

  // Pre-compute org total mentions for all unique orgs
  const orgMentionCounts = new Map<number, number>()
  const uniqueOrgIds = [...new Set(candidates.map(c => c.orgEntityId))]

  console.log(`[StockPersonAnnotator] Computing org mention totals for ${uniqueOrgIds.length} orgs...`)
  for (const orgId of uniqueOrgIds) {
    orgMentionCounts.set(orgId, await getOrgTotalMentions(orgId))
  }

  let annotated = 0
  let skipped = 0
  let errors = 0

  for (const candidate of candidates) {
    try {
      const roles = await getRoleDistribution(candidate.personEntityId, candidate.orgEntityId)
      const distinctTickers = personTickerCounts.get(candidate.personEntityId) || 0
      const orgTotal = orgMentionCounts.get(candidate.orgEntityId) || 0

      const classification = classifyRelationship(
        candidate.cooccurrenceCount,
        orgTotal,
        roles,
        distinctTickers,
      )

      // Skip minor relationships — not worth annotating
      if (classification.type === 'minor') {
        skipped++
        continue
      }

      const metadata = {
        relationship_type: classification.type,
        role_label: classification.label,
        confidence: classification.confidence,
        stock_ticker: candidate.ticker,
        stock_watchlist_id: candidate.watchlistId,
        cooccurrence_count: candidate.cooccurrenceCount,
        org_total_mentions: orgTotal,
        mention_ratio: orgTotal > 0 ? +(candidate.cooccurrenceCount / orgTotal).toFixed(4) : 0,
        protagonist_ratio: roles.total > 0 ? +(roles.protagonist / roles.total).toFixed(4) : 0,
        distinct_tickers: distinctTickers,
        annotated_at: new Date().toISOString(),
      }

      await getDb()
        .update(entityRelationships)
        .set({ metadata, updatedAt: new Date() })
        .where(eq(entityRelationships.id, candidate.relationshipId))

      annotated++

      if (annotated % 25 === 0) {
        console.log(`[StockPersonAnnotator] Processed ${annotated}/${candidates.length}...`)
      }
    } catch (err) {
      console.error(`[StockPersonAnnotator] Error annotating ${candidate.personName} ↔ ${candidate.ticker}:`, err)
      errors++
    }
  }

  console.log(`[StockPersonAnnotator] Done: ${annotated} annotated, ${skipped} skipped (minor), ${errors} errors`)
  return { annotated, skipped, errors }
}
