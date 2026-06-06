<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

interface GraphNode {
  id: number
  name: string
  type: string
  slug: string | null
  trendingScore: number
  shortDescription?: string
}

interface GraphEdge {
  source: number
  target: number
  weight: number
  cooccurrenceCount: number
  sentimentCorrelation: number | null
  lastSeen: Date
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const router = useRouter()

// --- Filters ---
const filters = ref({
  timeRange: 'all' as string,
  minStrength: 0.1,
  limit: 100,
})

const edgeWeightFilter = ref(1)
const selectedLayout = ref<'force' | 'radial' | 'hierarchical'>('force')
const loading = ref(true)
const error = ref<string | null>(null)
const graphData = ref<GraphData | null>(null)
const selectedNode = ref<GraphNode | null>(null)
const graphRef = ref<any>(null)

// Fullscreen + minimap
const graphWrapper = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)
const showMinimap = ref(false)
const graphHeight = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)

// Search
const searchQuery = ref('')
const { isTypeHidden, toggleEntityType, searchHighlight, setSearchHighlight } = useNetworkFilters()

const entityTypeDefs = [
  { type: 'person', label: 'Person', color: '#3b82f6' },
  { type: 'organization', label: 'Org', color: '#10b981' },
  { type: 'location', label: 'Location', color: '#f59e0b' },
  { type: 'event', label: 'Event', color: '#8b5cf6' },
  { type: 'topic', label: 'Topic', color: '#14b8a6' },
]

const layoutOptions = [
  { key: 'force', label: 'Force', icon: 'i-heroicons-sparkles' },
  { key: 'radial', label: 'Radial', icon: 'i-heroicons-sun' },
  { key: 'hierarchical', label: 'Hub', icon: 'i-heroicons-share' },
] as const

// --- Path Finding ---
const showPathFinder = ref(false)
const pathSourceQuery = ref('')
const pathTargetQuery = ref('')
const pathSourceEntity = ref<any>(null)
const pathTargetEntity = ref<any>(null)
const pathSourceSuggestions = ref<any[]>([])
const pathTargetSuggestions = ref<any[]>([])
const showPathSourceSuggestions = ref(false)
const showPathTargetSuggestions = ref(false)
const pathMaxDepth = ref(5)
const findingPath = ref(false)
const pathResult = ref<any>(null)
const pathError = ref<string | null>(null)
let pathSourceDebounce: ReturnType<typeof setTimeout> | null = null
let pathTargetDebounce: ReturnType<typeof setTimeout> | null = null

// --- Computed ---
const maxCooccurrence = computed(() => {
  if (!graphData.value?.edges?.length) return 10
  return Math.max(2, Math.max(...graphData.value.edges.map(e => e.cooccurrenceCount)))
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

// --- Graph height ---
function computeGraphHeight() {
  if (isFullscreen.value) {
    graphHeight.value = window.innerHeight
  } else {
    // Admin layout: mobile header is 56px (h-14), desktop has sidebar but no top header
    graphHeight.value = window.innerWidth >= 768 ? window.innerHeight : window.innerHeight - 56
  }
}

// --- Search & highlight ---
function onSearchInput() {
  setSearchHighlight(searchQuery.value || null)
}

function clearSearch() {
  searchQuery.value = ''
  setSearchHighlight(null)
}

// --- Data fetching ---
async function fetchGraphData() {
  loading.value = true
  error.value = null
  selectedNode.value = null

  try {
    const params: any = {
      minStrength: filters.value.minStrength,
      limit: filters.value.limit,
    }

    if (filters.value.timeRange !== 'all') {
      const daysAgo = parseInt(filters.value.timeRange)
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - daysAgo)
      params.fromDate = fromDate.toISOString()
    }

    const response = await $fetch('/api/network/graph', { params })

    if ((response as any).success) {
      graphData.value = (response as any).data
    } else {
      error.value = (response as any).error || 'Failed to fetch graph data'
    }
  } catch (e: any) {
    error.value = e.message || 'Network error'
  } finally {
    loading.value = false
  }
}

// --- Path Finding ---
async function searchPathEntities(q: string, target: 'source' | 'target') {
  if (q.length < 2) {
    if (target === 'source') pathSourceSuggestions.value = []
    else pathTargetSuggestions.value = []
    return
  }
  try {
    const data: any = await $fetch('/api/search', {
      params: { q, type: 'entities', limit: 6 },
    })
    const results = data?.entities || []
    if (target === 'source') pathSourceSuggestions.value = results
    else pathTargetSuggestions.value = results
  } catch {
    if (target === 'source') pathSourceSuggestions.value = []
    else pathTargetSuggestions.value = []
  }
}

function onPathSourceInput() {
  pathSourceEntity.value = null
  if (pathSourceDebounce) clearTimeout(pathSourceDebounce)
  pathSourceDebounce = setTimeout(() => {
    searchPathEntities(pathSourceQuery.value, 'source')
    showPathSourceSuggestions.value = true
  }, 250)
}

function onPathTargetInput() {
  pathTargetEntity.value = null
  if (pathTargetDebounce) clearTimeout(pathTargetDebounce)
  pathTargetDebounce = setTimeout(() => {
    searchPathEntities(pathTargetQuery.value, 'target')
    showPathTargetSuggestions.value = true
  }, 250)
}

function selectPathSource(entity: any) {
  pathSourceQuery.value = entity.name
  pathSourceEntity.value = entity
  showPathSourceSuggestions.value = false
  pathSourceSuggestions.value = []
}

function selectPathTarget(entity: any) {
  pathTargetQuery.value = entity.name
  pathTargetEntity.value = entity
  showPathTargetSuggestions.value = false
  pathTargetSuggestions.value = []
}

async function findPath() {
  if (!pathSourceEntity.value || !pathTargetEntity.value) return

  findingPath.value = true
  pathError.value = null
  pathResult.value = null

  try {
    const response = await $fetch('/api/network/path', {
      params: {
        sourceId: pathSourceEntity.value.id,
        targetId: pathTargetEntity.value.id,
        maxDepth: pathMaxDepth.value,
      }
    })

    if ((response as any).success) {
      pathResult.value = (response as any).data
    } else {
      pathError.value = (response as any).error || 'No path found'
    }
  } catch (e: any) {
    pathError.value = e.message || 'Network error'
  } finally {
    findingPath.value = false
  }
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
function handleNodeClick(node: GraphNode) {
  selectedNode.value = node
}

function handleEdgeClick(_edge: GraphEdge) {}

function handleVisibleStats(stats: { visibleNodes: number; visibleEdges: number }) {
  visibleStats.value = stats
}

function navigateToEntity() {
  if (selectedNode.value?.type && selectedNode.value?.slug) {
    router.push(`/${selectedNode.value.type}/${selectedNode.value.slug}`)
  }
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
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    if (event.key === 'Escape') {
      ;(target as HTMLInputElement).blur()
      showPathSourceSuggestions.value = false
      showPathTargetSuggestions.value = false
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
    case 'p':
      event.preventDefault()
      showPathFinder.value = !showPathFinder.value
      break
    case 'Escape':
      if (selectedNode.value) {
        selectedNode.value = null
      } else if (showPathFinder.value) {
        showPathFinder.value = false
      } else if (searchQuery.value) {
        clearSearch()
      }
      break
  }
}

// --- Lifecycle ---
onMounted(() => {
  computeGraphHeight()
  fetchGraphData()
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
  title: 'Network Graph - Admin',
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
        <p class="text-ink-3 text-sm">Loading network graph...</p>
      </div>
    </div>

    <div v-else-if="error" class="absolute inset-0 flex items-center justify-center bg-paper z-10">
      <div class="text-center max-w-sm">
        <span class="i-heroicons-exclamation-triangle w-10 h-10 text-red-400 mx-auto block mb-3" />
        <p class="text-red-500 font-medium mb-2">Failed to load graph</p>
        <p class="text-ink-4 text-sm mb-4">{{ error }}</p>
        <Button @click="fetchGraphData">Retry</Button>
      </div>
    </div>

    <div v-else-if="!graphData || graphData.nodes.length === 0" class="absolute inset-0 flex items-center justify-center bg-paper z-10">
      <div class="text-center max-w-sm">
        <span class="i-heroicons-circle-stack w-10 h-10 text-ink-4 mx-auto block mb-3" />
        <p class="text-ink-3 font-medium mb-2">No relationships found</p>
        <p class="text-ink-4 text-sm">
          Try adjusting filters or run: <code class="font-mono text-xs bg-paper-2 px-1.5 py-0.5 rounded">npm run relationships:compute</code>
        </p>
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
      <div class="toolbar-section">
        <div class="toolbar-search-wrapper">
          <span class="i-heroicons-magnifying-glass w-3.5 h-3.5 text-ink-4 flex-shrink-0" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            placeholder="Search..."
            class="toolbar-search-input"
            @input="onSearchInput"
          />
          <button
            v-if="searchQuery"
            class="text-ink-4 hover:text-ink-2 flex-shrink-0"
            @click="clearSearch"
          >
            <span class="i-heroicons-x-mark w-3 h-3" />
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
          @change="fetchGraphData()"
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

      <div class="toolbar-sep hidden md:block" />

      <!-- Max Nodes -->
      <div class="toolbar-section hidden md:flex">
        <select
          v-model.number="filters.limit"
          class="toolbar-select"
          @change="fetchGraphData()"
        >
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
          <option :value="1000">1k</option>
        </select>
      </div>

      <!-- Min Strength -->
      <div class="toolbar-section hidden lg:flex items-center gap-1.5">
        <span class="text-[10px] text-ink-4 whitespace-nowrap">Str</span>
        <input
          v-model.number="filters.minStrength"
          type="range"
          min="0"
          max="1"
          step="0.05"
          class="toolbar-range"
          @change="fetchGraphData()"
        />
        <span class="text-[10px] font-mono text-ink-3 w-6 text-right">{{ (filters.minStrength * 100).toFixed(0) }}%</span>
      </div>

      <div class="toolbar-sep" />

      <!-- Action buttons -->
      <div class="toolbar-section">
        <div class="flex items-center gap-0.5">
          <button class="toolbar-btn" title="Refresh" @click="fetchGraphData">
            <span class="i-heroicons-arrow-path w-3.5 h-3.5" />
          </button>
          <button class="toolbar-btn" title="Fit to view (0)" @click="graphRef?.fitToView()">
            <span class="i-heroicons-arrows-pointing-out w-3.5 h-3.5" />
          </button>
          <button
            class="toolbar-btn"
            :class="{ 'toolbar-btn-active': showPathFinder }"
            title="Path Finding (p)"
            @click="showPathFinder = !showPathFinder"
          >
            <span class="i-heroicons-map-pin w-3.5 h-3.5" />
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

    <!-- ===== Path Finding Panel (top-left, glassmorphic) ===== -->
    <transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div v-if="showPathFinder" class="pathfinder-panel" @click.stop>
        <!-- Header -->
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-1.5">
            <span class="i-heroicons-map-pin w-3.5 h-3.5 text-accent" />
            <span class="text-xs font-bold text-ink">Path Finding</span>
          </div>
          <button class="text-ink-4 hover:text-ink-2 transition-colors" @click="showPathFinder = false">
            <span class="i-heroicons-x-mark w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Source input -->
        <div class="mb-2 relative">
          <label class="text-[10px] font-medium text-ink-3 uppercase tracking-wider mb-1 block">Source</label>
          <div class="pf-input-wrapper">
            <input
              v-model="pathSourceQuery"
              type="text"
              placeholder="Search entity..."
              class="pf-input"
              @input="onPathSourceInput"
              @focus="showPathSourceSuggestions = pathSourceSuggestions.length > 0"
            />
            <span v-if="pathSourceEntity" class="pf-check">
              <span class="i-heroicons-check w-3 h-3 text-green-500" />
            </span>
          </div>
          <div v-if="showPathSourceSuggestions && pathSourceSuggestions.length > 0" class="pf-suggestions">
            <button
              v-for="s in pathSourceSuggestions"
              :key="s.id"
              class="pf-suggestion-item"
              @mousedown.prevent="selectPathSource(s)"
            >
              <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ background: entityTypeDefs.find(t => t.type === s.type)?.color || '#6b7280' }" />
              <span class="truncate">{{ s.name }}</span>
              <span class="text-ink-4 text-[9px] ml-auto flex-shrink-0">{{ s.type }}</span>
            </button>
          </div>
        </div>

        <!-- Target input -->
        <div class="mb-2 relative">
          <label class="text-[10px] font-medium text-ink-3 uppercase tracking-wider mb-1 block">Target</label>
          <div class="pf-input-wrapper">
            <input
              v-model="pathTargetQuery"
              type="text"
              placeholder="Search entity..."
              class="pf-input"
              @input="onPathTargetInput"
              @focus="showPathTargetSuggestions = pathTargetSuggestions.length > 0"
            />
            <span v-if="pathTargetEntity" class="pf-check">
              <span class="i-heroicons-check w-3 h-3 text-green-500" />
            </span>
          </div>
          <div v-if="showPathTargetSuggestions && pathTargetSuggestions.length > 0" class="pf-suggestions">
            <button
              v-for="s in pathTargetSuggestions"
              :key="s.id"
              class="pf-suggestion-item"
              @mousedown.prevent="selectPathTarget(s)"
            >
              <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :style="{ background: entityTypeDefs.find(t => t.type === s.type)?.color || '#6b7280' }" />
              <span class="truncate">{{ s.name }}</span>
              <span class="text-ink-4 text-[9px] ml-auto flex-shrink-0">{{ s.type }}</span>
            </button>
          </div>
        </div>

        <!-- Max depth -->
        <div class="mb-3">
          <label class="text-[10px] font-medium text-ink-3 uppercase tracking-wider mb-1 block">Max Depth</label>
          <select v-model.number="pathMaxDepth" class="pf-select">
            <option :value="2">2 hops</option>
            <option :value="3">3 hops</option>
            <option :value="5">5 hops</option>
            <option :value="8">8 hops</option>
          </select>
        </div>

        <!-- Find button -->
        <button
          class="pf-find-btn"
          :disabled="!pathSourceEntity || !pathTargetEntity || findingPath"
          @click="findPath"
        >
          {{ findingPath ? 'Finding...' : 'Find Path' }}
        </button>

        <!-- Result -->
        <div v-if="pathResult" class="mt-3 pt-3 border-t border-rule-soft">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-bold text-ink uppercase tracking-wider">Path ({{ pathResult.length }} steps)</span>
            <button class="text-ink-4 hover:text-ink-2 text-[10px]" @click="pathResult = null">Clear</button>
          </div>
          <div class="flex flex-wrap items-center gap-1 text-xs text-ink-2">
            <template v-for="(node, idx) in pathResult.path" :key="node.entityId">
              <NuxtLink
                :to="`/${node.type}/${node.slug}`"
                class="font-medium text-accent hover:underline"
              >
                {{ node.name }}
              </NuxtLink>
              <span v-if="idx < pathResult.path.length - 1" class="text-ink-4">→</span>
            </template>
          </div>
          <div class="mt-1.5 text-[10px] text-ink-4">
            Total weight: {{ pathResult.totalWeight.toFixed(2) }}
          </div>
        </div>

        <!-- Error -->
        <div v-if="pathError" class="mt-3 pt-3 border-t border-rule-soft">
          <div class="flex items-center justify-between">
            <span class="text-xs text-red-500">{{ pathError }}</span>
            <button class="text-ink-4 hover:text-ink-2 text-[10px]" @click="pathError = null">Dismiss</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- ===== Stats watermark (bottom-left) ===== -->
    <div class="stats-watermark" v-if="visibleStats || graphData">
      <span v-if="visibleStats">{{ visibleStats.visibleNodes }} nodes</span>
      <span v-if="visibleStats"> | {{ visibleStats.visibleEdges }} edges</span>
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
        <button
          class="absolute top-3 right-3 text-ink-4 hover:text-ink-2 transition-colors z-10"
          @click="selectedNode = null"
        >
          <span class="i-heroicons-x-mark w-4 h-4" />
        </button>

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

        <div class="flex flex-col gap-1.5">
          <Button
            v-if="selectedNode.slug"
            class="w-full !text-xs !py-1.5"
            @click="navigateToEntity"
          >
            View Entity Page
          </Button>
        </div>
      </div>
    </transition>

    <!-- Keyboard shortcuts hint -->
    <div class="shortcuts-hint">
      <span>f</span> fullscreen
      <span class="ml-2">1-3</span> layout
      <span class="ml-2">/</span> search
      <span class="ml-2">p</span> path
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

.toolbar-range::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-accent, #3b82f6);
  cursor: pointer;
  border: none;
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

/* --- Path Finding Panel --- */
.pathfinder-panel {
  position: absolute;
  top: 60px;
  left: 12px;
  width: 280px;
  z-index: 25;
  padding: 14px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

:root.dark .pathfinder-panel {
  background: rgba(18, 18, 18, 0.92);
  border-color: #334155;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.pf-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.pf-input {
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 5px;
  background: var(--color-paper, #fff);
  color: var(--color-ink, #1e293b);
  outline: none;
  transition: border-color 0.15s;
}

:root.dark .pf-input {
  background: rgba(51, 65, 85, 0.3);
  border-color: #334155;
  color: #e2e8f0;
}

.pf-input:focus {
  border-color: var(--color-accent, #3b82f6);
}

.pf-input::placeholder {
  color: var(--color-ink-4, #94a3b8);
}

.pf-check {
  position: absolute;
  right: 6px;
}

.pf-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  margin-top: 2px;
  max-height: 180px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 5px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

:root.dark .pf-suggestions {
  background: rgba(30, 41, 59, 0.95);
  border-color: #334155;
}

.pf-suggestion-item {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  font-size: 11px;
  color: var(--color-ink, #1e293b);
  transition: background 0.1s;
}

:root.dark .pf-suggestion-item {
  color: #e2e8f0;
}

.pf-suggestion-item:hover {
  background: var(--color-paper-2, #f1f5f9);
}

:root.dark .pf-suggestion-item:hover {
  background: rgba(51, 65, 85, 0.5);
}

.pf-select {
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
  border: 1px solid var(--color-rule, #e2e8f0);
  border-radius: 5px;
  background: var(--color-paper, #fff);
  color: var(--color-ink, #1e293b);
  outline: none;
  cursor: pointer;
}

:root.dark .pf-select {
  background: rgba(51, 65, 85, 0.3);
  border-color: #334155;
  color: #e2e8f0;
}

.pf-find-btn {
  width: 100%;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--color-accent, #3b82f6);
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.pf-find-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.pf-find-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
