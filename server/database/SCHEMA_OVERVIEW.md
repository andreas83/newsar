# Enhanced Database Schema Overview

## Design Goals

This schema is optimized for:
1. **Trending Topic Detection** - Fast identification of breaking and trending news stories
2. **Multi-Perspective Coverage** - Efficient queries for "show me all perspectives on topic X"
3. **Entity-Based Story Linking** - Connect related stories via people, organizations, events
4. **Hybrid Processing Workflow** - Support for both automatic grouping and manual refinement
5. **Performance at Scale** - Optimized indexes for common query patterns

## Core Tables (7)

### 1. `feeds`
RSS feed sources with bias classification
- Tracks which sources we're monitoring
- Pre-classified political bias and region

### 2. `articles`
Individual news articles from feeds
- **New**: `story_id` - Direct link to story for performance
- **New**: `processing_status` - Track workflow: pending → grouped → refined
- **New**: `auto_grouped_at`, `manual_reviewed_at` - Audit trail

**Key Indexes:**
- `published_at DESC` - For trending window queries (last 24h, 48h)
- `(story_id, published_at DESC)` - Fast "all articles in story" queries

### 3. `classifications`
Article language, political bias, geographic POV
- **New**: `entity_extraction_done` - Track processing pipeline
- **New**: `processing_metadata` - Store hybrid workflow state

### 4. `article_embeddings`
Vector embeddings (768 dimensions) for semantic similarity
- Uses pgvector extension
- Enables "find similar articles" queries

### 5. `keywords`
Extracted keywords from articles
- Used for topic detection
- Relevance scoring 0-1

### 6. `sources_config`
Domain-level classification rules
- Known bias for common news domains
- Enables fast rule-based classification

### 7. `article_modifications`
Track changes to articles over time
- Detect headline/content changes
- "Story evolution" feature

## Stories & Trending System (4 tables)

### 8. `stories`
Clustered similar news stories (formerly article_groups)

**Enhanced columns for trending & browsing:**
- `trending_score` (real) - Calculated trending score
- `status` (varchar) - 'emerging', 'trending', 'active', 'declining'
- `article_count` (int) - Denormalized for performance
- `source_count` (int) - How many unique sources covered this
- `source_diversity_score` (real) - Bias/region diversity 0-1
- `representative_title` (text) - Best title to display
- `summary` (text) - AI-generated story summary
- `first_seen`, `last_updated` (timestamp) - Story lifecycle

**Key Indexes:**
- `(status, trending_score DESC)` - Fast trending feed queries
- `trending_score DESC` - Overall trending ranking
- `last_updated DESC` - Recently updated stories

**Use Cases:**
- **Trending Feed**: `WHERE status = 'trending' ORDER BY trending_score DESC`
- **Recently Updated**: `ORDER BY last_updated DESC`

### 9. `story_members`
Many-to-many: stories ↔ articles (formerly article_group_members)

**Enhanced:**
- `is_representative` (boolean) - Flag the best article to represent the story
- Similarity scores for ranking

### 10. `story_coverage`
Denormalized coverage diversity metrics

**Columns:**
- `left_count`, `center_count`, `right_count` - Articles by political bias
- `regions_json` (jsonb) - Array of covered regions
- `total_sources` - Unique source count
- `coverage_diversity_score` - Overall diversity 0-1

**Use Cases:**
- "Show me stories with good left/right balance"
- "Find stories missing conservative coverage"
- Identify echo chamber stories (low diversity)

### 11. `story_metrics`
Time-series metrics for trending detection

**Columns:**
- `date_hour` (timestamp) - Hourly buckets
- `article_count` (int) - Articles published in this hour
- `velocity` (real) - Articles per hour
- `trending_score` (real) - Calculated trending score

**Key Indexes:**
- `(date_hour, trending_score DESC)` - "What's trending right now?"
- `(story_id, date_hour DESC)` - Story timeline

**Use Cases:**
- Calculate velocity: articles in last 6 hours / 6
- Trending detection: high velocity + recent activity
- Story timeline visualization

## Entity Tracking (3 tables)

### 12. `entities`
Named entities: people, organizations, locations, events

**Columns:**
- `type` - 'person', 'organization', 'location', 'event'
- `name` - Display name
- `canonical_name` - Normalized for deduplication (e.g., "Biden" vs "Joe Biden")
- `metadata` (jsonb) - Aliases, descriptions, etc.

**Key Indexes:**
- `(type, name)` - Fast entity lookup
- `canonical_name` - Deduplication queries

### 13. `article_entities`
Links articles to entities they mention

**Columns:**
- `relevance_score` (real 0-1) - How central is this entity to the article?
- `sentiment` - 'positive', 'negative', 'neutral'
- `mention_count` - How many times mentioned

**Use Cases:**
- "Show me all articles mentioning Biden"
- "What's the sentiment around Tesla in tech news?"

### 14. `story_entities`
Pre-computed entity → story mapping for performance

**Columns:**
- `is_primary` (boolean) - Main entity in the story
- `relevance` (real) - Aggregated from all articles
- `article_count` (int) - How many articles in story mention this

**Use Cases:**
- "Show me all stories about Ukraine conflict" (entity-based)
- Link related stories via shared entities
- "Stories primarily about Elon Musk"

## Query Patterns

### 1. Trending Feed (Real-time Browsing)
```sql
SELECT s.* FROM stories s
WHERE s.status = 'trending'
ORDER BY s.trending_score DESC
LIMIT 20;
```

### 2. Topic Deep-Dive (All Perspectives)
```sql
-- Find story by entity or keyword
SELECT s.*, sc.*
FROM stories s
JOIN story_entities se ON se.story_id = s.id
JOIN entities e ON e.id = se.entity_id
LEFT JOIN story_coverage sc ON sc.story_id = s.id
WHERE e.name = 'Climate Change'
AND se.is_primary = true;

-- Get articles with different perspectives
SELECT a.*, c.political_bias, f.region
FROM articles a
JOIN classifications c ON c.article_id = a.id
JOIN feeds f ON f.id = a.feed_id
WHERE a.story_id = :story_id
ORDER BY c.political_bias;
```

### 3. Entity-Based Story Discovery
```sql
-- All stories mentioning a person
SELECT s.*, se.relevance, se.article_count
FROM stories s
JOIN story_entities se ON se.story_id = s.id
JOIN entities e ON e.id = se.entity_id
WHERE e.type = 'person'
AND e.canonical_name = 'Joe Biden'
ORDER BY s.last_updated DESC;
```

### 4. Coverage Gap Analysis
```sql
-- Stories with good coverage on one side but not the other
SELECT s.*, sc.*
FROM stories s
JOIN story_coverage sc ON sc.story_id = s.id
WHERE sc.left_count > 5 AND sc.right_count = 0
-- Missing conservative perspective
```

### 5. Trending Velocity Calculation
```sql
-- Calculate current velocity for a story
SELECT
  sm.story_id,
  COUNT(*) as articles_last_6h,
  COUNT(*) / 6.0 as velocity
FROM story_metrics sm
WHERE sm.story_id = :story_id
AND sm.date_hour >= NOW() - INTERVAL '6 hours'
GROUP BY sm.story_id;
```

## Processing Workflow

### Hybrid Grouping Approach

1. **Article Ingestion**
   - RSS worker fetches article
   - Insert into `articles` table with `processing_status = 'pending'`

2. **Quick Auto-Grouping**
   - Generate embedding via Ollama
   - Find similar stories via vector similarity
   - If match found: assign to story, set `auto_grouped_at`
   - If new topic: create new story
   - Update `processing_status = 'grouped'`

3. **Periodic Refinement** (Optional)
   - Batch re-clustering for accuracy
   - Review low-confidence assignments
   - Update story metrics and coverage

4. **Entity Extraction** (Async)
   - Extract entities from article content
   - Link to existing entities or create new
   - Update `story_entities` aggregates
   - Set `entity_extraction_done = true`

5. **Trending Calculation** (Every 10-15 min)
   - Calculate velocity for active stories
   - Update `trending_score` based on velocity + recency + diversity
   - Update story `status` (emerging/trending/declining)

## Performance Optimizations

### Denormalization
- `stories.article_count` - Avoid COUNT(*) queries
- `stories.source_count` - Fast source diversity checks
- `story_coverage.*` - Pre-computed bias distribution
- `articles.story_id` - Direct FK in addition to story_members

### Strategic Indexes
- Descending indexes on timestamps for trending queries
- Composite indexes for common filters: `(status, trending_score)`
- Entity lookup indexes: `(type, name)`, `canonical_name`

### Query Efficiency
- Time-windowed queries use `published_at DESC` index
- Trending feed uses `(status, trending_score DESC)` index
- Entity searches use pre-computed `story_entities` table

## Benefits Over Original Schema

1. **Explicit Trending Support**
   - Original: Had to cluster and count on-the-fly
   - Enhanced: Pre-computed trending scores, status tracking

2. **Entity-Based Story Linking**
   - Original: Only semantic similarity
   - Enhanced: Also link via shared entities (people, orgs, events)

3. **Coverage Diversity Metrics**
   - Original: Had to aggregate from articles each time
   - Enhanced: Pre-computed in `story_coverage` table

4. **Hybrid Workflow Support**
   - Original: No processing status tracking
   - Enhanced: `processing_status`, `auto_grouped_at`, workflow metadata

5. **Performance at Scale**
   - Original: Generic indexes
   - Enhanced: Optimized indexes for trending, entity search, time-windows

6. **Better User Workflows**
   - **Browsing**: Fast trending feed via indexed trending_score
   - **Searching**: Entity-based search + semantic similarity
   - **Coverage Analysis**: Pre-computed diversity metrics
