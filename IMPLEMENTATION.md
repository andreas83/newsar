# Newsar Implementation Documentation

**Last Updated:** 2025-10-23

## Project Overview

Newsar is a Nuxt 4 RSS News Aggregation & Analysis Platform that collects articles from multiple sources, classifies them using AI, groups similar stories, and provides comprehensive analysis including sentiment, keywords, and summaries.

## Tech Stack

- **Frontend:** Nuxt 4 + UnoCSS + Nuxt UI (v3)
- **Backend:** Nuxt 4 Server API
- **Database:** PostgreSQL 16 + pgvector extension
- **ORM:** Drizzle ORM (TypeScript-first)
- **RSS Parsing:** rss-parser
- **Content Extraction:** Mozilla Readability + linkedom
- **Language Detection:** franc
- **AI/ML:** Ollama (local LLM inference)
  - **Chat Model:** llama3.2:3b (2GB) - for classification and analysis
  - **Embedding Model:** nomic-embed-text (274MB, 768 dimensions)
- **Background Jobs:** BullMQ with Redis (optional - batch scripts available)
- **Auth:** Nuxt Auth Utils

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     RSS FEED SOURCES                         │
│   (BBC, NY Times, Reuters, Al Jazeera, Guardian, Spiegel)  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  PHASE 3: RSS COLLECTION                     │
│  • Parse RSS feeds (rss-parser)                             │
│  • Extract snippets                                          │
│  • Content deduplication (SHA-256)                           │
│  • Queue full content extraction                             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│               PHASE 3B: CONTENT EXTRACTION                   │
│  • Fetch full HTML from article URLs                        │
│  • Extract clean content (Mozilla Readability)              │
│  • Store full article text                                  │
│  • ~4,170 chars avg (9x more than RSS snippets)            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              PHASE 4: HYBRID CLASSIFICATION                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Language Detection (franc)                          │   │
│  │ • Detects 170+ languages (ISO 639-3)               │   │
│  │ • Confidence scoring                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Political Bias Classification (Hybrid)              │   │
│  │ • Rule-based: Known source bias (instant)           │   │
│  │ • Ollama: Content analysis (unknown sources)        │   │
│  │ • Scale: -1 (left) to +1 (right)                    │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Entity Extraction (Ollama NER)                      │   │
│  │ • People, Organizations, Locations, Events          │   │
│  │ • Relevance scoring                                  │   │
│  │ • Mention counting                                   │   │
│  │ • Geographic POV detection                           │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│            PHASE 5: VECTOR EMBEDDINGS & GROUPING             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Embedding Generation (nomic-embed-text)             │   │
│  │ • 768-dimensional vectors                            │   │
│  │ • Stored in pgvector                                 │   │
│  │ • ~5 seconds per article                             │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Semantic Similarity Search                           │   │
│  │ • Cosine similarity calculation                      │   │
│  │ • Find related articles (70%+ similarity)            │   │
│  │ • Cross-source story discovery                       │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Story Clustering (DBSCAN-like)                       │   │
│  │ • Groups similar articles                            │   │
│  │ • Calculates cluster centroid                        │   │
│  │ • Coherence scoring                                  │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              PHASE 6: OLLAMA ANALYSIS PIPELINE               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Keyword Extraction (Ollama)                         │   │
│  │ • Top 10 keywords per article                        │   │
│  │ • Categories: topic, entity, event, general          │   │
│  │ • Relevance scoring                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Summary Generation (Ollama)                         │   │
│  │ • Short (50-80 words)                                │   │
│  │ • Medium (100-150 words)                             │   │
│  │ • Long (200-300 words)                               │   │
│  │ • Story summaries (multi-source)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Sentiment Analysis (Ollama)                         │   │
│  │ • Score: -1 (very negative) to +1 (very positive)  │   │
│  │ • Tone: positive/negative/neutral/mixed              │   │
│  │ • Emotion detection (hopeful, concerned, etc.)       │   │
│  │ • Confidence scoring                                 │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATABASE STORAGE                         │
│  • 14 tables with pgvector support                          │
│  • Classified articles with full metadata                   │
│  • Story groups with similarity scores                      │
│  • Entity relationships                                      │
│  • Keyword index                                             │
│  • Analysis results                                          │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Status

### ✅ Phase 1: Foundation (Complete)
- Nuxt 4 with TypeScript
- UnoCSS configuration
- PostgreSQL + pgvector extension
- Drizzle ORM with 14 tables
- Redis setup (optional)

### ✅ Phase 2: Database Schema (Complete)
**Tables:**
- `feeds` - RSS feed sources (6 configured)
- `articles` - News articles (288 collected)
- `classifications` - Language, bias, entities (3 classified)
- `article_embeddings` - Vector embeddings (3 generated)
- `stories` - Article groups/clusters
- `story_members` - Article-to-story mapping
- `entities` - Named entities (13+ extracted)
- `article_entities` - Article-entity relationships
- `story_entities` - Story-entity relationships
- `story_coverage` - Coverage diversity metrics
- `story_metrics` - Trending metrics
- `article_modifications` - Article change tracking
- `keywords` - Extracted keywords
- `analyses` - Analysis results (summary, sentiment)
- `sources_config` - Domain classification rules

### ✅ Phase 3: RSS Collection Engine (Complete)
**Features:**
- 6 news sources configured:
  - BBC News (Center, 0.0 bias)
  - New York Times (Center-Left, -0.3 bias)
  - Reuters (Center, 0.0 bias)
  - Al Jazeera English (Center-Left, -0.2 bias)
  - The Guardian (Center-Left, -0.3 bias)
  - Der Spiegel (Center-Left, -0.2 bias)
- 288 articles fetched
- Content deduplication via SHA-256
- Full content extraction (Mozilla Readability)
- 58 articles with full content extracted
- Average: 4,170 characters per article

**Scripts:**
- `npm run test:fetch` - Test RSS feed parsing

**Content Extraction:**
- Two-stage pipeline:
  1. Fast RSS parse → store snippets
  2. Background extraction → full content
- Mozilla Readability for clean text
- ~100% success rate
- Average extraction time: 3-5 seconds

**Scripts:**
- `npm run extract:all [limit] [concurrency]` - Batch extraction

### ✅ Phase 4: Hybrid Classification (Complete)
**Services:**
- **languageDetector.ts** - Language detection using franc
  - 170+ languages supported
  - Confidence scoring based on text length
  - ISO 639-3 to ISO 639-1 conversion

- **biasClassifier.ts** - Political bias classification
  - Rule-based for known sources (instant, 90% confidence)
  - Ollama analysis for unknown sources (~15 seconds)
  - Hybrid approach prioritizes speed
  - Scale: -1 (Far Left) to +1 (Far Right)
  - Labels: Far Left, Center-Left, Center, Center-Right, Far Right

- **entityExtractor.ts** - Named entity recognition
  - Types: PERSON, ORGANIZATION, LOCATION, EVENT
  - Max 10 entities per article
  - Relevance threshold: 0.3
  - Normalized names (US → United States)
  - Geographic POV extraction

- **articleClassifier.ts** - Orchestrates classification
  - Gets article + feed info
  - Detects language
  - Classifies bias (hybrid)
  - Extracts entities
  - Stores in classifications table
  - Updates article status to 'grouped'

**Performance:**
- Language detection: <1 second
- Bias (rule-based): <1 second
- Bias (Ollama): ~15 seconds
- Entity extraction: ~10 seconds
- **Total: ~30 seconds per article** (with Ollama)

**Results:**
- 3 articles classified
- Languages: English (95% confidence)
- Biases: Center (0.00), Center-Left (-0.30)
- 13+ entities extracted

**Scripts:**
- `npm run test:classify [articleId]` - Test single article
- `npm run classify:all [limit] [concurrency]` - Batch classification

### ✅ Phase 5: Vector Embeddings & Grouping (Complete)
**Services:**
- **embeddingGenerator.ts** - Generate and store embeddings
  - nomic-embed-text model (768 dimensions)
  - Truncates to 6,000 chars (safe for context)
  - Stores in pgvector format
  - ~5 seconds per article

  **Functions:**
  - `generateArticleEmbedding(articleId)` - Generate for single article
  - `getArticlesPendingEmbedding(limit)` - Get articles needing embeddings
  - `findSimilarArticles(articleId, limit, minSimilarity)` - Semantic search

- **articleClustering.ts** - Group similar articles
  - DBSCAN-like clustering algorithm
  - Cosine similarity calculation
  - Configurable similarity threshold (default 75%)
  - Calculates cluster centroid and coherence
  - Stores in article_groups table

  **Functions:**
  - `clusterArticles(minSimilarity, minClusterSize)` - Create clusters
  - `getArticleGroup(articleId)` - Get articles in same group

**Results:**
- 3 articles with embeddings
- Dimensions: 768
- Test similarity: 52-55% (unrelated articles)
- Expected: 75-90% for same story

**Scripts:**
- `npm run embed:all [limit] [concurrency]` - Batch embedding generation
- `npm run test:similarity [articleId]` - Test similarity search
- `npm run test:cluster [minSimilarity] [minSize]` - Test clustering

### ✅ Phase 6: Ollama Analysis Pipeline (Complete)
**Services:**
- **keywordExtractor.ts** - Extract keywords
  - Top 10 keywords per article
  - Categories: topic, entity, event, general
  - Relevance threshold: 0.4
  - Stores in keywords table
  - Temperature: 0.2 (consistent extraction)

  **Functions:**
  - `extractKeywords(title, content, maxKeywords)` - Extract keywords
  - `storeKeywords(articleId, keywords)` - Save to database
  - `getArticleKeywords(articleId)` - Retrieve keywords
  - `getTrendingKeywords(limit)` - Get most common keywords

- **summaryGenerator.ts** - Generate summaries
  - Three lengths:
    - Short: 50-80 words (2-3 sentences)
    - Medium: 100-150 words (4-6 sentences)
    - Long: 200-300 words (8-12 sentences)
  - Story summaries: Combines multiple sources
  - Headlines: Single sentence, 10-15 words
  - Temperature: 0.3 (factual output)

  **Functions:**
  - `generateSummary(title, content, length)` - Single article
  - `generateStorySummary(articles)` - Multi-source
  - `generateHeadline(content)` - One-sentence

- **sentimentAnalyzer.ts** - Analyze sentiment
  - Score: -1 (very negative) to +1 (very positive)
  - Tone classification: positive/negative/neutral/mixed
  - Emotion detection (hopeful, concerned, angry, etc.)
  - Confidence scoring
  - Temperature: 0.3

  **Scale:**
  - Very Negative (-1.0 to -0.6): Tragedy, disaster
  - Negative (-0.5 to -0.2): Problems, concerns
  - Neutral (-0.1 to 0.1): Factual reporting
  - Positive (0.2 to 0.5): Progress, good news
  - Very Positive (0.6 to 1.0): Celebration, breakthrough

  **Functions:**
  - `analyzeSentiment(title, content)` - Analyze single article
  - `compareStorySentiment(articles)` - Compare across sources
  - `getSentimentLabel(sentiment)` - Get display label
  - `getSentimentColor(sentiment)` - Get color for viz
  - `getSentimentEmoji(sentiment)` - Get emoji

- **articleAnalyzer.ts** - Orchestrates all analysis
  - Extracts keywords
  - Generates summary
  - Analyzes sentiment
  - Stores in analyses table
  - Tracks analysis metadata

  **Functions:**
  - `analyzeArticle(articleId, useOllama)` - Full analysis
  - `getArticlesPendingAnalysis(limit)` - Get articles needing analysis
  - `getArticleAnalysis(articleId)` - Retrieve analysis

**Performance:**
- Keyword extraction: ~8-12 seconds
- Summary generation: ~10-15 seconds
- Sentiment analysis: ~8-12 seconds
- **Total: ~30-40 seconds per article**

**Scripts:**
- `npm run test:analyze [articleId]` - Test single article
- `npm run analyze:all [limit] [concurrency]` - Batch analysis

## Database Schema

### Core Tables

**feeds** - RSS feed sources
```typescript
{
  id: serial
  url: varchar(2048) unique
  name: varchar(255)
  category: varchar(100)
  knownBias: real // -1 to 1
  region: varchar(100)
  isActive: integer // 1 or 0
  lastFetchedAt: timestamp
  createdAt: timestamp
  updatedAt: timestamp
}
```

**articles** - News articles
```typescript
{
  id: serial
  feedId: integer → feeds.id
  storyId: integer → stories.id
  title: text
  content: text // RSS snippet
  fullContent: text // Extracted content
  url: varchar(2048) unique
  author: varchar(255)
  publishedAt: timestamp
  contentHash: varchar(64) // SHA-256
  processingStatus: varchar(50) // 'pending', 'grouped', 'refined'
  contentExtracted: boolean
  extractionStatus: varchar(50) // 'pending', 'success', 'failed'
  extractionError: text
  extractedAt: timestamp
  rawData: jsonb
  createdAt: timestamp
  updatedAt: timestamp
}
```

**classifications** - Article classifications
```typescript
{
  id: serial
  articleId: integer → articles.id
  language: varchar(10)
  politicalBias: real // -1 to 1
  geoPov: varchar(100)
  confidence: real // 0 to 1
  method: varchar(50) // 'rule-based', 'ollama', 'hybrid'
  entityExtractionDone: boolean
  processingMetadata: jsonb
  metadata: jsonb
  createdAt: timestamp
  updatedAt: timestamp
}
```

**article_embeddings** - Vector embeddings
```typescript
{
  id: serial
  articleId: integer → articles.id (unique)
  embedding: vector(768) // pgvector
  model: varchar(100) // 'nomic-embed-text'
  createdAt: timestamp
}
```

**entities** - Named entities
```typescript
{
  id: serial
  type: varchar(50) // 'person', 'organization', 'location', 'event'
  name: varchar(255)
  canonicalName: varchar(255) // Normalized
  metadata: jsonb
  createdAt: timestamp
  updatedAt: timestamp
}
```

**article_entities** - Article-entity relationships
```typescript
{
  id: serial
  articleId: integer → articles.id
  entityId: integer → entities.id
  relevanceScore: real // 0 to 1
  sentiment: varchar(50)
  mentionCount: integer
  createdAt: timestamp
}
```

**keywords** - Extracted keywords
```typescript
{
  id: serial
  articleId: integer → articles.id
  keyword: varchar(255)
  relevanceScore: real // 0 to 1
  category: varchar(50) // 'topic', 'entity', 'event', 'general'
  extractionMethod: varchar(50)
  createdAt: timestamp
}
```

**analyses** - Analysis results
```typescript
{
  id: serial
  articleId: integer → articles.id (unique)
  summary: text
  sentiment: real // -1 to 1
  sentimentConfidence: real // 0 to 1
  keywordExtractionDone: boolean
  summaryGenerated: boolean
  sentimentAnalyzed: boolean
  analysisMetadata: jsonb // emotions, tone, word counts
  createdAt: timestamp
  updatedAt: timestamp
}
```

**stories** - Story clusters
```typescript
{
  id: serial
  name: varchar(255)
  representativeTitle: text
  description: text
  summary: text // AI-generated
  clusterMethod: varchar(50) // 'auto', 'refined', 'manual'
  centroidEmbedding: vector(768)
  status: varchar(50) // 'emerging', 'trending', 'active'
  trendingScore: real
  articleCount: integer
  sourceCount: integer
  sourceDiversityScore: real
  firstSeen: timestamp
  lastUpdated: timestamp
  createdAt: timestamp
  updatedAt: timestamp
}
```

## Processing Pipeline

### Standard Article Processing Flow

1. **RSS Collection** (`npm run test:fetch`)
   - Parse RSS feeds
   - Extract article metadata
   - Generate content hash for deduplication
   - Store article with `processing_status='pending'`

2. **Content Extraction** (`npm run extract:all`)
   - Fetch full HTML from article URL
   - Extract clean content using Mozilla Readability
   - Store in `full_content` field
   - Set `content_extracted=true`

3. **Classification** (`npm run classify:all`)
   - Detect language (franc)
   - Classify political bias (hybrid: rule-based or Ollama)
   - Extract named entities (Ollama NER)
   - Determine geographic POV
   - Store in classifications table
   - Set `processing_status='grouped'`

4. **Embedding Generation** (`npm run embed:all`)
   - Generate 768-dim vector (nomic-embed-text)
   - Store in article_embeddings table
   - Ready for similarity search

5. **Analysis** (`npm run analyze:all`)
   - Extract keywords (Ollama)
   - Generate summary (Ollama)
   - Analyze sentiment (Ollama)
   - Store in analyses and keywords tables

6. **Clustering** (`npm run test:cluster`)
   - Calculate similarity between all embeddings
   - Group similar articles (DBSCAN-like)
   - Create story groups
   - Calculate cluster centroids

### Batch Processing Commands

```bash
# Full pipeline on 50 articles
npm run extract:all 50 3    # Extract content (3 concurrent)
npm run classify:all 50 2   # Classify (2 concurrent)
npm run embed:all 50 3      # Generate embeddings (3 concurrent)
npm run analyze:all 50 1    # Analyze (1 concurrent - Ollama)
npm run test:cluster 0.75 2 # Cluster (75% similarity, min 2 articles)
```

### Performance Benchmarks

**Per Article:**
- RSS parsing: <1 second
- Content extraction: 3-5 seconds
- Language detection: <1 second
- Bias classification (rule-based): <1 second
- Bias classification (Ollama): ~15 seconds
- Entity extraction: ~10 seconds
- Embedding generation: ~5 seconds
- Keyword extraction: ~10 seconds
- Summary generation: ~12 seconds
- Sentiment analysis: ~10 seconds

**Total per article (full pipeline):**
- With rule-based bias: ~50 seconds
- With Ollama bias: ~65 seconds

**Recommended Concurrency (local development):**
- Content extraction: 3-5
- Classification: 1-2
- Embedding: 3-5
- Analysis: 1 (Ollama stability)

## API Services

### RSS & Content
- `server/services/rssParser.ts` - RSS feed parsing
- `server/services/contentExtractor.ts` - Full article extraction

### Classification
- `server/services/languageDetector.ts` - Language detection
- `server/services/biasClassifier.ts` - Political bias
- `server/services/entityExtractor.ts` - Named entity recognition
- `server/services/articleClassifier.ts` - Classification orchestrator

### Embeddings & Clustering
- `server/services/embeddingGenerator.ts` - Vector embeddings
- `server/services/articleClustering.ts` - Story grouping

### Analysis
- `server/services/keywordExtractor.ts` - Keyword extraction
- `server/services/summaryGenerator.ts` - Summary generation
- `server/services/sentimentAnalyzer.ts` - Sentiment analysis
- `server/services/articleAnalyzer.ts` - Analysis orchestrator

### Utilities
- `server/utils/ollama.ts` - Ollama client wrapper
- `server/database/db.ts` - Database connection
- `server/database/schema.ts` - Drizzle schema

## Scripts Reference

### Testing Scripts
```bash
npm run test:fetch              # Test RSS feed parsing
npm run test:extract            # Test content extraction
npm run test:classify [id]      # Test classification on article
npm run test:similarity [id]    # Test similarity search
npm run test:cluster [sim] [min] # Test clustering
npm run test:analyze [id]       # Test analysis pipeline
```

### Batch Processing Scripts
```bash
npm run extract:all [limit] [concurrency]   # Batch content extraction
npm run classify:all [limit] [concurrency]  # Batch classification
npm run embed:all [limit] [concurrency]     # Batch embedding generation
npm run analyze:all [limit] [concurrency]   # Batch analysis
```

### Database Scripts
```bash
npm run db:generate    # Generate migrations
npm run db:migrate     # Run migrations
npm run db:push        # Push schema changes
npm run db:studio      # Open Drizzle Studio
npm run db:drop        # Drop migrations
npm run seed:feeds     # Seed RSS feeds
```

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/newsar

# Redis (optional)
REDIS_URL=redis://localhost:6379

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=llama3.2:3b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

## Current System State

**Database:**
- 288 articles collected
- 58 articles with full content
- 3 articles classified
- 3 embeddings generated
- 13+ entities extracted
- 0 story groups (pending clustering)

**RSS Feeds:** 6 active sources
**Ollama Models:**
- llama3.2:3b (2GB) - Downloaded ✅
- nomic-embed-text (274MB) - Downloaded ✅

## Known Limitations

1. **Ollama Performance:**
   - Runs locally, limited by hardware
   - Recommended: Run batch jobs on better hardware or cloud
   - Current speed: ~30-65 seconds per article

2. **Redis Optional:**
   - BullMQ queue system requires Redis
   - Alternative: Batch scripts work without Redis
   - Queue scripts may fail if Redis not running

3. **Language Support:**
   - Optimized for English articles
   - Multi-language support available but untested

4. **Similarity Threshold:**
   - Default 75% may need tuning
   - Lower for diverse coverage, higher for precision

## Next Development Phases

### Phase 7: Admin Dashboard (Not Started)
- Feed management UI
- Classification review interface
- Manual bias override
- Article group visualization
- Job queue monitoring
- Analytics dashboard

### Phase 8: Public Interface (Not Started)
- News feed with filters
- Article comparison view
- Timeline for story evolution
- Semantic + keyword search
- Source transparency info

### Phase 9: Advanced Features (Not Started)
- Bias heatmap visualization
- Source reliability scoring
- Breaking news detection
- Trend analysis
- REST API endpoints
- Webhook notifications
- Export (JSON/CSV/RSS)

## Troubleshooting

### Ollama Connection Issues
```bash
# Check if Ollama is running
curl http://localhost:11434/api/version

# Start Ollama
ollama serve

# List available models
ollama list
```

### Database Connection Issues
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U newsar -d newsar -c "SELECT COUNT(*) FROM articles;"
```

### Redis Connection Issues (Optional)
```bash
# Check Redis status
sudo systemctl status redis

# Use batch scripts instead
npm run extract:all    # Works without Redis
npm run classify:all   # Works without Redis
```

## Performance Optimization Tips

1. **Run batch jobs on powerful hardware:**
   ```bash
   # Cloud instance or desktop with GPU
   npm run classify:all 100 3
   npm run embed:all 100 5
   npm run analyze:all 100 2
   ```

2. **Tune concurrency based on resources:**
   - Low-end: concurrency=1
   - Mid-range: concurrency=2-3
   - High-end: concurrency=5+

3. **Use pgvector indexes for large datasets:**
   ```sql
   CREATE INDEX ON article_embeddings
   USING ivfflat (embedding vector_cosine_ops)
   WITH (lists = 100);
   ```

4. **Cache Ollama responses** (future enhancement)

## Contributing

When adding new features:

1. Follow the phase structure
2. Create services in `server/services/`
3. Add scripts in `server/scripts/`
4. Update schema in `server/database/schema.ts`
5. Run `npm run db:push` to update database
6. Add npm scripts to `package.json`
7. Update this documentation

## License

Private project - No license specified

---

**Generated:** 2025-10-23
**Version:** 1.0.0
**Status:** Backend ML Pipeline Complete (Phases 1-6)
