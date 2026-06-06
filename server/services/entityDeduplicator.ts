import { getDatabase } from '../database/db.js'
import { entities, articleEntities, storyEntities, entitySummaries, entityRelationships } from '../database/schema.js'
import { eq, sql, and, inArray } from 'drizzle-orm'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  entity1: { id: number; name: string; type: string; mentionCount: number }
  entity2: { id: number; name: string; type: string; mentionCount: number }
  confidence: number
  reasons: string[]
}

export interface MergeResult {
  keepEntity: { id: number; name: string }
  removedEntity: { id: number; name: string }
  articleEntitiesReassigned: number
  storyEntitiesReassigned: number
  duplicateArticleEntitiesRemoved: number
  duplicateStoryEntitiesRemoved: number
}

export interface FindDuplicateOptions {
  entityType?: string           // Filter by type (person, organization, location, event)
  minConfidence?: number        // Minimum confidence threshold (0-1, default 0.6)
  limit?: number                // Max results (default 100)
  minMentions?: number          // Only consider entities with at least N mentions (default 1)
}

// ─── Text Normalization Helpers ──────────────────────────────────────────────

const COMMON_PREFIXES = ['the', 'a', 'an', 'al-', 'el-', 'la', 'le', 'los', 'las', 'des', 'del']

/**
 * Normalize an entity name for comparison:
 * - Lowercase
 * - Remove punctuation (except hyphens inside words)
 * - Remove common prefixes like "The"
 * - Collapse whitespace
 */
export function normalizeName(name: string): string {
  let normalized = name.toLowerCase().trim()

  // Remove content in parentheses (often aliases like "Nicolás Maduro (Maduro)")
  normalized = normalized.replace(/\s*\([^)]*\)\s*/g, ' ')

  // Remove punctuation but keep hyphens between words and apostrophes within words
  normalized = normalized.replace(/[.,;:!?"'`\u2018\u2019\u201C\u201D]/g, '')

  // Remove common prefixes
  for (const prefix of COMMON_PREFIXES) {
    const re = new RegExp(`^${prefix}\\s+`, 'i')
    normalized = normalized.replace(re, '')
  }

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Tokenize a name into words for overlap comparison
 */
export function tokenize(name: string): string[] {
  return normalizeName(name)
    .split(/[\s\-]+/)
    .filter(t => t.length > 0)
}

/**
 * Calculate token overlap ratio between two sets of tokens.
 * Returns the ratio of shared tokens to the smaller set's size.
 */
export function tokenOverlapRatio(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  const setA = new Set(tokensA)
  const setB = new Set(tokensB)

  let overlap = 0
  for (const token of setA) {
    if (setB.has(token)) overlap++
  }

  // Use the smaller set size as denominator so "Trump" matching "Donald Trump" gets high score
  const minSize = Math.min(setA.size, setB.size)
  return overlap / minSize
}

/**
 * Check if one name is a substring of another (after normalization)
 */
export function isSubstringMatch(nameA: string, nameB: string): boolean {
  const normA = normalizeName(nameA)
  const normB = normalizeName(nameB)

  // Don't match if both are the same (exact match, not substring)
  if (normA === normB) return false

  // One must contain the other, and the shorter one must be at least 3 chars
  if (normA.length < 3 || normB.length < 3) return false

  return normA.includes(normB) || normB.includes(normA)
}

/**
 * Check if two names are exact matches after normalization
 */
export function isExactNormalizedMatch(nameA: string, nameB: string): boolean {
  return normalizeName(nameA) === normalizeName(nameB)
}

// ─── Confidence Scoring ──────────────────────────────────────────────────────

/**
 * Score a pair of potential duplicate entities.
 * Returns a confidence score (0-1) and list of reasons.
 */
export function scoreDuplicatePair(
  entity1: { id: number; name: string; type: string; mentionCount: number },
  entity2: { id: number; name: string; type: string; mentionCount: number }
): { confidence: number; reasons: string[] } {
  // Must be same type
  if (entity1.type !== entity2.type) {
    return { confidence: 0, reasons: [] }
  }

  let confidence = 0
  const reasons: string[] = []

  const normName1 = normalizeName(entity1.name)
  const normName2 = normalizeName(entity2.name)

  // Strategy 1: Exact normalized match (highest confidence)
  if (normName1 === normName2) {
    confidence = 0.95
    reasons.push(`Exact normalized match: "${normName1}"`)
    return { confidence, reasons }
  }

  // Strategy 2: Substring match (conservative)
  const tokens1 = tokenize(entity1.name)
  const tokens2 = tokenize(entity2.name)
  const extraTokenCount = Math.abs(tokens1.length - tokens2.length)

  if (isSubstringMatch(entity1.name, entity2.name)) {
    // Only treat as substring match if the extra tokens are minor (1 token difference max)
    // This prevents "China" matching "South China Sea" (2 extra tokens)
    // or "Donald Trump" matching "Donald Trump Jr" (1 extra token but a name qualifier)
    if (extraTokenCount <= 1) {
      // Check for name qualifiers that indicate a different entity
      const shorterTokens = tokens1.length < tokens2.length ? tokens1 : tokens2
      const longerTokens = tokens1.length >= tokens2.length ? tokens1 : tokens2
      const extraTokens = longerTokens.filter(t => !shorterTokens.includes(t))

      // Tokens that indicate a genuinely different entity (not just a name variant)
      const DIFFERENTIATING_TOKENS = new Set([
        'jr', 'jnr', 'sr', 'ii', 'iii', 'iv',           // Person suffixes (Trump ≠ Trump Jr)
        'sea', 'ocean', 'bay', 'gulf', 'strait', 'lake',  // Water bodies (China ≠ South China Sea)
        'river', 'mountain', 'island', 'islands', 'peninsula',
        'north', 'northern', 'south', 'southern', 'east',  // Directional regions
        'eastern', 'west', 'western', 'central', 'greater',
        'council', 'court', 'agency', 'office', 'institute', // Org qualifiers
        'university', 'academy', 'association', 'commission',
        'committee', 'federation', 'foundation', 'ministry',
        'stade', 'stadium', 'temple', 'airport', 'base',  // Venue qualifiers
        'fort', 'palace', 'castle', 'wall', 'border',
        'club', 'fc', 'united',                             // Sports qualifiers
      ])

      const hasDifferentiatingToken = extraTokens.some(t => DIFFERENTIATING_TOKENS.has(t.toLowerCase()))

      if (hasDifferentiatingToken) {
        // Extra token changes entity meaning → low confidence
        confidence = 0.3
        reasons.push(`Substring match with qualifier: "${entity1.name}" vs "${entity2.name}" (low confidence)`)
      } else {
        confidence = 0.7
        reasons.push(`Substring match: "${entity1.name}" contains/contained by "${entity2.name}"`)
      }
    } else {
      // 2+ extra tokens → likely a different entity, very low confidence
      confidence = 0.2
      reasons.push(`Distant substring match: "${entity1.name}" vs "${entity2.name}" (${extraTokenCount} extra tokens)`)
    }
  }

  // Strategy 3: Token overlap
  const overlap = tokenOverlapRatio(tokens1, tokens2)

  if (overlap >= 0.7) {
    const overlapBonus = overlap * 0.3 // Up to 0.3 bonus
    if (confidence === 0) {
      // If no substring match, token overlap alone gives base + bonus
      confidence = 0.5 + overlapBonus
    } else if (confidence >= 0.5) {
      // Only add bonus if base confidence is reasonable
      confidence += overlapBonus
    }
    reasons.push(`Token overlap: ${(overlap * 100).toFixed(0)}% (${tokens1.join(',')} vs ${tokens2.join(',')})`)
  }

  // If no match strategies triggered, return 0
  if (confidence === 0) {
    return { confidence: 0, reasons: [] }
  }

  // Mention count ratio bonus: if one has many mentions and the other has few,
  // they're likely the same entity (one canonical, one variant)
  const maxMentions = Math.max(entity1.mentionCount, entity2.mentionCount)
  const minMentions = Math.min(entity1.mentionCount, entity2.mentionCount)
  if (maxMentions > 10 && minMentions > 0) {
    const ratio = minMentions / maxMentions
    // Lower ratio means one dominates -> more likely a variant
    if (ratio < 0.1) {
      confidence = Math.min(1.0, confidence + 0.05)
      reasons.push(`Mention imbalance: ${maxMentions} vs ${minMentions} (ratio ${ratio.toFixed(3)})`)
    }
  }

  // Cap at 1.0
  confidence = Math.min(1.0, confidence)

  return { confidence, reasons }
}

// ─── Database Operations ─────────────────────────────────────────────────────

/**
 * Get entity mention counts from article_entities.
 * Batches queries to avoid PostgreSQL parameter limits.
 */
async function getEntityMentionCounts(entityIds: number[]): Promise<Map<number, number>> {
  if (entityIds.length === 0) return new Map()
  const db = getDatabase()
  const map = new Map<number, number>()

  // Batch in chunks of 5000 to stay well within PG parameter limits
  const BATCH_SIZE = 5000
  for (let i = 0; i < entityIds.length; i += BATCH_SIZE) {
    const batch = entityIds.slice(i, i + BATCH_SIZE)
    const results = await db
      .select({
        entityId: articleEntities.entityId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(articleEntities)
      .where(inArray(articleEntities.entityId, batch))
      .groupBy(articleEntities.entityId)

    for (const r of results) {
      map.set(r.entityId, r.count)
    }
  }

  return map
}

/**
 * Find duplicate entity candidates.
 *
 * Strategy:
 * 1. Load entities grouped by type
 * 2. Within each type, compare names using normalization + token overlap
 * 3. Score and rank candidate pairs
 */
export async function findDuplicateCandidates(
  options: FindDuplicateOptions = {}
): Promise<DuplicateCandidate[]> {
  const {
    entityType,
    minConfidence = 0.6,
    limit = 100,
    minMentions = 1,
  } = options

  const db = getDatabase()

  // Build query conditions
  const conditions: any[] = []
  if (entityType) {
    conditions.push(eq(entities.type, entityType))
  }

  // Load all entities (we need to compare in-memory for flexible matching)
  // For performance, we load entities with their mention counts
  const entityList = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      canonicalName: entities.canonicalName,
      slug: entities.slug,
    })
    .from(entities)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(entities.type, entities.name)

  console.log(`Loaded ${entityList.length} entities for deduplication analysis`)

  // Get mention counts for all entities
  const allEntityIds = entityList.map(e => e.id)
  const mentionCounts = await getEntityMentionCounts(allEntityIds)

  // Filter by minimum mentions
  const filteredEntities = entityList.filter(e => (mentionCounts.get(e.id) || 0) >= minMentions)
  console.log(`After mention filter (>=${minMentions}): ${filteredEntities.length} entities`)

  // Group by type for comparison
  const byType = new Map<string, typeof filteredEntities>()
  for (const entity of filteredEntities) {
    const group = byType.get(entity.type) || []
    group.push(entity)
    byType.set(entity.type, group)
  }

  const candidates: DuplicateCandidate[] = []

  // For performance with large entity sets, we use a normalized name index
  // to avoid O(n^2) comparisons for exact normalized matches
  for (const [type, entitiesOfType] of byType) {
    console.log(`Processing ${entitiesOfType.length} entities of type "${type}"...`)

    // Build index: normalized name -> entities with that normalized name
    const normalizedIndex = new Map<string, typeof entitiesOfType>()
    for (const entity of entitiesOfType) {
      const norm = normalizeName(entity.name)
      const group = normalizedIndex.get(norm) || []
      group.push(entity)
      normalizedIndex.set(norm, group)
    }

    // Phase 1: Exact normalized matches (fast, via index)
    for (const [normName, group] of normalizedIndex) {
      if (group.length < 2) continue

      // All pairs within this group are exact normalized matches
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const e1 = group[i]
          const e2 = group[j]
          const mc1 = mentionCounts.get(e1.id) || 0
          const mc2 = mentionCounts.get(e2.id) || 0

          const { confidence, reasons } = scoreDuplicatePair(
            { id: e1.id, name: e1.name, type: e1.type, mentionCount: mc1 },
            { id: e2.id, name: e2.name, type: e2.type, mentionCount: mc2 }
          )

          if (confidence >= minConfidence) {
            candidates.push({
              entity1: { id: e1.id, name: e1.name, type: e1.type, mentionCount: mc1 },
              entity2: { id: e2.id, name: e2.name, type: e2.type, mentionCount: mc2 },
              confidence,
              reasons,
            })
          }
        }
      }
    }

    // Phase 2: Substring + token overlap (requires pairwise comparison)
    // For large sets, only compare entities that share at least one token
    const tokenIndex = new Map<string, typeof entitiesOfType>()
    for (const entity of entitiesOfType) {
      const tokens = tokenize(entity.name)
      for (const token of tokens) {
        if (token.length < 3) continue // Skip very short tokens
        const group = tokenIndex.get(token) || []
        group.push(entity)
        tokenIndex.set(token, group)
      }
    }

    // Track already-scored pairs to avoid duplicates
    const scoredPairs = new Set<string>()
    // Also skip pairs already found as exact normalized matches
    for (const c of candidates) {
      const key = `${Math.min(c.entity1.id, c.entity2.id)}-${Math.max(c.entity1.id, c.entity2.id)}`
      scoredPairs.add(key)
    }

    for (const [_token, group] of tokenIndex) {
      if (group.length < 2 || group.length > 200) continue // Skip overly common tokens

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const e1 = group[i]
          const e2 = group[j]
          const key = `${Math.min(e1.id, e2.id)}-${Math.max(e1.id, e2.id)}`

          if (scoredPairs.has(key)) continue
          scoredPairs.add(key)

          const mc1 = mentionCounts.get(e1.id) || 0
          const mc2 = mentionCounts.get(e2.id) || 0

          const { confidence, reasons } = scoreDuplicatePair(
            { id: e1.id, name: e1.name, type: e1.type, mentionCount: mc1 },
            { id: e2.id, name: e2.name, type: e2.type, mentionCount: mc2 }
          )

          if (confidence >= minConfidence) {
            candidates.push({
              entity1: { id: e1.id, name: e1.name, type: e1.type, mentionCount: mc1 },
              entity2: { id: e2.id, name: e2.name, type: e2.type, mentionCount: mc2 },
              confidence,
              reasons,
            })
          }
        }
      }
    }
  }

  // Sort by confidence descending, then by combined mention count
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    return (b.entity1.mentionCount + b.entity2.mentionCount) - (a.entity1.mentionCount + a.entity2.mentionCount)
  })

  return candidates.slice(0, limit)
}

/**
 * Merge two entities: reassign all references from removeId to keepId.
 *
 * This:
 * 1. Reassigns article_entities from removeId to keepId (skipping conflicts)
 * 2. Reassigns story_entities from removeId to keepId (skipping conflicts)
 * 3. Reassigns entity_relationships from removeId to keepId (skipping conflicts)
 * 4. Updates entity_summaries mention count on the kept entity
 * 5. Stores the removed entity's name as an alias in the kept entity's metadata
 * 6. Deletes the removed entity (cascades to entity_summaries)
 */
export async function mergeEntities(keepId: number, removeId: number): Promise<MergeResult> {
  const db = getDatabase()

  // Verify both entities exist
  const [keepEntity] = await db
    .select({ id: entities.id, name: entities.name, type: entities.type, metadata: entities.metadata })
    .from(entities)
    .where(eq(entities.id, keepId))
    .limit(1)

  const [removeEntity] = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .where(eq(entities.id, removeId))
    .limit(1)

  if (!keepEntity) throw new Error(`Keep entity ${keepId} not found`)
  if (!removeEntity) throw new Error(`Remove entity ${removeId} not found`)
  if (keepEntity.type !== removeEntity.type) {
    throw new Error(`Cannot merge entities of different types: ${keepEntity.type} vs ${removeEntity.type}`)
  }

  console.log(`Merging entity "${removeEntity.name}" (${removeId}) into "${keepEntity.name}" (${keepId})`)

  let articleEntitiesReassigned = 0
  let storyEntitiesReassigned = 0
  let duplicateArticleEntitiesRemoved = 0
  let duplicateStoryEntitiesRemoved = 0

  // ── Step 1: Reassign article_entities ──────────────────────────────────
  // Find which articles already have the keepId entity
  const existingArticleLinks = await db
    .select({ articleId: articleEntities.articleId })
    .from(articleEntities)
    .where(eq(articleEntities.entityId, keepId))

  const existingArticleIds = new Set(existingArticleLinks.map(l => l.articleId))

  // Find article_entities for removeId
  const removeArticleLinks = await db
    .select({ id: articleEntities.id, articleId: articleEntities.articleId })
    .from(articleEntities)
    .where(eq(articleEntities.entityId, removeId))

  // Split into reassign vs delete (conflicts)
  const toReassignArticle: number[] = []
  const toDeleteArticle: number[] = []
  for (const link of removeArticleLinks) {
    if (existingArticleIds.has(link.articleId)) {
      toDeleteArticle.push(link.id)
    } else {
      toReassignArticle.push(link.id)
    }
  }

  // Reassign non-conflicting rows
  if (toReassignArticle.length > 0) {
    await db
      .update(articleEntities)
      .set({ entityId: keepId })
      .where(inArray(articleEntities.id, toReassignArticle))
    articleEntitiesReassigned = toReassignArticle.length
  }

  // Delete conflicting rows (article already linked to keepId)
  if (toDeleteArticle.length > 0) {
    await db
      .delete(articleEntities)
      .where(inArray(articleEntities.id, toDeleteArticle))
    duplicateArticleEntitiesRemoved = toDeleteArticle.length
  }

  // ── Step 2: Reassign story_entities ────────────────────────────────────
  const existingStoryLinks = await db
    .select({ storyId: storyEntities.storyId })
    .from(storyEntities)
    .where(eq(storyEntities.entityId, keepId))

  const existingStoryIds = new Set(existingStoryLinks.map(l => l.storyId))

  const removeStoryLinks = await db
    .select({ id: storyEntities.id, storyId: storyEntities.storyId })
    .from(storyEntities)
    .where(eq(storyEntities.entityId, removeId))

  const toReassignStory: number[] = []
  const toDeleteStory: number[] = []
  for (const link of removeStoryLinks) {
    if (existingStoryIds.has(link.storyId)) {
      toDeleteStory.push(link.id)
    } else {
      toReassignStory.push(link.id)
    }
  }

  if (toReassignStory.length > 0) {
    await db
      .update(storyEntities)
      .set({ entityId: keepId })
      .where(inArray(storyEntities.id, toReassignStory))
    storyEntitiesReassigned = toReassignStory.length
  }

  if (toDeleteStory.length > 0) {
    await db
      .delete(storyEntities)
      .where(inArray(storyEntities.id, toDeleteStory))
    duplicateStoryEntitiesRemoved = toDeleteStory.length
  }

  // ── Step 3: Reassign entity_relationships ──────────────────────────────
  // Update source_entity_id references
  try {
    // Delete relationships that would create duplicates, then reassign the rest
    // First handle source_entity_id
    // Delete conflicting source relationships (and self-referencing)
    await db
      .delete(entityRelationships)
      .where(
        and(
          eq(entityRelationships.sourceEntityId, removeId),
          sql`(${entityRelationships.targetEntityId} = ${keepId} OR ${entityRelationships.targetEntityId} IN (
            SELECT target_entity_id FROM entity_relationships WHERE source_entity_id = ${keepId}
          ))`
        )
      )

    // Reassign remaining source relationships
    await db
      .update(entityRelationships)
      .set({ sourceEntityId: keepId })
      .where(eq(entityRelationships.sourceEntityId, removeId))

    // Now handle target_entity_id
    // Delete conflicting target relationships (and self-referencing)
    await db
      .delete(entityRelationships)
      .where(
        and(
          eq(entityRelationships.targetEntityId, removeId),
          sql`(${entityRelationships.sourceEntityId} = ${keepId} OR ${entityRelationships.sourceEntityId} IN (
            SELECT source_entity_id FROM entity_relationships WHERE target_entity_id = ${keepId}
          ))`
        )
      )

    // Reassign remaining target relationships
    await db
      .update(entityRelationships)
      .set({ targetEntityId: keepId })
      .where(eq(entityRelationships.targetEntityId, removeId))
  } catch (err) {
    console.warn(`Warning: could not fully reassign entity_relationships:`, err)
  }

  // ── Step 4: Update mention count on kept entity's summary ──────────────
  const [newMentionCount] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(articleEntities)
    .where(eq(articleEntities.entityId, keepId))

  const updatedMentions = newMentionCount?.count || 0

  // Update entity_summaries if it exists
  await db
    .update(entitySummaries)
    .set({ mentionCount: updatedMentions, lastUpdated: new Date() })
    .where(eq(entitySummaries.entityId, keepId))

  // ── Step 5: Store alias in kept entity's metadata ──────────────────────
  const existingMetadata = (keepEntity.metadata as Record<string, any>) || {}
  const aliases: string[] = existingMetadata.aliases || []
  if (!aliases.includes(removeEntity.name)) {
    aliases.push(removeEntity.name)
  }

  await db
    .update(entities)
    .set({
      metadata: { ...existingMetadata, aliases },
      updatedAt: new Date(),
    })
    .where(eq(entities.id, keepId))

  // ── Step 6: Delete the removed entity ──────────────────────────────────
  // entity_summaries has onDelete: 'cascade', so it will be cleaned up
  // entity_relationships also has onDelete: 'cascade'
  await db
    .delete(entities)
    .where(eq(entities.id, removeId))

  const result: MergeResult = {
    keepEntity: { id: keepId, name: keepEntity.name },
    removedEntity: { id: removeId, name: removeEntity.name },
    articleEntitiesReassigned,
    storyEntitiesReassigned,
    duplicateArticleEntitiesRemoved,
    duplicateStoryEntitiesRemoved,
  }

  console.log(`Merge complete:`)
  console.log(`  - article_entities reassigned: ${articleEntitiesReassigned}, conflicts removed: ${duplicateArticleEntitiesRemoved}`)
  console.log(`  - story_entities reassigned: ${storyEntitiesReassigned}, conflicts removed: ${duplicateStoryEntitiesRemoved}`)
  console.log(`  - Updated mention count: ${updatedMentions}`)
  console.log(`  - Added alias: "${removeEntity.name}"`)
  console.log(`  - Deleted entity: ${removeId}`)

  return result
}
