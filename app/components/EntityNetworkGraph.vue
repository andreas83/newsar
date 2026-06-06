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
      <div class="legend-row">
        <span class="legend-line" style="background: #22c55e"></span> Similar sentiment
      </div>
      <div class="legend-row">
        <span class="legend-line" style="background: #ef4444"></span> Different sentiment
      </div>
      <div class="legend-row">
        <span class="legend-line" style="background: #cbd5e1"></span> Neutral
      </div>
      <div class="legend-hint">
        Node size = trending score<br>
        Edge numbers = shared articles<br>
        Hover node to highlight neighbors<br>
        Click node to pin highlight<br>
        Double-click to view details
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
          <div>
            <div class="flex items-center gap-1.5">
              <Badge :color="getEntityColor(tooltip.data.type)">{{ tooltip.data.type }}</Badge>
              <span class="tooltip-name">{{ tooltip.data.name }}</span>
            </div>
            <div v-if="tooltip.data.shortDescription" class="tooltip-description">
              {{ tooltip.data.shortDescription.length > 120 ? tooltip.data.shortDescription.slice(0, 120) + '...' : tooltip.data.shortDescription }}
            </div>
          </div>
        </div>
        <div v-if="tooltip.data.trendingScore !== undefined" class="tooltip-meta">
          Trending: {{ (tooltip.data.trendingScore * 100).toFixed(1) }}%
        </div>
        <div v-if="tooltip.data.connectionCount !== undefined" class="tooltip-meta">
          Connections: {{ tooltip.data.connectionCount }}
        </div>
        <div v-if="tooltip.data.weight !== undefined" class="tooltip-meta">
          Strength: {{ tooltip.data.weight }}
        </div>
        <div v-if="tooltip.data.sentiment" class="tooltip-meta">
          {{ tooltip.data.sentiment }}
        </div>
        <a
          v-if="tooltip.data.type && tooltip.data.type !== 'edge' && tooltip.data.slug"
          class="tooltip-link"
          :href="`/${tooltip.data.type}/${tooltip.data.slug}`"
          @click.prevent="navigateTo(`/${tooltip.data.type}/${tooltip.data.slug}`)"
        >
          Go to entity &rarr;
        </a>
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

// Module-scope D3 selections (prerequisite refactor)
let linkSelection: d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown> | null = null
let nodeSelection: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null = null
let linkLabelSelection: d3.Selection<SVGTextElement, GraphEdge, SVGGElement, unknown> | null = null
let nodeLabels: d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown> | null = null
let allEdges: GraphEdge[] = []
let allNodes: GraphNode[] = []
let gSelection: d3.Selection<SVGGElement, unknown, null, undefined> | null = null

// Ego network highlighting state
const pinnedEgoNodeId = ref<number | null>(null)
const activeEgoNodeId = ref<number | null>(null)
const neighborSet = ref<Set<number>>(new Set())

// Shared filter state — same ref used by parent page
const { hiddenEntityTypes, isTypeHidden, toggleEntityType: toggleType } = useNetworkFilters()
const hiddenTypes = computed(() => new Set(hiddenEntityTypes.value))

// Label collision state
let currentZoomScale = 1.0
let currentTransform: d3.ZoomTransform = d3.zoomIdentity

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

function getEntityColor(type: string): 'blue' | 'green' | 'orange' | 'purple' | 'teal' {
  const colorMap: Record<string, 'blue' | 'green' | 'orange' | 'purple' | 'teal'> = {
    person: 'blue',
    organization: 'green',
    location: 'orange',
    event: 'purple',
    topic: 'teal',
  }
  return colorMap[type] || 'blue'
}

function getNodeSize(node: GraphNode): number {
  const minSize = props.minNodeSize || 4
  const maxSize = props.maxNodeSize || 20

  // Size based on trending score
  const size = minSize + (node.trendingScore * (maxSize - minSize))
  return Math.max(minSize, Math.min(maxSize, size))
}

// --- Exposed Methods ---

function fitToView() {
  if (!svg || !zoom || !allNodes.length) return
  const width = props.width || graphContainer.value?.clientWidth || 800
  const height = props.height || graphContainer.value?.clientHeight || 600

  const hidden = hiddenTypes.value
  const visibleNodes = allNodes.filter(n => !hidden.has(n.type) && n.x !== undefined && n.y !== undefined)
  if (!visibleNodes.length) return

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of visibleNodes) {
    const r = getNodeSize(n)
    if (n.x! - r < minX) minX = n.x! - r
    if (n.y! - r < minY) minY = n.y! - r
    if (n.x! + r > maxX) maxX = n.x! + r
    if (n.y! + r > maxY) maxY = n.y! + r
  }

  const padding = 40
  const bw = maxX - minX + padding * 2
  const bh = maxY - minY + padding * 2
  const scale = Math.min(width / bw, height / bh, 2)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const transform = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-cx, -cy)

  svg.transition().duration(500).call(zoom.transform, transform)
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
  if (!svg || !zoom) return
  svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
}

defineExpose({ fitToView, zoomIn, zoomOut, resetZoom })

// --- Ego Network Helpers ---

function getNeighborIds(nodeId: number, edges: GraphEdge[]): Set<number> {
  const neighbors = new Set<number>([nodeId])
  for (const e of edges) {
    const sourceId = typeof e.source === 'number' ? e.source : (e.source as GraphNode).id
    const targetId = typeof e.target === 'number' ? e.target : (e.target as GraphNode).id
    if (sourceId === nodeId) neighbors.add(targetId)
    if (targetId === nodeId) neighbors.add(sourceId)
  }
  return neighbors
}

function applyEgoHighlight(nodeId: number | null) {
  if (!linkSelection || !nodeSelection || !nodeLabels) return

  if (nodeId !== null) {
    const nSet = getNeighborIds(nodeId, allEdges)
    activeEgoNodeId.value = nodeId
    neighborSet.value = nSet

    // Dim non-neighbor nodes
    nodeSelection.select('circle')
      .transition().duration(200)
      .style('opacity', (d: GraphNode) => nSet.has(d.id) ? 1 : 0.1)
      .attr('stroke', (d: GraphNode) => {
        if (d.id === nodeId) return '#fbbf24'
        return '#fff'
      })
      .attr('stroke-width', (d: GraphNode) => {
        if (d.id === nodeId) return 4
        return 2
      })

    // Dim non-connecting edges
    linkSelection
      .transition().duration(200)
      .style('opacity', (d: GraphEdge) => {
        const sourceId = typeof d.source === 'number' ? d.source : (d.source as GraphNode).id
        const targetId = typeof d.target === 'number' ? d.target : (d.target as GraphNode).id
        return (sourceId === nodeId || targetId === nodeId) ? 0.6 : 0.05
      })

    // Dim edge labels
    if (linkLabelSelection) {
      linkLabelSelection
        .transition().duration(200)
        .style('opacity', (d: GraphEdge) => {
          const sourceId = typeof d.source === 'number' ? d.source : (d.source as GraphNode).id
          const targetId = typeof d.target === 'number' ? d.target : (d.target as GraphNode).id
          return (sourceId === nodeId || targetId === nodeId) ? 1 : 0.05
        })
    }

    // Force-show labels for neighbors during ego highlight
    nodeLabels
      .transition().duration(200)
      .style('opacity', (d: GraphNode) => nSet.has(d.id) ? 1 : 0)
  } else {
    activeEgoNodeId.value = null
    neighborSet.value = new Set()

    // Restore nodes
    nodeSelection.select('circle')
      .transition().duration(200)
      .style('opacity', 1)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)

    // Restore edges
    linkSelection
      .transition().duration(200)
      .style('opacity', (d: GraphEdge) => {
        const baseOpacity = allNodes.length > 500 ? 0.15 : 0.4
        return Math.min(baseOpacity, d.weight * 0.6)
      })

    // Restore edge labels
    if (linkLabelSelection) {
      linkLabelSelection
        .transition().duration(200)
        .style('opacity', 1)
    }

    // Restore labels via collision system
    updateLabelVisibility()
  }
}

// --- Unified Visibility (shared by edge-weight filter + legend toggle) ---

function updateVisibility() {
  if (!linkSelection || !nodeSelection) return

  const minCo = props.minCooccurrence ?? 1
  const hidden = hiddenTypes.value

  // Track which nodes have at least one visible edge
  const nodesWithVisibleEdges = new Set<number>()

  // Update edge visibility
  linkSelection.each(function(d: GraphEdge) {
    const sourceNode = d.source as GraphNode
    const targetNode = d.target as GraphNode
    const sourceId = typeof d.source === 'number' ? d.source : sourceNode.id
    const targetId = typeof d.target === 'number' ? d.target : targetNode.id
    const sourceType = typeof d.source === 'number' ? '' : sourceNode.type
    const targetType = typeof d.target === 'number' ? '' : targetNode.type

    const hiddenByType = hidden.has(sourceType) || hidden.has(targetType)
    const hiddenByWeight = d.cooccurrenceCount < minCo
    const isHidden = hiddenByType || hiddenByWeight

    d3.select(this).style('display', isHidden ? 'none' : null)

    if (!isHidden) {
      nodesWithVisibleEdges.add(sourceId)
      nodesWithVisibleEdges.add(targetId)
    }
  })

  // Update edge label visibility
  if (linkLabelSelection) {
    linkLabelSelection.each(function(d: GraphEdge) {
      const sourceNode = d.source as GraphNode
      const targetNode = d.target as GraphNode
      const sourceType = typeof d.source === 'number' ? '' : sourceNode.type
      const targetType = typeof d.target === 'number' ? '' : targetNode.type

      const hiddenByType = hidden.has(sourceType) || hidden.has(targetType)
      const hiddenByWeight = d.cooccurrenceCount < minCo
      d3.select(this).style('display', (hiddenByType || hiddenByWeight) ? 'none' : null)
    })
  }

  // Update node visibility: hidden if type is hidden, or orphaned (no visible edges)
  let visibleNodes = 0
  let visibleEdges = 0

  nodeSelection.each(function(d: GraphNode) {
    const hiddenByType = hidden.has(d.type)
    const isOrphan = !hiddenByType && !nodesWithVisibleEdges.has(d.id)
    const isHidden = hiddenByType || isOrphan
    d3.select(this).style('display', isHidden ? 'none' : null)
    if (!isHidden) visibleNodes++
  })

  // Count visible edges
  linkSelection.each(function() {
    if (d3.select(this).style('display') !== 'none') visibleEdges++
  })

  emit('update:visibleStats', { visibleNodes, visibleEdges })

  // Update labels after visibility change
  updateLabelVisibility()
  scheduleMinimapDraw()
}

// --- Label Collision Prevention ---

function updateLabelVisibility() {
  if (!nodeLabels || !allNodes.length) return

  // If ego highlight is active, that controls labels
  if (activeEgoNodeId.value !== null) return

  const zoomScale = currentZoomScale
  const hidden = hiddenTypes.value

  // Trending threshold based on zoom: at 1x show top ~10%, at 2x ~30%, at 4x+ show all
  const trendingThreshold = Math.max(0, 0.4 - zoomScale * 0.15)

  // Collect candidates with positions
  interface LabelCandidate {
    node: GraphNode
    x: number
    y: number
    width: number
    height: number
    show: boolean
  }

  const candidates: LabelCandidate[] = []
  const placed: LabelCandidate[] = []

  allNodes.forEach(n => {
    if (hidden.has(n.type)) return
    if (n.x === undefined || n.y === undefined) return
    if (n.trendingScore < trendingThreshold) return

    const textWidth = (n.name.length * 6) / zoomScale
    const textHeight = 12 / zoomScale
    candidates.push({
      node: n,
      x: n.x - textWidth / 2,
      y: n.y + getNodeSize(n) + 12 - textHeight / 2,
      width: textWidth,
      height: textHeight,
      show: false,
    })
  })

  // Sort by trending score descending (highest priority first)
  candidates.sort((a, b) => b.node.trendingScore - a.node.trendingScore)

  // Greedy AABB occlusion: place labels one by one
  for (const c of candidates) {
    let overlaps = false
    for (const p of placed) {
      if (
        c.x < p.x + p.width &&
        c.x + c.width > p.x &&
        c.y < p.y + p.height &&
        c.y + c.height > p.y
      ) {
        overlaps = true
        break
      }
    }
    if (!overlaps) {
      c.show = true
      placed.push(c)
    }
  }

  // Build lookup of which nodes to show
  const showSet = new Set(placed.map(c => c.node.id))

  nodeLabels
    .style('opacity', (d: GraphNode) => showSet.has(d.id) ? 1 : 0)
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

function drawMinimap() {
  const canvas = minimapCanvas.value
  if (!canvas || !allNodes.length) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  const hidden = hiddenTypes.value

  // Compute bounding box of all nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of allNodes) {
    if (hidden.has(n.type) || n.x === undefined || n.y === undefined) continue
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x > maxX) maxX = n.x
    if (n.y > maxY) maxY = n.y
  }

  if (minX === Infinity) return

  const padding = 20
  minX -= padding; minY -= padding
  maxX += padding; maxY += padding
  const bw = maxX - minX || 1
  const bh = maxY - minY || 1
  const scale = Math.min(w / bw, h / bh)

  const isDark = document.documentElement.classList.contains('dark')
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = isDark ? 'rgba(15,23,42,0.6)' : 'rgba(248,250,252,0.6)'
  ctx.fillRect(0, 0, w, h)

  // Draw nodes as dots
  for (const n of allNodes) {
    if (hidden.has(n.type) || n.x === undefined || n.y === undefined) continue
    const mx = (n.x - minX) * scale
    const my = (n.y - minY) * scale
    ctx.fillStyle = entityColors[n.type] || '#6b7280'
    ctx.beginPath()
    ctx.arc(mx, my, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // Draw viewport rectangle
  if (svg && graphContainer.value) {
    const svgW = props.width || graphContainer.value.clientWidth
    const svgH = props.height || graphContainer.value.clientHeight

    // Current viewport in graph coordinates
    const t = currentTransform
    const vx1 = (0 - t.x) / t.k
    const vy1 = (0 - t.y) / t.k
    const vx2 = (svgW - t.x) / t.k
    const vy2 = (svgH - t.y) / t.k

    const rx = (vx1 - minX) * scale
    const ry = (vy1 - minY) * scale
    const rw = (vx2 - vx1) * scale
    const rh = (vy2 - vy1) * scale

    ctx.strokeStyle = isDark ? 'rgba(147,197,253,0.6)' : 'rgba(59,130,246,0.5)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(rx, ry, rw, rh)
    ctx.fillStyle = isDark ? 'rgba(147,197,253,0.08)' : 'rgba(59,130,246,0.06)'
    ctx.fillRect(rx, ry, rw, rh)
  }
}

function onMinimapClick(event: MouseEvent) {
  if (!svg || !zoom || !allNodes.length || !minimapCanvas.value) return

  const canvas = minimapCanvas.value
  const rect = canvas.getBoundingClientRect()
  const mx = event.clientX - rect.left
  const my = event.clientY - rect.top
  const w = canvas.width
  const h = canvas.height
  const hidden = hiddenTypes.value

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of allNodes) {
    if (hidden.has(n.type) || n.x === undefined || n.y === undefined) continue
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x > maxX) maxX = n.x
    if (n.y > maxY) maxY = n.y
  }
  if (minX === Infinity) return

  const padding = 20
  minX -= padding; minY -= padding
  maxX += padding; maxY += padding
  const bw = maxX - minX || 1
  const bh = maxY - minY || 1
  const scale = Math.min(w / bw, h / bh)

  // Convert minimap click to graph coordinates
  const gx = mx / scale + minX
  const gy = my / scale + minY

  const svgW = props.width || graphContainer.value?.clientWidth || 800
  const svgH = props.height || graphContainer.value?.clientHeight || 600

  const transform = d3.zoomIdentity
    .translate(svgW / 2, svgH / 2)
    .scale(currentTransform.k)
    .translate(-gx, -gy)

  svg.transition().duration(300).call(zoom.transform, transform)
}

// --- Search Highlight ---

function applySearchHighlight(query: string | null) {
  if (!nodeSelection || !nodeLabels || !linkSelection) return

  if (!query || !query.trim()) {
    // Clear: restore from ego or default state
    if (pinnedEgoNodeId.value !== null) {
      applyEgoHighlight(pinnedEgoNodeId.value)
    } else {
      applyEgoHighlight(null)
    }
    return
  }

  const q = query.toLowerCase()
  const matches = allNodes.filter(n => n.name.toLowerCase().includes(q))

  if (matches.length === 0) return

  if (matches.length === 1) {
    // Single match: ego-highlight + pan to node
    const match = matches[0]
    pinnedEgoNodeId.value = match.id
    applyEgoHighlight(match.id)

    // Pan to node
    if (svg && zoom && match.x !== undefined && match.y !== undefined) {
      const svgW = props.width || graphContainer.value?.clientWidth || 800
      const svgH = props.height || graphContainer.value?.clientHeight || 600

      const transform = d3.zoomIdentity
        .translate(svgW / 2, svgH / 2)
        .scale(Math.max(currentZoomScale, 1.5))
        .translate(-match.x, -match.y)

      svg.transition().duration(500).call(zoom.transform, transform)
    }
  } else {
    // Multiple matches: dim non-matching nodes
    const matchIds = new Set(matches.map(m => m.id))
    activeEgoNodeId.value = null

    nodeSelection.select('circle')
      .transition().duration(200)
      .style('opacity', (d: GraphNode) => matchIds.has(d.id) ? 1 : 0.1)
      .attr('stroke', (d: GraphNode) => matchIds.has(d.id) ? '#fbbf24' : '#fff')
      .attr('stroke-width', (d: GraphNode) => matchIds.has(d.id) ? 3 : 2)

    linkSelection
      .transition().duration(200)
      .style('opacity', 0.05)

    if (linkLabelSelection) {
      linkLabelSelection
        .transition().duration(200)
        .style('opacity', 0.05)
    }

    nodeLabels
      .transition().duration(200)
      .style('opacity', (d: GraphNode) => matchIds.has(d.id) ? 1 : 0)
  }
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
      const sId = typeof e.source === 'number' ? e.source : (e.source as GraphNode).id
      const tId = typeof e.target === 'number' ? e.target : (e.target as GraphNode).id
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
    // 'force' layout: random positions
    nodes.forEach((node) => {
      node.x = Math.random() * width
      node.y = Math.random() * height
    })
  }
}

function initGraph() {
  if (!graphContainer.value || !props.data) return

  const width = props.width || graphContainer.value.clientWidth
  const height = props.height || graphContainer.value.clientHeight

  // Clear existing SVG and stop previous simulation FIRST
  if (simulation) {
    simulation.stop()
    simulation = null
  }
  d3.select(graphContainer.value).selectAll('*').remove()

  // Reset module-scope selections
  linkSelection = null
  nodeSelection = null
  linkLabelSelection = null
  nodeLabels = null

  // Make a shallow copy of nodes to avoid mutating props
  const nodes = props.data.nodes.map(n => ({ ...n }))
  const edges = props.data.edges.map(e => ({ ...e }))

  // Store as module-scope references
  allNodes = nodes
  allEdges = edges

  // Compute initial positions based on layout strategy
  const layout = props.layout || 'force'
  computeInitialPositions(nodes, edges, width, height, layout)
  nodes.forEach((node) => {
    node.fx = null
    node.fy = null
  })

  // Create SVG
  svg = d3.select(graphContainer.value)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('class', 'network-svg')

  const g = svg.append('g')
  gSelection = g

  // Setup zoom
  currentZoomScale = 1.0
  currentTransform = d3.zoomIdentity
  let lastLabelZoomScale = 1.0

  zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 10])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
      currentZoomScale = event.transform.k
      currentTransform = event.transform

      // Update labels if zoom changed significantly
      if (Math.abs(currentZoomScale - lastLabelZoomScale) > 0.1) {
        lastLabelZoomScale = currentZoomScale
        updateLabelVisibility()
      }

      scheduleMinimapDraw()
    })

  svg.call(zoom)

  // Click on SVG background to clear ego pin
  svg.on('click', (event: any) => {
    // Only if clicking the SVG itself (not a node)
    if (event.target.tagName === 'svg' || event.target.tagName === 'rect') {
      pinnedEgoNodeId.value = null
      applyEgoHighlight(null)
    }
  })

  // Create links
  linkSelection = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(edges)
    .enter()
    .append('line')
    .attr('class', 'edge')
    .attr('stroke', (d: GraphEdge) => {
      const isDark = document.documentElement.classList.contains('dark')
      const sc = d.sentimentCorrelation
      if (sc !== null && sc > 0.3) return isDark ? '#4ade80' : '#22c55e' // green
      if (sc !== null && sc < -0.3) return isDark ? '#f87171' : '#ef4444' // red
      return isDark ? '#64748b' : '#cbd5e1' // neutral gray
    })
    .attr('stroke-opacity', (d: GraphEdge) => {
      const baseOpacity = nodes.length > 500 ? 0.15 : 0.4
      return Math.min(baseOpacity, d.weight * 0.6)
    })
    .attr('stroke-width', (d: GraphEdge) => {
      return Math.max(0.5, d.weight * 3)
    })
    .on('click', (_event: any, d: GraphEdge) => {
      emit('edgeClick', d)
    })
    .on('mouseover', function(event: any, d: GraphEdge) {
      d3.select(this)
        .attr('stroke', '#1e293b')
        .attr('stroke-opacity', 1)

      const sourceName = typeof d.source === 'object' ? (d.source as GraphNode).name : '?'
      const targetName = typeof d.target === 'object' ? (d.target as GraphNode).name : '?'
      const sentimentLabel = d.sentimentCorrelation !== null
        ? (d.sentimentCorrelation > 0.3 ? 'Discussed similarly' : d.sentimentCorrelation < -0.3 ? 'Discussed differently' : 'Neutral sentiment')
        : null

      showTooltip(event, {
        type: 'edge',
        name: `${sourceName} \u2014 ${targetName}`,
        weight: `${d.cooccurrenceCount} article${d.cooccurrenceCount !== 1 ? 's' : ''} mention both`,
        sentiment: sentimentLabel,
      })
    })
    .on('mouseout', function(_event: any, d: GraphEdge) {
      const isDark = document.documentElement.classList.contains('dark')
      const sc = d.sentimentCorrelation
      let originalColor = isDark ? '#64748b' : '#cbd5e1'
      if (sc !== null && sc > 0.3) originalColor = isDark ? '#4ade80' : '#22c55e'
      else if (sc !== null && sc < -0.3) originalColor = isDark ? '#f87171' : '#ef4444'

      d3.select(this)
        .attr('stroke', originalColor)
        .attr('stroke-opacity', 0.6)

      hideTooltip()
    })

  // Edge labels (only for small graphs to avoid clutter)
  const showEdgeLabels = edges.length <= 60
  if (showEdgeLabels) {
    linkLabelSelection = g.append('g')
      .attr('class', 'edge-labels')
      .selectAll('text')
      .data(edges)
      .enter()
      .append('text')
      .text((d: GraphEdge) => String(d.cooccurrenceCount))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .style('font-size', '9px')
      .style('fill', '#64748b')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
  }

  // Create nodes
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

  // Node circles
  nodeSelection.append('circle')
    .attr('r', (d: GraphNode) => {
      if (props.highlightNodeId != null && d.id === props.highlightNodeId) return getNodeSize(d) * 1.5
      return getNodeSize(d)
    })
    .attr('fill', (d: GraphNode) => entityColors[d.type] || entityColors.person)
    .attr('stroke', (d: GraphNode) => {
      if (props.highlightNodeId != null && d.id === props.highlightNodeId) return '#fbbf24'
      return '#fff'
    })
    .attr('stroke-width', (d: GraphNode) => {
      if (props.highlightNodeId != null && d.id === props.highlightNodeId) return 4
      return 2
    })
    .style('opacity', (d: GraphNode) => {
      if (props.highlightNodeId != null && d.id !== props.highlightNodeId) return 0.6
      return 1
    })
    .style('cursor', 'pointer')
    .on('click', (event: any, d: GraphNode) => {
      event.stopPropagation() // prevent SVG background click handler
      // Single click: toggle ego pin only
      if (pinnedEgoNodeId.value === d.id) {
        pinnedEgoNodeId.value = null
        applyEgoHighlight(null)
      } else {
        pinnedEgoNodeId.value = d.id
        applyEgoHighlight(d.id)
      }
    })
    .on('dblclick', (event: any, d: GraphNode) => {
      event.stopPropagation()
      // Double-click: open entity details
      emit('nodeClick', d)
    })
    .on('mouseover', function(event: any, d: GraphNode) {
      // Ego highlight on hover (if no pinned node)
      if (pinnedEgoNodeId.value === null) {
        applyEgoHighlight(d.id)
      }

      // Enlarge hovered node circle
      d3.select(this)
        .attr('r', getNodeSize(d) * 1.5)

      showTooltip(event, {
        ...d,
        connectionCount: allEdges.filter(
          e => (typeof e.source === 'number' ? e.source : (e.source as GraphNode).id) === d.id ||
               (typeof e.target === 'number' ? e.target : (e.target as GraphNode).id) === d.id
        ).length
      })
    })
    .on('mouseout', function(_event: any, d: GraphNode) {
      // Restore ego highlight on mouseout (if no pinned node)
      if (pinnedEgoNodeId.value === null) {
        applyEgoHighlight(null)
      }

      d3.select(this)
        .attr('r', getNodeSize(d))

      hideTooltip()
    })

  // Node labels - start with opacity 0, collision system manages visibility
  nodeLabels = nodeSelection.append('text')
    .text((d: GraphNode) => d.name)
    .attr('x', 0)
    .attr('y', (d: GraphNode) => getNodeSize(d) + 12)
    .attr('text-anchor', 'middle')
    .attr('class', 'node-label')
    .style('font-size', '10px')
    .style('fill', '#1e293b')
    .style('pointer-events', 'none')
    .style('user-select', 'none')
    .style('opacity', 0)

  // --- Force Simulation with layout-aware parameters ---
  const isLargeGraph = nodes.length > 500
  const isMediumGraph = nodes.length > 100 && nodes.length <= 500

  let chargeStrength = isLargeGraph ? -800 : isMediumGraph ? -1500 : -2500
  let chargeDistanceMax = isLargeGraph ? 600 : isMediumGraph ? 800 : 1000
  let baseLinkDistance = isLargeGraph ? 180 : isMediumGraph ? 300 : 400
  let centerStrength = isLargeGraph ? 0.01 : isMediumGraph ? 0.008 : 0.005
  const collisionPadding = isLargeGraph ? 25 : isMediumGraph ? 35 : 50

  // Connection counts for hierarchical layout
  let connectionCounts: Map<number, number> | null = null
  let hubIds: Set<number> | null = null

  if (layout === 'hierarchical') {
    connectionCounts = new Map<number, number>()
    for (const n of nodes) connectionCounts.set(n.id, 0)
    for (const e of edges) {
      const sId = typeof e.source === 'number' ? e.source : (e.source as GraphNode).id
      const tId = typeof e.target === 'number' ? e.target : (e.target as GraphNode).id
      connectionCounts.set(sId, (connectionCounts.get(sId) || 0) + 1)
      connectionCounts.set(tId, (connectionCounts.get(tId) || 0) + 1)
    }
    const sorted = [...nodes].sort((a, b) =>
      (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0)
    )
    const hubCount = Math.max(2, Math.ceil(nodes.length * 0.05))
    hubIds = new Set(sorted.slice(0, hubCount).map(n => n.id))
  }

  // Tune forces per layout
  if (layout === 'radial') {
    chargeStrength *= 0.15             // Near-zero repulsion to keep rings tight
    centerStrength *= 0.5              // Weak centering — radial force handles this
  } else if (layout === 'hierarchical') {
    chargeStrength *= 0.3              // Moderate repulsion
    centerStrength *= 1.5              // Stronger center pull for hubs
  }

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges)
      .id((d: any) => d.id)
      .distance((d: any) => {
        if (layout === 'hierarchical' && hubIds) {
          const sId = typeof d.source === 'number' ? d.source : d.source.id
          const tId = typeof d.target === 'number' ? d.target : d.target.id
          const isHubLink = hubIds.has(sId) && hubIds.has(tId)
          if (isHubLink) return 100
          return 250
        }
        return Math.min(baseLinkDistance, Math.max(80, baseLinkDistance / (d.weight + 0.2)))
      })
      .strength((d: any) => {
        if (layout === 'radial') return Math.min(0.15, d.weight * 0.1)
        return Math.min(0.7, d.weight * 0.3)
      })
    )
    .force('charge', d3.forceManyBody()
      .strength(chargeStrength)
      .distanceMax(chargeDistanceMax)
      .distanceMin(20)
    )
    .force('center', d3.forceCenter(width / 2, height / 2).strength(centerStrength))
    .force('collision', d3.forceCollide()
      .radius((d: any) => getNodeSize(d) + collisionPadding)
      .strength(0.9)
      .iterations(2)
    )

  // Layout-specific forces
  if (layout === 'radial') {
    // Strong radial force — no forceX/forceY (would conflict)
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
    // Custom radial forces: hubs toward center, non-hubs to periphery
    const hubR = Math.min(width, height) * 0.12
    const nonHubR = Math.min(width, height) * 0.38
    simulation.force('radial', d3.forceRadial(
      (d: any) => hubIds!.has(d.id) ? hubR : nonHubR,
      width / 2,
      height / 2,
    ).strength((d: any) => hubIds!.has(d.id) ? 0.6 : 0.2))
    // No forceX/forceY — radial handles positioning
  } else {
    // Force layout: gentle centering via forceX/forceY
    simulation
      .force('x', d3.forceX(width / 2).strength(centerStrength))
      .force('y', d3.forceY(height / 2).strength(centerStrength))
  }

  simulation
    .alphaDecay(isLargeGraph ? 0.05 : 0.02)
    .velocityDecay(isLargeGraph ? 0.5 : 0.3)

  // --- Warmup phase: run simulation silently to pre-stabilize ---
  const warmupTicks = isLargeGraph ? 100 : 150
  simulation.alpha(1).stop()
  for (let i = 0; i < warmupTicks; i++) {
    simulation.tick()
  }

  // Draw dashed ring guides for radial layout
  if (layout === 'radial') {
    const typeOrder = ['person', 'organization', 'location', 'event', 'topic']
    const activeTypes = typeOrder.filter(t => nodes.some(n => n.type === t))
    const ringGap = Math.min(width, height) * 0.35 / Math.max(1, activeTypes.length)
    for (let i = 0; i < activeTypes.length; i++) {
      const radius = ringGap * (i + 1)
      g.insert('circle', ':first-child')
        .attr('cx', width / 2)
        .attr('cy', height / 2)
        .attr('r', radius)
        .attr('fill', 'none')
        .attr('stroke', document.documentElement.classList.contains('dark') ? '#334155' : '#cbd5e1')
        .attr('stroke-dasharray', '4 6')
        .attr('opacity', 0.25)
        .attr('class', 'ring-guide')
    }
  }

  // Apply warmup positions to DOM
  linkSelection!
    .attr('x1', (d: any) => d.source.x)
    .attr('y1', (d: any) => d.source.y)
    .attr('x2', (d: any) => d.target.x)
    .attr('y2', (d: any) => d.target.y)

  if (linkLabelSelection) {
    linkLabelSelection
      .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
      .attr('y', (d: any) => (d.source.y + d.target.y) / 2)
  }

  nodeSelection!.attr('transform', (d: GraphNode) => `translate(${d.x},${d.y})`)

  // Throttle tick updates for gentle remaining settling
  let tickCount = 0
  let lastUpdate = Date.now()
  const UPDATE_INTERVAL = 50

  simulation.on('tick', () => {
    tickCount++
    const now = Date.now()

    // Throttle visual updates
    if (now - lastUpdate > UPDATE_INTERVAL || simulation!.alpha() < 0.01) {
      lastUpdate = now

      linkSelection!
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      if (linkLabelSelection) {
        linkLabelSelection
          .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
          .attr('y', (d: any) => (d.source.y + d.target.y) / 2)
      }

      nodeSelection!.attr('transform', (d: GraphNode) => `translate(${d.x},${d.y})`)

      scheduleMinimapDraw()
    }

    // Auto-stop after convergence to save CPU/RAM
    if (simulation && simulation.alpha() < 0.005) {
      simulation.stop()
      // Update labels after simulation converges
      updateLabelVisibility()
      scheduleMinimapDraw()
    }
  })

  // Restart with low alpha for gentle settling
  simulation.alpha(0.3).restart()

  // Apply initial visibility (respects minCooccurrence and hiddenTypes)
  nextTick(() => {
    updateVisibility()
    // Apply pending search highlight
    if (props.searchHighlight) {
      applySearchHighlight(props.searchHighlight)
    }
  })

  // Drag functions
  function dragstarted(event: any, d: GraphNode) {
    if (!event.active) simulation?.alphaTarget(0.3).restart()
    d.fx = d.x
    d.fy = d.y
  }

  function dragged(event: any, d: GraphNode) {
    d.fx = event.x
    d.fy = event.y
  }

  function dragended(event: any, d: GraphNode) {
    if (!event.active) simulation?.alphaTarget(0)
    d.fx = null
    d.fy = null
    // Update labels after drag
    updateLabelVisibility()
  }
}

let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null

function showTooltip(event: any, data: any) {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
  }
  tooltip.value = {
    visible: true,
    x: event.clientX + 10,
    y: event.clientY - 10,
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

onMounted(() => {
  nextTick(() => {
    initGraph()
  })
})

// Reinitialize when data changes
watch(() => [props.data?.nodes.length, props.data?.edges.length], (newVal, oldVal) => {
  if (newVal[0] !== oldVal?.[0] || newVal[1] !== oldVal?.[1]) {
    // Reset ego pin on data change (nodes may have changed), preserve legend toggles
    pinnedEgoNodeId.value = null
    activeEgoNodeId.value = null
    nextTick(() => {
      initGraph()
    })
  }
})

// Reinitialize when dimensions change (e.g. fullscreen toggle)
watch(() => [props.width, props.height], (newVal, oldVal) => {
  if (newVal[0] !== oldVal?.[0] || newVal[1] !== oldVal?.[1]) {
    nextTick(() => {
      initGraph()
    })
  }
})

// Reinitialize when highlighted node changes
watch(() => props.highlightNodeId, () => {
  nextTick(() => {
    initGraph()
  })
})

// Reinitialize when layout strategy changes
watch(() => props.layout, () => {
  pinnedEgoNodeId.value = null
  activeEgoNodeId.value = null
  nextTick(() => {
    initGraph()
  })
})

// Watch minCooccurrence for dynamic edge-weight filtering
watch(() => props.minCooccurrence, () => {
  updateVisibility()
})

// Watch searchHighlight prop
watch(() => props.searchHighlight, (newVal) => {
  applySearchHighlight(newVal || null)
})

// Watch showMinimap prop
watch(() => props.showMinimap, (val) => {
  if (val) {
    nextTick(() => drawMinimap())
  }
})

// Sync prop inward (parent badge click) and apply D3 side-effects
// Apply D3 side-effects whenever shared hiddenEntityTypes changes (from legend or badges)
watch(hiddenEntityTypes, () => {
  // If pinned ego node's type is now hidden, clear pin
  if (pinnedEgoNodeId.value !== null) {
    const pinnedNode = allNodes.find(n => n.id === pinnedEgoNodeId.value)
    if (pinnedNode && hiddenEntityTypes.value.includes(pinnedNode.type)) {
      pinnedEgoNodeId.value = null
      applyEgoHighlight(null)
    }
  }

  updateVisibility()

  // Reheat simulation so remaining nodes spread
  if (simulation) {
    simulation.alpha(0.3).restart()
  }
})

// Cleanup - properly dispose of D3 resources to prevent memory leaks
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
  if (zoom) {
    zoom = null
  }
  // Null module-scope selections
  linkSelection = null
  nodeSelection = null
  linkLabelSelection = null
  nodeLabels = null
  gSelection = null
  allEdges = []
  allNodes = []
  tooltip.value.visible = false
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer)
    tooltipHideTimer = null
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
  background: #f8fafc;
  border-radius: 8px;
  overflow: hidden;
}

:root.dark .entity-network-container {
  background: #1e293b;
}

.graph-canvas {
  width: 100%;
  height: 100%;
}

.network-svg {
  display: block;
  background: #fff;
}

:root.dark .network-svg {
  background: #0f172a;
}

.edge {
  cursor: pointer;
  transition: all 0.2s;
}

.node {
  cursor: pointer;
}

.node-label {
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 500;
}

:root.dark .node-label {
  fill: #e2e8f0 !important;
}

.tooltip {
  position: fixed;
  z-index: 1000;
  pointer-events: auto;
}

.tooltip-content {
  background: #1e293b;
  color: #f8fafc;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  min-width: 200px;
  max-width: 320px;
}

.tooltip-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.tooltip-image {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: #334155;
}

.tooltip-name {
  font-weight: 600;
  font-size: 14px;
}

.tooltip-description {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
  line-height: 1.4;
}

.tooltip-meta {
  font-size: 12px;
  color: #cbd5e1;
  margin-top: 4px;
}

.tooltip-link {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: #93c5fd;
  border: 1px solid #334155;
  border-radius: 6px;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
}

.tooltip-link:hover {
  background: #334155;
  color: #bfdbfe;
}

/* Minimap canvas */
.minimap-canvas {
  position: absolute;
  bottom: 12px;
  right: 12px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  cursor: pointer;
  z-index: 10;
}

:root.dark .minimap-canvas {
  border-color: rgba(51, 65, 85, 0.5);
  background: rgba(15, 23, 42, 0.7);
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
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(4px);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 11px;
  color: #334155;
  line-height: 1.5;
  z-index: 10;
  max-width: 180px;
}

:root.dark .graph-legend {
  background: rgba(15, 23, 42, 0.92);
  border-color: #334155;
  color: #cbd5e1;
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
  background: rgba(0, 0, 0, 0.06);
}

:root.dark .legend-row-interactive:hover {
  background: rgba(255, 255, 255, 0.06);
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
  background: #e2e8f0;
  margin: 5px 0;
}

:root.dark .legend-divider {
  background: #334155;
}

.legend-hint {
  margin-top: 5px;
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.4;
}
</style>
