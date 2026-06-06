# Topic Linking & Grouping System - Implementation Plan

## Overview
Build an AI-powered topic relationship system that automatically detects and displays connections between keywords and entities across multiple interfaces.

**User Requirements:**
- Display: All interfaces (expandable bubbles, graph page, search sidebar)
- Curation: Fully automatic (AI/ML based)
- Relationships: Synonyms, Parent-child hierarchies, Related entities

## Phase 1: Database Schema

### 1.1 Topic Relationships Table
```sql
CREATE TABLE topic_relationships (
  id SERIAL PRIMARY KEY,
  source_type VARCHAR(50) NOT NULL, -- 'keyword' | 'entity'
  source_id INTEGER NOT NULL,
  source_value VARCHAR(255) NOT NULL, -- denormalized for performance
  target_type VARCHAR(50) NOT NULL, -- 'keyword' | 'entity'
  target_id INTEGER NOT NULL,
  target_value VARCHAR(255) NOT NULL, -- denormalized for performance
  relationship_type VARCHAR(50) NOT NULL, -- 'synonym' | 'parent' | 'child' | 'related' | 'co_occurrence'
  strength REAL NOT NULL, -- 0-1 confidence score
  supporting_evidence JSONB, -- {co_occurrence_count, embedding_similarity, ollama_confidence, shared_articles[]}
  auto_detected BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX topic_relationships_source_idx ON topic_relationships(source_type, source_id);
CREATE INDEX topic_relationships_target_idx ON topic_relationships(target_type, target_id);
CREATE INDEX topic_relationships_type_idx ON topic_relationships(relationship_type);
CREATE INDEX topic_relationships_strength_idx ON topic_relationships(strength DESC);
```

### 1.2 Topic Clusters Table
```sql
CREATE TABLE topic_clusters (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_cluster_id INTEGER REFERENCES topic_clusters(id),
  primary_keywords TEXT[], -- array of main keywords
  primary_entities TEXT[], -- array of main entities
  metadata JSONB, -- {article_count, date_range: {start, end}, trending_score}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX topic_clusters_parent_idx ON topic_clusters(parent_cluster_id);
CREATE INDEX topic_clusters_name_idx ON topic_clusters(name);
```

## Phase 2: Auto-Detection Services

### 2.1 Synonym Detection Service
**File:** `server/services/topicRelationships/synonymDetector.ts`

**Algorithm:**
```typescript
for each keyword pair (k1, k2):
  // String similarity check
  string_similarity = levenshtein_ratio(k1, k2)

  if string_similarity > 0.80:
    // Embedding similarity check
    embed1 = await getKeywordEmbedding(k1)
    embed2 = await getKeywordEmbedding(k2)
    embedding_similarity = cosine_similarity(embed1, embed2)

    if embedding_similarity > 0.85:
      strength = (string_similarity + embedding_similarity) / 2
      createRelationship(k1, k2, 'synonym', strength, {
        string_similarity,
        embedding_similarity
      })
```

**Examples it will detect:**
- "ceasefire" ↔ "ceasefire agreement" (high string similarity)
- "Gaza Strip" ↔ "Gaza" (embedding similarity)
- "climate change" ↔ "global warming" (embedding similarity)

### 2.2 Co-Occurrence Analysis Service
**File:** `server/services/topicRelationships/coOccurrenceAnalyzer.ts`

**Algorithm:** Pointwise Mutual Information (PMI)
```typescript
PMI(topic_a, topic_b) = log( P(a,b) / (P(a) * P(b)) )

where:
  P(a,b) = articles_containing_both / total_articles
  P(a) = articles_containing_a / total_articles
  P(b) = articles_containing_b / total_articles

if PMI > 2.0 AND co_occurrence_count > 3:
  strength = min(1.0, PMI / 5.0) // normalize to 0-1
  createRelationship(a, b, 'co_occurrence', strength, {
    pmi_score: PMI,
    co_occurrence_count,
    shared_articles: [article_ids]
  })
```

**Examples it will detect:**
- "ceasefire" + "Gaza" (appear together often)
- "climate change" + "protests" (co-occur in news)

### 2.3 Hierarchical Relationship Detector
**File:** `server/services/topicRelationships/hierarchyDetector.ts`

**Method:** Ollama-based semantic analysis
```typescript
async function detectHierarchy(topic_a: string, topic_b: string) {
  const prompt = `Given these news topics from articles:
Topic A: "${topic_a}"
Topic B: "${topic_b}"

Question: Is Topic A a broader category that contains Topic B as a subtopic?

Examples:
- "Middle East conflict" is broader than "Gaza ceasefire" → YES
- "Climate change" is broader than "carbon emissions" → YES
- "Israel" and "Gaza" are related but neither contains the other → NO

Answer: YES, NO, or UNCERTAIN
Confidence: [0-100]%
Reasoning: [one sentence]`;

  const response = await ollama.chat({
    model: 'llama3.2:3b',
    messages: [{ role: 'user', content: prompt }]
  });

  // Parse response
  if (response.includes('YES') && confidence > 70) {
    createRelationship(topic_a, topic_b, 'parent', confidence/100, {
      ollama_confidence: confidence,
      reasoning: extractReasoning(response)
    });
    createRelationship(topic_b, topic_a, 'child', confidence/100, {
      ollama_confidence: confidence,
      reasoning: extractReasoning(response)
    });
  }
}
```

**Examples it will detect:**
- "Gaza crisis" → ["ceasefire", "humanitarian aid", "buffer zone"]
- "Middle East" → ["Israel", "Gaza", "Hamas"]

### 2.4 Entity-Keyword Linker
**File:** `server/services/topicRelationships/entityKeywordLinker.ts`

**Algorithm:**
```typescript
// For each entity-keyword pair
SELECT
  e.name as entity,
  k.keyword,
  COUNT(DISTINCT a.id) as co_occurrence,
  AVG(ae.relevance_score) as avg_entity_relevance,
  AVG(k.relevance_score) as avg_keyword_relevance
FROM entities e
JOIN article_entities ae ON e.id = ae.entity_id
JOIN articles a ON ae.article_id = a.id
JOIN keywords k ON a.id = k.article_id
GROUP BY e.name, k.keyword
HAVING COUNT(DISTINCT a.id) >= 2

// Calculate strength
strength = (
  (co_occurrence / max_co_occurrence) * 0.4 +
  avg_entity_relevance * 0.3 +
  avg_keyword_relevance * 0.3
)

if strength > 0.3:
  createRelationship(entity, keyword, 'related', strength, {
    co_occurrence_count: co_occurrence,
    shared_articles: article_ids
  })
```

**Examples it will detect:**
- "ceasefire" → [Israel, Gaza, Hamas, UN]
- "climate change" → [Paris Agreement, Greta Thunberg, UN]

## Phase 3: Background Processing

### 3.1 Relationship Computation Worker
**File:** `server/workers/topicRelationshipWorker.ts`

**BullMQ Jobs:**
```typescript
// Job types
'compute-synonyms'       // priority: 10
'compute-cooccurrence'   // priority: 15
'compute-hierarchy'      // priority: 20 (slow, uses Ollama)
'link-entities-keywords' // priority: 12

// Scheduler: runs daily at 3 AM
'scheduled-relationship-update'
```

**Process:**
1. Get all keywords and entities
2. Compute pairwise relationships
3. Store in topic_relationships table
4. Update cluster metadata

### 3.2 Cluster Generation Worker
**Schedule:** Weekly on Sundays

**Algorithm:**
```typescript
// 1. Get all keywords with their relationships
// 2. Build adjacency matrix
// 3. Run community detection (Louvain algorithm)
// 4. Name each cluster using most frequent/relevant terms
// 5. Store in topic_clusters table
```

## Phase 4: API Endpoints

### 4.1 GET /api/topics/related
**File:** `server/api/topics/related.get.ts`

**Params:**
- `id`: keyword or entity ID
- `type`: 'keyword' | 'entity'
- `relationship`: optional filter (synonym, parent, child, related)
- `limit`: max results (default 20)

**Response:**
```json
{
  "source": {
    "id": 123,
    "type": "keyword",
    "value": "ceasefire"
  },
  "relationships": [
    {
      "target": {"id": 124, "type": "keyword", "value": "ceasefire agreement"},
      "relationship_type": "synonym",
      "strength": 0.92,
      "article_count": 4
    },
    {
      "target": {"id": 45, "type": "entity", "value": "Israel"},
      "relationship_type": "related",
      "strength": 0.85,
      "article_count": 8
    }
  ]
}
```

### 4.2 GET /api/topics/clusters
**File:** `server/api/topics/clusters.get.ts`

**Response:**
```json
{
  "clusters": [
    {
      "id": 1,
      "name": "Gaza Crisis",
      "keywords": ["ceasefire", "humanitarian aid", "Gaza Strip"],
      "entities": ["Israel", "Gaza", "Hamas"],
      "article_count": 45,
      "trending_score": 8.5
    }
  ]
}
```

### 4.3 GET /api/topics/graph
**File:** `server/api/topics/graph.get.ts`

**Params:**
- `center`: optional keyword/entity to center on
- `depth`: how many relationship hops (default 2)
- `min_strength`: filter weak relationships (default 0.5)

**Response:** Graph data in format compatible with D3.js/Vis.js
```json
{
  "nodes": [
    {"id": "k-123", "label": "ceasefire", "type": "keyword", "category": "event", "size": 10},
    {"id": "e-45", "label": "Israel", "type": "entity", "entityType": "location", "size": 8}
  ],
  "edges": [
    {"from": "k-123", "to": "e-45", "type": "related", "strength": 0.85, "width": 3}
  ]
}
```

### 4.4 GET /api/topics/:id/hierarchy
**File:** `server/api/topics/[id]/hierarchy.get.ts`

**Response:**
```json
{
  "topic": {"id": 123, "value": "ceasefire", "type": "keyword"},
  "parents": [
    {"id": 200, "value": "Gaza crisis", "strength": 0.78}
  ],
  "children": [
    {"id": 124, "value": "ceasefire agreement", "strength": 0.92},
    {"id": 125, "value": "buffer zone", "strength": 0.65}
  ],
  "siblings": [
    {"id": 130, "value": "humanitarian aid", "strength": 0.70}
  ]
}
```

## Phase 5: UI Components

### 5.1 Expandable Trending Bubbles
**File:** `app/components/TrendingBubblesExpanded.vue`

**Features:**
- Click bubble → smooth expand animation
- Show related topics as smaller sub-bubbles
- Synonyms: same color, 60% size
- Related entities: different shape (squares), connected by lines
- Click sub-bubble → navigate to that topic
- ESC or click outside → collapse

**Visual:**
```
[Ceasefire] (large red bubble)
  ├─ [ceasefire agreement] (smaller red bubble, connected)
  ├─ [Israel] (blue square, connected line)
  ├─ [Gaza] (blue square, connected line)
  └─ [Hamas] (blue square, connected line)
```

### 5.2 Topic Knowledge Graph Page
**Route:** `/topics/graph`
**File:** `app/pages/topics/graph.vue`

**Library:** Vis.js Network (better for this use case than D3)

**Features:**
- Interactive force-directed graph
- Node types:
  - Keywords: circles, colored by category
  - Entities: squares, colored by type
- Edge types:
  - Synonym: dashed line
  - Parent/child: arrow
  - Related: solid line
  - Co-occurrence: dotted line
- Interactions:
  - Hover node → show tooltip with article count
  - Click node → highlight connected nodes, dim others
  - Double-click node → navigate to articles
  - Right-click node → show context menu (view hierarchy, related topics)
- Controls:
  - Zoom in/out
  - Filter by relationship type
  - Filter by category
  - Search for topic
- Physics simulation: adjustable (can freeze)

### 5.3 Related Topics Sidebar
**File:** `app/components/RelatedTopicsSidebar.vue`

**Used on:**
- Search results page
- Article detail page

**Content:**
```
Related Topics
──────────────
Similar Terms
  • ceasefire agreement (4 articles)
  • Gaza ceasefire (2 articles)

Broader Topics
  • Gaza crisis (12 articles)
  • Middle East conflict (25 articles)

Related Entities
  • Israel (8 articles)
  • Gaza (6 articles)
  • Hamas (5 articles)

Often Mentioned With
  • humanitarian aid (7 articles)
  • buffer zone (3 articles)
```

Each item clickable → refine/expand search

## Phase 6: Automated Scripts

### 6.1 npm run topics:compute-relationships
**File:** `server/scripts/computeTopicRelationships.ts`

Compute all relationships from scratch:
1. Clear existing auto-detected relationships
2. Run synonym detection
3. Run co-occurrence analysis
4. Run entity-keyword linking
5. Queue hierarchy detection jobs (Ollama, slow)

### 6.2 npm run topics:cluster
**File:** `server/scripts/generateTopicClusters.ts`

Generate topic clusters using community detection

### 6.3 npm run topics:update
**File:** `server/scripts/updateTopicRelationships.ts`

Incremental update:
1. Get new keywords/entities since last update
2. Compute relationships for new items only
3. Update existing clusters

## Implementation Priorities

### Phase 1 (Foundation) - 4 hours
1. Database schema (1h)
2. Synonym detector (1h)
3. Co-occurrence analyzer (1h)
4. Entity-keyword linker (1h)

### Phase 2 (Core Features) - 6 hours
1. Relationship computation worker (2h)
2. API endpoints (2h)
3. Basic related topics display (2h)

### Phase 3 (Advanced UI) - 8 hours
1. Expandable bubbles (3h)
2. Knowledge graph page (4h)
3. Related topics sidebar (1h)

### Phase 4 (Polish) - 2 hours
1. Hierarchy detector with Ollama (1h)
2. Cluster generation (1h)

**Total: ~20 hours**

## Success Metrics

After implementation:
- **Coverage**: >80% of keywords have at least 1 relationship
- **Accuracy**: >90% of synonyms are correctly detected
- **Performance**: Graph page loads in <2 seconds
- **User Engagement**: Click-through rate on related topics >15%

## Future Enhancements

1. **Temporal relationships**: Track how topic relationships change over time
2. **Sentiment-aware linking**: "Israel" + "ceasefire" → positive vs negative sentiment
3. **Geographic clustering**: Topics by region
4. **Multi-language support**: Detect cross-language synonyms
5. **User feedback**: Let users suggest/vote on relationships
