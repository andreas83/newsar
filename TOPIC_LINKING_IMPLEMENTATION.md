# Topic Linking & Grouping System - Implementation Summary

## ✅ Completed Implementation

The AI-powered topic relationship system has been successfully implemented with automatic detection of connections between keywords and entities.

---

## 🗄️ Database Schema

**New Tables Created:**

1. **topic_relationships** - Stores relationships between topics
   - Tracks synonyms, parent/child hierarchies, co-occurrences, and related entities
   - Includes strength scores (0-1) and supporting evidence
   - Denormalized for performance with source/target values

2. **topic_clusters** - Groups of related topics
   - Hierarchical clustering support (parent_cluster_id)
   - Arrays of primary keywords and entities
   - Metadata for article counts, trending scores, and date ranges

---

## 🔧 Services Implemented

### 1. Synonym Detector (`server/services/topicRelationships/synonymDetector.ts`)
- **Algorithm:** Levenshtein string similarity + embedding similarity
- **Thresholds:** String similarity > 0.80, Embedding similarity > 0.85
- **Examples:** "ceasefire" ↔ "ceasefire agreement", "Gaza Strip" ↔ "Gaza"

### 2. Co-Occurrence Analyzer (`server/services/topicRelationships/coOccurrenceAnalyzer.ts`)
- **Algorithm:** Pointwise Mutual Information (PMI)
- **Thresholds:** PMI > 2.0, co-occurrence count >= 3
- **Supports:** Both keyword-keyword and entity-entity relationships
- **Examples:** "ceasefire" + "Gaza", "climate change" + "protests"

### 3. Entity-Keyword Linker (`server/services/topicRelationships/entityKeywordLinker.ts`)
- **Strength Calculation:**
  - Normalized co-occurrence (40%)
  - Average entity relevance (30%)
  - Average keyword relevance (30%)
- **Threshold:** Strength >= 0.3
- **Examples:** "ceasefire" → [Israel, Gaza, Hamas, UN]

### 4. Hierarchy Detector (`server/services/topicRelationships/hierarchyDetector.ts`)
- **Algorithm:** Ollama LLM analysis (llama3.2:3b)
- **Threshold:** Confidence >= 70%
- **Creates:** Parent-child bidirectional relationships
- **Examples:** "Gaza crisis" → ["ceasefire", "humanitarian aid", "buffer zone"]

---

## 🌐 API Endpoints

### 1. GET `/api/topics/related`
Get related topics for a specific keyword or entity
```bash
# Query params: id, type (keyword|entity), relationship (optional), limit
curl "http://localhost:3000/api/topics/related?id=123&type=keyword&limit=20"
```

**Response:**
```json
{
  "source": { "id": 123, "type": "keyword", "value": "ceasefire" },
  "relationships": [
    {
      "target": { "id": 124, "type": "keyword", "value": "ceasefire agreement" },
      "relationshipType": "synonym",
      "strength": 0.92,
      "articleCount": 4
    }
  ]
}
```

### 2. GET `/api/topics/clusters`
Get all topic clusters
```bash
curl "http://localhost:3000/api/topics/clusters?limit=20"
```

### 3. GET `/api/topics/graph`
Get graph data for visualization (D3.js/Vis.js compatible)
```bash
# Query params: center (optional), centerType, depth (default 2), minStrength (default 0.5)
curl "http://localhost:3000/api/topics/graph?center=ceasefire&depth=2&minStrength=0.5"
```

**Response:**
```json
{
  "nodes": [
    { "id": "k-123", "label": "ceasefire", "type": "keyword", "size": 10 },
    { "id": "e-45", "label": "Israel", "type": "entity", "size": 8 }
  ],
  "edges": [
    { "from": "k-123", "to": "e-45", "type": "related", "strength": 0.85, "width": 3 }
  ]
}
```

### 4. GET `/api/topics/[id]/hierarchy`
Get hierarchical relationships for a topic
```bash
# Query params: type (keyword|entity), limit
curl "http://localhost:3000/api/topics/123/hierarchy?type=keyword&limit=10"
```

**Response:**
```json
{
  "topic": { "id": 123, "value": "ceasefire", "type": "keyword" },
  "parents": [{ "id": 200, "value": "Gaza crisis", "strength": 0.78 }],
  "children": [{ "id": 124, "value": "ceasefire agreement", "strength": 0.92 }],
  "siblings": [{ "id": 130, "value": "humanitarian aid", "strength": 0.70 }]
}
```

---

## 📜 NPM Scripts

### Test & Compute Relationships

```bash
# Quick test on small dataset (recommended first)
npm run test:topics

# Compute all relationships (synonyms, co-occurrences, entity-keyword links)
npm run topics:compute

# Compute with hierarchy detection (slow, uses Ollama)
npm run topics:compute -- --hierarchy

# Limit processing to specific number of topics
npm run topics:compute -- --limit=50
```

### Background Workers

```bash
# Start topic relationship worker (processes jobs from Redis queue)
npm run worker:topics
```

---

## 🔄 Background Processing with BullMQ

**Queue System:**
- `detect-synonyms` (priority: 10)
- `analyze-cooccurrence` (priority: 15)
- `link-entities-keywords` (priority: 12)
- `detect-hierarchy` (priority: 20 - slow)
- `compute-all-relationships` (priority: 5)

**Usage:**
```typescript
import {
  queueSynonymDetection,
  queueCoOccurrenceAnalysis,
  queueEntityKeywordLinking,
  queueHierarchyDetection,
  queueFullRelationshipComputation
} from '~/server/queues/topicRelationshipQueue'

// Queue individual jobs
await queueSynonymDetection({ limit: 100 })
await queueCoOccurrenceAnalysis({ limit: 100, type: 'keyword' })
await queueEntityKeywordLinking({ limit: 200 })

// Or queue everything at once
await queueFullRelationshipComputation({ limit: 100, includeHierarchy: true })
```

---

## 🚀 Getting Started

### 1. Test the System (Small Dataset)
```bash
npm run test:topics
```
This will process ~20 keywords and create initial relationships.

### 2. Compute Full Relationships
```bash
# Without hierarchy (faster)
npm run topics:compute

# With hierarchy detection (slower, uses Ollama)
npm run topics:compute -- --hierarchy --limit=100
```

### 3. Start Background Worker (Optional)
```bash
npm run worker:topics
```

### 4. Query via API
```bash
# Get related topics
curl "http://localhost:3000/api/topics/related?id=1&type=keyword"

# Get topic graph
curl "http://localhost:3000/api/topics/graph?minStrength=0.5&limit=100"
```

---

## 📊 Expected Results

After running `npm run test:topics` or `npm run topics:compute`, you should see:

- **Synonyms:** Keywords with high string + embedding similarity
- **Co-occurrences:** Topics that appear together frequently (PMI-based)
- **Entity-Keyword Links:** Entities connected to relevant keywords
- **Hierarchies:** Parent-child topic relationships (if --hierarchy flag used)

**Example Output:**
```
🔄 Computing topic relationships from scratch...

Step 1: Clearing existing auto-detected relationships...
  ✅ Cleared 0 existing relationships

Step 2: Running synonym detection...
  String similarity: 0.920 ("ceasefire" vs "ceasefire agreement")
  Embedding similarity: 0.887
  ✅ Created relationship: ceasefire → ceasefire agreement
  ✅ Found 5 synonyms

Step 3: Running keyword co-occurrence analysis...
  "ceasefire" + "Gaza":
    Co-occurrences: 8
    PMI: 2.456
  ✅ Found 12 keyword co-occurrences

Step 4: Running entity co-occurrence analysis...
  ✅ Found 7 entity co-occurrences

Step 5: Running entity-keyword linking...
  "Israel" ↔ "ceasefire":
    Co-occurrence: 8 (normalized: 1.000)
    Entity relevance: 0.850
    Keyword relevance: 0.780
    Strength: 0.843
  ✅ Created 23 entity-keyword links

✅ Topic relationship computation complete!
```

---

## 🎯 Next Steps

### Phase 5: UI Components (From Original Plan)

To complete the full vision, consider implementing:

1. **Expandable Trending Bubbles** (`app/components/TrendingBubblesExpanded.vue`)
   - Click to expand and show related topics
   - Visual connections between topics

2. **Topic Knowledge Graph Page** (`app/pages/topics/graph.vue`)
   - Interactive force-directed graph using Vis.js
   - Click/hover interactions
   - Filtering and search

3. **Related Topics Sidebar** (`app/components/RelatedTopicsSidebar.vue`)
   - Show on search results and article pages
   - Group by relationship type
   - Clickable to refine searches

### Scheduled Updates

Consider adding a cron job or scheduled task:
```typescript
// Run daily at 3 AM
await queueFullRelationshipComputation({ limit: 200, includeHierarchy: false })
```

---

## 📈 Performance Notes

- **Synonym Detection:** ~0.5s per pair (embedding generation)
- **Co-Occurrence:** Fast (SQL-based)
- **Entity-Keyword Linking:** Fast (SQL-based)
- **Hierarchy Detection:** ~2-3s per comparison (Ollama LLM calls)

**Recommendation:** Run hierarchy detection sparingly or in background jobs.

---

## 🐛 Troubleshooting

### Ollama Not Available
```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Pull required models
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

### Redis Connection Issues
```bash
# Check Redis is running
redis-cli ping

# Or use non-Redis batch scripts
npm run test:topics  # Doesn't require Redis
```

### No Relationships Found
- Ensure articles have been classified: `npm run classify:all`
- Ensure keywords have been extracted: `npm run analyze:all`
- Check database has sufficient data: `psql newsar -c "SELECT COUNT(*) FROM keywords"`

---

## 📚 File Structure

```
server/
├── database/
│   ├── schema.ts                              # Added topicRelationships & topicClusters tables
│   └── migrations/
│       └── 0001_topic_relationships.sql       # Migration file
├── services/
│   └── topicRelationships/
│       ├── synonymDetector.ts                 # Levenshtein + embeddings
│       ├── coOccurrenceAnalyzer.ts            # PMI-based analysis
│       ├── entityKeywordLinker.ts             # Link entities to keywords
│       └── hierarchyDetector.ts               # Ollama-based hierarchy detection
├── queues/
│   └── topicRelationshipQueue.ts              # BullMQ queue functions
├── workers/
│   └── topicRelationshipWorker.ts             # Background job processor
├── scripts/
│   ├── computeTopicRelationships.ts           # Full computation script
│   └── testTopicRelationships.ts              # Quick test script
└── api/
    └── topics/
        ├── related.get.ts                     # GET /api/topics/related
        ├── clusters.get.ts                    # GET /api/topics/clusters
        ├── graph.get.ts                       # GET /api/topics/graph
        └── [id]/
            └── hierarchy.get.ts               # GET /api/topics/:id/hierarchy
```

---

## ✨ Success!

The Topic Linking & Grouping System is now fully functional and ready to detect relationships automatically. Run the test script to see it in action!

```bash
npm run test:topics
```
