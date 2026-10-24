<script setup lang="ts">
import type { GraphData, GraphNode, NetworkSelection } from './EntityNetworkGraph.vue'

const props = defineProps<{
  entityId: number
  entityType: 'person' | 'organization' | 'location' | 'event' | 'topic'
}>()

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
type Layout = typeof layoutOptions[number]['key']

const timeWindows = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: 365 },
]

// --- Reactive state ---
const { hiddenEntityTypes, isTypeHidden, toggleEntityType, searchHighlight, setSearchHighlight } = useNetworkFilters()
const visibleTypes = computed(() => {
  const all = new Set(['person', 'organization', 'location', 'event', 'topic'])
  for (const t of hiddenEntityTypes.value) all.delete(t)
  return all
})
const timeWindow = ref(30)
const minWeight = ref(0.1)
const maxNodes = ref(100)
const searchQuery = ref('')
const loading = ref(false)
const rawData = ref<GraphData | null>(null)
const selection = ref<NetworkSelection | null>(null)
const hasExplored = ref(false)
const selectedLayout = ref<Layout>('force')

// The network can be re-centered on any node; the page's entity is the origin
const center = ref<{ id: number; type: string; name: string | null }>({ id: props.entityId, type: props.entityType, name: null })
const originName = ref<string | null>(null)
const isRecentered = computed(() => center.value.id !== props.entityId)

// Fullscreen & sizing
const explorerSection = ref<HTMLElement | null>(null)
const graphRef = ref<any>(null)
const isFullscreen = ref(false)
const windowWidth = ref(1200)
const windowHeight = ref(800)
const graphContainerWidth = ref(800)
const showMinimap = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

// Debounce timers
let strengthTimer: ReturnType<typeof setTimeout> | null = null
let nodesTimer: ReturnType<typeof setTimeout> | null = null

// --- Computed ---
const hiddenTypeCount = computed(() => hiddenEntityTypes.value.length)

// Type hiding happens inside the graph (no relayout), so pass the full data
const hasData = computed(() => (rawData.value?.nodes.length ?? 0) > 0)

const visibleStats = ref<{ visibleNodes: number; visibleEdges: number } | null>(null)

const typeDistribution = computed(() => {
  if (!rawData.value?.nodes) return []
  const counts: Record<string, number> = {}
  for (const n of rawData.value.nodes) {
    counts[n.type] = (counts[n.type] || 0) + 1
  }
  return entityTypeDefs.map(t => ({
    ...t,
    count: counts[t.type] || 0,
  })).filter(t => t.count > 0)
})

// --- Methods ---
function toggleType(type: string) {
  if (visibleTypes.value.has(type) && visibleTypes.value.size <= 1) return
  toggleEntityType(type)
}

function setTimeWindow(tw: number) {
  if (timeWindow.value === tw) return
  timeWindow.value = tw
  fetchData()
}

function onStrengthInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value) / 100
  minWeight.value = val
  if (strengthTimer) clearTimeout(strengthTimer)
  strengthTimer = setTimeout(() => fetchData(), 500)
}

function onNodesInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  maxNodes.value = val
  if (nodesTimer) clearTimeout(nodesTimer)
  nodesTimer = setTimeout(() => fetchData(), 500)
}

function onSearchInput() {
  setSearchHighlight(searchQuery.value || null)
}

function clearSearch() {
  searchQuery.value = ''
  setSearchHighlight(null)
}

async function fetchData() {
  loading.value = true
  try {
    const result = await $fetch<GraphData & { meta?: any }>('/api/network/entities', {
      query: {
        entityType: center.value.type,
        centerEntity: center.value.id,
        timeWindow: timeWindow.value,
        minWeight: minWeight.value,
        limit: maxNodes.value,
      }
    })
    if (result.nodes?.length > 0) {
      rawData.value = result
      const c = result.nodes.find(n => n.id === center.value.id)
      if (c) center.value.name = c.name
      if (!isRecentered.value && c) originName.value = c.name
    } else {
      rawData.value = { nodes: [], edges: [] }
    }
  } catch {
    rawData.value = { nodes: [], edges: [] }
  } finally {
    loading.value = false
  }
}

function toggleFullscreen() {
  if (!explorerSection.value) return
  if (!document.fullscreenElement) {
    explorerSection.value.requestFullscreen().then(() => {
      setTimeout(() => { isFullscreen.value = true }, 150)
    }).catch(() => {})
  } else {
    document.exitFullscreen().catch(() => {})
  }
}

function recenterOn(node: GraphNode) {
  center.value = { id: node.id, type: node.type, name: node.name }
  selection.value = null
  fetchData()
}

function resetCenter() {
  center.value = { id: props.entityId, type: props.entityType, name: originName.value }
  selection.value = null
  fetchData()
}

// Same component instance is reused when navigating between entity pages
watch(() => props.entityId, () => {
  originName.value = null
  center.value = { id: props.entityId, type: props.entityType, name: null }
  selection.value = null
  fetchData()
})

// Double-click (or the panel button) opens the entity page
function handleNodeClick(node: GraphNode) {
  if (node.slug) navigateTo(`/${node.type}/${node.slug}`)
}

function handleNodeSelect(sel: NetworkSelection | null) {
  selection.value = sel
  if (sel) hasExplored.value = true
}

function handleVisibleStats(stats: { visibleNodes: number; visibleEdges: number }) {
  visibleStats.value = stats
}

// --- Keyboard shortcuts (fullscreen only) ---
function onKeydown(event: KeyboardEvent) {
  if (!isFullscreen.value) return
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    if (event.key === 'Escape') {
      ;(target as HTMLInputElement).blur()
      return
    }
    return
  }

  switch (event.key) {
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
      if (selection.value) graphRef.value?.clearFocus()
      else document.exitFullscreen().catch(() => {})
      break
  }
}

// --- Lifecycle ---
onMounted(() => {
  windowWidth.value = window.innerWidth
  windowHeight.value = window.innerHeight
  window.addEventListener('resize', onResize)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeydown)
  if (explorerSection.value) {
    graphContainerWidth.value = explorerSection.value.clientWidth
  }
  fetchData()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('keydown', onKeydown)
  if (strengthTimer) clearTimeout(strengthTimer)
  if (nodesTimer) clearTimeout(nodesTimer)
})

function onResize() {
  windowWidth.value = window.innerWidth
  windowHeight.value = window.innerHeight
  if (explorerSection.value) {
    graphContainerWidth.value = explorerSection.value.clientWidth
  }
}

function onFullscreenChange() {
  if (!document.fullscreenElement) {
    setTimeout(() => { isFullscreen.value = false }, 150)
  }
  // The graph remounts in the other mode, so focus does not carry over
  selection.value = null
}
</script>

<template>
  <div
    ref="explorerSection"
    class="explorer-root"
    :class="{ 'explorer-fullscreen': isFullscreen }"
  >
    <!-- ═══ INLINE MODE (not fullscreen) ═══ -->
    <template v-if="!isFullscreen">
      <!-- Header -->
      <div class="inline-header">
        <div class="flex items-center gap-2 min-w-0">
          <span class="i-heroicons-share w-4 h-4 text-accent flex-shrink-0" />
          <span class="text-sm font-bold text-ink truncate">Entity Network</span>
          <span v-if="!loading && visibleStats" class="text-[11px] text-ink-4 flex-shrink-0">
            {{ visibleStats.visibleNodes }} entities, {{ visibleStats.visibleEdges }} links
          </span>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <div class="layout-pills" role="group" aria-label="Layout">
            <button
              v-for="opt in layoutOptions"
              :key="opt.key"
              class="layout-pill"
              :class="{ 'layout-pill-active': selectedLayout === opt.key }"
              :title="`${opt.label} layout`"
              :aria-pressed="selectedLayout === opt.key"
              @click="selectedLayout = opt.key"
            >
              <span :class="opt.icon" class="w-3 h-3" />
              <span class="layout-pill-label">{{ opt.label }}</span>
            </button>
          </div>
          <button class="inline-fullscreen-btn" title="Explore fullscreen" @click="toggleFullscreen">
            <span class="i-heroicons-arrows-pointing-out w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Recentered banner -->
      <div v-if="isRecentered" class="recenter-bar">
        <span class="i-heroicons-viewfinder-circle w-3.5 h-3.5 flex-shrink-0" />
        <span class="truncate">Centered on <strong>{{ center.name }}</strong></span>
        <button class="recenter-back" @click="resetCenter">
          <span class="i-heroicons-arrow-uturn-left w-3 h-3" />
          Back to {{ originName || 'this entity' }}
        </button>
      </div>

      <!-- Legend doubles as type filter -->
      <div v-if="typeDistribution.length" class="inline-legend">
        <button
          v-for="et in typeDistribution"
          :key="et.type"
          class="inline-legend-item"
          :class="{ 'type-toggle-hidden': isTypeHidden(et.type) }"
          :title="`${isTypeHidden(et.type) ? 'Show' : 'Hide'} ${et.label.toLowerCase()} nodes`"
          @click="toggleType(et.type)"
        >
          <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: isTypeHidden(et.type) ? '#94a3b8' : et.color }" />
          {{ et.label }} <span class="text-ink-4">{{ et.count }}</span>
        </button>
        <span class="inline-legend-hint">
          {{ hasExplored ? 'Bigger = more connected' : 'Click a node to explore · double-click to open' }}
        </span>
      </div>

      <div v-if="hasData" class="relative h-[460px]">
        <EntityNetworkGraph
          ref="graphRef"
          :data="rawData!"
          :width="graphContainerWidth"
          :height="460"
          :show-legend="false"
          :layout="selectedLayout"
          :highlight-node-id="center.id"
          @node-click="handleNodeClick"
          @node-select="handleNodeSelect"
          @update:visible-stats="handleVisibleStats"
        />
        <NetworkFocusPanel
          v-if="selection"
          :selection="selection"
          :max-items="6"
          compact
          @focus="graphRef?.focusNode($event)"
          @open="handleNodeClick"
          @close="graphRef?.clearFocus()"
        >
          <template #actions="{ node }">
            <Button
              v-if="node.id !== center.id"
              variant="outline"
              color="gray"
              size="sm"
              block
              @click="recenterOn(node)"
            >
              Center network on this
            </Button>
          </template>
        </NetworkFocusPanel>
      </div>
      <div v-else-if="!loading" class="flex items-center justify-center h-[460px] text-ink-4">
        <div class="text-center">
          <span class="i-heroicons-circle-stack w-8 h-8 mx-auto block mb-2 opacity-50" />
          <p class="text-sm">No network data available</p>
        </div>
      </div>
      <div v-else class="flex items-center justify-center h-[460px]">
        <div class="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    </template>

    <!-- ═══ FULLSCREEN MODE (workstation UX) ═══ -->
    <template v-else>
      <!-- Loading -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-10">
        <div class="text-center">
          <div class="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
          <p class="text-ink-3 text-sm">Loading entity network...</p>
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="!hasData" class="absolute inset-0 flex items-center justify-center z-10">
        <div class="text-center max-w-sm">
          <span class="i-heroicons-circle-stack w-10 h-10 text-ink-4 mx-auto block mb-3" />
          <p class="text-ink-3 font-medium mb-2">No network data</p>
          <p class="text-ink-4 text-sm">Try adjusting the time range or strength filter.</p>
        </div>
      </div>

      <!-- Graph -->
      <template v-if="hasData">
        <EntityNetworkGraph
          ref="graphRef"
          :data="rawData!"
          :height="windowHeight"
          :show-legend="false"
          :layout="selectedLayout"
          :highlight-node-id="center.id"
          :search-highlight="searchHighlight"
          :show-minimap="showMinimap"
          @node-click="handleNodeClick"
          @node-select="handleNodeSelect"
          @update:visible-stats="handleVisibleStats"
        />
        <NetworkFocusPanel
          v-if="selection"
          :selection="selection"
          @focus="graphRef?.focusNode($event)"
          @open="handleNodeClick"
          @close="graphRef?.clearFocus()"
        >
          <template #actions="{ node }">
            <Button
              v-if="node.id !== center.id"
              variant="outline"
              color="gray"
              size="sm"
              block
              @click="recenterOn(node)"
            >
              Center network on this
            </Button>
          </template>
        </NetworkFocusPanel>
      </template>

      <!-- ===== Floating Toolbar (top center) ===== -->
      <div class="floating-toolbar" @click.stop>
        <!-- Type toggles -->
        <div class="toolbar-section">
          <div class="flex items-center gap-1.5">
            <button
              v-for="et in typeDistribution"
              :key="et.type"
              class="type-toggle"
              :class="{ 'type-toggle-hidden': isTypeHidden(et.type) }"
              :title="`${isTypeHidden(et.type) ? 'Show' : 'Hide'} ${et.label.toLowerCase()} nodes`"
              @click="toggleType(et.type)"
            >
              <span
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ background: isTypeHidden(et.type) ? '#94a3b8' : et.color }"
              />
              <span class="type-toggle-label">{{ et.label }}</span>
              <span class="type-toggle-count">{{ et.count }}</span>
            </button>
          </div>
        </div>

        <div class="toolbar-sep" />

        <!-- Layout switcher -->
        <div class="toolbar-section">
          <div class="layout-pills" role="group" aria-label="Layout">
            <button
              v-for="opt in layoutOptions"
              :key="opt.key"
              class="layout-pill"
              :class="{ 'layout-pill-active': selectedLayout === opt.key }"
              :title="`${opt.label} layout (${layoutOptions.indexOf(opt) + 1})`"
              :aria-pressed="selectedLayout === opt.key"
              @click="selectedLayout = opt.key"
            >
              <span :class="opt.icon" class="w-3 h-3" />
              <span class="layout-pill-label">{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <div class="toolbar-sep" />

        <!-- Time window pills -->
        <div class="toolbar-section">
          <div class="layout-pills">
            <button
              v-for="tw in timeWindows"
              :key="tw.value"
              class="layout-pill"
              :class="{ 'layout-pill-active': timeWindow === tw.value }"
              @click="setTimeWindow(tw.value)"
            >
              {{ tw.label }}
            </button>
          </div>
        </div>

        <div class="toolbar-sep hidden sm:block" />

        <!-- Strength slider -->
        <div class="toolbar-section hidden sm:flex items-center gap-1.5">
          <span class="text-[10px] text-ink-4 whitespace-nowrap">Str</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round(minWeight * 100)"
            class="toolbar-range"
            @input="onStrengthInput"
          />
          <span class="text-[10px] font-mono text-ink-3 w-6 text-right">{{ minWeight.toFixed(2) }}</span>
        </div>

        <!-- Nodes slider -->
        <div class="toolbar-section hidden sm:flex items-center gap-1.5">
          <span class="text-[10px] text-ink-4 whitespace-nowrap">Nodes</span>
          <input
            type="range"
            min="25"
            max="200"
            :value="maxNodes"
            class="toolbar-range"
            @input="onNodesInput"
          />
          <span class="text-[10px] font-mono text-ink-3 w-4 text-right">{{ maxNodes }}</span>
        </div>

        <div class="toolbar-sep" />

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

        <!-- Close fullscreen -->
        <div class="toolbar-section">
          <button class="toolbar-btn" title="Exit fullscreen (Esc)" @click="toggleFullscreen">
            <span class="i-heroicons-arrows-pointing-in w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Recentered chip (top-left) -->
      <div v-if="isRecentered" class="recenter-bar recenter-floating">
        <span class="i-heroicons-viewfinder-circle w-3.5 h-3.5 flex-shrink-0" />
        <span class="truncate">Centered on <strong>{{ center.name }}</strong></span>
        <button class="recenter-back" @click="resetCenter">
          <span class="i-heroicons-arrow-uturn-left w-3 h-3" />
          Back to {{ originName || 'this entity' }}
        </button>
      </div>

      <!-- ===== Stats watermark (bottom-left) ===== -->
      <div class="stats-watermark" v-if="visibleStats">
        <span v-if="visibleStats">{{ visibleStats.visibleNodes }} nodes</span>
        <span v-if="visibleStats"> | {{ visibleStats.visibleEdges }} edges</span>
        <span v-if="hiddenTypeCount > 0"> | {{ hiddenTypeCount }} type{{ hiddenTypeCount > 1 ? 's' : '' }} hidden</span>
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

      <!-- First-use hint -->
      <div v-if="!hasExplored && !loading && hasData" class="explore-hint">
        <span class="i-heroicons-cursor-arrow-rays w-3.5 h-3.5 text-accent" />
        Click a node to see its connections &middot; double-click to open it
      </div>

      <!-- Keyboard shortcuts hint -->
      <div class="shortcuts-hint">
        <span>+/-</span> zoom
        <span class="ml-2">0</span> fit
        <span class="ml-2">1-3</span> layout
        <span class="ml-2">/</span> search
        <span class="ml-2">Esc</span> exit
      </div>
    </template>
  </div>
</template>

<style scoped>
/* --- Root container --- */
.explorer-root {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--color-rule, #e2e8f0);
  background: var(--color-paper, #fff);
}

:root.dark .explorer-root {
  background: var(--color-paper, #1e293b);
}

/* Fullscreen overrides */
.explorer-root:fullscreen {
  border-radius: 0;
  border: none;
}

.explorer-fullscreen {
  width: 100%;
  height: 100vh;
}

/* --- Inline header --- */
.inline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
}

.inline-fullscreen-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: var(--color-ink-3, #64748b);
  cursor: pointer;
  transition: all 0.15s;
}

.inline-fullscreen-btn:hover {
  background: var(--color-paper-2, #f1f5f9);
  color: var(--color-ink, #1e293b);
}

:root.dark .inline-fullscreen-btn:hover {
  background: rgba(51, 65, 85, 0.4);
  color: #e2e8f0;
}

/* --- Floating Toolbar --- */
.floating-toolbar {
  position: absolute;
  top: 12px;
  /* left+right+auto margins center it without halving the shrink-to-fit width */
  left: 12px;
  right: 12px;
  margin-inline: auto;
  width: fit-content;
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
  min-width: 90px;
  max-width: 140px;
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

/* Layout pills (reused for time window) */
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

@media (min-width: 768px) {
  .layout-pill-label {
    display: inline;
  }
}

/* --- Recentered banner --- */
.recenter-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 5px 8px 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--color-ink-2);
  background: var(--color-paper-2);
  border: 1px solid var(--color-rule-soft);
}

.recenter-bar strong {
  color: var(--color-ink);
  font-weight: 600;
}

.recenter-floating {
  position: absolute;
  top: 60px;
  left: 12px;
  z-index: 20;
  margin: 0;
  max-width: calc(100% - 24px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.recenter-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--color-ink-2);
  background: var(--color-paper);
  border: 1px solid var(--color-rule);
  cursor: pointer;
}

.recenter-back:hover {
  color: var(--color-ink);
  border-color: var(--color-ink-4);
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
  color: var(--color-ink-4);
}

.type-toggle-label {
  display: none;
  color: var(--color-ink-2);
}

@media (min-width: 1024px) {
  .type-toggle-label {
    display: inline;
  }
}

/* --- Inline legend --- */
.inline-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 4px;
  padding: 0 12px 8px;
}

.inline-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-ink-2);
  transition: background 0.15s, opacity 0.15s;
}

.inline-legend-item:hover {
  background: var(--color-paper-2);
}

.inline-legend-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-ink-4);
}

@media (max-width: 640px) {
  .inline-legend-hint {
    display: none;
  }
}

/* --- First-use hint --- */
.explore-hint {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-ink-2);
  background: color-mix(in srgb, var(--color-panel, #fff) 90%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-rule);
  box-shadow: 0 2px 8px rgba(23, 20, 14, 0.08);
  pointer-events: none;
  white-space: nowrap;
}

/* Toolbar controls */
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
