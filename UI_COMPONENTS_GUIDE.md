# Topic Linking UI Components - Usage Guide

## 🎨 Components Created

The Topic Linking & Grouping System now has full UI components ready to use!

---

## 1. Related Topics Sidebar

**Component:** `app/components/RelatedTopicsSidebar.vue`

A sidebar component that displays related topics grouped by relationship type.

### Features:
- Groups relationships by type (Synonyms, Broader Topics, Subtopics, Co-occurrences, Related)
- Color-coded by relationship type
- Click to navigate to topic search
- Shows article counts and strength scores
- Responsive design

### Usage:
```vue
<RelatedTopicsSidebar
  :topic-id="123"
  :topic-type="'keyword'"
  :topic-value="'ceasefire'"
/>
```

### Props:
- `topicId` (number) - ID of the keyword or entity
- `topicType` ('keyword' | 'entity') - Type of topic
- `topicValue` (string) - Display name of the topic

### Example Integration:
```vue
<!-- In your search results or article detail page -->
<template>
  <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
    <div class="lg:col-span-3">
      <!-- Main content -->
    </div>
    <div class="lg:col-span-1">
      <RelatedTopicsSidebar
        v-if="selectedKeyword"
        :topic-id="selectedKeyword.id"
        :topic-type="'keyword'"
        :topic-value="selectedKeyword.keyword"
      />
    </div>
  </div>
</template>
```

---

## 2. Topic Knowledge Graph Page

**Route:** `/topics/graph`
**File:** `app/pages/topics/graph.vue`

An interactive page to explore topic relationships as a network graph.

### Features:
- Search to center graph on specific topic
- Filter by relationship type (synonym, parent, child, co-occurrence, related)
- Adjust minimum strength threshold
- Click nodes to view details and connections
- Responsive list-based visualization
- Color-coded by node type and relationship type

### Access:
Navigate to `http://localhost:3000/topics/graph` in your browser.

### Controls:
1. **Search Box**: Enter a topic name to center the graph around it
2. **Min Strength Slider**: Filter weak relationships (0.0 - 1.0)
3. **Relationship Type Filter**: Show only specific types of relationships
4. **Node List**: Click any node to see its connections in the sidebar

### Example Screenshots:
- Main graph view with 61 entity co-occurrences
- Node details sidebar showing connections
- Relationship type filtering

---

## 3. Integration Examples

### Add Related Topics to Search Results

**File:** `app/pages/search.vue` (you'll need to modify this)

```vue
<script setup>
// ... existing code ...

// Get first keyword from results to show related topics
const firstKeyword = computed(() => {
  const articles = articlesData.value?.articles || []
  if (articles.length === 0) return null

  // Get keywords from first article
  const firstArticle = articles[0]
  return firstArticle.keywords?.[0] || null
})
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
    <!-- Search Results (3/4 width) -->
    <div class="lg:col-span-3">
      <!-- Your existing search results -->
    </div>

    <!-- Related Topics Sidebar (1/4 width) -->
    <div class="lg:col-span-1">
      <RelatedTopicsSidebar
        v-if="firstKeyword"
        :topic-id="firstKeyword.id"
        :topic-type="'keyword'"
        :topic-value="firstKeyword.keyword"
      />
    </div>
  </div>
</template>
```

### Add Related Topics to Article Detail

**File:** `app/pages/articles/[id].vue` (if you have one)

```vue
<script setup>
const route = useRoute()
const articleId = route.params.id

const { data: article } = await useFetch(`/api/articles/${articleId}`)

// Get primary entity or keyword from article
const primaryTopic = computed(() => {
  const entities = article.value?.entities || []
  if (entities.length > 0) {
    return {
      id: entities[0].id,
      type: 'entity',
      value: entities[0].name,
    }
  }

  const keywords = article.value?.keywords || []
  if (keywords.length > 0) {
    return {
      id: keywords[0].id,
      type: 'keyword',
      value: keywords[0].keyword,
    }
  }

  return null
})
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
    <div class="lg:col-span-3">
      <!-- Article content -->
    </div>
    <aside class="lg:col-span-1 space-y-6">
      <!-- Related Topics -->
      <RelatedTopicsSidebar
        v-if="primaryTopic"
        :topic-id="primaryTopic.id"
        :topic-type="primaryTopic.type"
        :topic-value="primaryTopic.value"
      />
    </aside>
  </div>
</template>
```

### Add Link to Graph in Navigation

**File:** `app/layouts/default.vue` or navigation component

```vue
<template>
  <nav>
    <!-- ... existing nav items ... -->
    <NuxtLink to="/topics/graph" class="nav-link">
      <Icon name="i-heroicons-squares-plus" />
      Topic Graph
    </NuxtLink>
  </nav>
</template>
```

---

## 🚀 Testing the UI

### 1. Start the Development Server
```bash
npm run dev
```

### 2. Navigate to Topic Graph
Open `http://localhost:3000/topics/graph` in your browser.

### 3. Explore Relationships
- **Without search**: See all 124 relationships
- **With search**: Type "Israel" or "Gaza" to center on that topic
- **Click nodes**: View their connections in the sidebar
- **Filter**: Try different relationship types

### 4. Test Related Topics Sidebar
You'll need to integrate it into an existing page (see examples above), or create a test page:

```vue
<!-- app/pages/test-sidebar.vue -->
<script setup>
// Use a topic from our database
const testTopic = {
  id: 1, // Use an actual ID from your keywords/entities table
  type: 'entity',
  value: 'Israel', // Or another entity you have
}
</script>

<template>
  <div class="max-w-md mx-auto py-8">
    <RelatedTopicsSidebar
      :topic-id="testTopic.id"
      :topic-type="testTopic.type"
      :topic-value="testTopic.value"
    />
  </div>
</template>
```

Then visit `http://localhost:3000/test-sidebar`

---

## 📊 Database Queries to Get Topic IDs

### Get Keyword IDs:
```sql
SELECT id, keyword FROM keywords LIMIT 20;
```

### Get Entity IDs:
```sql
SELECT id, name, type FROM entities LIMIT 20;
```

### Get Topics with Relationships:
```sql
-- Keywords with relationships
SELECT DISTINCT k.id, k.keyword, COUNT(tr.id) as relationship_count
FROM keywords k
JOIN topic_relationships tr ON (tr.source_type = 'keyword' AND tr.source_id = k.id)
GROUP BY k.id, k.keyword
ORDER BY relationship_count DESC
LIMIT 10;

-- Entities with relationships
SELECT DISTINCT e.id, e.name, e.type, COUNT(tr.id) as relationship_count
FROM entities e
JOIN topic_relationships tr ON (tr.source_type = 'entity' AND tr.source_id = e.id)
GROUP BY e.id, e.name, e.type
ORDER BY relationship_count DESC
LIMIT 10;
```

---

## 🎨 Customization

### Colors
The components use Tailwind CSS classes. Customize colors by modifying the color classes:

**Related Topics Sidebar:**
- Purple for synonyms: `hover:bg-purple-50`, `group-hover:text-purple-700`
- Blue for parents: `hover:bg-blue-50`, `group-hover:text-blue-700`
- Green for children: `hover:bg-green-50`, `group-hover:text-green-700`

**Topic Graph:**
- Keywords: `#8b5cf6` (purple)
- Entities: `#3b82f6` (blue)
- Relationships: See `getEdgeColor()` function

### Layout
Both components are responsive and work well in:
- Sidebars (1/4 width)
- Full-width pages
- Modal dialogs
- Tabs or accordions

---

## 🔧 Troubleshooting

### "No related topics found"
- Ensure you've run `npm run topics:compute` to generate relationships
- Check that the topic ID exists in the database
- Verify relationships exist: `SELECT * FROM topic_relationships WHERE source_id = YOUR_ID`

### "No graph data available"
- Run `npm run topics:compute` to generate relationships
- Check: `SELECT COUNT(*) FROM topic_relationships`
- Should have > 0 relationships

### API Errors
- Ensure the development server is running: `npm run dev`
- Check API endpoints are accessible:
  - `http://localhost:3000/api/topics/related?id=1&type=entity`
  - `http://localhost:3000/api/topics/graph`

### Component Not Showing
- Ensure you imported the component (Nuxt auto-imports from `components/`)
- Check console for errors
- Verify props are passed correctly

---

## 📝 Next Steps

1. **Integrate into Existing Pages**
   - Add Related Topics Sidebar to search results
   - Add to article detail pages
   - Add to story detail pages

2. **Add to Navigation**
   - Link to `/topics/graph` in main navigation
   - Add "Explore Topics" button on homepage

3. **Enhance Visualizations** (Optional)
   - Add force-directed graph using D3.js or Vis.js
   - Add animated transitions
   - Add zoom and pan controls

4. **Schedule Regular Updates**
   - Add cron job to run `npm run topics:compute` daily
   - Or integrate into your article processing pipeline

---

## ✅ What's Working

- ✅ Database schema with 124 relationships
- ✅ API endpoints serving graph data
- ✅ Related Topics Sidebar component
- ✅ Topic Knowledge Graph page at `/topics/graph`
- ✅ Relationship filtering and search
- ✅ Responsive design
- ✅ Real data from your news articles

**Ready to use!** 🎉

Just integrate the components into your pages and start exploring topic relationships!
