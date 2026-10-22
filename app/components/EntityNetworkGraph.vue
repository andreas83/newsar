<template>
  <div class="entity-network-container">
    <div ref="graphContainer" class="graph-canvas"></div>

    <!-- Legend overlay (gated by showLegend prop) -->
    <div v-if="showLegend !== false" class="graph-legend">
      <div class="legend-title">Legend</div>
      <div class="legend-hint" style="margin-top: 0; margin-bottom: 4px;">Click to toggle types</div>
      <div
        v-for="(label, type) in entityTypeLabels"
        :key="type"
        class="legend-row legend-row-interactive"
        :class="{ 'legend-disabled': isTypeHidden(type as string) }"
        @click="toggleType(type as string)"
      >
        <span
          class="legend-dot"
          :style="{ background: isTypeHidden(type as string) ? '#94a3b8' : entityColors[type as string] }"
        ></span>
        <span :class="{ 'legend-strikethrough': isTypeHidden(type as string) }">{{ label }}</span>
      </div>
      <div class="legend-divider"></div>
      <div class="legend-hint" style="margin-top: 0; margin-bottom: 2px;">When a node is focused:</div>
      <div class="legend-row">
        <span class="legend-line" :style="{ background: SENTIMENT_SIMILAR }"></span> Similar tone
      </div>
      <div class="legend-row">
        <span class="legend-line" :style="{ background: SENTIMENT_OPPOSED }"></span> Opposed tone
      </div>
      <div class="legend-hint">
        Node size = how connected<br>
        Line width = shared articles<br>
        Click node to focus<br>
        Double-click to open
      </div>
    </div>

    <!-- Minimap canvas -->
    <canvas
      v-if="showMinimap"
      ref="minimapCanvas"
      class="minimap-canvas"
      width="160"
      height="120"
      @click="onMinimapClick"
    ></canvas>

    <!-- Tooltip -->
    <div
      v-if="tooltip.visible"
      class="tooltip"
      :style="{
        left: tooltip.x + 'px',
        top: tooltip.y + 'px',
      }"
      @mouseenter="onTooltipEnter"
      @mouseleave="onTooltipLeave"
    >
      <div class="tooltip-content">
        <div class="tooltip-header">
          <img
            v-if="tooltip.data.imageUrl"
            :src="tooltip.data.imageUrl"
            :alt="tooltip.data.name"
            class="tooltip-image"
          />
          <div class="min-w-0">
            <div v-if="tooltip.data.type !== 'edge'" class="tooltip-type">
              <span class="tooltip-type-dot" :style="{ background: entityColors[tooltip.data.type] || '#6b7280' }"></span>
              {{ entityTypeLabels[tooltip.data.type] || tooltip.data.type }}
            </div>
            <div class="tooltip-name">{{ tooltip.data.name }}</div>
            <div v-if="tooltip.data.shortDescription" class="tooltip-description">
              {{ tooltip.data.shortDescription.length > 120 ? tooltip.data.shortDescription.slice(0, 120) + '...' : tooltip.data.shortDescription }}
            </div>
          </div>
        </div>
        <div v-if="tooltip.data.connectionCount !== undefined" class="tooltip-meta">
          {{ tooltip.data.connectionCount }} connection{{ tooltip.data.connectionCount !== 1 ? 's' : '' }} in view
        </div>
        <div v-if="tooltip.data.weight !== undefined" class="tooltip-meta">
          {{ tooltip.data.weight }}
        </div>
        <div v-if="tooltip.data.sentiment" class="tooltip-meta">
          {{ tooltip.data.sentiment }}
        </div>
        <div v-if="tooltip.data.type !== 'edge'" class="tooltip-hint">
          Click to focus &middot; double-click to open
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as d3 from 'd3'

// Export types for use in parent components
export interface GraphNode {
  id: number
  name: string
  type: string
  slug: string | null
  trendingScore: number
  shortDescription?: string | null
  imageUrl?: string | null
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphEdge {
  source: number | GraphNode
  target: number | GraphNode
  weight: number
  cooccurrenceCount: number
  sentimentCorrelation: number | null
  lastSeen: Date
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface NetworkConnection {
  node: GraphNode
  cooccurrenceCount: number
  weight: number
  sentimentCorrelation: number | null
}

export interface NetworkSelection {
  node: GraphNode
  connections: NetworkConnection[]
}

export type LayoutStrategy = 'force' | 'radial' | 'hierarchical'

const props = defineProps<{
  data: GraphData
  width?: number
  height?: number
  minNodeSize?: number
  maxNodeSize?: number
  highlightNodeId?: number | null
  minCooccurrence?: number
  layout?: LayoutStrategy
  showLegend?: boolean
  searchHighlight?: string | null
  showMinimap?: boolean
}>()

const emit = defineEmits<{
  nodeClick: [node: GraphNode]
  nodeSelect: [selection: NetworkSelection | null]
  edgeClick: [edge: GraphEdge]
  'update:visibleStats': [stats: { visibleNodes: number; visibleEdges: number }]
}>()

const graphContainer = ref<HTMLElement | null>(null)
const minimapCanvas = ref<HTMLCanvasElement | null>(null)
const tooltip = ref({
  visible: false,
  x: 0,
  y: 0,
  data: {} as any,
})

let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
let zoom: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

// Module-scope D3 selections
let linkSelection: d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown> | null = null
let labelLayer: d3.Selection<SVGGElement, unknown, null, undefined> | null = null
let nodeSelection: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null = null
let linkLabelSelection: d3.Selection<SVGTextElement, GraphEdge, SVGGElement, unknown> | null = null
let nodeLabels: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown> | null = null
let allEdges: GraphEdge[] = []
let allNodes: GraphNode[] = []

// Graph indexes, rebuilt on every init
let nodeById = new Map<number, GraphNode>()
let importance = new Map<number, number>()  // 0..1, how connected a node is
let maxCooccurrence = 1
let visibleNodeIds = new Set<number>()

// Focus state: a pinned node (click) wins over a hover preview
const pinnedEgoNodeId = ref<number | null>(null)
const hoverNodeId = ref<number | null>(null)
let searchMatchIds: Set<number> | null = null
let lastPinAt = 0
let hoverTimer: ReturnType<typeof setTimeout> | null = null

// Shared filter state — same ref used by parent page
const { hiddenEntityTypes, isTypeHidden, toggleEntityType: toggleType } = useNetworkFilters()
const hiddenTypes = computed(() => new Set(hiddenEntityTypes.value))

// Zoom state
let currentZoomScale = 1.0
let currentTransform: d3.ZoomTransform = d3.zoomIdentity
let userMovedView = false
let hasAutoFitted = false

// Minimap throttle
let minimapTimer: ReturnType<typeof setTimeout> | null = null

// Entity type colors
const entityColors: Record<string, string> = {
  person: '#3b82f6',     // blue
  organization: '#10b981', // green
  location: '#f59e0b',   // orange
  event: '#8b5cf6',      // purple
  topic: '#14b8a6',      // teal
}

const entityTypeLabels: Record<string, string> = {
  person: 'Person',
  organization: 'Organization',
  location: 'Location',
  event: 'Event',
  topic: 'Topic',
}

// Sentiment colors only appear on focused edges, so the resting graph stays calm
const SENTIMENT_SIMILAR = '#16a34a'
const SENTIMENT_OPPOSED = '#dc2626'

// Label metrics in screen pixels (labels are counter-scaled against zoom)
const LABEL_FONT_PX = 11
const LABEL_CHAR_PX = 6.2

function idOf(end: number | GraphNode): number {
  return typeof end === 'number' ? end : end.id
}

function getNodeSize(node: GraphNode): number {
  const minSize = props.minNodeSize || 4
  const maxSize = props.maxNodeSize || 20
  const size = minSize + (importance.get(node.id) ?? 0) * (maxSize - minSize)
  if (props.highlightNodeId != null && node.id === props.highlightNodeId) return Math.max(size, maxSize)
  return size
}

/**
 * Size by connectedness, not trending score: almost all entities have a
 * trending score of 0, which made every node the same size. Score is the sum
 * of sqrt(shared articles) over a node's edges, log-scaled so one hub does not
 * flatten everything else to the minimum size.
 */
function computeImportance(nodes: GraphNode[], edges: GraphEdge[]) {
  const score = new Map<number, number>()
  maxCooccurrence = 1
  for (const e of edges) {
    const s = Math.sqrt(Math.max(1, e.cooccurrenceCount))
    const sId = idOf(e.source)
    const tId = idOf(e.target)
    score.set(sId, (score.get(sId) || 0) + s)
    score.set(tId, (score.get(tId) || 0) + s)
    if (e.cooccurrenceCount > maxCooccurrence) maxCooccurrence = e.cooccurrenceCount
  }
  const maxScore = Math.max(1, ...score.values())
  importance = new Map()
  for (const n of nodes) {
    const connected = Math.log1p(score.get(n.id) || 0) / Math.log1p(maxScore)
    // Trending breaks ties between equally connected nodes
    importance.set(n.id, Math.min(1, connected * 0.85 + (n.trendingScore || 0) * 0.15))
  }
}

function isEdgeVisible(d: GraphEdge): boolean {
  const hidden = hiddenTypes.value
  const s = nodeById.get(idOf(d.source))
  const t = nodeById.get(idOf(d.target))
  if (!s || !t) return false
  if (hidden.has(s.type) || hidden.has(t.type)) return false
  return d.cooccurrenceCount >= (props.minCooccurrence ?? 1)
}

function viewportSize() {
  return {
    width: props.width || graphContainer.value?.clientWidth || 800,
    height: props.height || graphContainer.value?.clientHeight || 600,
  }
}

// --- Exposed Methods ---

function fitToView(duration = 500) {
  if (!svg || !zoom || !allNodes.length) return
  const { width, height } = viewportSize()

  const visibleNodes = allNodes.filter(n =>
    n.x !== undefined && n.y !== undefined &&
    (visibleNodeIds.size === 0 || visibleNodeIds.has(n.id)),
  )
  if (!visibleNodes.length) return

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of visibleNodes) {
    const r = getNodeSize(n)
    if (n.x! - r < minX) minX = n.x! - r
    if (n.y! - r < minY) minY = n.y! - r
    if (n.x! + r > maxX) maxX = n.x! + r
    if (n.y! + r > maxY) maxY = n.y! + r
  }

  // Extra room at the bottom for labels and at the top for the floating toolbar
  const padX = 48
  const padTop = 64
  const padBottom = 48
  const bw = maxX - minX
  const bh = maxY - minY
  const scale = Math.max(0.1, Math.min((width - padX * 2) / bw, (height - padTop - padBottom) / bh, 1.3))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const transform = d3.zoomIdentity
    .translate(width / 2, padTop + (height - padTop - padBottom) / 2)
    .scale(scale)
    .translate(-cx, -cy)

  if (duration > 0) {
    svg.transition().duration(duration).call(zoom.transform, transform)
  } else {
    svg.call(zoom.transform, transform)
  }
}

function zoomIn() {
  if (!svg || !zoom) return
  svg.transition().duration(300).call(zoom.scaleBy, 1.4)
}

function zoomOut() {
  if (!svg || !zoom) return
  svg.transition().duration(300).call(zoom.scaleBy, 0.7)
}

function resetZoom() {
  fitToView()
}

function panToNode(node: GraphNode, minScale = 1.2) {
  if (!svg || !zoom || node.x === undefined || node.y === undefined) return
  const { width, height } = viewportSize()
  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(Math.max(currentZoomScale, minScale))
    .translate(-node.x, -node.y)
  svg.transition().duration(500).call(zoom.transform, transform)
}

/** Pin focus on a node (e.g. from a connection list) and bring it into view. */
function focusNode(id: number, pan = true) {
  const node = nodeById.get(id)
  if (!node) return
  pinnedEgoNodeId.value = id
  lastPinAt = Date.now()
  restyle()
  emitSelection()
  if (pan) panToNode(node)
}

function clearFocus() {
  if (pinnedEgoNodeId.value === null) return
  pinnedEgoNodeId.value = null
  restyle()
  emitSelection()
}

defineExpose({ fitToView, zoomIn, zoomOut, resetZoom, focusNode, clearFocus })

// --- Focus / Selection ---

function visibleNeighbors(nodeId: number): Map<number, GraphEdge> {
  const result = new Map<number, GraphEdge>()
  for (const e of allEdges) {
    const sId = idOf(e.source)
    const tId = idOf(e.target)
    if (sId !== nodeId && tId !== nodeId) continue
    if (!isEdgeVisible(e)) continue
    result.set(sId === nodeId ? tId : sId, e)
  }
  return result
}

function emitSelection() {
  const id = pinnedEgoNodeId.value
  const node = id !== null ? nodeById.get(id) : undefined
  if (!node) {
    emit('nodeSelect', null)
    return
  }
  const connections: NetworkConnection[] = []
  for (const [neighborId, e] of visibleNeighbors(node.id)) {
    const neighbor = nodeById.get(neighborId)
    if (!neighbor) continue
    connections.push({
      node: neighbor,
      cooccurrenceCount: e.cooccurrenceCount,
      weight: e.weight,
      sentimentCorrelation: e.sentimentCorrelation,
    })
  }
  connections.sort((a, b) => b.cooccurrenceCount - a.cooccurrenceCount || b.weight - a.weight)
  emit('nodeSelect', { node, connections })
}

function edgeBaseOpacity(d: GraphEdge): number {
  const ceiling = allNodes.length > 500 ? 0.25 : 0.45
  return Math.min(ceiling, 0.12 + d.weight * 0.4)
}

function edgeWidth(d: GraphEdge): number {
  return 0.6 + 3.4 * Math.sqrt(d.cooccurrenceCount / maxCooccurrence)
}

function sentimentColor(d: GraphEdge): string {
  const sc = d.sentimentCorrelation
  if (sc !== null && sc > 0.3) return SENTIMENT_SIMILAR
  if (sc !== null && sc < -0.3) return SENTIMENT_OPPOSED
  return 'var(--color-ink-3, #6b6353)'
}

function nodeRingColor(d: GraphNode, focusId: number | null): string {
  if (d.id === focusId) return 'var(--color-accent, #d97706)'
  if (searchMatchIds?.has(d.id)) return 'var(--color-accent, #d97706)'
  if (props.highlightNodeId != null && d.id === props.highlightNodeId) return 'var(--color-ink, #17140e)'
  return 'var(--color-paper, #fff)'
}

function nodeRingWidth(d: GraphNode, focusId: number | null): number {
  if (d.id === focusId) return 3.5
  if (searchMatchIds?.has(d.id)) return 3
  if (props.highlightNodeId != null && d.id === props.highlightNodeId) return 2.5
  return 1.5
}

/** Single place that derives node/edge styling from focus + search state. */
function restyle() {
  if (!linkSelection || !nodeSelection) return

  const focusId = pinnedEgoNodeId.value ?? hoverNodeId.value
  const circles = nodeSelection.select<SVGCircleElement>('circle')

  if (focusId !== null) {
    const neighbors = visibleNeighbors(focusId)

    circles.transition().duration(150)
      .style('opacity', (d: GraphNode) => (d.id === focusId || neighbors.has(d.id)) ? 1 : 0.12)
      .style('stroke', (d: GraphNode) => nodeRingColor(d, focusId))
      .style('stroke-width', (d: GraphNode) => nodeRingWidth(d, focusId))

    const touches = (d: GraphEdge) => idOf(d.source) === focusId || idOf(d.target) === focusId
    linkSelection
      .style('stroke', (d: GraphEdge) => touches(d) ? sentimentColor(d) : 'var(--color-ink-4, #9a9080)')
      .transition().duration(150)
      .style('opacity', (d: GraphEdge) => touches(d) ? 0.9 : 0.04)

    linkLabelSelection?.transition().duration(150)
      .style('opacity', (d: GraphEdge) => touches(d) ? 1 : 0)
  } else if (searchMatchIds) {
    circles.transition().duration(150)
      .style('opacity', (d: GraphNode) => searchMatchIds!.has(d.id) ? 1 : 0.12)
      .style('stroke', (d: GraphNode) => nodeRingColor(d, null))
      .style('stroke-width', (d: GraphNode) => nodeRingWidth(d, null))

    linkSelection
      .style('stroke', 'var(--color-ink-4, #9a9080)')
      .transition().duration(150)
      .style('opacity', 0.05)

    linkLabelSelection?.transition().duration(150).style('opacity', 0)
  } else {
    circles.transition().duration(150)
      .style('opacity', 1)
      .style('stroke', (d: GraphNode) => nodeRingColor(d, null))
      .style('stroke-width', (d: GraphNode) => nodeRingWidth(d, null))

    linkSelection
      .style('stroke', 'var(--color-ink-4, #9a9080)')
      .transition().duration(150)
      .style('opacity', edgeBaseOpacity)

    linkLabelSelection?.transition().duration(150).style('opacity', 0.8)
  }

  updateLabelVisibility()
}

// --- Unified Visibility (shared by edge-weight filter + legend toggle) ---

function updateVisibility() {
  if (!linkSelection || !nodeSelection) return

  const hidden = hiddenTypes.value
  const nodesWithVisibleEdges = new Set<number>()
  let visibleEdges = 0

  linkSelection.style('display', (d: GraphEdge) => {
    if (!isEdgeVisible(d)) return 'none'
    nodesWithVisibleEdges.add(idOf(d.source))
    nodesWithVisibleEdges.add(idOf(d.target))
    visibleEdges++
    return null
  })

  linkLabelSelection?.style('display', (d: GraphEdge) => isEdgeVisible(d) ? null : 'none')

  // Hidden if type is hidden, or orphaned (no visible edges)
  visibleNodeIds = new Set()
  for (const n of allNodes) {
    if (!hidden.has(n.type) && nodesWithVisibleEdges.has(n.id)) visibleNodeIds.add(n.id)
  }
  nodeSelection.style('display', (d: GraphNode) => visibleNodeIds.has(d.id) ? null : 'none')

  // Drop focus if the focused node just disappeared
  const wasPinned = pinnedEgoNodeId.value !== null
  if (wasPinned && !visibleNodeIds.has(pinnedEgoNodeId.value!)) {
    pinnedEgoNodeId.value = null
  }

  emit('update:visibleStats', { visibleNodes: visibleNodeIds.size, visibleEdges })

  restyle()
  // Connection lists depend on what is visible, so refresh them
  if (wasPinned) emitSelection()
  scheduleMinimapDraw()
}

// --- Label Placement ---

/**
 * Greedy label placement in screen space. Labels are counter-scaled against
 * zoom, so a label always reads at ~11px; zooming in therefore frees room and
 * reveals more names. Priority depends on mode:
 *  - focus: the focused node, then neighbors by shared articles
 *  - search: matches only
 *  - default: most connected first, limited to the viewport
 */
function updateLabelVisibility() {
  if (!nodeLabels || !allNodes.length) return

  const k = currentZoomScale
  const t = currentTransform
  const { width, height } = viewportSize()
  const focusId = pinnedEgoNodeId.value ?? hoverNodeId.value

  let priority: Map<number, number>
  let budget: number

  if (focusId !== null) {
    priority = new Map([[focusId, Infinity]])
    for (const [id, e] of visibleNeighbors(focusId)) priority.set(id, e.cooccurrenceCount)
    budget = 60
  } else if (searchMatchIds) {
    priority = new Map([...searchMatchIds].map(id => [id, importance.get(id) ?? 0]))
    budget = 60
  } else {
    priority = new Map()
    for (const n of allNodes) {
      if (visibleNodeIds.has(n.id)) priority.set(n.id, importance.get(n.id) ?? 0)
    }
    if (props.highlightNodeId != null) priority.set(props.highlightNodeId, Infinity)
    budget = Math.max(12, Math.round(28 * Math.sqrt(k)))
  }

  interface Box { id: number; x: number; y: number; w: number; h: number }
  const candidates: { node: GraphNode; p: number }[] = []
  for (const [id, p] of priority) {
    const n = nodeById.get(id)
    if (!n || n.x === undefined || n.y === undefined || !visibleNodeIds.has(id)) continue
    const sx = t.applyX(n.x)
    const sy = t.applyY(n.y)
    if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) continue
    candidates.push({ node: n, p })
  }
  candidates.sort((a, b) => b.p - a.p)

  // Circles of nodes that are currently emphasized act as obstacles
  const obstacles: Box[] = []
  for (const n of allNodes) {
    if (n.x === undefined || n.y === undefined || !visibleNodeIds.has(n.id)) continue
    if (focusId !== null && !priority.has(n.id)) continue
    if (searchMatchIds && focusId === null && !searchMatchIds.has(n.id)) continue
    const r = getNodeSize(n) * k
    obstacles.push({ id: n.id, x: t.applyX(n.x) - r, y: t.applyY(n.y) - r, w: r * 2, h: r * 2 })
  }
  const hits = (box: Box, list: Box[]) => list.some(p =>
    p.id !== box.id && box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y,
  )

  type Side = 'below' | 'above' | 'right' | 'left'
  const SIDES: Side[] = ['below', 'above', 'right', 'left']
  const placed: Box[] = []
  const sideOf = new Map<number, Side>()

  // The few biggest hubs sit inside their own cluster, where every side is
  // covered by neighbors; let them overlap circles (the halo keeps them legible)
  const HUB_LABELS = 6

  for (const [rank, { node, p }] of candidates.entries()) {
    if (placed.length >= budget) break
    const isHub = focusId === null && !searchMatchIds && rank < HUB_LABELS
    const w = node.name.length * LABEL_CHAR_PX + 4
    const h = LABEL_FONT_PX + 3
    const cx = t.applyX(node.x!)
    const cy = t.applyY(node.y!)
    const r = getNodeSize(node) * k

    // Cartographic placement: first free spot around the node wins
    for (const side of SIDES) {
      const box: Box = side === 'below' ? { id: node.id, x: cx - w / 2, y: cy + r + 2, w, h }
        : side === 'above' ? { id: node.id, x: cx - w / 2, y: cy - r - 2 - h, w, h }
          : side === 'right' ? { id: node.id, x: cx + r + 3, y: cy - h / 2, w, h }
            : { id: node.id, x: cx - r - 3 - w, y: cy - h / 2, w, h }
      // The focused/center node is always labelled
      const free = !hits(box, placed) && (isHub || !hits(box, obstacles))
      if ((p === Infinity && side === 'below') || free) {
        placed.push(box)
        sideOf.set(node.id, side)
        break
      }
    }
  }

  nodeLabels
    .style('opacity', (d: GraphNode) => sideOf.has(d.id) ? 1 : 0)
    .classed('node-label-strong', (d: GraphNode) =>
      d.id === focusId || (props.highlightNodeId != null && d.id === props.highlightNodeId),
    )
    .each(function (d: GraphNode) {
      const side = sideOf.get(d.id)
      if (!side) return
      const r = getNodeSize(d)
      const gap = 3 / k
      const el = d3.select(this)
      if (side === 'below') el.attr('x', 0).attr('y', r).attr('dy', '1.05em').attr('text-anchor', 'middle')
      else if (side === 'above') el.attr('x', 0).attr('y', -r - gap).attr('dy', '-0.3em').attr('text-anchor', 'middle')
      else if (side === 'right') el.attr('x', r + gap).attr('y', 0).attr('dy', '0.35em').attr('text-anchor', 'start')
      else el.attr('x', -r - gap).attr('y', 0).attr('dy', '0.35em').attr('text-anchor', 'end')
    })
}

// --- Minimap ---

function scheduleMinimapDraw() {
  if (!props.showMinimap) return
  if (minimapTimer) return
  minimapTimer = setTimeout(() => {
    minimapTimer = null
    drawMinimap()
  }, 500)
}

function minimapBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of allNodes) {
    if (!visibleNodeIds.has(n.id) || n.x === undefined || n.y === undefined) continue
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x > maxX) maxX = n.x
    if (n.y > maxY) maxY = n.y
  }
  if (minX === Infinity) return null
  const padding = 20
  minX -= padding; minY -= padding
  maxX += padding; maxY += padding
  return { minX, minY, bw: maxX - minX || 1, bh: maxY - minY || 1 }
}

function drawMinimap() {
  const canvas = minimapCanvas.value
  if (!canvas || !allNodes.length) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  const bounds = minimapBounds()
  if (!bounds) return
  const { minX, minY, bw, bh } = bounds
  const scale = Math.min(w / bw, h / bh)

  const isDark = document.documentElement.classList.contains('dark')
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = isDark ? 'rgba(18,18,18,0.6)' : 'rgba(247,245,239,0.6)'
  ctx.fillRect(0, 0, w, h)

  const focusId = pinnedEgoNodeId.value
  for (const n of allNodes) {
    if (!visibleNodeIds.has(n.id) || n.x === undefined || n.y === undefined) continue
    const mx = (n.x - minX) * scale
    const my = (n.y - minY) * scale
    ctx.fillStyle = entityColors[n.type] || '#6b7280'
    ctx.beginPath()
    ctx.arc(mx, my, n.id === focusId ? 4 : 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // Viewport rectangle
  if (svg && graphContainer.value) {
    const { width: svgW, height: svgH } = viewportSize()
    const t = currentTransform
    const vx1 = (0 - t.x) / t.k
    const vy1 = (0 - t.y) / t.k
    const vx2 = (svgW - t.x) / t.k
    const vy2 = (svgH - t.y) / t.k

    const rx = (vx1 - minX) * scale
    const ry = (vy1 - minY) * scale
    const rw = (vx2 - vx1) * scale
    const rh = (vy2 - vy1) * scale

    ctx.strokeStyle = isDark ? 'rgba(245,158,11,0.7)' : 'rgba(217,119,6,0.6)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(rx, ry, rw, rh)
    ctx.fillStyle = isDark ? 'rgba(245,158,11,0.08)' : 'rgba(217,119,6,0.06)'
    ctx.fillRect(rx, ry, rw, rh)
  }
}

function onMinimapClick(event: MouseEvent) {
  if (!svg || !zoom || !allNodes.length || !minimapCanvas.value) return

  const canvas = minimapCanvas.value
  const rect = canvas.getBoundingClientRect()
  const bounds = minimapBounds()
  if (!bounds) return
  const { minX, minY, bw, bh } = bounds
  const scale = Math.min(canvas.width / bw, canvas.height / bh)

  // Convert minimap click to graph coordinates
  const gx = (event.clientX - rect.left) / scale + minX
  const gy = (event.clientY - rect.top) / scale + minY

  const { width: svgW, height: svgH } = viewportSize()
  const transform = d3.zoomIdentity
    .translate(svgW / 2, svgH / 2)
    .scale(currentTransform.k)
    .translate(-gx, -gy)

  svg.transition().duration(300).call(zoom.transform, transform)
}

// --- Search Highlight ---

function applySearchHighlight(query: string | null, pan = true) {
  if (!nodeSelection) return

  searchMatchIds = null
  const q = query?.trim().toLowerCase()
  if (!q) {
    restyle()
    return
  }

  const matches = allNodes.filter(n => visibleNodeIds.has(n.id) && n.name.toLowerCase().includes(q))
  if (matches.length === 0) {
    restyle()
    return
  }

  if (matches.length === 1) {
    focusNode(matches[0].id, pan)
    return
  }

  // Exact name match beats substring matches ("Iran" vs "Iranian Army")
  const exact = matches.find(n => n.name.toLowerCase() === q)
  if (exact) {
    focusNode(exact.id, pan)
    return
  }

  searchMatchIds = new Set(matches.map(m => m.id))
  if (pinnedEgoNodeId.value !== null) {
    pinnedEgoNodeId.value = null
    emitSelection()
  }
  restyle()
}

function computeInitialPositions(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  layout: LayoutStrategy,
) {
  const cx = width / 2
  const cy = height / 2

  if (layout === 'radial') {
    // Group nodes by entity type, place in concentric rings with wide spacing
    const typeOrder = ['person', 'organization', 'location', 'event', 'topic']
    const groups: Record<string, GraphNode[]> = {}
    for (const n of nodes) {
      const t = n.type || 'other'
      if (!groups[t]) groups[t] = []
      groups[t].push(n)
    }

    const activeTypes = typeOrder.filter(t => groups[t]?.length > 0)
    const ringGap = Math.min(width, height) * 0.35 / Math.max(1, activeTypes.length)
    let ringIdx = 0
    for (const type of activeTypes) {
      ringIdx++
      const group = groups[type]
      const radius = ringGap * ringIdx
      group.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / group.length - Math.PI / 2
        n.x = cx + radius * Math.cos(angle)
        n.y = cy + radius * Math.sin(angle)
      })
    }
    // Place any remaining types not in typeOrder
    for (const type of Object.keys(groups)) {
      if (typeOrder.includes(type)) continue
      ringIdx++
      const group = groups[type]
      const radius = ringGap * ringIdx
      group.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / group.length - Math.PI / 2
        n.x = cx + radius * Math.cos(angle)
        n.y = cy + radius * Math.sin(angle)
      })
    }
  } else if (layout === 'hierarchical') {
    // Hub/spoke: hubs near center, others toward periphery near their most-connected hub
    const connectionCounts = new Map<number, number>()
    const adjacency = new Map<number, Map<number, number>>()
    for (const n of nodes) {
      connectionCounts.set(n.id, 0)
      adjacency.set(n.id, new Map())
    }
    for (const e of edges) {
      const sId = idOf(e.source)
      const tId = idOf(e.target)
      connectionCounts.set(sId, (connectionCounts.get(sId) || 0) + 1)
      connectionCounts.set(tId, (connectionCounts.get(tId) || 0) + 1)
      const adj = adjacency.get(sId)!
      adj.set(tId, (adj.get(tId) || 0) + 1)
      const adj2 = adjacency.get(tId)!
      adj2.set(sId, (adj2.get(sId) || 0) + 1)
    }

    const sorted = [...nodes].sort((a, b) =>
      (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0)
    )

    // Top 5% (min 2) are hubs
    const hubCount = Math.max(2, Math.ceil(nodes.length * 0.05))
    const hubIds = new Set(sorted.slice(0, hubCount).map(n => n.id))
    const hubRadius = Math.min(width, height) * 0.15
    const peripheryMin = Math.min(width, height) * 0.3
    const peripheryMax = Math.min(width, height) * 0.45

    // Place hubs in a circle near center
    const hubs = sorted.filter(n => hubIds.has(n.id))
    hubs.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / hubs.length - Math.PI / 2
      n.x = cx + hubRadius * Math.cos(angle)
      n.y = cy + hubRadius * Math.sin(angle)
    })

    // Place non-hubs near their most-connected hub
    const nonHubs = sorted.filter(n => !hubIds.has(n.id))
    const hubPositions = new Map<number, { x: number; y: number }>()
    for (const h of hubs) {
      hubPositions.set(h.id, { x: h.x!, y: h.y! })
    }

    nonHubs.forEach((n, i) => {
      // Find most-connected hub
      const adj = adjacency.get(n.id) || new Map()
      let bestHub: number | null = null
      let bestWeight = 0
      for (const [neighborId, w] of adj) {
        if (hubIds.has(neighborId) && w > bestWeight) {
          bestHub = neighborId
          bestWeight = w
        }
      }

      const radius = peripheryMin + Math.random() * (peripheryMax - peripheryMin)
      if (bestHub !== null && hubPositions.has(bestHub)) {
        // Place near that hub's direction from center
        const hp = hubPositions.get(bestHub)!
        const angle = Math.atan2(hp.y - cy, hp.x - cx) + (Math.random() - 0.5) * 1.2
        n.x = cx + radius * Math.cos(angle)
        n.y = cy + radius * Math.sin(angle)
      } else {
        // No hub connection: golden spiral at periphery
        const goldenAngle = Math.PI * (3 - Math.sqrt(5))
        const angle = i * goldenAngle
        n.x = cx + radius * Math.cos(angle)
        n.y = cy + radius * Math.sin(angle)
      }
    })
  } else {
    // 'force' layout: deterministic phyllotaxis, most connected nodes in the
    // middle. Same data → same picture, so the map is learnable across visits.
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const ordered = [...nodes].sort((a, b) => (importance.get(b.id) ?? 0) - (importance.get(a.id) ?? 0))
    ordered.forEach((node, i) => {
      const r = 12 * Math.sqrt(i + 0.5)
      node.x = cx + r * Math.cos(i * goldenAngle)
      node.y = cy + r * Math.sin(i * goldenAngle)
    })
  }
}

function initGraph() {
  if (!graphContainer.value || !props.data) return

  const { width, height } = viewportSize()

  // Clear existing SVG and stop previous simulation FIRST
  if (simulation) {
    simulation.stop()
    simulation = null
  }
  d3.select(graphContainer.value).selectAll('*').remove()

  linkSelection = null
  labelLayer = null
  nodeSelection = null
  linkLabelSelection = null
  nodeLabels = null
  searchMatchIds = null
  hoverNodeId.value = null
  userMovedView = false
  hasAutoFitted = false

  // Make a shallow copy of nodes to avoid mutating props
  const nodes = props.data.nodes.map(n => ({ ...n }))
  const edges = props.data.edges.map(e => ({ ...e }))

  allNodes = nodes
  allEdges = edges
  nodeById = new Map(nodes.map(n => [n.id, n]))
  visibleNodeIds = new Set(nodes.map(n => n.id))
  computeImportance(nodes, edges)

  const layout = props.layout || 'force'
  computeInitialPositions(nodes, edges, width, height, layout)
  nodes.forEach((node) => {
    node.fx = null
    node.fy = null
  })

  // Ego networks: anchor the center entity in the middle of the force layout
  const centerNode = props.highlightNodeId != null ? nodeById.get(props.highlightNodeId) : undefined
  if (centerNode && layout === 'force') {
    centerNode.x = centerNode.fx = width / 2
    centerNode.y = centerNode.fy = height / 2
  }

  svg = d3.select(graphContainer.value)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('class', 'network-svg')

  const g = svg.append('g')

  currentZoomScale = 1.0
  currentTransform = d3.zoomIdentity
  let lastLabelZoomScale = 1.0
  let lastLabelTransform = d3.zoomIdentity

  zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
      currentZoomScale = event.transform.k
      currentTransform = event.transform
      if (event.sourceEvent) userMovedView = true

      // Keep labels a constant screen size
      labelLayer?.style('--inv-k', String(1 / event.transform.k))

      // Re-place labels when zoom or pan moved enough to change what fits
      const panned = Math.abs(event.transform.x - lastLabelTransform.x) + Math.abs(event.transform.y - lastLabelTransform.y)
      if (Math.abs(currentZoomScale - lastLabelZoomScale) / lastLabelZoomScale > 0.08 || panned > 80) {
        lastLabelZoomScale = currentZoomScale
        lastLabelTransform = event.transform
        updateLabelVisibility()
      }

      scheduleMinimapDraw()
    })
    .on('end', () => {
      lastLabelZoomScale = currentZoomScale
      lastLabelTransform = currentTransform
      updateLabelVisibility()
    })

  svg.call(zoom).on('dblclick.zoom', null)

  // Click on empty canvas clears focus
  svg.on('click', (event: any) => {
    if (event.target.tagName === 'svg') clearFocus()
  })

  linkSelection = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(edges)
    .enter()
    .append('line')
    .attr('class', 'edge')
    .style('stroke', 'var(--color-ink-4, #9a9080)')
    .style('opacity', edgeBaseOpacity)
    .attr('stroke-width', edgeWidth)
    .attr('stroke-linecap', 'round')
    .on('click', (_event: any, d: GraphEdge) => {
      emit('edgeClick', d)
    })
    .on('mouseover', function(event: any, d: GraphEdge) {
      d3.select(this).attr('stroke-width', edgeWidth(d) + 2)

      const sourceName = nodeById.get(idOf(d.source))?.name ?? '?'
      const targetName = nodeById.get(idOf(d.target))?.name ?? '?'
      const sentimentLabel = d.sentimentCorrelation !== null
        ? (d.sentimentCorrelation > 0.3 ? 'Covered in a similar tone' : d.sentimentCorrelation < -0.3 ? 'Covered in opposing tones' : 'No clear tone pattern')
        : null

      showTooltip(event, {
        type: 'edge',
        name: `${sourceName} — ${targetName}`,
        weight: `${d.cooccurrenceCount.toLocaleString('en-US')} article${d.cooccurrenceCount !== 1 ? 's' : ''} mention both`,
        sentiment: sentimentLabel,
      })
    })
    .on('mouseout', function(_event: any, d: GraphEdge) {
      d3.select(this).attr('stroke-width', edgeWidth(d))
      hideTooltip()
    })

  // Edge labels (only for small graphs to avoid clutter)
  if (edges.length <= 60) {
    linkLabelSelection = g.append('g')
      .attr('class', 'edge-labels')
      .selectAll('text')
      .data(edges)
      .enter()
      .append('text')
      .attr('class', 'edge-label')
      .text((d: GraphEdge) => String(d.cooccurrenceCount))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .style('opacity', 0.8)
  }

  nodeSelection = g.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .call(d3.drag<any, GraphNode>()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended) as any)

  nodeSelection.append('circle')
    .attr('r', (d: GraphNode) => getNodeSize(d))
    .attr('fill', (d: GraphNode) => entityColors[d.type] || entityColors.person)
    .style('stroke', (d: GraphNode) => nodeRingColor(d, null))
    .style('stroke-width', (d: GraphNode) => nodeRingWidth(d, null))
    .style('cursor', 'pointer')
    .on('click', (event: any, d: GraphNode) => {
      event.stopPropagation() // prevent canvas click handler
      // The focus panel takes over from the tooltip
      tooltip.value.visible = false
      if (pinnedEgoNodeId.value === d.id) {
        // Second click of a double-click must not undo the focus
        if (Date.now() - lastPinAt < 400) return
        clearFocus()
      } else {
        focusNode(d.id, false)
      }
    })
    .on('dblclick', (event: any, d: GraphNode) => {
      event.stopPropagation()
      emit('nodeClick', d)
    })
    .on('mouseover', function(event: any, d: GraphNode) {
      d3.select(this).attr('r', getNodeSize(d) * 1.25)

      // Short delay so sweeping the cursor across the graph does not strobe
      if (hoverTimer) clearTimeout(hoverTimer)
      if (pinnedEgoNodeId.value === null) {
        hoverTimer = setTimeout(() => {
          hoverNodeId.value = d.id
          restyle()
        }, 90)
      }

      showTooltip(event, {
        ...d,
        connectionCount: visibleNeighbors(d.id).size,
      })
    })
    .on('mouseout', function(_event: any, d: GraphNode) {
      d3.select(this).attr('r', getNodeSize(d))
      if (hoverTimer) {
        clearTimeout(hoverTimer)
        hoverTimer = null
      }
      if (hoverNodeId.value !== null) {
        hoverNodeId.value = null
        restyle()
      }
      hideTooltip()
    })

  // Node labels live in their own layer above all circles, so a neighbor's
  // circle never paints over a name. The placement pass decides which show.
  labelLayer = g.append('g').attr('class', 'labels')
  nodeLabels = labelLayer
    .selectAll('text')
    .data(nodes)
    .enter()
    .append('text')
    .text((d: GraphNode) => d.name)
    .attr('x', 0)
    .attr('y', (d: GraphNode) => getNodeSize(d))
    .attr('dy', '1.05em')
    .attr('text-anchor', 'middle')
    .attr('class', 'node-label')
    .style('opacity', 0)

  // --- Force Simulation with layout-aware parameters ---
  const isLargeGraph = nodes.length > 500
  const isMediumGraph = nodes.length > 100 && nodes.length <= 500

  // Gravity matters: most graphs here are many small disconnected clusters,
  // and weak centering let them drift far apart (and off-screen).
  let chargeStrength = isLargeGraph ? -70 : isMediumGraph ? -140 : -260
  const chargeDistanceMax = isLargeGraph ? 300 : isMediumGraph ? 400 : 600
  let gravity = isLargeGraph ? 0.08 : isMediumGraph ? 0.07 : 0.05
  const collisionPadding = isLargeGraph ? 3 : isMediumGraph ? 5 : 8

  let hubIds: Set<number> | null = null

  if (layout === 'hierarchical') {
    const connectionCounts = new Map<number, number>()
    for (const n of nodes) connectionCounts.set(n.id, 0)
    for (const e of edges) {
      const sId = idOf(e.source)
      const tId = idOf(e.target)
      connectionCounts.set(sId, (connectionCounts.get(sId) || 0) + 1)
      connectionCounts.set(tId, (connectionCounts.get(tId) || 0) + 1)
    }
    const sorted = [...nodes].sort((a, b) =>
      (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0)
    )
    const hubCount = Math.max(2, Math.ceil(nodes.length * 0.05))
    hubIds = new Set(sorted.slice(0, hubCount).map(n => n.id))
  }

  if (layout === 'radial') {
    chargeStrength *= 0.3   // Light repulsion to keep rings tight
    gravity = 0             // Radial force handles positioning
  } else if (layout === 'hierarchical') {
    chargeStrength *= 0.6
    gravity = 0
  }

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges)
      .id((d: any) => d.id)
      .distance((d: any) => {
        if (layout === 'hierarchical' && hubIds) {
          const isHubLink = hubIds.has(d.source.id) && hubIds.has(d.target.id)
          return isHubLink ? 100 : 250
        }
        // Strong ties sit closer; leave room for both circles
        return getNodeSize(d.source) + getNodeSize(d.target) + 24 + 50 * (1 - Math.min(1, d.weight))
      })
      .strength((d: any) => {
        if (layout === 'radial') return Math.min(0.15, d.weight * 0.1)
        // d3 default: weaker pull on high-degree nodes so hubs do not collapse
        const degS = degreeOf(d.source.id)
        const degT = degreeOf(d.target.id)
        return 1 / Math.min(degS, degT)
      })
    )
    .force('charge', d3.forceManyBody()
      .strength(chargeStrength)
      .distanceMax(chargeDistanceMax)
      .distanceMin(10)
    )
    .force('collision', d3.forceCollide()
      .radius((d: any) => getNodeSize(d) + collisionPadding)
      .strength(0.9)
      .iterations(2)
    )

  if (layout === 'radial') {
    const typeOrder = ['person', 'organization', 'location', 'event', 'topic']
    const activeTypes = typeOrder.filter(t => nodes.some(n => n.type === t))
    const ringGap = Math.min(width, height) * 0.35 / Math.max(1, activeTypes.length)
    simulation.force('radial', d3.forceRadial(
      (d: any) => {
        const idx = activeTypes.indexOf(d.type)
        return ringGap * (idx >= 0 ? idx + 1 : activeTypes.length + 1)
      },
      width / 2,
      height / 2,
    ).strength(0.8))
  } else if (layout === 'hierarchical') {
    // Hubs toward center, non-hubs to periphery
    const hubR = Math.min(width, height) * 0.12
    const nonHubR = Math.min(width, height) * 0.38
    simulation.force('radial', d3.forceRadial(
      (d: any) => hubIds!.has(d.id) ? hubR : nonHubR,
      width / 2,
      height / 2,
    ).strength((d: any) => hubIds!.has(d.id) ? 0.6 : 0.2))
  } else {
    // Elliptical gravity: spread clusters along the longer screen axis
    simulation
      .force('x', d3.forceX(width / 2).strength(gravity * Math.sqrt(height / width)))
      .force('y', d3.forceY(height / 2).strength(gravity * Math.sqrt(width / height)))
  }

  simulation
    .alphaDecay(isLargeGraph ? 0.05 : 0.03)
    .velocityDecay(0.4)

  // --- Warmup: settle silently so the first frame is already readable ---
  const warmupTicks = isLargeGraph ? 120 : 220
  simulation.alpha(1).stop()
  for (let i = 0; i < warmupTicks; i++) {
    simulation.tick()
  }

  // Dashed ring guides for radial layout
  if (layout === 'radial') {
    const typeOrder = ['person', 'organization', 'location', 'event', 'topic']
    const activeTypes = typeOrder.filter(t => nodes.some(n => n.type === t))
    const ringGap = Math.min(width, height) * 0.35 / Math.max(1, activeTypes.length)
    for (let i = 0; i < activeTypes.length; i++) {
      g.insert('circle', ':first-child')
        .attr('cx', width / 2)
        .attr('cy', height / 2)
        .attr('r', ringGap * (i + 1))
        .attr('fill', 'none')
        .style('stroke', 'var(--color-rule, #cbd5e1)')
        .attr('stroke-dasharray', '4 6')
        .attr('opacity', 0.5)
        .attr('class', 'ring-guide')
    }
  }

  const renderPositions = () => {
    linkSelection!
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y)

    linkLabelSelection
      ?.attr('x', (d: any) => (d.source.x + d.target.x) / 2)
      .attr('y', (d: any) => (d.source.y + d.target.y) / 2)

    nodeSelection!.attr('transform', (d: GraphNode) => `translate(${d.x},${d.y})`)
    nodeLabels!.attr('transform', (d: GraphNode) => `translate(${d.x},${d.y})`)
  }

  renderPositions()

  // Frame the settled graph immediately instead of starting at an arbitrary zoom
  updateVisibility()
  fitToView(0)

  // Throttled ticks for the remaining gentle settling
  let lastUpdate = Date.now()
  const UPDATE_INTERVAL = 50

  simulation.on('tick', () => {
    const now = Date.now()
    if (now - lastUpdate > UPDATE_INTERVAL || simulation!.alpha() < 0.01) {
      lastUpdate = now
      renderPositions()
      scheduleMinimapDraw()
    }

    if (simulation && simulation.alpha() < 0.005) {
      simulation.stop()
      renderPositions()
      // Re-frame once after the first settle, unless the user already took over
      if (!hasAutoFitted && !userMovedView) fitToView(400)
      hasAutoFitted = true
      updateLabelVisibility()
      scheduleMinimapDraw()
    }
  })

  simulation.alpha(0.3).restart()

  // Keep the overview framing; the search match is focused, not zoomed to
  if (props.searchHighlight) {
    applySearchHighlight(props.searchHighlight, false)
  }

  function dragstarted(event: any, d: GraphNode) {
    if (!event.active) simulation?.alphaTarget(0.2).restart()
    d.fx = d.x
    d.fy = d.y
    hideTooltip()
  }

  function dragged(event: any, d: GraphNode) {
    d.fx = event.x
    d.fy = event.y
  }

  function dragended(event: any, d: GraphNode) {
    if (!event.active) simulation?.alphaTarget(0)
    // The ego center stays anchored
    if (d.id !== props.highlightNodeId || layout !== 'force') {
      d.fx = null
      d.fy = null
    }
    updateLabelVisibility()
  }
}

// Degree among all loaded edges (used for link strength)
let degreeCache = new Map<number, number>()
function degreeOf(id: number): number {
  if (degreeCache.size === 0) {
    for (const e of allEdges) {
      const s = idOf(e.source)
      const t = idOf(e.target)
      degreeCache.set(s, (degreeCache.get(s) || 0) + 1)
      degreeCache.set(t, (degreeCache.get(t) || 0) + 1)
    }
  }
  return degreeCache.get(id) || 1
}

let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null

function showTooltip(event: any, data: any) {
  // Touch screens emulate hover on tap; the focus panel covers that case
  if (window.matchMedia?.('(hover: none)').matches) return
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
  // Flip to the other side near the right/bottom viewport edges
  const tipW = 330
  const tipH = 170
  const x = event.clientX + tipW + 16 > window.innerWidth ? event.clientX - tipW - 12 : event.clientX + 12
  const y = event.clientY + tipH > window.innerHeight ? event.clientY - tipH : event.clientY - 10
  tooltip.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    data,
  }
}

function hideTooltip() {
  if (tooltipHideTimer) clearTimeout(tooltipHideTimer)
  tooltipHideTimer = setTimeout(() => {
    tooltip.value.visible = false
    tooltipHideTimer = null
  }, 200)
}

function onTooltipEnter() {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
}

function onTooltipLeave() {
  tooltip.value.visible = false
}

function reinit() {
  degreeCache = new Map()
  nextTick(() => initGraph())
}

onMounted(() => {
  reinit()
})

// Reinitialize when data changes
watch(() => [props.data?.nodes.length, props.data?.edges.length], (newVal, oldVal) => {
  if (newVal[0] !== oldVal?.[0] || newVal[1] !== oldVal?.[1]) {
    if (pinnedEgoNodeId.value !== null) {
      pinnedEgoNodeId.value = null
      emit('nodeSelect', null)
    }
    reinit()
  }
})

// Reinitialize when dimensions change (e.g. fullscreen toggle)
watch(() => [props.width, props.height], (newVal, oldVal) => {
  if (newVal[0] !== oldVal?.[0] || newVal[1] !== oldVal?.[1]) {
    reinit()
  }
})

watch(() => props.highlightNodeId, () => {
  reinit()
})

watch(() => props.layout, () => {
  if (pinnedEgoNodeId.value !== null) {
    pinnedEgoNodeId.value = null
    emit('nodeSelect', null)
  }
  reinit()
})

watch(() => props.minCooccurrence, () => {
  updateVisibility()
})

watch(() => props.searchHighlight, (newVal) => {
  applySearchHighlight(newVal || null)
})

watch(() => props.showMinimap, (val) => {
  if (val) {
    nextTick(() => drawMinimap())
  }
})

// Shared hiddenEntityTypes changed (legend or toolbar)
watch(hiddenEntityTypes, () => {
  updateVisibility()
  // Reheat so remaining nodes spread into the freed space
  if (simulation) {
    simulation.alpha(0.3).restart()
  }
})

// Cleanup - dispose of D3 resources to prevent memory leaks
onBeforeUnmount(() => {
  if (simulation) {
    simulation.stop()
    simulation = null
  }
  if (svg) {
    svg.selectAll('*').remove()
    svg.remove()
    svg = null
  }
  zoom = null
  linkSelection = null
  labelLayer = null
  nodeSelection = null
  linkLabelSelection = null
  nodeLabels = null
  allEdges = []
  allNodes = []
  nodeById = new Map()
  tooltip.value.visible = false
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
  if (minimapTimer) {
    clearTimeout(minimapTimer)
    minimapTimer = null
  }
})
</script>

<style scoped>
.entity-network-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-paper, #f7f5ef);
  border-radius: 8px;
  overflow: hidden;
}

.graph-canvas {
  width: 100%;
  height: 100%;
}

/* D3-created elements carry no scoped attribute, hence :deep() */
.graph-canvas :deep(.network-svg) {
  display: block;
  background: var(--color-paper, #f7f5ef);
  cursor: grab;
}

.graph-canvas :deep(.network-svg:active) {
  cursor: grabbing;
}

.graph-canvas :deep(.edge) {
  cursor: pointer;
}

.graph-canvas :deep(.node) {
  cursor: pointer;
}

.graph-canvas :deep(.node circle) {
  transition: r 0.12s ease-out;
}

.graph-canvas :deep(.node-label) {
  font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  font-weight: 500;
  font-size: calc(11px * var(--inv-k, 1));
  fill: var(--color-ink-2, #3b352a);
  /* Halo so names stay legible over lines */
  stroke: var(--color-paper, #f7f5ef);
  stroke-width: calc(3px * var(--inv-k, 1));
  stroke-linejoin: round;
  paint-order: stroke;
  pointer-events: none;
  user-select: none;
  transition: opacity 0.15s;
}

.graph-canvas :deep(.node-label-strong) {
  font-weight: 700;
  fill: var(--color-ink, #17140e);
}

.graph-canvas :deep(.edge-label) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px;
  fill: var(--color-ink-3, #6b6353);
  stroke: var(--color-paper, #f7f5ef);
  stroke-width: 2.5px;
  paint-order: stroke;
  pointer-events: none;
  user-select: none;
}

.tooltip {
  position: fixed;
  z-index: 1000;
  pointer-events: auto;
}

.tooltip-content {
  background: #1c1a16;
  color: #f7f5ef;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  min-width: 200px;
  max-width: 320px;
}

.tooltip-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
}

.tooltip-image {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: #3b352a;
}

.tooltip-type {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #c4bfae;
  margin-bottom: 2px;
}

.tooltip-type-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.tooltip-name {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.3;
}

.tooltip-description {
  font-size: 12px;
  color: #a8a291;
  margin-top: 4px;
  line-height: 1.4;
}

.tooltip-meta {
  font-size: 12px;
  color: #d9d3c3;
  margin-top: 3px;
}

.tooltip-hint {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid #3b352a;
  font-size: 11px;
  color: #9a9080;
}

/* Minimap canvas */
.minimap-canvas {
  position: absolute;
  bottom: 12px;
  right: 12px;
  border-radius: 6px;
  border: 1px solid var(--color-rule, #d9d3c3);
  background: color-mix(in srgb, var(--color-panel, #fff) 70%, transparent);
  backdrop-filter: blur(8px);
  cursor: pointer;
  z-index: 10;
}

@media (max-width: 768px) {
  .minimap-canvas {
    display: none;
  }
}

.graph-legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: color-mix(in srgb, var(--color-panel, #fff) 92%, transparent);
  backdrop-filter: blur(4px);
  border: 1px solid var(--color-rule, #d9d3c3);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 11px;
  color: var(--color-ink-2, #3b352a);
  line-height: 1.5;
  z-index: 10;
  max-width: 180px;
}

.legend-title {
  font-weight: 600;
  margin-bottom: 4px;
  font-size: 12px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 0;
}

.legend-row-interactive {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
  margin: 0 -4px;
}

.legend-row-interactive:hover {
  background: var(--color-paper-2, #eeebe2);
}

.legend-disabled {
  opacity: 0.4;
}

.legend-strikethrough {
  text-decoration: line-through;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.2s;
}

.legend-line {
  width: 16px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-divider {
  height: 1px;
  background: var(--color-rule, #d9d3c3);
  margin: 5px 0;
}

.legend-hint {
  margin-top: 5px;
  font-size: 10px;
  color: var(--color-ink-4, #9a9080);
  line-height: 1.4;
}
</style>
