<script setup lang="ts">
const route = useRoute()
const router = useRouter()

// --- State ---

const centerQuery = (route.query.center as string) || ''

const filters = ref({
  center: centerQuery,
  timeRange: '30' as string,
  minStrength: 0.3,
  limit: 200,
})

const edgeWeightFilter = ref(1)
const selectedLayout = ref<'force' | 'radial' | 'hierarchical'>('force')
const loading = ref(true)
const error = ref<string | null>(null)
const graphData = ref<any>(null)
const selectedNode = ref<any>(null)

// Search suggestions
const searchQuery = ref(centerQuery)
const suggestions = ref<any[]>([])
const showSuggestions = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null

// Fullscreen + minimap
const graphWrapper = ref<HTMLElement | null>(null)
const graphRef = ref<any>(null)
const isFullscreen = ref(false)
const showMinimap = ref(false)
const graphHeight = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)

// Shared filter state with EntityNetworkGraph
const { isTypeHidden, toggleEntityType, searchHighlight, setSearchHighlight } = useNetworkFilters()

const entityTypeDefs = [
  { type: 'person', label: 'Person', color: '#3b82f6', badgeColor: 'blue' as const },
  { type: 'organization', label: 'Org', color: '#10b981', badgeColor: 'green' as const },
  { type: 'location', label: 'Location', color: '#f59e0b', badgeColor: 'orange' as const },
  { type: 'event', label: 'Event', color: '#8b5cf6', badgeColor: 'purple' as const },
  { type: 'topic', label: 'Topic', color: '#14b8a6', badgeColor: 'teal' as const },
]

// --- Computed ---

const maxCooccurrence = computed(() => {
  if (!graphData.value?.edges?.length) return 10
  return Math.max(2, Math.max(...graphData.value.edges.map((e: any) => e.cooccurrenceCount)))
})

const visibleStats = ref<{ visibleNodes: number; visibleEdges: number } | null>(null)

const typeDistribution = computed(() => {
  if (!graphData.value?.nodes) return []
  const counts: Record<string, number> = {}
  for (const n of graphData.value.nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1
  }
  return entityTypeDefs.map(t => ({
    ...t,
    count: counts[t.type] || 0,
  })).filter(t => t.count > 0)
})

const layoutOptions = [
  { key: 'force', label: 'Force', icon: 'i-heroicons-sparkles' },
  { key: 'radial', label: 'Radial', icon: 'i-heroicons-sun' },
  { key: 'hierarchical', label: 'Hub', icon: 'i-heroicons-share' },
] as const

// --- Graph height ---

function computeGraphHeight() {
  if (isFullscreen.value) {
    graphHeight.value = window.innerHeight
  } else {
    graphHeight.value = window.innerHeight - 84
  }
}

// --- Search ---

async function searchEntities(q: string) {
  if (q.length < 2) {
    suggestions.value = []
    return
  }
  try {
    const data: any = await $fetch('/api/search', {
      params: { q, type: 'entities', limit: 8 },
    })
    suggestions.value = data?.entities || []
  } catch {
    suggestions.value = []
  }
}

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    searchEntities(searchQuery.value)
    showSuggestions.value = true
  }, 250)

  // Also update search highlight in real-time
  setSearchHighlight(searchQuery.value || null)
}

function selectSuggestion(entity: any) {
  searchQuery.value = entity.name
  filters.value.center = entity.name
  showSuggestions.value = false
  suggestions.value = []
  setSearchHighlight(entity.name)
  applyFilters()
}

function clearSearch() {
  searchQuery.value = ''
  filters.value.center = ''
  showSuggestions.value = false
  suggestions.value = []
  setSearchHighlight(null)
  applyFilters()
}

function handleSearchEnter() {
  filters.value.center = searchQuery.value
  showSuggestions.value = false
  setSearchHighlight(searchQuery.value || null)
  applyFilters()
}

// --- Data fetching ---

async function fetchGraph() {
  loading.value = true
  error.value = null
  selectedNode.value = null

  try {
    const params: Record<string, any> = {
      minStrength: filters.value.minStrength,
      limit: filters.value.limit,
    }

    if (filters.value.timeRange !== 'all') {
      const daysAgo = parseInt(filters.value.timeRange)
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - daysAgo)
      params.fromDate = fromDate.toISOString()
    }

    // If center entity specified, find its ID first
    if (filters.value.center) {
      try {
        const data: any = await $fetch('/api/search', {
          params: { q: filters.value.center, type: 'entities', limit: 1 },
        })
        if (data?.entities?.length > 0) {
          params.entityIds = [data.entities[0].id]
        }
      } catch { /* proceed without center */ }
    }

    const response = await $fetch('/api/network/graph', { params })
    if ((response as any).success) {
      graphData.value = (response as any).data
    } else {
      error.value = (response as any).error || 'Failed to load graph'
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to load graph'
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  const query: Record<string, string> = {}
  if (filters.value.center) query.center = filters.value.center
  router.replace({ query })
  fetchGraph()
}

// --- Fullscreen ---

function toggleFullscreen() {
  if (!graphWrapper.value) return
  if (!document.fullscreenElement) {
    graphWrapper.value.requestFullscreen().catch(() => {})
  } else {
    document.exitFullscreen().catch(() => {})
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
  computeGraphHeight()
}

// --- Interactions ---

function handleNodeClick(node: any) {
  selectedNode.value = node
}

function handleEdgeClick(_edge: any) {
  // Could show edge details in future
}

function handleVisibleStats(stats: { visibleNodes: number; visibleEdges: number }) {
  visibleStats.value = stats
}

function navigateToEntity() {
  if (selectedNode.value?.type && selectedNode.value?.slug) {
    router.push(`/${selectedNode.value.type}/${selectedNode.value.slug}`)
  }
}

function focusEntity() {
  if (!selectedNode.value) return
  filters.value.center = selectedNode.value.name
  searchQuery.value = selectedNode.value.name
  setSearchHighlight(selectedNode.value.name)
  applyFilters()
}

function getNodeConnections(nodeId: number): number {
  if (!graphData.value?.edges) return 0
  return graphData.value.edges.filter(
    (e: any) => {
      const sId = typeof e.source === 'number' ? e.source : e.source?.id
      const tId = typeof e.target === 'number' ? e.target : e.target?.id
      return sId === nodeId || tId === nodeId
    }
  ).length
}

// --- Keyboard Shortcuts ---

function onKeydown(event: KeyboardEvent) {
  // Skip if typing in an input
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    if (event.key === 'Escape') {
      ;(target as HTMLInputElement).blur()
      showSuggestions.value = false
      return
    }
    return
  }

  switch (event.key) {
    case 'f':
      event.preventDefault()
      toggleFullscreen()
      break
    case '1':
      event.preventDefault()
      selectedLayout.value = 'force'
      break
    case '2':
      event.preventDefault()
      selectedLayout.value = 'radial'
      break
    case '3':
      event.preventDefault()
      selectedLayout.value = 'hierarchical'
      break
    case '+':
    case '=':
      event.preventDefault()
      graphRef.value?.zoomIn()
      break
    case '-':
      event.preventDefault()
      graphRef.value?.zoomOut()
      break
    case '0':
      event.preventDefault()
      graphRef.value?.fitToView()
      break
    case '/':
      event.preventDefault()
      searchInput.value?.focus()
      break
    case 'Escape':
      if (selectedNode.value) {
        selectedNode.value = null
      } else if (searchQuery.value) {
        clearSearch()
      }
      break
  }
}

// --- Lifecycle ---

watch(() => route.query.center, (val) => {
  const v = (val as string) || ''
  filters.value.center = v
  searchQuery.value = v
  fetchGraph()
})

onMounted(() => {
  computeGraphHeight()
  fetchGraph()
  window.addEventListener('resize', computeGraphHeight)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', computeGraphHeight)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('keydown', onKeydown)
})

useHead({
  title: filters.value.center
    ? `Network: ${filters.value.center}`
    : 'Entity Network',
})
</script>

<template>
  <div
    ref="graphWrapper"
    class="graph-workstation"
    :class="{ 'is-fullscreen': isFullscreen }"
    :style="{ height: graphHeight + 'px' }"
  >
    <!-- Graph Canvas -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-paper z-10">
      <div class="text-center">
        <div class="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
        <p class="text-ink-3 text-sm">Loading entity network...</p>
      </div>
    </div>

    <div v-else-if="error" class="absolute inset-0 flex items-center justify-center bg-paper z-10">
      <div class="text-center max-w-sm">
        <span class="i-heroicons-exclamation-triangle w-10 h-10 text-red-400 mx-auto block mb-3" />
        <p class="text-red-500 font-medium mb-2">Failed to load graph</p>
        <p class="text-ink-4 text-sm mb-4">{{ error }}</p>
        <Button @click="fetchGraph">Retry</Button>
      </div>
    </div>

    <div v-else-if="!graphData || graphData.nodes.length === 0" class="absolute inset-0 flex items-center justify-center bg-paper z-10">
      <div class="text-center max-w-sm">
        <span class="i-heroicons-circle-stack w-10 h-10 text-ink-4 mx-auto block mb-3" />
        <p class="text-ink-3 font-medium mb-2">No relationships found</p>
        <p class="text-ink-4 text-sm">Try a different entity, wider time range, or lower the minimum strength.</p>
      </div>
    </div>

    <template v-else>
      <EntityNetworkGraph
        ref="graphRef"
        :data="graphData"
        :height="graphHeight"
        :min-node-size="5"
        :max-node-size="22"
        :min-cooccurrence="edgeWeightFilter"
        :layout="selectedLayout"
        :show-legend="false"
        :search-highlight="searchHighlight"
        :show-minimap="showMinimap"
        @node-click="handleNodeClick"
        @edge-click="handleEdgeClick"
        @update:visible-stats="handleVisibleStats"
      />
    </template>

    <!-- ===== Floating Toolbar (top center) ===== -->
    <div class="floating-toolbar" @click.stop>

      <!-- Search -->
      <div class="toolbar-section relative">
        <div class="toolbar-search-wrapper">
          <span class="i-heroicons-magnifying-glass w-3.5 h-3.5 text-ink-4 flex-shrink-0" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            placeholder="Search..."
            class="toolbar-search-input"
            @input="onSearchInput"
            @focus="showSuggestions = suggestions.length > 0"
            @keydown.enter="handleSearchEnter"
            @keydown.escape.stop="showSuggestions = false"
          />
          <button
            v-if="searchQuery"
            class="text-ink-4 hover:text-ink-2 flex-shrink-0"
            @click="clearSearch"
          >
            <span class="i-heroicons-x-mark w-3 h-3" />
          </button>
        </div>

        <!-- Suggestions dropdown -->
        <div
          v-if="showSuggestions && suggestions.length > 0"
          class="suggestions-dropdown"
        >
          <button
            v-for="s in suggestions"
            :key="s.id"
            class="suggestion-item"
            @mousedown.prevent="selectSuggestion(s)"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ background: entityTypeDefs.find(t => t.type === s.type)?.color || '#6b7280' }"
            />
            <span class="text-ink truncate">{{ s.name }}</span>
            <span class="text-ink-4 text-[10px] ml-auto flex-shrink-0">{{ s.type }}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-sep" />

      <!-- Layout switcher -->
      <div class="toolbar-section">
        <div class="layout-pills">
          <button
            v-for="opt in layoutOptions"
            :key="opt.key"
            class="layout-pill"
            :class="{ 'layout-pill-active': selectedLayout === opt.key }"
            :title="opt.label"
            @click="selectedLayout = opt.key"
          >
            <span :class="opt.icon" class="w-3 h-3" />
            <span class="layout-pill-label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-sep" />

      <!-- Type toggles -->
      <div class="toolbar-section">
        <div class="flex items-center gap-1.5">
          <button
            v-for="et in typeDistribution"
            :key="et.type"
            class="type-toggle"
            :class="{ 'type-toggle-hidden': isTypeHidden(et.type) }"
            @click="toggleEntityType(et.type)"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ background: isTypeHidden(et.type) ? '#94a3b8' : et.color }"
            />
            <span class="type-toggle-count">{{ et.count }}</span>
          </button>
        </div>
      </div>

      <div class="toolbar-sep hidden sm:block" />

      <!-- Time range -->
      <div class="toolbar-section hidden sm:flex">
        <select
          v-model="filters.timeRange"
          class="toolbar-select"
          @change="applyFilters()"
        >
          <option value="7">7d</option>
          <option value="30">30d</option>
          <option value="90">90d</option>
          <option value="365">1y</option>
          <option value="all">All</option>
        </select>
      </div>

      <!-- Edge slider -->
      <div v-if="graphData?.edges?.length" class="toolbar-section hidden md:flex items-center gap-1.5">
        <span class="text-[10px] text-ink-4 whitespace-nowrap">Edges</span>
        <input
          v-model.number="edgeWeightFilter"
          type="range"
          :min="1"
          :max="maxCooccurrence"
          step="1"
          class="toolbar-range"
        />
        <span class="text-[10px] font-mono text-ink-3 w-4 text-right">{{ edgeWeightFilter }}</span>
      </div>

      <div class="toolbar-sep" />

      <!-- Action buttons -->
      <div class="toolbar-section">
        <div class="flex items-center gap-0.5">
          <button class="toolbar-btn" title="Refresh (re-fetch data)" @click="fetchGraph">
            <span class="i-heroicons-arrow-path w-3.5 h-3.5" />
          </button>
          <button class="toolbar-btn" title="Fit to view (0)" @click="graphRef?.fitToView()">
            <span class="i-heroicons-arrows-pointing-out w-3.5 h-3.5" />
          </button>
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn-active': isFullscreen }"
            title="Fullscreen (f)"
            @click="toggleFullscreen"
          >
            <span :class="isFullscreen ? 'i-heroicons-arrows-pointing-in' : 'i-heroicons-tv'" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- ===== Stats watermark (bottom-left) ===== -->
    <div class="stats-watermark" v-if="visibleStats || graphData">
      <span v-if="visibleStats">{{ visibleStats.visibleNodes }} nodes</span>
      <span v-if="visibleStats"> | {{ visibleStats.visibleEdges }} edges</span>
      <span v-if="filters.center"> | focused: {{ filters.center }}</span>
    </div>

    <!-- ===== Zoom controls (bottom-right) ===== -->
    <div class="zoom-controls">
      <button class="zoom-btn" title="Zoom in (+)" @click="graphRef?.zoomIn()">
        <span class="i-heroicons-plus w-4 h-4" />
      </button>
      <button class="zoom-btn" title="Zoom out (-)" @click="graphRef?.zoomOut()">
        <span class="i-heroicons-minus w-4 h-4" />
      </button>
      <div class="zoom-sep" />
      <button class="zoom-btn" title="Fit to view (0)" @click="graphRef?.fitToView()">
        <span class="i-heroicons-arrows-pointing-out w-4 h-4" />
      </button>
      <div class="zoom-sep" />
      <button
        class="zoom-btn"
        :class="{ 'zoom-btn-active': showMinimap }"
        title="Toggle minimap"
        @click="showMinimap = !showMinimap"
      >
        <span class="i-heroicons-map w-4 h-4" />
      </button>
    </div>

    <!-- ===== Detail panel (floating right-edge) ===== -->
    <transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-x-4"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-4"
    >
      <div v-if="selectedNode" class="detail-panel" @click.stop>
        <!-- Close -->
        <button
          class="absolute top-3 right-3 text-ink-4 hover:text-ink-2 transition-colors z-10"
          @click="selectedNode = null"
        >
          <span class="i-heroicons-x-mark w-4 h-4" />
        </button>

        <!-- Entity info -->
        <div class="pr-6">
          <div class="flex items-center gap-2 mb-2">
            <span
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ background: entityTypeDefs.find(t => t.type === selectedNode.type)?.color || '#6b7280' }"
            />
            <span class="text-[10px] font-medium text-ink-3 uppercase tracking-wider">{{ selectedNode.type }}</span>
          </div>

          <h3 class="text-base font-bold text-ink leading-tight mb-2">
            {{ selectedNode.name }}
          </h3>

          <p v-if="selectedNode.shortDescription" class="text-xs text-ink-3 leading-relaxed mb-3">
            {{ selectedNode.shortDescription }}
          </p>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="bg-paper-2 rounded-md px-2.5 py-1.5">
            <div class="text-sm font-bold text-ink">{{ getNodeConnections(selectedNode.id) }}</div>
            <div class="text-[9px] text-ink-4 uppercase tracking-wider">Connections</div>
          </div>
          <div class="bg-paper-2 rounded-md px-2.5 py-1.5">
            <div class="text-sm font-bold text-ink">{{ (selectedNode.trendingScore * 100).toFixed(0) }}%</div>
            <div class="text-[9px] text-ink-4 uppercase tracking-wider">Trending</div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex flex-col gap-1.5">
          <Button
            v-if="selectedNode.slug"
            class="w-full !text-xs !py-1.5"
            @click="navigateToEntity"
          >
            View Entity Page
          </Button>
          <Button
            variant="outline"
            class="w-full !text-xs !py-1.5"
            @click="focusEntity"
          >
            Focus Network
          </Button>
        </div>
      </div>
    </transition>

    <!-- Keyboard shortcuts hint -->
    <div class="shortcuts-hint">
      <span>f</span> fullscreen
      <span class="ml-2">1-3</span> layout
      <span class="ml-2">/</span> search
      <span class="ml-2">0</span> fit
    </div>
  </div>
</template>

<style scoped>
/* --- Workstation Layout --- */
.graph-workstation {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: #f8fafc;
}

:root.dark .graph-workstation {
  background: #0f172a;
}

.graph-workstation.is-fullscreen {
  height: 100vh !important;
}

/* --- Glassmorphic base --- */
.glass {
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 8px;
}

:root.dark .glass {
  background: rgba(18, 18, 18, 0.88);
  border-color: #334155;
}

/* --- Floating Toolbar --- */
.floating-toolbar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 8px;
  font-size: 11px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  max-width: calc(100% - 24px);
  flex-wrap: wrap;
  justify-content: center;
}

:root.dark .floating-toolbar {
  background: rgba(18, 18, 18, 0.88);
  border-color: #334155;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.toolbar-section {
  display: flex;
  align-items: center;
}

.toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--color-rule, #e2e8f0);
  flex-shrink: 0;
}

:root.dark .toolbar-sep {
  background: #334155;
}

/* Search */
.toolbar-search-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--color-paper-2, #f1f5f9);
  min-width: 100px;
  max-width: 160px;
}

:root.dark .toolbar-search-wrapper {
  background: rgba(51, 65, 85, 0.5);
}

.toolbar-search-input {
  background: transparent;
  border: none;
  outline: none;
  font-size: 11px;
  color: var(--color-ink, #1e293b);
  width: 100%;
  min-width: 0;
}

:root.dark .toolbar-search-input {
  color: #e2e8f0;
}

.toolbar-search-input::placeholder {
  color: var(--color-ink-4, #94a3b8);
}

/* Suggestions dropdown */
.suggestions-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 240px;
  max-height: 256px;
  overflow-y: auto;
  z-index: 50;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

:root.dark .suggestions-dropdown {
  background: rgba(30, 41, 59, 0.95);
  border-color: #334155;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  font-size: 11px;
  transition: background 0.1s;
}

.suggestion-item:hover {
  background: var(--color-paper-2, #f1f5f9);
}

:root.dark .suggestion-item:hover {
  background: rgba(51, 65, 85, 0.5);
}

/* Layout pills */
.layout-pills {
  display: flex;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid var(--color-rule, #e2e8f0);
}

:root.dark .layout-pills {
  border-color: #334155;
}

.layout-pill {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  font-size: 10px;
  font-weight: 500;
  color: var(--color-ink-3, #64748b);
  background: transparent;
  transition: all 0.15s;
  cursor: pointer;
  border: none;
  border-right: 1px solid var(--color-rule, #e2e8f0);
}

:root.dark .layout-pill {
  border-right-color: #334155;
}

.layout-pill:last-child {
  border-right: none;
}

.layout-pill:hover {
  background: var(--color-paper-2, #f1f5f9);
}

:root.dark .layout-pill:hover {
  background: rgba(51, 65, 85, 0.4);
}

.layout-pill-active {
  background: var(--color-accent, #3b82f6) !important;
  color: #fff !important;
}

.layout-pill-label {
  display: none;
}

@media (min-width: 640px) {
  .layout-pill-label {
    display: inline;
  }
}

/* Type toggles */
.type-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  color: var(--color-ink-3, #64748b);
  cursor: pointer;
  transition: all 0.15s;
}

.type-toggle:hover {
  background: var(--color-paper-2, #f1f5f9);
}

:root.dark .type-toggle:hover {
  background: rgba(51, 65, 85, 0.4);
}

.type-toggle-hidden {
  opacity: 0.3;
}

.type-toggle-count {
  font-variant-numeric: tabular-nums;
}

/* Toolbar controls */
.toolbar-select {
  background: var(--color-paper-2, #f1f5f9);
  border: none;
  border-radius: 4px;
  padding: 2px 4px;
  font-size: 10px;
  color: var(--color-ink, #1e293b);
  cursor: pointer;
  outline: none;
}

:root.dark .toolbar-select {
  background: rgba(51, 65, 85, 0.5);
  color: #e2e8f0;
}

.toolbar-range {
  width: 48px;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-rule, #e2e8f0);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.toolbar-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-accent, #3b82f6);
  cursor: pointer;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  color: var(--color-ink-3, #64748b);
  cursor: pointer;
  transition: all 0.15s;
}

.toolbar-btn:hover {
  background: var(--color-paper-2, #f1f5f9);
  color: var(--color-ink, #1e293b);
}

:root.dark .toolbar-btn:hover {
  background: rgba(51, 65, 85, 0.4);
  color: #e2e8f0;
}

.toolbar-btn-active {
  background: var(--color-accent, #3b82f6) !important;
  color: #fff !important;
}

/* --- Stats Watermark --- */
.stats-watermark {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 15;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 10px;
  color: var(--color-ink-4, #94a3b8);
  opacity: 0.6;
  pointer-events: none;
  user-select: none;
}

/* --- Zoom Controls --- */
.zoom-controls {
  position: absolute;
  bottom: 60px;
  right: 12px;
  z-index: 15;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

:root.dark .zoom-controls {
  background: rgba(18, 18, 18, 0.88);
  border-color: #334155;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.zoom-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  color: var(--color-ink-3, #64748b);
  cursor: pointer;
  transition: all 0.15s;
}

.zoom-btn:hover {
  background: var(--color-paper-2, #f1f5f9);
  color: var(--color-ink, #1e293b);
}

:root.dark .zoom-btn:hover {
  background: rgba(51, 65, 85, 0.4);
  color: #e2e8f0;
}

.zoom-btn-active {
  background: var(--color-accent, #3b82f6) !important;
  color: #fff !important;
}

.zoom-sep {
  height: 1px;
  background: var(--color-rule, #e2e8f0);
  margin: 1px 4px;
}

:root.dark .zoom-sep {
  background: #334155;
}

/* --- Detail Panel --- */
.detail-panel {
  position: absolute;
  top: 60px;
  right: 12px;
  width: 260px;
  z-index: 20;
  padding: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

:root.dark .detail-panel {
  background: rgba(18, 18, 18, 0.92);
  border-color: #334155;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

/* --- Keyboard shortcuts hint --- */
.shortcuts-hint {
  position: absolute;
  bottom: 12px;
  right: 60px;
  z-index: 10;
  font-size: 9px;
  color: var(--color-ink-4, #94a3b8);
  opacity: 0.4;
  pointer-events: none;
  user-select: none;
}

.shortcuts-hint span {
  display: inline-block;
  background: var(--color-paper-2, #f1f5f9);
  border-radius: 2px;
  padding: 0 3px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
}

:root.dark .shortcuts-hint span {
  background: rgba(51, 65, 85, 0.4);
}

@media (max-width: 640px) {
  .shortcuts-hint {
    display: none;
  }
}
</style>
