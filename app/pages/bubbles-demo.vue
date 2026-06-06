<script setup lang="ts">
const mode = ref<'original' | 'enhanced'>('enhanced')
const showRelationships = ref(true)
const layout = ref<'clustered' | 'standard'>('clustered')
</script>

<template>
  <div>
    <!-- Header -->
    <section class="bg-gradient-to-b from-gray-50 to-white py-8 border-b">
      <Container>
        <div class="space-y-4">
          <h1 class="text-3xl font-bold text-gray-900">
            Bubble Visualization Demo
          </h1>
          <p class="text-gray-600">
            Compare the original and enhanced bubble visualizations with clustering features
          </p>

          <!-- Controls -->
          <div class="flex flex-wrap gap-4 items-center p-4 bg-white rounded-lg shadow-sm">
            <div class="flex items-center gap-2">
              <label class="text-sm font-medium text-gray-700">Version:</label>
              <USelectMenu
                v-model="mode"
                :options="[
                  { label: 'Enhanced (with clustering)', value: 'enhanced' },
                  { label: 'Original', value: 'original' }
                ]"
                value-attribute="value"
                option-attribute="label"
              />
            </div>

            <div v-if="mode === 'enhanced'" class="flex items-center gap-2">
              <label class="text-sm font-medium text-gray-700">Layout:</label>
              <USelectMenu
                v-model="layout"
                :options="[
                  { label: 'Clustered', value: 'clustered' },
                  { label: 'Standard', value: 'standard' }
                ]"
                value-attribute="value"
                option-attribute="label"
              />
            </div>

            <label v-if="mode === 'enhanced'" class="flex items-center gap-2 cursor-pointer">
              <UCheckbox v-model="showRelationships" />
              <span class="text-sm text-gray-700">Show Relationships</span>
            </label>
          </div>
        </div>
      </Container>
    </section>

    <!-- Original Bubbles -->
    <section v-if="mode === 'original'" class="py-8">
      <Container>
        <div class="space-y-4">
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 class="font-semibold text-blue-900 mb-2">Original Version</h3>
            <ul class="text-sm text-blue-800 space-y-1">
              <li>• Simple keyword bubbles sized by frequency and relevance</li>
              <li>• Color-coded by category (entities, events, topics, etc.)</li>
              <li>• Click to search for articles</li>
              <li>• No relationship visualization</li>
            </ul>
          </div>
          <TrendingBubbles />
        </div>
      </Container>
    </section>

    <!-- Enhanced Bubbles -->
    <section v-if="mode === 'enhanced'" class="py-8">
      <Container>
        <div class="space-y-4">
          <div class="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 class="font-semibold text-green-900 mb-2">Enhanced Version</h3>
            <ul class="text-sm text-green-800 space-y-1">
              <li>• <strong>Force-directed clustering</strong>: Related topics positioned closer together</li>
              <li>• <strong>Relationship visualization</strong>: Lines show co-occurrence, synonyms, and related topics</li>
              <li>• <strong>Interactive highlighting</strong>: Hover to see connected topics</li>
              <li>• <strong>Click to explore</strong>: Select a bubble to see all related topics and filter view</li>
              <li>• <strong>Smart layout</strong>: Uses PMI (Pointwise Mutual Information) for positioning</li>
              <li>• <strong>Visual feedback</strong>: Dimming effect for unrelated topics when hovering/selecting</li>
            </ul>
          </div>
          <TrendingBubblesEnhanced
            :show-relationships="showRelationships"
            :layout="layout"
          />
        </div>
      </Container>
    </section>

    <!-- Feature Comparison Table -->
    <section class="py-8 bg-gray-50">
      <Container>
        <h2 class="text-2xl font-bold text-gray-900 mb-6">Feature Comparison</h2>
        <Card>
          <UTable
            :columns="[
              { key: 'feature', label: 'Feature' },
              { key: 'original', label: 'Original' },
              { key: 'enhanced', label: 'Enhanced' }
            ]"
            :rows="[
              {
                feature: 'Visual Clustering',
                original: '❌',
                enhanced: '✅ Force-directed layout based on topic relationships'
              },
              {
                feature: 'Relationship Lines',
                original: '❌',
                enhanced: '✅ Shows co-occurrence, synonyms, and related topics'
              },
              {
                feature: 'Interactive Hover',
                original: '❌',
                enhanced: '✅ Highlights connected topics'
              },
              {
                feature: 'Click to Filter',
                original: '❌',
                enhanced: '✅ Shows related topics panel'
              },
              {
                feature: 'Smart Positioning',
                original: '❌',
                enhanced: '✅ Uses PMI scores for layout'
              },
              {
                feature: 'Size by Frequency',
                original: '✅',
                enhanced: '✅'
              },
              {
                feature: 'Color by Category',
                original: '✅',
                enhanced: '✅'
              },
              {
                feature: 'Search Integration',
                original: '✅',
                enhanced: '✅'
              }
            ]"
          >
            <template #feature-data="{ row }">
              <span class="font-medium">{{ row.feature }}</span>
            </template>
          </UTable>
        </Card>
      </Container>
    </section>

    <!-- Technical Details -->
    <section class="py-8">
      <Container>
        <h2 class="text-2xl font-bold text-gray-900 mb-6">Technical Implementation</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <template #header>
              <h3 class="font-semibold text-gray-900">Clustering Algorithm</h3>
            </template>
            <div class="space-y-2 text-sm text-gray-600">
              <p><strong>Force-Directed Layout:</strong> Simulates physics forces to position related topics closer together.</p>
              <p><strong>Repulsion:</strong> All bubbles repel each other to prevent overlap.</p>
              <p><strong>Attraction:</strong> Related topics attract each other based on relationship strength.</p>
              <p><strong>PMI Scores:</strong> Pointwise Mutual Information measures topic co-occurrence strength.</p>
            </div>
          </Card>

          <Card>
            <template #header>
              <h3 class="font-semibold text-gray-900">Data Sources</h3>
            </template>
            <div class="space-y-2 text-sm text-gray-600">
              <p><strong>Keywords:</strong> Extracted from articles using Ollama analysis</p>
              <p><strong>Entities:</strong> Named entity recognition (people, organizations, locations)</p>
              <p><strong>Relationships:</strong> Co-occurrence, synonyms, and hierarchies from topic relationship analysis</p>
              <p><strong>Trending Window:</strong> Last 7 days of articles</p>
            </div>
          </Card>

          <Card>
            <template #header>
              <h3 class="font-semibold text-gray-900">API Endpoints</h3>
            </template>
            <div class="space-y-2 text-sm">
              <div>
                <code class="bg-gray-100 px-2 py-1 rounded text-xs">/api/trending</code>
                <p class="text-gray-600 mt-1">Original endpoint with basic keyword data</p>
              </div>
              <div>
                <code class="bg-gray-100 px-2 py-1 rounded text-xs">/api/trending-enhanced</code>
                <p class="text-gray-600 mt-1">Enhanced endpoint with relationships and positions</p>
              </div>
            </div>
          </Card>

          <Card>
            <template #header>
              <h3 class="font-semibold text-gray-900">Interactive Features</h3>
            </template>
            <div class="space-y-2 text-sm text-gray-600">
              <p><strong>Hover:</strong> Temporarily highlights related topics</p>
              <p><strong>Click:</strong> Selects and locks the highlight, shows related panel</p>
              <p><strong>Double-click:</strong> Searches for articles about the topic</p>
              <p><strong>Dimming:</strong> Unrelated topics fade when filtering is active</p>
            </div>
          </Card>
        </div>
      </Container>
    </section>
  </div>
</template>
