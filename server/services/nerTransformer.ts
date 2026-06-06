import { getModelPipeline, MODELS, recordInference } from './transformerService.js';
import type { Entity, EntityExtractionResult } from './entityExtractor.js';

/**
 * BERT NER label mapping
 * BERT-base-NER uses CoNLL-2003 labels: PER, ORG, LOC, MISC
 */
const LABEL_MAP: Record<string, 'person' | 'organization' | 'location' | 'event' | null> = {
  'PER': 'person',
  'PERSON': 'person',
  'ORG': 'organization',
  'ORGANIZATION': 'organization',
  'LOC': 'location',
  'LOCATION': 'location',
  'GPE': 'location', // Geopolitical entity
  'MISC': null, // We'll handle MISC separately for events
  'EVENT': 'event',
  'FAC': 'location', // Facility
};

/**
 * Event keywords to identify MISC entities as events
 */
const EVENT_KEYWORDS = [
  'olympics', 'summit', 'conference', 'war', 'crisis', 'election',
  'championship', 'cup', 'games', 'festival', 'awards', 'attack',
  'referendum', 'treaty', 'accord', 'deal', 'accord', 'protocol',
  'cop', 'g7', 'g20', 'nato', 'davos'
];

/**
 * Check if a name likely represents an event
 */
function isLikelyEvent(name: string): boolean {
  const lower = name.toLowerCase();
  return EVENT_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Calculate relevance score based on entity properties
 */
function calculateRelevance(
  entity: any,
  position: number,
  totalEntities: number
): number {
  // Base score from model confidence
  let score = entity.score || 0.5;

  // Boost entities that appear early in text
  const positionBoost = 1 - (position / (totalEntities + 1)) * 0.3;
  score *= positionBoost;

  // Ensure score is between 0 and 1
  return Math.max(0, Math.min(1, score));
}

/**
 * Count mentions of an entity in the text
 */
function countMentions(text: string, entityName: string): number {
  // Case-insensitive search
  const regex = new RegExp(entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 1;
}

/**
 * Merge overlapping or duplicate entities
 */
function mergeEntities(entities: any[]): any[] {
  const merged: any[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    // Create a normalized key for deduplication
    const key = `${entity.word.toLowerCase()}_${entity.entity_group || entity.entity}`;

    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entity);
    } else {
      // Update existing entity (increase score if duplicate found)
      const existing = merged.find(
        e => e.word.toLowerCase() === entity.word.toLowerCase()
      );
      if (existing) {
        existing.score = Math.max(existing.score, entity.score);
      }
    }
  }

  return merged;
}

/**
 * Normalize entity names (similar to entityExtractor.ts)
 */
function normalizeEntityName(name: string): string {
  const normalizations: Record<string, string> = {
    'US': 'United States',
    'USA': 'United States',
    'U.S.': 'United States',
    'U.S.A.': 'United States',
    'UK': 'United Kingdom',
    'U.K.': 'United Kingdom',
    'UAE': 'United Arab Emirates',
    'U.A.E.': 'United Arab Emirates',
    'UN': 'United Nations',
    'U.N.': 'United Nations',
    'WHO': 'World Health Organization',
    'NATO': 'NATO',
    'EU': 'European Union',
    'E.U.': 'European Union',
  };

  return normalizations[name] || name;
}

/**
 * Extract named entities using Transformers.js BERT NER model
 */
export async function extractEntitiesWithTransformer(
  title: string,
  content: string
): Promise<EntityExtractionResult> {
  try {
    const startTime = Date.now();

    // Load the NER model
    const ner = await getModelPipeline('token-classification', MODELS.NER, {
      aggregation_strategy: 'simple', // Group tokens into entities
    });

    // Combine title and content (limit to 2000 chars like Ollama version)
    const text = `${title}\n\n${content.substring(0, 2000)}`;

    // Run NER inference
    const rawEntities = await ner(text);

    // Process and filter entities
    const processedEntities: Entity[] = [];
    const mergedEntities = mergeEntities(rawEntities);

    for (let i = 0; i < mergedEntities.length; i++) {
      const entity = mergedEntities[i];
      const entityLabel = (entity.entity_group || entity.entity).replace(/^[BI]-/, ''); // Remove B- and I- prefixes
      const mappedType = LABEL_MAP[entityLabel];

      // Skip if we can't map the label
      if (!mappedType && !isLikelyEvent(entity.word)) {
        continue;
      }

      // Determine entity type
      let entityType: 'person' | 'organization' | 'location' | 'event';
      if (mappedType) {
        entityType = mappedType;
      } else if (isLikelyEvent(entity.word)) {
        entityType = 'event';
      } else {
        continue; // Skip unmapped entities
      }

      // Clean up entity name
      let entityName = entity.word.trim();

      // Skip WordPiece fragments (start with ##)
      if (entityName.startsWith('##')) {
        console.warn(`[NER Transformer] Skipping WordPiece fragment: ${entityName}`);
        continue;
      }

      // Remove any remaining ## symbols (shouldn't happen, but defensive)
      entityName = entityName.replace(/##/g, '');

      // Normalize entity name
      entityName = normalizeEntityName(entityName);

      // Skip very short names (likely errors)
      if (entityName.length < 2) {
        continue;
      }

      // Skip common false positives for locations
      if (entityType === 'location') {
        const invalidLocations = ['white', 'black', 'office', 'west', 'east', 'north', 'south'];
        if (invalidLocations.includes(entityName.toLowerCase())) {
          continue;
        }
      }

      // Calculate relevance and mentions
      const relevance = calculateRelevance(entity, i, mergedEntities.length);
      const mentions = countMentions(text, entityName);

      processedEntities.push({
        name: entityName,
        type: entityType,
        relevance,
        mentions,
      });
    }

    // Filter by relevance and sort
    const filteredEntities = processedEntities
      .filter(e => e.relevance >= 0.3)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10); // Max 10 entities

    const inferenceTime = Date.now() - startTime;
    recordInference(MODELS.NER, inferenceTime);

    console.log(`[NER Transformer] Extracted ${filteredEntities.length} entities in ${inferenceTime}ms`);

    return {
      entities: filteredEntities,
      success: true,
    };
  } catch (error) {
    console.error('[NER Transformer] Error extracting entities:', error);

    return {
      entities: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Compare NER results from Transformer vs Ollama
 * Useful for A/B testing and quality comparison
 */
export interface NERComparison {
  transformer: EntityExtractionResult;
  ollama: EntityExtractionResult;
  transformerTime: number;
  ollamaTime: number;
  speedup: number;
  entityOverlap: number; // Percentage of entities found by both
  uniqueToTransformer: Entity[];
  uniqueToOllama: Entity[];
}

export async function compareNERMethods(
  title: string,
  content: string,
  ollamaExtractor: (title: string, content: string) => Promise<EntityExtractionResult>
): Promise<NERComparison> {
  // Run both methods in parallel
  const [transformerResult, ollamaResult] = await Promise.all([
    (async () => {
      const start = Date.now();
      const result = await extractEntitiesWithTransformer(title, content);
      return { result, time: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const result = await ollamaExtractor(title, content);
      return { result, time: Date.now() - start };
    })(),
  ]);

  // Calculate overlap
  const transformerNames = new Set(
    transformerResult.result.entities.map(e => e.name.toLowerCase())
  );
  const ollamaNames = new Set(
    ollamaResult.result.entities.map(e => e.name.toLowerCase())
  );

  const commonEntities = [...transformerNames].filter(name =>
    ollamaNames.has(name)
  ).length;

  const totalUnique = new Set([...transformerNames, ...ollamaNames]).size;
  const overlap = totalUnique > 0 ? (commonEntities / totalUnique) * 100 : 0;

  // Find unique entities
  const uniqueToTransformer = transformerResult.result.entities.filter(
    e => !ollamaNames.has(e.name.toLowerCase())
  );
  const uniqueToOllama = ollamaResult.result.entities.filter(
    e => !transformerNames.has(e.name.toLowerCase())
  );

  return {
    transformer: transformerResult.result,
    ollama: ollamaResult.result,
    transformerTime: transformerResult.time,
    ollamaTime: ollamaResult.time,
    speedup: ollamaResult.time / transformerResult.time,
    entityOverlap: overlap,
    uniqueToTransformer,
    uniqueToOllama,
  };
}
