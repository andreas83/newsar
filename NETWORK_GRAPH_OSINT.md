# Entity Network Graph - OSINT Feature

## Overview

The Entity Network Graph is a powerful OSINT (Open Source Intelligence) tool that visualizes relationships between entities (people, organizations, locations, and events) based on their co-occurrence in news articles.

## Features

### 1. **Network Visualization**
- **D3.js Force-Directed Graph**: Interactive visualization with physics-based layout
- **Entity Types**: Color-coded nodes for different entity types:
  - 🔵 **Person** (Blue)
  - 🟢 **Organization** (Green)
  - 🟠 **Location** (Orange)
  - 🟣 **Event** (Purple)
- **Relationship Strength**: Edge thickness represents relationship strength
- **Trending Indicators**: Node size based on trending score

### 2. **Filtering & Analysis**
- **Time Range Filtering**: Analyze relationships over specific periods
  - Last 7 days
  - Last 30 days
  - Last 90 days
  - All time
- **Strength Threshold**: Filter weak relationships (0-100% threshold)
- **Node Limit**: Control graph complexity (100-1000 nodes)

### 3. **Path Finding (OSINT)**
- Find shortest path between any two entities
- Discover hidden connections and intermediaries
- Analyze connection strength along the path
- Useful for investigating relationships and networks

### 4. **Interactive Features**
- **Zoom & Pan**: Navigate large networks easily
- **Drag Nodes**: Manually position entities
- **Click to Select**: View detailed entity information
- **Hover for Details**: Quick info on entities and relationships

## Data Model

### Entity Relationships Table

```sql
entity_relationships (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER,           -- First entity
  target_entity_id INTEGER,           -- Second entity
  cooccurrence_count INTEGER,         -- How many articles mention both
  strength REAL,                      -- 0-1 normalized relationship weight
  sentiment_correlation REAL,         -- -1 to 1 sentiment similarity
  first_co_occurrence TIMESTAMP,      -- When first seen together
  last_co_occurrence TIMESTAMP,       -- Most recent co-occurrence
  shared_articles JSONB,              -- Array of article details
  temporal_pattern JSONB,             -- Time-series co-occurrence data
  metadata JSONB
)
```

### Relationship Metrics

1. **Cooccurrence Count**: Number of articles mentioning both entities
2. **Strength**: Weighted score based on:
   - Co-occurrence frequency
   - Entity relevance scores in articles
   - Logarithmic scaling for normalization
3. **Sentiment Correlation**: Pearson correlation of sentiment scores
4. **Temporal Pattern**: Daily co-occurrence counts and velocity trends

## Usage

### 1. Compute Entity Relationships

Before using the network graph, compute relationships from existing articles:

```bash
# Compute all relationships (min 2 co-occurrences)
npm run relationships:compute

# Require at least 3 co-occurrences (reduces noise)
npm run relationships:compute 3

# Analyze only last 7 days
npm run relationships:compute 2 7

# Last 30 days with min 5 co-occurrences
npm run relationships:compute 5 30
```

**Performance**: ~2-3 seconds for 15,000 co-occurrences

### 2. View Network Graph

Navigate to: **`/admin/network`**

The graph will display all entity relationships based on your filters.

### 3. Path Finding Example

To find connections between two entities:

1. Enable "Path Finding" in the UI
2. Enter source entity ID (e.g., `42`)
3. Enter target entity ID (e.g., `123`)
4. Set max depth (default: 5 hops)
5. Click "Find Path"

**Result**: Shows the shortest connection path with intermediary entities

### 4. API Endpoints

#### Get Network Graph Data

```
GET /api/network/graph?minStrength=0.1&limit=500&fromDate=2025-01-01
```

**Parameters**:
- `entityIds`: Filter to specific entities (comma-separated)
- `minStrength`: Minimum relationship strength (0-1)
- `fromDate`: Filter by date range (ISO 8601)
- `toDate`: End of date range
- `limit`: Max edges to return (default: 500)

**Response**:
```json
{
  "success": true,
  "data": {
    "nodes": [
      {
        "id": 42,
        "name": "Donald Trump",
        "type": "person",
        "slug": "donald-trump",
        "trendingScore": 0.85
      }
    ],
    "edges": [
      {
        "source": 42,
        "target": 123,
        "weight": 0.75,
        "cooccurrenceCount": 15,
        "sentimentCorrelation": 0.62,
        "lastSeen": "2025-10-26T..."
      }
    ]
  },
  "stats": {
    "nodeCount": 250,
    "edgeCount": 487
  }
}
```

#### Find Shortest Path

```
GET /api/network/path?sourceId=42&targetId=123&maxDepth=5
```

**Parameters**:
- `sourceId`: Starting entity ID
- `targetId`: Destination entity ID
- `maxDepth`: Maximum hops (default: 5)

**Response**:
```json
{
  "success": true,
  "data": {
    "path": [
      { "entityId": 42, "name": "Donald Trump", "type": "person", "slug": "donald-trump" },
      { "entityId": 89, "name": "Republican Party", "type": "organization", "slug": "republican-party" },
      { "entityId": 123, "name": "Joe Biden", "type": "person", "slug": "joe-biden" }
    ],
    "edges": [
      { "source": 42, "target": 89, "weight": 0.85, "cooccurrenceCount": 45 },
      { "source": 89, "target": 123, "weight": 0.78, "cooccurrenceCount": 32 }
    ],
    "length": 2,
    "totalWeight": 1.63
  }
}
```

## OSINT Use Cases

### 1. **Investigative Journalism**
- Discover hidden connections between political figures
- Track organizational affiliations
- Identify emerging relationships in news coverage

### 2. **Media Bias Analysis**
- Analyze which entities are frequently mentioned together
- Identify narrative clustering patterns
- Compare sentiment correlations across biased sources

### 3. **Event Tracking**
- Monitor how events connect people and organizations
- Track geographic spread of stories
- Analyze temporal evolution of relationships

### 4. **Network Analysis**
- Identify central/influential entities (high connection count)
- Detect entity communities and clusters
- Find bridge entities connecting disparate groups

## Technical Architecture

### Backend Services

1. **`entityRelationshipComputer.ts`**: Core computation service
   - `computeEntityRelationships()`: Compute all relationships
   - `getEntityNetworkGraph()`: Fetch graph data for visualization

2. **Database Schema**: PostgreSQL with jsonb for flexible metadata
   - Indexed for fast queries on source/target entities
   - Optimized for temporal filtering

3. **API Layer**: RESTful endpoints with query-based filtering

### Frontend Components

1. **`EntityNetworkGraph.vue`**: D3.js visualization component
   - Force-directed graph layout
   - Interactive zoom, pan, drag
   - Custom tooltips and highlighting

2. **`/admin/network.vue`**: Admin page with filters
   - Time range selection
   - Strength threshold slider
   - Path finding interface
   - Entity details panel

## Performance Optimization

### Computation
- Bulk processing with batch upserts
- Efficient SQL joins for co-occurrence detection
- Progress logging for long operations

### Visualization
- Configurable node limits (prevent browser overload)
- Strength filtering to reduce edge count
- Physics simulation with adjustable parameters

## Maintenance

### Update Relationships

Relationships should be recomputed periodically as new articles are processed:

```bash
# Daily update (last 7 days)
npm run relationships:compute 2 7

# Weekly full recompute
npm run relationships:compute 2
```

### Database Cleanup

Remove stale relationships:

```sql
-- Remove relationships not updated in 90 days
DELETE FROM entity_relationships
WHERE last_co_occurrence < NOW() - INTERVAL '90 days';
```

## Future Enhancements

- [ ] Community detection algorithms (Louvain, modularity)
- [ ] Export to GEXF/GraphML for Gephi analysis
- [ ] Time-series animation (relationships over time)
- [ ] Centrality metrics (betweenness, eigenvector)
- [ ] Integration with external knowledge graphs
- [ ] Automated relationship validation
- [ ] Entity disambiguation and merging

## Troubleshooting

### No relationships showing
1. Ensure entities are extracted: Check `article_entities` table
2. Compute relationships: Run `npm run relationships:compute`
3. Adjust filters: Lower minimum strength threshold

### Slow graph performance
1. Reduce node limit (use 100-250 instead of 500+)
2. Increase minimum strength threshold
3. Use time range filtering

### Missing entities in path finding
1. Ensure both entity IDs exist in database
2. Check if entities have any relationships
3. Increase max depth (try 7-10 for distant connections)

## References

- **D3.js Documentation**: https://d3js.org/
- **Force-Directed Graphs**: https://en.wikipedia.org/wiki/Force-directed_graph_drawing
- **Dijkstra's Algorithm**: https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm
- **OSINT Techniques**: https://osintframework.com/
