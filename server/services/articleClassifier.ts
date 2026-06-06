import { getDatabase } from '../database/db.js'
import { articles, feeds, classifications, entities as entitiesTable, articleEntities } from '../database/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { detectLanguage, iso3ToIso1 } from './languageDetector.js'
import { classifyBias, getBiasLabel, type BiasResult } from './biasClassifier.js'
import { extractEntities, extractGeoPOV, normalizeEntityName, type Entity } from './entityExtractor.js'
import { extractArticleFeatures, storeArticleFeatures } from './articleFeatureExtractor.js'

/**
 * Generate a URL-safe slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // Remove special chars
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/-+/g, '-')            // Replace multiple hyphens
    .replace(/^-|-$/g, '')          // Trim leading/trailing hyphens
}

/**
 * Store extracted entities in the database for a given article.
 * Creates new entity records if needed, links entities to the article,
 * and deduplicates entity links by entityId.
 *
 * Returns the number of entity links stored.
 */
export async function storeArticleEntities(articleId: number, extractedEntities: Entity[]): Promise<number> {
  if (extractedEntities.length === 0) return 0

  const db = getDatabase()

  // Normalize all entity names
  const normalizedEntities = extractedEntities.map(entity => ({
    ...entity,
    normalizedName: normalizeEntityName(entity.name, entity.type)
  }))

  // Batch check: Get all existing entities in one query
  const normalizedNames = normalizedEntities.map(e => e.normalizedName)
  const existingEntities = await db
    .select()
    .from(entitiesTable)
    .where(inArray(entitiesTable.canonicalName, normalizedNames))

  // Build a map for quick lookup — prefer the lowest ID (canonical entity) when duplicates exist
  const existingMap = new Map<string, number>()
  for (const e of existingEntities) {
    if (!e.canonicalName) continue
    const current = existingMap.get(e.canonicalName)
    if (!current || e.id < current) {
      existingMap.set(e.canonicalName, e.id)
    }
  }

  // For person entities not found by exact match, try matching without middle initials
  // e.g., "Donald J Trump" should match existing "Donald Trump"
  const unmatchedPersons = normalizedEntities.filter(
    e => !existingMap.has(e.normalizedName) && e.type === 'person'
  )
  if (unmatchedPersons.length > 0) {
    for (const entity of unmatchedPersons) {
      // Strip single-letter words (middle initials): "Donald J Trump" → "Donald Trump"
      const withoutInitials = entity.normalizedName
        .replace(/\s+\b[A-Z]\b\s+/g, ' ')  // Remove standalone single letters between words
        .replace(/\s+/g, ' ')
        .trim()

      if (withoutInitials !== entity.normalizedName) {
        // Check if the stripped version matches an existing entity
        const [match] = await db
          .select({ id: entitiesTable.id, canonicalName: entitiesTable.canonicalName })
          .from(entitiesTable)
          .where(eq(entitiesTable.canonicalName, withoutInitials))
          .orderBy(entitiesTable.id)
          .limit(1)
        if (match) {
          existingMap.set(entity.normalizedName, match.id)
          continue
        }
      }

      // Also check the reverse: if "Donald Trump" is the new name,
      // see if an existing entity like "Donald J Trump" exists whose stripped form matches
      // This is handled by the DB having the canonical version, so less common
    }
  }

  // Separate new entities from existing ones
  const newEntities = normalizedEntities.filter(e => !existingMap.has(e.normalizedName))
  const articleEntityLinks: any[] = []

  // Insert new entities one at a time to handle race conditions
  for (const entity of newEntities) {
    // Double-check this canonical name wasn't just inserted by another entity in this batch
    if (existingMap.has(entity.normalizedName)) continue

    try {
      const [inserted] = await db
        .insert(entitiesTable)
        .values({
          type: entity.type,
          subtype: entity.subtype || null,
          name: entity.name,
          canonicalName: entity.normalizedName,
          slug: generateSlug(entity.normalizedName),
        })
        .onConflictDoNothing()
        .returning({ id: entitiesTable.id, canonicalName: entitiesTable.canonicalName })

      if (inserted) {
        existingMap.set(inserted.canonicalName!, inserted.id)
      } else {
        // Conflict: entity was inserted by another process, look it up
        const [existing] = await db
          .select({ id: entitiesTable.id })
          .from(entitiesTable)
          .where(eq(entitiesTable.canonicalName, entity.normalizedName))
          .orderBy(entitiesTable.id)
          .limit(1)
        if (existing) {
          existingMap.set(entity.normalizedName, existing.id)
        }
      }
    } catch (err) {
      // Fallback: look up existing entity on any insert error
      const [existing] = await db
        .select({ id: entitiesTable.id })
        .from(entitiesTable)
        .where(eq(entitiesTable.canonicalName, entity.normalizedName))
        .orderBy(entitiesTable.id)
        .limit(1)
      if (existing) {
        existingMap.set(entity.normalizedName, existing.id)
      }
    }
  }

  // Backfill subtypes for existing entities that don't have one yet
  for (const entity of normalizedEntities) {
    if (entity.subtype) {
      const existing = existingEntities.find(e => e.canonicalName === entity.normalizedName)
      if (existing && !existing.subtype) {
        await db.update(entitiesTable)
          .set({ subtype: entity.subtype })
          .where(eq(entitiesTable.id, existing.id))
      }
    }
  }

  // Build all article-entity links with OSINT role
  for (const entity of normalizedEntities) {
    const entityId = existingMap.get(entity.normalizedName)
    if (entityId) {
      articleEntityLinks.push({
        articleId,
        entityId,
        relevanceScore: entity.relevance,
        mentionCount: entity.mentions,
        role: entity.role || 'neutral',
      })
    }
  }

  // Deduplicate by entityId (keep highest relevance, sum mentions, prefer non-neutral role)
  const deduplicatedLinks = new Map<number, typeof articleEntityLinks[0]>()
  for (const link of articleEntityLinks) {
    const existing = deduplicatedLinks.get(link.entityId)
    if (!existing) {
      deduplicatedLinks.set(link.entityId, link)
    } else {
      existing.relevanceScore = Math.max(existing.relevanceScore, link.relevanceScore)
      existing.mentionCount += link.mentionCount
      if (existing.role === 'neutral' && link.role !== 'neutral') {
        existing.role = link.role
      }
    }
  }
  const uniqueLinks = Array.from(deduplicatedLinks.values())

  // Batch insert: Link all entities to article at once
  if (uniqueLinks.length > 0) {
    await db.insert(articleEntities).values(uniqueLinks)
  }

  return uniqueLinks.length
}

export interface ClassificationResult {
  success: boolean
  articleId: number
  language?: string
  bias?: number
  biasLabel?: string
  geoPov?: string | null
  entityCount?: number
  framing?: string | null
  sensationalism?: number | null
  factuality?: number | null
  claimCount?: number
  error?: string
}

/**
 * Classify a single article (language, bias, entities)
 */
export async function classifyArticle(articleId: number, useOllama: boolean = true): Promise<ClassificationResult> {
  const db = getDatabase()

  try {
    // 1. Get article and feed info
    const [article] = await db
      .select({
        id: articles.id,
        feedId: articles.feedId,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
        knownBias: feeds.knownBias,
      })
      .from(articles)
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!article) {
      throw new Error(`Article ${articleId} not found`)
    }

    // Use full content if available, otherwise use snippet
    const textToAnalyze = article.fullContent || article.content || ''

    if (textToAnalyze.length < 100) {
      throw new Error('Article content too short for classification')
    }

    console.log(`Classifying article ${articleId}: ${article.title.substring(0, 50)}...`)

    // 2. Language detection
    const langResult = detectLanguage(textToAnalyze)
    const language = iso3ToIso1(langResult.language)

    console.log(`  Language: ${language} (confidence: ${langResult.confidence.toFixed(2)})`)

    // 2b. Skip disabled languages to save AI tokens
    const DISABLED_LANGUAGES = ['fr', 'de', 'es']
    if (DISABLED_LANGUAGES.includes(language)) {
      console.log(`  ⏭️  Skipping ${language} article (language disabled)`)

      // Store minimal classification so it doesn't get re-queued
      await db
        .insert(classifications)
        .values({
          articleId: article.id,
          language,
          politicalBias: null,
          confidence: langResult.confidence,
          method: 'skipped',
          entityExtractionDone: false,
          featureExtractionDone: false,
          processingMetadata: {
            languageConfidence: langResult.confidence,
            skippedReason: 'language_disabled',
            timestamp: new Date().toISOString(),
          },
        })

      // Mark as processed so pipeline doesn't retry
      await db
        .update(articles)
        .set({ processingStatus: 'grouped' })
        .where(eq(articles.id, articleId))

      return {
        success: true,
        articleId: article.id,
        language,
        bias: undefined,
        biasLabel: 'skipped',
        geoPov: null,
        entityCount: 0,
      }
    }

    // 3. Political bias classification (language-aware)
    // Skip AI bias analysis for thin content (<300 chars) — not enough signal to detect bias
    // Still use rule-based (known feed bias) if available
    const isContentThin = textToAnalyze.length < 300
    let biasResult: BiasResult

    if (isContentThin && article.knownBias === null) {
      // Thin content + unknown source → set bias to null (low confidence)
      biasResult = {
        bias: 0,
        confidence: 0.1,
        method: 'rule-based',
        reasoning: 'Content too short for reliable bias detection',
      }
      console.log(`  Bias: SKIPPED (content too short: ${textToAnalyze.length} chars)`)
    } else {
      biasResult = await classifyBias(
        article.title,
        textToAnalyze,
        article.knownBias,
        useOllama,
        language
      )
      console.log(`  Bias: ${getBiasLabel(biasResult.bias)} (${biasResult.bias.toFixed(2)}, method: ${biasResult.method})`)
    }
    const biasLabel = getBiasLabel(biasResult.bias)

    // 4. Entity extraction
    let extractedEntities: any[] = []
    let geoPov: string | null = null

    // Check if Transformers.js NER is enabled
    const useTransformersForNER = process.env.USE_TRANSFORMERS_FOR_NER === 'true'

    if (useTransformersForNER) {
      // Use Transformers.js for NER (faster, CPU-based)
      const { extractEntitiesWithTransformer } = await import('./nerTransformer.js')
      const entityResult = await extractEntitiesWithTransformer(article.title, textToAnalyze)

      if (entityResult.success) {
        extractedEntities = entityResult.entities
        geoPov = extractGeoPOV(extractedEntities)
        console.log(`  Entities: ${extractedEntities.length} found (Transformers.js)`)
        if (geoPov) {
          console.log(`  Geographic POV: ${geoPov}`)
        }
      } else {
        console.log(`  Entity extraction failed: ${entityResult.error}`)
      }
    } else if (useOllama) {
      // Use Ollama for NER (slower, GPU-based)
      const entityResult = await extractEntities(article.title, textToAnalyze)

      if (entityResult.success) {
        extractedEntities = entityResult.entities
        geoPov = extractGeoPOV(extractedEntities)
        console.log(`  Entities: ${extractedEntities.length} found (Ollama)`)
        if (geoPov) {
          console.log(`  Geographic POV: ${geoPov}`)
        }
      } else {
        console.log(`  Entity extraction failed: ${entityResult.error}`)
      }
    }

    // 5. Feature extraction (framing, factuality, sensationalism, claims)
    console.log(`  Extracting article features...`)
    const featureResult = await extractArticleFeatures(article.title, textToAnalyze, language)
    if (featureResult.success) {
      console.log(`  Framing: ${featureResult.primaryFraming}${featureResult.secondaryFraming ? ' / ' + featureResult.secondaryFraming : ''}`)
      console.log(`  Type: ${featureResult.articleType} | Sensationalism: ${featureResult.sensationalism.toFixed(2)} | Factuality: ${featureResult.factOpinionRatio.toFixed(2)}`)
      console.log(`  Claims: ${featureResult.claims.length} extracted`)
    } else {
      console.log(`  Feature extraction failed: ${featureResult.error}`)
    }

    // 6. Store classification in database with OSINT metadata + features
    const [classification] = await db
      .insert(classifications)
      .values({
        articleId: article.id,
        language,
        politicalBias: (isContentThin && article.knownBias === null) ? null : biasResult.bias,
        geoPov,
        confidence: Math.min(langResult.confidence, biasResult.confidence),
        method: biasResult.method,
        entityExtractionDone: extractedEntities.length > 0,
        primaryFraming: featureResult.primaryFraming,
        secondaryFraming: featureResult.secondaryFraming,
        articleType: featureResult.articleType,
        sensationalism: featureResult.sensationalism,
        factOpinionRatio: featureResult.factOpinionRatio,
        sourceCountCited: featureResult.sourceCountCited,
        featureExtractionDone: featureResult.success,
        processingMetadata: {
          languageConfidence: langResult.confidence,
          biasConfidence: biasResult.confidence,
          biasReasoning: biasResult.reasoning,
          timestamp: new Date().toISOString(),
        },
        metadata: {
          // OSINT analysis results
          techniques: biasResult.techniques || [],
          osintClassification: biasResult.classification,
          analysisVersion: '3.0-features',
        },
      })
      .returning({ id: classifications.id })

    // 6b. Store claims in articleClaims table
    if (featureResult.claims.length > 0) {
      const { articleClaims: articleClaimsTable } = await import('../database/schema.js')
      await db.insert(articleClaimsTable).values(
        featureResult.claims.map(claim => ({
          articleId: article.id,
          claimText: claim.text,
          attribution: claim.attribution,
          claimType: claim.type,
          confidence: claim.confidence,
        }))
      )
    }

    // 7. Store entities (optimized batch operations)
    if (extractedEntities.length > 0) {
      await storeArticleEntities(article.id, extractedEntities)
    }

    // 8. Update article processing status
    await db
      .update(articles)
      .set({
        processingStatus: 'grouped',
      })
      .where(eq(articles.id, articleId))

    console.log(`  ✅ Classification complete`)

    return {
      success: true,
      articleId: article.id,
      language,
      bias: biasResult.bias,
      biasLabel,
      geoPov,
      entityCount: extractedEntities.length,
      framing: featureResult.primaryFraming,
      sensationalism: featureResult.sensationalism,
      factuality: featureResult.factOpinionRatio,
      claimCount: featureResult.claims.length,
    }
  } catch (error) {
    console.error(`Failed to classify article ${articleId}:`, error)

    return {
      success: false,
      articleId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get articles pending classification
 */
export async function getPendingClassification(limit: number = 10) {
  const db = getDatabase()

  return await db
    .select({
      id: articles.id,
      title: articles.title,
      contentExtracted: articles.contentExtracted,
    })
    .from(articles)
    .where(eq(articles.processingStatus, 'pending'))
    .limit(limit)
}
