import { pgTable, serial, text, timestamp, varchar, integer, real, jsonb, index, unique, uniqueIndex, customType, boolean, bigint } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// Custom vector type for pgvector
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 768})`
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value)
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value)
  },
})

// Feeds table - RSS feed sources
export const feeds = pgTable('feeds', {
  id: serial('id').primaryKey(),
  url: varchar('url', { length: 2048 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  knownBias: real('known_bias'), // -1 to 1 scale
  region: varchar('region', { length: 100 }),
  language: varchar('language', { length: 10 }).default('en'), // ISO 639-1 language code
  isActive: integer('is_active').default(1).notNull(), // 1 = active, 0 = inactive
  extractionMethod: varchar('extraction_method', { length: 20 }).default('readability'), // 'readability', 'puppeteer' — per-feed override
  lastFetchedAt: timestamp('last_fetched_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  urlIdx: index('feeds_url_idx').on(table.url),
  categoryIdx: index('feeds_category_idx').on(table.category),
  regionIdx: index('feeds_region_idx').on(table.region),
  languageIdx: index('feeds_language_idx').on(table.language),
}))

// Articles table - News articles
export const articles = pgTable('articles', {
  id: serial('id').primaryKey(),
  feedId: integer('feed_id').references(() => feeds.id).notNull(),
  storyId: integer('story_id').references(() => stories.id), // Direct FK for performance
  title: text('title').notNull(),
  content: text('content'), // RSS snippet/summary
  fullContent: text('full_content'), // Extracted article content
  url: varchar('url', { length: 2048 }).notNull().unique(),
  author: varchar('author', { length: 255 }),
  publishedAt: timestamp('published_at'),
  contentHash: varchar('content_hash', { length: 64 }).notNull(), // SHA-256 hash
  processingStatus: varchar('processing_status', { length: 50 }).default('pending'), // 'pending', 'grouped', 'refined'
  contentExtracted: boolean('content_extracted').default(false),
  extractionStatus: varchar('extraction_status', { length: 50 }).default('pending'), // 'pending', 'success', 'partial', 'failed', 'fallback', 'skipped'
  extractionError: text('extraction_error'),
  extractedAt: timestamp('extracted_at'),
  autoGroupedAt: timestamp('auto_grouped_at'),
  manualReviewedAt: timestamp('manual_reviewed_at'),
  imageUrl: varchar('image_url', { length: 2048 }), // OG image URL
  imageLocalPath: varchar('image_local_path', { length: 512 }), // Local storage path
  imageFetchedAt: timestamp('image_fetched_at'),
  imageFetchStatus: varchar('image_fetch_status', { length: 50 }).default('pending'), // 'pending', 'success', 'failed', 'skipped'
  excluded: boolean('excluded').default(false).notNull(), // Excluded from all views (spam, irrelevant content)
  rawData: jsonb('raw_data'), // Store original RSS data
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  urlIdx: index('articles_url_idx').on(table.url),
  feedIdIdx: index('articles_feed_id_idx').on(table.feedId),
  storyIdIdx: index('articles_story_id_idx').on(table.storyId),
  publishedAtIdx: index('articles_published_at_idx').on(table.publishedAt),
  publishedAtDescIdx: index('articles_published_at_desc_idx').on(table.publishedAt.desc()), // For trending queries
  contentHashIdx: index('articles_content_hash_idx').on(table.contentHash),
  processingStatusIdx: index('articles_processing_status_idx').on(table.processingStatus),
  extractionStatusIdx: index('articles_extraction_status_idx').on(table.extractionStatus),
  storyPublishedIdx: index('articles_story_published_idx').on(table.storyId, table.publishedAt.desc()),
  excludedExtractedPublishedIdx: index('articles_excluded_extracted_published_idx').on(table.excluded, table.contentExtracted, table.publishedAt.desc()),
}))

// Classifications table - Article classifications
export const classifications = pgTable('classifications', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull(),
  language: varchar('language', { length: 10 }),
  politicalBias: real('political_bias'), // -1 (left) to 1 (right)
  geoPov: varchar('geo_pov', { length: 100 }), // Geographic point of view
  confidence: real('confidence'), // 0 to 1
  method: varchar('method', { length: 50 }), // 'rule-based', 'ollama', 'hybrid'
  entityExtractionDone: boolean('entity_extraction_done').default(false),
  primaryFraming: varchar('primary_framing', { length: 50 }), // e.g. 'economic_impact', 'human_rights', 'conflict'
  secondaryFraming: varchar('secondary_framing', { length: 50 }),
  articleType: varchar('article_type', { length: 30 }), // 'news_report', 'opinion', 'analysis', 'editorial', 'press_release'
  sensationalism: real('sensationalism'), // 0 (measured) to 1 (sensational)
  factOpinionRatio: real('fact_opinion_ratio'), // 0 (all opinion) to 1 (all facts)
  sourceCountCited: integer('source_count_cited'), // named sources in article
  propagandaRisk: real('propaganda_risk'), // 0 (credible) to 1 (propaganda-like)
  featureExtractionDone: boolean('feature_extraction_done').default(false),
  processingMetadata: jsonb('processing_metadata'), // For hybrid workflow tracking
  metadata: jsonb('metadata'), // Additional classification data
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index('classifications_article_id_idx').on(table.articleId),
  languageIdx: index('classifications_language_idx').on(table.language),
  biasIdx: index('classifications_bias_idx').on(table.politicalBias),
  primaryFramingIdx: index('classifications_primary_framing_idx').on(table.primaryFraming),
  sensationalismIdx: index('classifications_sensationalism_idx').on(table.sensationalism),
  factOpinionRatioIdx: index('classifications_fact_opinion_ratio_idx').on(table.factOpinionRatio),
  articleLanguageIdx: index('classifications_article_language_idx').on(table.articleId, table.language),
}))

// Article claims table - Extracted verifiable claims from articles
export const articleClaims = pgTable('article_claims', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull(),
  claimText: text('claim_text').notNull(),
  attribution: varchar('attribution', { length: 255 }), // who made the claim
  claimType: varchar('claim_type', { length: 50 }), // 'factual', 'quote', 'statistic', 'prediction'
  confidence: real('confidence'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index('article_claims_article_id_idx').on(table.articleId),
  claimTypeIdx: index('article_claims_claim_type_idx').on(table.claimType),
}))

// Article embeddings table - Vector embeddings for semantic search
export const articleEmbeddings = pgTable('article_embeddings', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull().unique(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(), // pgvector column for nomic-embed-text (768 dimensions)
  model: varchar('model', { length: 100 }).default('nomic-embed-text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index('article_embeddings_article_id_idx').on(table.articleId),
}))

// Stories table (formerly article_groups) - Clustered similar news stories
export const stories = pgTable('stories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  representativeTitle: text('representative_title'), // Best title for display
  description: text('description'),
  summary: text('summary'), // AI-generated story summary
  clusterMethod: varchar('cluster_method', { length: 50 }), // 'auto', 'refined', 'manual'
  centroidEmbedding: vector('centroid_embedding', { dimensions: 768 }), // Cluster centroid
  status: varchar('status', { length: 50 }).default('active'), // 'emerging', 'trending', 'active', 'declining'
  trendingScore: real('trending_score').default(0),
  articleCount: integer('article_count').default(0).notNull(),
  sourceCount: integer('source_count').default(0).notNull(), // Unique feed count
  sourceDiversityScore: real('source_diversity_score').default(0), // 0-1 based on bias/region diversity
  firstSeen: timestamp('first_seen').defaultNow().notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  topicLabel: varchar('topic_label', { length: 255 }),
  primaryLanguage: varchar('primary_language', { length: 10 }), // ISO 639-1 language code (majority language of member articles)
  primaryRegion: varchar('primary_region', { length: 100 }),
  primaryEntities: jsonb('primary_entities'),
  timeSpanHours: real('time_span_hours'),
  clusterVersion: varchar('cluster_version', { length: 10 }).default('v1'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  statusIdx: index('stories_status_idx').on(table.status),
  trendingScoreIdx: index('stories_trending_score_idx').on(table.trendingScore.desc()),
  lastUpdatedIdx: index('stories_last_updated_idx').on(table.lastUpdated.desc()),
  statusTrendingIdx: index('stories_status_trending_idx').on(table.status, table.trendingScore.desc()),
  primaryLanguageIdx: index('stories_primary_language_idx').on(table.primaryLanguage),
  primaryRegionIdx: index('stories_primary_region_idx').on(table.primaryRegion),
  clusterVersionIdx: index('stories_cluster_version_idx').on(table.clusterVersion),
}))

// Story members - Many-to-many relationship (formerly article_group_members)
export const storyMembers = pgTable('story_members', {
  id: serial('id').primaryKey(),
  storyId: integer('story_id').references(() => stories.id).notNull(),
  articleId: integer('article_id').references(() => articles.id).notNull(),
  similarity: real('similarity'), // Similarity score to centroid
  isRepresentative: boolean('is_representative').default(false), // Flag best article for story
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  storyArticleUnique: unique('story_article_unique').on(table.storyId, table.articleId),
  storyIdIdx: index('story_members_story_id_idx').on(table.storyId),
  articleIdIdx: index('story_members_article_id_idx').on(table.articleId),
  representativeIdx: index('story_members_representative_idx').on(table.storyId, table.isRepresentative),
}))

// Entities table - Named entities (people, organizations, locations, events, topics)
export const entities = pgTable('entities', {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(), // 'person', 'organization', 'location', 'event', 'topic'
  subtype: varchar('subtype', { length: 50 }), // Fine-grained classification (e.g., 'company', 'politician', 'country')
  name: varchar('name', { length: 255 }).notNull(),
  canonicalName: varchar('canonical_name', { length: 255 }), // Normalized name for deduplication
  slug: varchar('slug', { length: 255 }), // URL-friendly slug for entity pages
  metadata: jsonb('metadata'), // Additional entity data (aliases, descriptions, etc.)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  typeIdx: index('entities_type_idx').on(table.type),
  nameIdx: index('entities_name_idx').on(table.name),
  canonicalNameIdx: index('entities_canonical_name_idx').on(table.canonicalName),
  typeNameIdx: index('entities_type_name_idx').on(table.type, table.name),
  slugIdx: index('entities_slug_idx').on(table.slug),
}))

// Article entities - Links articles to entities they mention
export const articleEntities = pgTable('article_entities', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull(),
  entityId: integer('entity_id').references(() => entities.id).notNull(),
  relevanceScore: real('relevance_score').notNull(), // 0 to 1
  sentiment: varchar('sentiment', { length: 50 }), // 'positive', 'negative', 'neutral'
  role: varchar('role', { length: 20 }), // OSINT: 'protagonist', 'antagonist', 'neutral', 'context'
  mentionCount: integer('mention_count').default(1).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  articleEntityUnique: unique('article_entity_unique').on(table.articleId, table.entityId),
  articleIdIdx: index('article_entities_article_id_idx').on(table.articleId),
  entityIdIdx: index('article_entities_entity_id_idx').on(table.entityId),
  relevanceIdx: index('article_entities_relevance_idx').on(table.entityId, table.relevanceScore.desc()),
}))

// Story entities - Pre-computed entity → story mapping for performance
export const storyEntities = pgTable('story_entities', {
  id: serial('id').primaryKey(),
  storyId: integer('story_id').references(() => stories.id).notNull(),
  entityId: integer('entity_id').references(() => entities.id).notNull(),
  isPrimary: boolean('is_primary').default(false), // Main entity in the story
  relevance: real('relevance').notNull(), // Aggregated relevance from all articles
  articleCount: integer('article_count').default(1).notNull(), // How many articles mention this entity
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  storyEntityUnique: unique('story_entity_unique').on(table.storyId, table.entityId),
  storyIdIdx: index('story_entities_story_id_idx').on(table.storyId),
  entityIdIdx: index('story_entities_entity_id_idx').on(table.entityId),
  primaryIdx: index('story_entities_primary_idx').on(table.storyId, table.isPrimary),
  relevanceIdx: index('story_entities_relevance_idx').on(table.entityId, table.relevance.desc()),
}))

// Entity summaries - AI-generated summaries and metadata for entities
export const entitySummaries = pgTable('entity_summaries', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').references(() => entities.id, { onDelete: 'cascade' }).notNull().unique(),
  summary: text('summary'), // LLM-generated summary (150-200 words)
  shortDescription: varchar('short_description', { length: 500 }), // One-line description
  imageUrl: varchar('image_url', { length: 1000 }), // Primary image URL
  wikiUrl: varchar('wiki_url', { length: 500 }), // Wikipedia/external link
  mentionCount: integer('mention_count').default(0).notNull(), // Total mentions across articles
  trendingScore: real('trending_score').default(0), // Trending score (0-1)
  metadata: jsonb('metadata'), // Additional data (aliases, categories, etc.)
  generatedAt: timestamp('generated_at').defaultNow(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  entityIdIdx: index('entity_summaries_entity_id_idx').on(table.entityId),
  trendingIdx: index('entity_summaries_trending_idx').on(table.trendingScore.desc()),
  mentionCountIdx: index('entity_summaries_mention_count_idx').on(table.mentionCount.desc()),
  lastUpdatedIdx: index('entity_summaries_last_updated_idx').on(table.lastUpdated.desc()),
}))

// Story coverage - Denormalized coverage diversity metrics
export const storyCoverage = pgTable('story_coverage', {
  id: serial('id').primaryKey(),
  storyId: integer('story_id').references(() => stories.id).notNull().unique(),
  leftCount: integer('left_count').default(0).notNull(), // Articles from left-bias sources
  centerCount: integer('center_count').default(0).notNull(), // Articles from center-bias sources
  rightCount: integer('right_count').default(0).notNull(), // Articles from right-bias sources
  regionsJson: jsonb('regions_json'), // JSON array of covered regions
  totalSources: integer('total_sources').default(0).notNull(),
  coverageDiversityScore: real('coverage_diversity_score').default(0), // 0-1 score
  framingDistribution: jsonb('framing_distribution'), // { "economic_impact": 5, "conflict": 3, ... }
  avgSensationalism: real('avg_sensationalism'),
  avgFactuality: real('avg_factuality'),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
}, (table) => ({
  storyIdIdx: index('story_coverage_story_id_idx').on(table.storyId),
  diversityIdx: index('story_coverage_diversity_idx').on(table.coverageDiversityScore.desc()),
}))

// Story metrics - Time-series metrics for trending detection
export const storyMetrics = pgTable('story_metrics', {
  id: serial('id').primaryKey(),
  storyId: integer('story_id').references(() => stories.id).notNull(),
  dateHour: timestamp('date_hour').notNull(), // Hourly buckets
  articleCount: integer('article_count').default(0).notNull(),
  velocity: real('velocity').default(0), // Articles per hour
  trendingScore: real('trending_score').default(0),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (table) => ({
  storyDateIdx: index('story_metrics_story_date_idx').on(table.storyId, table.dateHour.desc()),
  dateHourIdx: index('story_metrics_date_hour_idx').on(table.dateHour.desc()),
  trendingIdx: index('story_metrics_trending_idx').on(table.dateHour, table.trendingScore.desc()),
  storyDateUnique: unique('story_date_hour_unique').on(table.storyId, table.dateHour),
}))

// Article modifications table - Track changes to articles over time
export const articleModifications = pgTable('article_modifications', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull(),
  fieldName: varchar('field_name', { length: 100 }).notNull(), // 'title', 'content', etc.
  oldValue: text('old_value'),
  newValue: text('new_value'),
  diffData: jsonb('diff_data'), // Detailed diff information
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index('article_modifications_article_id_idx').on(table.articleId),
  createdAtIdx: index('article_modifications_created_at_idx').on(table.createdAt),
}))

// Keywords table - Extracted keywords from articles
export const keywords = pgTable('keywords', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull(),
  keyword: varchar('keyword', { length: 255 }).notNull(),
  relevanceScore: real('relevance_score').notNull(), // 0 to 1
  category: varchar('category', { length: 50 }), // 'topic', 'entity', 'event', 'general'
  extractionMethod: varchar('extraction_method', { length: 50 }), // 'ollama', 'tfidf', etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index('keywords_article_id_idx').on(table.articleId),
  keywordIdx: index('keywords_keyword_idx').on(table.keyword),
  scoreIdx: index('keywords_score_idx').on(table.relevanceScore),
}))

// Analyses table - Article analysis results (summary, sentiment, etc.)
export const analyses = pgTable('analyses', {
  id: serial('id').primaryKey(),
  articleId: integer('article_id').references(() => articles.id).notNull().unique(),
  summary: text('summary'), // AI-generated summary
  sentiment: real('sentiment'), // -1 (negative) to 1 (positive)
  sentimentConfidence: real('sentiment_confidence'), // 0 to 1
  keywordExtractionDone: boolean('keyword_extraction_done').default(false),
  summaryGenerated: boolean('summary_generated').default(false),
  sentimentAnalyzed: boolean('sentiment_analyzed').default(false),
  analysisMetadata: jsonb('analysis_metadata'), // Additional analysis data (emotions, tone, etc.)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index('analyses_article_id_idx').on(table.articleId),
  sentimentIdx: index('analyses_sentiment_idx').on(table.sentiment),
}))

// Sources config table - Domain rules for hybrid classification
export const sourcesConfig = pgTable('sources_config', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  politicalBias: real('political_bias'), // Known bias -1 to 1
  region: varchar('region', { length: 100 }),
  reliability: real('reliability'), // 0 to 1
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  domainIdx: index('sources_config_domain_idx').on(table.domain),
}))

// DEPRECATED: Topic relationships superseded by entity_relationships table. Kept to prevent Drizzle from dropping the table.
export const topicRelationships = pgTable('topic_relationships', {
  id: serial('id').primaryKey(),
  sourceType: varchar('source_type', { length: 50 }).notNull(), // 'keyword' | 'entity'
  sourceId: integer('source_id').notNull(),
  sourceValue: varchar('source_value', { length: 255 }).notNull(), // Denormalized for performance
  targetType: varchar('target_type', { length: 50 }).notNull(), // 'keyword' | 'entity'
  targetId: integer('target_id').notNull(),
  targetValue: varchar('target_value', { length: 255 }).notNull(), // Denormalized for performance
  relationshipType: varchar('relationship_type', { length: 50 }).notNull(), // 'synonym' | 'parent' | 'child' | 'related' | 'co_occurrence'
  strength: real('strength').notNull(), // 0-1 confidence score
  supportingEvidence: jsonb('supporting_evidence'), // {co_occurrence_count, embedding_similarity, ollama_confidence, shared_articles[]}
  autoDetected: boolean('auto_detected').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  sourceIdx: index('topic_relationships_source_idx').on(table.sourceType, table.sourceId),
  targetIdx: index('topic_relationships_target_idx').on(table.targetType, table.targetId),
  typeIdx: index('topic_relationships_type_idx').on(table.relationshipType),
  strengthIdx: index('topic_relationships_strength_idx').on(table.strength.desc()),
}))

// DEPRECATED: Topic clusters — 0 rows, never populated. Kept to prevent Drizzle from dropping the table.
export const topicClusters = pgTable('topic_clusters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  parentClusterId: integer('parent_cluster_id').references(() => topicClusters.id),
  primaryKeywords: text('primary_keywords').array(), // Array of main keywords
  primaryEntities: text('primary_entities').array(), // Array of main entities
  metadata: jsonb('metadata'), // {article_count, date_range: {start, end}, trending_score}
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  parentIdx: index('topic_clusters_parent_idx').on(table.parentClusterId),
  nameIdx: index('topic_clusters_name_idx').on(table.name),
}))

// Entity relationships table - Entity-to-entity co-occurrence network for OSINT graphs
export const entityRelationships = pgTable('entity_relationships', {
  id: serial('id').primaryKey(),
  sourceEntityId: integer('source_entity_id').references(() => entities.id, { onDelete: 'cascade' }).notNull(),
  targetEntityId: integer('target_entity_id').references(() => entities.id, { onDelete: 'cascade' }).notNull(),
  cooccurrenceCount: integer('cooccurrence_count').default(1).notNull(), // How many articles mention both
  strength: real('strength').notNull(), // 0-1 normalized weight based on co-occurrence frequency
  sentimentCorrelation: real('sentiment_correlation'), // -1 to 1, how similarly they're discussed
  firstCooccurrence: timestamp('first_co_occurrence').notNull(), // When first seen together
  lastCooccurrence: timestamp('last_co_occurrence').notNull(), // Most recent co-occurrence
  sharedArticles: jsonb('shared_articles'), // Array of {article_id, published_at, relevance_scores}
  temporalPattern: jsonb('temporal_pattern'), // Time-series data for temporal analysis
  metadata: jsonb('metadata'), // Additional relationship data
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  sourceTargetUnique: unique('entity_rel_source_target_unique').on(table.sourceEntityId, table.targetEntityId),
  sourceIdx: index('entity_relationships_source_idx').on(table.sourceEntityId),
  targetIdx: index('entity_relationships_target_idx').on(table.targetEntityId),
  strengthIdx: index('entity_relationships_strength_idx').on(table.strength.desc()),
  lastCooccurrenceIdx: index('entity_relationships_last_cooccur_idx').on(table.lastCooccurrence.desc()),
  sourceTargetStrengthIdx: index('entity_rel_source_target_strength_idx').on(table.sourceEntityId, table.strength.desc()),
}))

// Geocache table - persistent server-side cache for Nominatim coordinates
export const geocache = pgTable('geocache', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  lat: real('lat'),
  lon: real('lon'),
  found: boolean('found').notNull().default(true), // false = negative cache (location not found)
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  nameIdx: index('geocache_name_idx').on(table.name),
}))

// Entity summary history - archived versions of entity summaries for timeline tracking
export const entitySummaryHistory = pgTable('entity_summary_history', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').references(() => entities.id, { onDelete: 'cascade' }).notNull(),
  summary: text('summary'),
  shortDescription: varchar('short_description', { length: 500 }),
  changeNote: text('change_note'), // LLM-generated 1-2 sentence diff note
  mentionCount: integer('mention_count'),
  trendingScore: real('trending_score'),
  articleContext: jsonb('article_context'), // { articleIds, articleTitles, dateRange }
  generatedAt: timestamp('generated_at').notNull(), // when this version was originally created
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
}, (table) => ({
  entityIdIdx: index('entity_summary_history_entity_id_idx').on(table.entityId),
  entityGeneratedIdx: index('entity_summary_history_entity_generated_idx').on(table.entityId, table.generatedAt.desc()),
}))

// Geo normalization lookup table for standardizing geographic points of view
export const geoNormalization = pgTable('geo_normalization', {
  id: serial('id').primaryKey(),
  rawValue: varchar('raw_value', { length: 255 }).notNull().unique(),
  normalizedCountry: varchar('normalized_country', { length: 100 }).notNull(),
  normalizedRegion: varchar('normalized_region', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  rawValueIdx: index('geo_normalization_raw_value_lower_idx').on(table.rawValue),
}))

// Stock watchlist - curated set of tracked tickers linked to organization entities
export const stockWatchlist = pgTable('stock_watchlist', {
  id: serial('id').primaryKey(),
  ticker: varchar('ticker', { length: 20 }).notNull().unique(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  exchange: varchar('exchange', { length: 50 }).default('US'),
  sector: varchar('sector', { length: 100 }),
  entityId: integer('entity_id').references(() => entities.id),
  mappingMethod: varchar('mapping_method', { length: 50 }),
  mappingConfidence: real('mapping_confidence'),
  isActive: boolean('is_active').default(true).notNull(),
  finnhubProfile: jsonb('finnhub_profile'),
  metadata: jsonb('metadata'),
  lastPriceAt: timestamp('last_price_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tickerIdx: index('stock_watchlist_ticker_idx').on(table.ticker),
  entityIdIdx: index('stock_watchlist_entity_id_idx').on(table.entityId),
  sectorIdx: index('stock_watchlist_sector_idx').on(table.sector),
  isActiveIdx: index('stock_watchlist_is_active_idx').on(table.isActive),
}))

// Stock prices - time-series price data (one row per ticker per fetch)
export const stockPrices = pgTable('stock_prices', {
  id: serial('id').primaryKey(),
  watchlistId: integer('watchlist_id').references(() => stockWatchlist.id, { onDelete: 'cascade' }).notNull(),
  price: real('price').notNull(),
  openPrice: real('open_price'),
  highPrice: real('high_price'),
  lowPrice: real('low_price'),
  previousClose: real('previous_close'),
  changeAmount: real('change_amount'),
  changePercent: real('change_percent'),
  volume: bigint('volume', { mode: 'number' }),
  marketStatus: varchar('market_status', { length: 20 }),
  source: varchar('source', { length: 50 }).default('finnhub'),
  fetchedAt: timestamp('fetched_at').notNull(),
}, (table) => ({
  watchlistFetchedIdx: index('stock_prices_watchlist_fetched_idx').on(table.watchlistId, table.fetchedAt.desc()),
  fetchedAtIdx: index('stock_prices_fetched_at_idx').on(table.fetchedAt.desc()),
}))

// Stock-news correlations - pre-computed events for future ML training (Phase 2)
export const stockNewsCorrelations = pgTable('stock_news_correlations', {
  id: serial('id').primaryKey(),
  watchlistId: integer('watchlist_id').references(() => stockWatchlist.id, { onDelete: 'cascade' }).notNull(),
  entityId: integer('entity_id').references(() => entities.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  eventDate: timestamp('event_date').notNull(),
  priceBefore: real('price_before'),
  priceAfter: real('price_after'),
  priceChangePercent: real('price_change_percent'),
  mentionCountWindow: real('mention_count_window'),
  avgSentiment: real('avg_sentiment'),
  articleIds: jsonb('article_ids'),
  windowHours: integer('window_hours').default(24),
  confidence: real('confidence'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  watchlistIdx: index('stock_news_correlations_watchlist_idx').on(table.watchlistId),
  entityIdx: index('stock_news_correlations_entity_idx').on(table.entityId),
  eventDateIdx: index('stock_news_correlations_event_date_idx').on(table.eventDate.desc()),
  eventTypeIdx: index('stock_news_correlations_event_type_idx').on(table.eventType),
}))

// Stock backtest results - forward-looking price changes for each historical anomaly event
export const stockBacktestResults = pgTable('stock_backtest_results', {
  id: serial('id').primaryKey(),
  correlationId: integer('correlation_id').references(() => stockNewsCorrelations.id, { onDelete: 'cascade' }).notNull(),
  price1d: real('price_1d'),
  price3d: real('price_3d'),
  price5d: real('price_5d'),
  price1w: real('price_1w'),
  price2w: real('price_2w'),
  price4w: real('price_4w'),
  change1d: real('change_1d'),
  change3d: real('change_3d'),
  change5d: real('change_5d'),
  change1w: real('change_1w'),
  change2w: real('change_2w'),
  change4w: real('change_4w'),
  benchmarkChange1d: real('benchmark_change_1d'),
  benchmarkChange5d: real('benchmark_change_5d'),
  benchmarkChange2w: real('benchmark_change_2w'),
  benchmarkChange4w: real('benchmark_change_4w'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  correlationIdx: index('backtest_correlation_idx').on(table.correlationId),
}))

// Stock signal profiles - aggregated stats per (ticker, event_type) pair
export const stockSignalProfiles = pgTable('stock_signal_profiles', {
  id: serial('id').primaryKey(),
  watchlistId: integer('watchlist_id').references(() => stockWatchlist.id, { onDelete: 'cascade' }).notNull(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  sampleCount: integer('sample_count').notNull().default(0),
  avgChange1d: real('avg_change_1d'),
  avgChange3d: real('avg_change_3d'),
  avgChange5d: real('avg_change_5d'),
  avgChange1w: real('avg_change_1w'),
  avgChange2w: real('avg_change_2w'),
  avgChange4w: real('avg_change_4w'),
  winRate1d: real('win_rate_1d'),
  winRate3d: real('win_rate_3d'),
  winRate5d: real('win_rate_5d'),
  winRate1w: real('win_rate_1w'),
  winRate2w: real('win_rate_2w'),
  winRate4w: real('win_rate_4w'),
  stddev1d: real('stddev_1d'),
  stddev3d: real('stddev_3d'),
  stddev5d: real('stddev_5d'),
  stddev1w: real('stddev_1w'),
  stddev2w: real('stddev_2w'),
  stddev4w: real('stddev_4w'),
  avgAlpha5d: real('avg_alpha_5d'),
  avgAlpha4w: real('avg_alpha_4w'),
  profileConfidence: real('profile_confidence'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  watchlistEventIdx: index('signal_profiles_watchlist_event_idx').on(table.watchlistId, table.eventType),
  confidenceIdx: index('signal_profiles_confidence_idx').on(table.profileConfidence),
}))

// Stock recommendations - generated buy/sell signals from anomalies + historical profiles
export const stockRecommendations = pgTable('stock_recommendations', {
  id: serial('id').primaryKey(),
  watchlistId: integer('watchlist_id').references(() => stockWatchlist.id, { onDelete: 'cascade' }).notNull(),
  correlationId: integer('correlation_id').references(() => stockNewsCorrelations.id, { onDelete: 'cascade' }).notNull(),
  profileId: integer('profile_id').references(() => stockSignalProfiles.id),
  signalDirection: varchar('signal_direction', { length: 20 }).notNull().default('neutral'),
  signalStrength: real('signal_strength').notNull().default(0),
  shortTermDirection: varchar('short_term_direction', { length: 20 }).notNull().default('neutral'),
  shortTermConfidence: real('short_term_confidence').default(0),
  shortTermExpectedChange: real('short_term_expected_change'),
  mediumTermDirection: varchar('medium_term_direction', { length: 20 }).notNull().default('neutral'),
  mediumTermConfidence: real('medium_term_confidence').default(0),
  mediumTermExpectedChange: real('medium_term_expected_change'),
  eventStrength: real('event_strength'),
  historicalWinrate: real('historical_winrate'),
  anomalyConfidence: real('anomaly_confidence'),
  sourceDiversity: real('source_diversity'),
  mentionMultiplier: real('mention_multiplier'),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  eventDate: timestamp('event_date').notNull(),
  triggerMetadata: jsonb('trigger_metadata'),
  modelSource: varchar('model_source', { length: 20 }).notNull().default('heuristic'),
  mlProbUp5d: real('ml_prob_up_5d'),
  mlExpectedChange5d: real('ml_expected_change_5d'),
  mlProbUp4w: real('ml_prob_up_4w'),
  mlConfidence: real('ml_confidence'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  expiresAt: timestamp('expires_at'),
  actualChange5d: real('actual_change_5d'),
  actualChange4w: real('actual_change_4w'),
  validatedAt: timestamp('validated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  correlationModelIdx: uniqueIndex('idx_recommendations_correlation').on(table.correlationId, table.modelSource),
  watchlistIdx: index('recommendations_watchlist_idx').on(table.watchlistId),
  statusIdx: index('recommendations_status_idx').on(table.status),
  signalIdx: index('recommendations_signal_idx').on(table.signalDirection, table.signalStrength),
  createdIdx: index('recommendations_created_idx').on(table.createdAt),
  modelSourceIdx: index('recommendations_model_source_idx').on(table.modelSource),
}))

// Paper trading portfolios
export const paperPortfolios = pgTable('paper_portfolios', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  strategy: varchar('strategy', { length: 50 }).notNull(),
  initialCapital: real('initial_capital').notNull().default(100000),
  currentCapital: real('current_capital').notNull().default(100000),
  currentValue: real('current_value').notNull().default(100000),
  totalTrades: integer('total_trades').default(0),
  winningTrades: integer('winning_trades').default(0),
  totalPnl: real('total_pnl').default(0),
  maxDrawdown: real('max_drawdown').default(0),
  sharpeRatio: real('sharpe_ratio'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Individual paper trades
export const paperTrades = pgTable('paper_trades', {
  id: serial('id').primaryKey(),
  portfolioId: integer('portfolio_id').references(() => paperPortfolios.id).notNull(),
  watchlistId: integer('watchlist_id').references(() => stockWatchlist.id).notNull(),
  recommendationId: integer('recommendation_id').references(() => stockRecommendations.id),
  direction: varchar('direction', { length: 10 }).notNull(),
  entryPrice: real('entry_price').notNull(),
  entryDate: timestamp('entry_date').notNull(),
  shares: real('shares').notNull(),
  positionSize: real('position_size').notNull(),
  exitPrice: real('exit_price'),
  exitDate: timestamp('exit_date'),
  pnl: real('pnl'),
  pnlPercent: real('pnl_percent'),
  status: varchar('status', { length: 20 }).default('open'),
  stopLoss: real('stop_loss'),
  takeProfit: real('take_profit'),
  exitReason: varchar('exit_reason', { length: 50 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  portfolioIdx: index('paper_trades_portfolio_idx').on(table.portfolioId),
  statusIdx: index('paper_trades_status_idx').on(table.status),
  watchlistIdx: index('paper_trades_watchlist_idx').on(table.watchlistId),
}))

// Daily portfolio snapshots for equity curve
export const paperPortfolioSnapshots = pgTable('paper_portfolio_snapshots', {
  id: serial('id').primaryKey(),
  portfolioId: integer('portfolio_id').references(() => paperPortfolios.id).notNull(),
  snapshotDate: timestamp('snapshot_date', { mode: 'date' }).notNull(),
  capital: real('capital').notNull(),
  portfolioValue: real('portfolio_value').notNull(),
  openPositions: integer('open_positions').default(0),
  dailyPnl: real('daily_pnl').default(0),
  cumulativePnl: real('cumulative_pnl').default(0),
  drawdown: real('drawdown').default(0),
  spyValue: real('spy_value'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  portfolioDateIdx: index('paper_snapshots_portfolio_date_idx').on(table.portfolioId, table.snapshotDate),
}))
