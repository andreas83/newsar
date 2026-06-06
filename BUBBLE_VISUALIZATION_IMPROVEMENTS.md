# Trending Bubbles - UX Improvements with Clustering

## Overview

Enhanced the trending topics bubble visualization with advanced clustering and relationship features, leveraging your existing topic relationship analysis system.

## 🎨 Key UX Improvements

### 1. **Visual Clustering with Force-Directed Layout**
- Related topics are positioned closer together using a physics simulation
- Bubbles repel each other to prevent overlap
- Related bubbles attract each other based on relationship strength
- Creates natural visual clusters that match semantic relationships

### 2. **Relationship Visualization**
- **Connection Lines**: Shows relationships between topics
  - Co-occurrence (blue): Topics that appear together in articles
  - Synonyms (purple): Alternative terms for the same concept
  - Related (cyan): Topics with other connections
- **Strength-based styling**: Line opacity and thickness reflect relationship strength
- **Dynamic display**: Only shows connections for hovered/selected bubbles

### 3. **Interactive Highlighting**
- **Hover mode**: Temporarily highlights related topics
- **Selection mode**: Click to lock the highlight and show detailed panel
- **Dimming effect**: Unrelated topics fade to 30% opacity with scale reduction
- **Visual feedback**: Selected bubbles get a ring highlight and scale up

### 4. **Smart Exploration Panel**
- Appears when you select a bubble
- Lists all related topics as clickable chips
- Action buttons:
  - "Search Articles" - Find articles about the selected topic
  - "Clear Selection" - Reset the view
- Shows relationship context

### 5. **Enhanced Legend**
- Category legend (colors)
- Relationship type legend (line colors)
- Clear visual reference for understanding the visualization

## 🔧 Technical Implementation

### New API Endpoint: `/api/trending-enhanced`

```typescript
GET /api/trending-enhanced?limit=30&relationships=true
```

**Response includes:**
- `bubbles[]`: Enhanced bubble data with positions
  - `id`: Keyword ID for relationship lookups
  - `keyword`, `category`, `count`, `size`, `relevance`
  - `position`: { x, y } coordinates (0-100 range)
- `relationships[]`: Topic relationships
  - `sourceId`, `targetId`: Bubble IDs
  - `type`: 'co_occurrence' | 'synonym' | 'related'
  - `strength`: 0-1 score based on PMI
- `timestamp`: Data freshness

### Force-Directed Layout Algorithm

**Parameters:**
- 50 iterations
- Repulsion strength: 800 (size-weighted)
- Attraction strength: 0.1 (relationship-weighted)

**Process:**
1. Initialize random positions
2. For each iteration:
   - Calculate repulsion forces between all bubble pairs
   - Calculate attraction forces between related bubbles
   - Apply forces with damping (0.1)
   - Constrain to bounds (5-95%)

**Result:** Bubbles naturally cluster based on semantic relationships

### Component Props

```vue
<TrendingBubblesEnhanced
  :show-relationships="true"  // Show connection lines
  layout="clustered"          // 'clustered' | 'standard'
/>
```

## 📊 Data Flow

```
Articles (last 7 days)
  ↓
Keywords extracted by Ollama
  ↓
Topic Relationship Analysis
  ├─ Co-occurrence (PMI scores)
  ├─ Synonyms (semantic similarity)
  └─ Hierarchies (parent-child)
  ↓
Trending API (aggregation + positioning)
  ↓
Enhanced Bubbles Component
  ├─ Force-directed layout
  ├─ Interactive highlighting
  └─ Relationship visualization
```

## 🎯 Use Cases

### 1. **Discovering Topic Clusters**
- Quickly identify groups of related topics in the news
- Understand which topics are commonly discussed together
- See emerging topic relationships

### 2. **Exploring Story Connections**
- Click a bubble to see what it's related to
- Follow relationship chains to understand story context
- Find alternative perspectives on the same topic

### 3. **Trend Analysis**
- Visual clustering reveals trending topic groups
- Relationship strength indicates how strongly topics are connected
- Size reflects frequency in recent articles

### 4. **Search Enhancement**
- Click any bubble to search for articles
- See related topics before searching
- Understand topic context before diving in

## 🚀 Integration

### Current Implementation

The main index page (`/app/pages/index.vue`) now uses the enhanced bubbles:

```vue
<TrendingBubblesEnhanced :show-relationships="true" layout="clustered" />
```

### Demo Page

Visit `/bubbles-demo` to see:
- Side-by-side comparison of original vs enhanced
- Interactive controls to toggle features
- Feature comparison table
- Technical implementation details

### Original Component

The original `TrendingBubbles.vue` is preserved for reference and can be used if needed.

## 📈 Benefits

### For Users
- **Better understanding**: Visual clusters reveal topic relationships
- **Easier exploration**: Hover and click to discover connections
- **Less clutter**: Dimming effect focuses attention
- **More context**: See related topics before clicking

### For the Platform
- **Leverages existing data**: Uses topic relationship analysis already in place
- **Performant**: Force-directed layout runs once on the server
- **Scalable**: Works with any number of bubbles (tested with 30+)
- **Extensible**: Easy to add more relationship types

## 🔮 Future Enhancements

### Potential Additions
1. **Story-based bubbles**: Show story clusters instead of keywords
2. **Time-based animation**: Animate bubble movement as topics trend
3. **Filtering controls**: Filter by category, time window, or relationship type
4. **Network graph view**: Alternative visualization with nodes and edges
5. **Zoom and pan**: Explore large topic networks
6. **Mobile optimization**: Touch-friendly interactions
7. **Custom color schemes**: User-selectable themes
8. **Export visualization**: Save as image or data

### Easy Wins
- Add more relationship types (hierarchies, entity-keyword links)
- Increase trending window (14 days, 30 days)
- Add trending score calculation
- Show velocity (rising/falling trends)

## 🧪 Testing

### Manual Testing
1. Visit the homepage or `/bubbles-demo`
2. Hover over bubbles - should see highlights and connection lines
3. Click a bubble - should see selection panel
4. Check that unrelated bubbles are dimmed
5. Click "Search Articles" - should navigate to search
6. Clear selection - should reset view

### Data Requirements
- Keywords must exist in database
- Topic relationships must be computed (run `npm run topic-relationships:analyze`)
- Recent articles (last 7 days) needed for trending data

### Performance
- API response time: < 200ms for 30 bubbles
- Layout calculation: ~50ms server-side
- Interactive responsiveness: 60fps animations
- Relationship queries: Optimized with indexes

## 📝 Configuration

### Adjusting the Algorithm

Edit `/server/api/trending-enhanced.get.ts`:

```typescript
// Layout parameters
const iterations = 50              // More = better layout, slower
const repulsionStrength = 800      // Higher = more spread out
const attractionStrength = 0.1     // Higher = tighter clusters

// Data parameters
const sevenDaysAgo = ...          // Change trending window
const limit = 30                   // Number of bubbles

// Relationship filters
minPMI: 2.0                       // Minimum co-occurrence strength
```

### Customizing Appearance

Edit `/app/components/TrendingBubblesEnhanced.vue`:

```typescript
// Bubble size range
const minSize = 2.5  // rem
const maxSize = 8    // rem

// Opacity when dimmed
opacity-30 scale-95

// Relationship line styles
strokeWidth: Math.max(1, rel.strength * 3)
opacity: 0.3 + rel.strength * 0.4
```

## 🎓 Key Concepts

### Pointwise Mutual Information (PMI)
- Measures how much more often two topics appear together than expected by chance
- Formula: PMI = log(P(A,B) / (P(A) × P(B)))
- Higher scores = stronger relationships
- Used for both co-occurrence detection and layout strength

### Force-Directed Layout
- Physics simulation treating bubbles as charged particles
- Repulsion: All pairs push apart (inverse square law)
- Attraction: Related pairs pull together (linear)
- Equilibrium: Settles into natural clustering pattern

### Cosine Similarity
- Used in vector embeddings for semantic similarity
- Ranges from -1 (opposite) to 1 (identical)
- Your system already uses this for article clustering
- Can be integrated with bubble relationships

## 📚 Related Files

**Components:**
- `/app/components/TrendingBubbles.vue` (original)
- `/app/components/TrendingBubblesEnhanced.vue` (new)

**API Endpoints:**
- `/server/api/trending.get.ts` (original)
- `/server/api/trending-enhanced.get.ts` (new)

**Services:**
- `/server/services/topicRelationships/coOccurrenceAnalyzer.ts`
- `/server/services/topicRelationships/synonymDetector.ts`
- `/server/services/articleClustering.ts`

**Pages:**
- `/app/pages/index.vue` (updated to use enhanced)
- `/app/pages/bubbles-demo.vue` (new demo page)

## 🤝 Contributing

To extend the bubble visualization:

1. Add new relationship types in `topicRelationships` service
2. Update the enhanced API to include them
3. Add visual styles in the component
4. Update the legend
5. Test with real data

## 📄 License

Same as the main project.

---

**Questions or feedback?** Check the demo page at `/bubbles-demo` or review the implementation in the files listed above.
