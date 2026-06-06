<script setup lang="ts">
// ===== Types =====
interface SimNode {
  id: string
  label: string
  category: string
  baseSize: number
  x: number
  y: number
  vx: number
  vy: number
  opacity: number
  hover: number
  phase: number
  delay: number
  spawned: boolean
}

interface SimEdge {
  source: SimNode
  target: SimNode
  strength: number
  width: number
  opacity: number
  coCount: number
  drawProgress: number
  particles: Array<{ t: number; speed: number }>
}

interface SpawnRing {
  x: number
  y: number
  rgb: [number, number, number]
  birth: number
}

// ===== Props & Emits =====
const props = defineProps<{
  nodes: any[]
  edges: any[]
}>()

const emit = defineEmits<{
  'node-click': [nodeId: string]
}>()

// ===== Color Map =====
const COLORS: Record<string, { fill: string; rgb: [number, number, number] }> = {
  person:       { fill: '#60a5fa', rgb: [96, 165, 250] },
  organization: { fill: '#34d399', rgb: [52, 211, 153] },
  location:     { fill: '#fbbf24', rgb: [251, 191, 36] },
  event:        { fill: '#a78bfa', rgb: [167, 139, 250] },
  keyword:      { fill: '#94a3b8', rgb: [148, 163, 184] },
  entity:       { fill: '#60a5fa', rgb: [96, 165, 250] },
}

const getColor = (cat: string) => COLORS[cat] || COLORS.keyword

// ===== Refs =====
const containerRef = ref<HTMLElement>()
const canvasRef = ref<HTMLCanvasElement>()
const W = ref(800)
const H = ref(500)
const dpr = ref(1)
const tooltip = ref<{ x: number; y: number; label: string; type: string } | null>(null)

// ===== Mutable Simulation State =====
let nodes: SimNode[] = []
let edges: SimEdge[] = []
let rings: SpawnRing[] = []
let animId = 0
let t0 = 0
let hoverId: string | null = null
let isDragging = false
let dragTarget: SimNode | null = null
let didMove = false

// ===== Initialize Simulation =====
function init() {
  const cx = W.value / 2
  const cy = H.value / 2

  nodes = props.nodes.map((n: any, i: number) => ({
    id: n.id,
    label: n.label,
    category: n.category || n.type || 'keyword',
    baseSize: Math.max(6, Math.min(22, (n.size || 5) * 2)),
    x: cx + (Math.random() - 0.5) * 80,
    y: cy + (Math.random() - 0.5) * 80,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
    opacity: 0,
    hover: 0,
    phase: Math.random() * Math.PI * 2,
    delay: i * 70 + Math.random() * 180,
    spawned: false,
  }))

  const map = new Map(nodes.map(n => [n.id, n]))

  edges = props.edges
    .filter((e: any) => map.has(e.from) && map.has(e.to))
    .map((e: any) => ({
      source: map.get(e.from)!,
      target: map.get(e.to)!,
      strength: e.strength || 0.5,
      width: e.width || 1,
      opacity: 0,
      coCount: e.cooccurrenceCount || 0,
      drawProgress: 0,
      particles: Array.from({ length: 2 + Math.floor(Math.random() * 2) }, () => ({
        t: Math.random(),
        speed: 0.0008 + Math.random() * 0.0012,
      })),
    }))

  rings = []
}

// ===== Physics =====
function physics(strong: boolean) {
  const n = nodes.length
  const cx = W.value / 2
  const cy = H.value / 2
  const repulsion = strong ? 3000 : 800
  const springK = strong ? 0.005 : 0.001
  const gravity = strong ? 0.008 : 0.003
  const damping = strong ? 0.86 : 0.95

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i], b = nodes[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = repulsion / (d * d)
      const fx = (dx / d) * f, fy = (dy / d) * f
      a.vx -= fx; a.vy -= fy
      b.vx += fx; b.vy += fy
    }
  }

  for (const e of edges) {
    const dx = e.target.x - e.source.x
    const dy = e.target.y - e.source.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const rest = 110 + (1 - e.strength) * 60
    const f = (d - rest) * springK
    const fx = (dx / d) * f, fy = (dy / d) * f
    e.source.vx += fx; e.source.vy += fy
    e.target.vx -= fx; e.target.vy -= fy
  }

  for (const node of nodes) {
    if (isDragging && dragTarget === node) continue
    node.vx += (cx - node.x) * gravity
    node.vy += (cy - node.y) * gravity
    node.vx *= damping
    node.vy *= damping
    node.x += node.vx
    node.y += node.vy
    // bounds
    node.x = Math.max(50, Math.min(W.value - 50, node.x))
    node.y = Math.max(40, Math.min(H.value - 40, node.y))
  }
}

// ===== Render Loop =====
function render(time: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const elapsed = time - t0
  const cw = W.value, ch = H.value

  ctx.setTransform(dpr.value, 0, 0, dpr.value, 0, 0)

  // --- Background ---
  const bg = ctx.createLinearGradient(0, 0, cw, ch)
  bg.addColorStop(0, '#0b1120')
  bg.addColorStop(0.5, '#0f172a')
  bg.addColorStop(1, '#0c1424')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cw, ch)

  // Dot grid
  ctx.fillStyle = 'rgba(100, 116, 139, 0.05)'
  for (let gx = 20; gx < cw; gx += 28) {
    for (let gy = 20; gy < ch; gy += 28) {
      ctx.fillRect(gx, gy, 1, 1)
    }
  }

  // --- Physics ---
  if (elapsed < 3500) {
    physics(true)
  } else if (isDragging) {
    physics(false)
  } else if (Math.floor(time / 100) % 5 === 0) {
    physics(false)
  }

  // --- Animate intro values ---
  for (const node of nodes) {
    const ne = elapsed - node.delay
    const tgt = Math.min(1, Math.max(0, ne / 500))
    node.opacity += (tgt - node.opacity) * 0.08

    if (node.opacity > 0.5 && !node.spawned) {
      node.spawned = true
      rings.push({ x: node.x, y: node.y, rgb: getColor(node.category).rgb, birth: elapsed })
    }

    const hoverTarget = hoverId === node.id ? 1 : 0
    node.hover += (hoverTarget - node.hover) * 0.12
  }

  for (const edge of edges) {
    const edgeDelay = Math.max(edge.source.delay, edge.target.delay) + 400
    const tgt = Math.min(1, Math.max(0, (elapsed - edgeDelay) / 600))
    edge.opacity += (tgt - edge.opacity) * 0.08
    edge.drawProgress = Math.min(1, Math.max(0, (elapsed - edgeDelay) / 450))
  }

  // Expire spawn rings
  rings = rings.filter(r => elapsed - r.birth < 700)

  // --- Connected set for hover highlighting ---
  const connected = new Set<string>()
  if (hoverId) {
    connected.add(hoverId)
    for (const e of edges) {
      if (e.source.id === hoverId) connected.add(e.target.id)
      if (e.target.id === hoverId) connected.add(e.source.id)
    }
  }

  // --- Draw Edges ---
  for (const edge of edges) {
    if (edge.opacity < 0.01) continue

    const isHit = edge.source.id === hoverId || edge.target.id === hoverId
    const alpha = edge.opacity * (hoverId ? (isHit ? 0.5 : 0.04) : 0.22)
    const { source: src, target: tgt } = edge
    const dx = tgt.x - src.x, dy = tgt.y - src.y
    const prog = edge.drawProgress
    const ex = src.x + dx * prog, ey = src.y + dy * prog

    // Gradient edge line
    const srcRgb = getColor(src.category).rgb
    const tgtRgb = getColor(tgt.category).rgb
    const grad = ctx.createLinearGradient(src.x, src.y, ex, ey)
    grad.addColorStop(0, `rgba(${srcRgb[0]},${srcRgb[1]},${srcRgb[2]},${alpha})`)
    grad.addColorStop(1, `rgba(${tgtRgb[0]},${tgtRgb[1]},${tgtRgb[2]},${alpha})`)

    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(ex, ey)
    ctx.strokeStyle = grad
    ctx.lineWidth = edge.width * (isHit && hoverId ? 2 : 1)
    ctx.stroke()

    // Edge glow for highlighted edges
    if (isHit && hoverId && alpha > 0.2) {
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = `rgba(255,255,255,0.04)`
      ctx.lineWidth = edge.width * 6
      ctx.stroke()
    }

    // Particles along edges
    if (prog > 0.85 && edge.opacity > 0.1) {
      const pBaseAlpha = hoverId ? (isHit ? 0.7 : 0.03) : 0.18
      ctx.globalCompositeOperation = 'lighter'

      for (const p of edge.particles) {
        p.t += p.speed * (isHit && hoverId ? 2.5 : 1)
        if (p.t > 1) p.t -= 1

        // Particle + trail
        for (let trail = 0; trail < 4; trail++) {
          const tt = p.t - trail * 0.018
          if (tt < 0) continue
          const px = src.x + dx * tt
          const py = src.y + dy * tt
          const ta = pBaseAlpha * edge.opacity * (1 - trail * 0.28)
          const radius = 2 - trail * 0.35
          ctx.beginPath()
          ctx.arc(px, py, Math.max(0.5, radius), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${ta})`
          ctx.fill()
        }
      }

      ctx.globalCompositeOperation = 'source-over'
    }

    // Co-occurrence count on hover
    if (isHit && hoverId && edge.coCount > 0 && prog > 0.9) {
      const mx = (src.x + tgt.x) / 2
      const my = (src.y + tgt.y) / 2
      ctx.font = '9px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // pill bg
      const tw = ctx.measureText(String(edge.coCount)).width + 8
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
      ctx.beginPath()
      ctx.arc(mx, my - 8, tw / 2 + 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(148, 163, 184, 0.9)`
      ctx.fillText(String(edge.coCount), mx, my - 8)
    }
  }

  // --- Draw Spawn Rings ---
  for (const ring of rings) {
    const rp = (elapsed - ring.birth) / 700
    const radius = 12 + rp * 45
    const alpha = (1 - rp) * 0.35
    const [r, g, b] = ring.rgb
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
    ctx.lineWidth = 2 * (1 - rp)
    ctx.stroke()
  }

  // --- Draw Nodes ---
  const showAllLabels = nodes.length < 16

  for (const node of nodes) {
    if (node.opacity < 0.01) continue

    const col = getColor(node.category)
    const [r, g, b] = col.rgb
    const isConn = !hoverId || connected.has(node.id)
    const dim = isConn ? 1 : 0.12
    const alpha = node.opacity * dim

    const pulse = Math.sin(time * 0.0015 + node.phase) * 0.1 + 1
    const hScale = 1 + node.hover * 0.4
    const size = node.baseSize * pulse * hScale

    // Outer glow
    const glowR = size * (2.5 + node.hover * 1.8)
    const glow = ctx.createRadialGradient(node.x, node.y, size * 0.2, node.x, node.y, glowR)
    glow.addColorStop(0, `rgba(${r},${g},${b},${0.22 * alpha})`)
    glow.addColorStop(0.4, `rgba(${r},${g},${b},${0.07 * alpha})`)
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Node body with inner gradient (gives 3D feel)
    const bodyGrad = ctx.createRadialGradient(
      node.x - size * 0.25, node.y - size * 0.25, 0,
      node.x, node.y, size
    )
    const rLit = Math.min(255, r + 50)
    const gLit = Math.min(255, g + 50)
    const bLit = Math.min(255, b + 50)
    bodyGrad.addColorStop(0, `rgba(${rLit},${gLit},${bLit},${alpha})`)
    bodyGrad.addColorStop(1, `rgba(${r},${g},${b},${alpha * 0.85})`)
    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, Math.PI * 2)
    ctx.fillStyle = bodyGrad
    ctx.fill()

    // Border highlight
    ctx.strokeStyle = `rgba(255,255,255,${0.2 * alpha})`
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Animated dashed ring on hover
    if (node.hover > 0.02) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, size + 4 + node.hover * 6, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${r},${g},${b},${node.hover * 0.35})`
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.lineDashOffset = -time * 0.025
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Label
    const showLabel = showAllLabels || node.baseSize > 12 || node.hover > 0.1 ||
      (hoverId && connected.has(node.id))
    if (showLabel && alpha > 0.15) {
      const fontSize = 10 + node.hover * 2
      ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`
      ctx.textAlign = 'center'

      const labelY = node.y + size + 10
      const text = node.label
      const tw = ctx.measureText(text).width
      const pw = tw + 12
      const ph = fontSize + 6

      // Pill background
      ctx.fillStyle = `rgba(15, 23, 42, ${0.8 * alpha})`
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(node.x - pw / 2, labelY - 3, pw, ph, 4)
      } else {
        ctx.rect(node.x - pw / 2, labelY - 3, pw, ph)
      }
      ctx.fill()

      // Subtle colored border
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.25 * alpha})`
      ctx.lineWidth = 0.5
      ctx.stroke()

      // Text
      ctx.fillStyle = `rgba(226, 232, 240, ${0.9 * alpha})`
      ctx.fillText(text, node.x, labelY + fontSize * 0.35)
    }
  }

  // --- Vignette ---
  const vig = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.72)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, cw, ch)

  // --- Tooltip data ---
  if (hoverId && !isDragging) {
    const hn = nodes.find(n => n.id === hoverId)
    if (hn) {
      tooltip.value = {
        x: hn.x,
        y: hn.y - hn.baseSize * 1.6 - 24,
        label: hn.label,
        type: hn.category,
      }
    }
  } else {
    tooltip.value = null
  }

  animId = requestAnimationFrame(render)
}

// ===== Hit Testing =====
function hitTest(x: number, y: number): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    const dx = x - n.x, dy = y - n.y
    if (dx * dx + dy * dy < (n.baseSize + 10) ** 2) return n
  }
  return null
}

function getPos(e: MouseEvent | Touch) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

// ===== Mouse Events =====
function onMouseMove(e: MouseEvent) {
  const { x, y } = getPos(e)
  if (isDragging && dragTarget) {
    dragTarget.x = x
    dragTarget.y = y
    dragTarget.vx = 0
    dragTarget.vy = 0
    didMove = true
    return
  }
  const node = hitTest(x, y)
  hoverId = node?.id ?? null
  if (canvasRef.value) canvasRef.value.style.cursor = node ? 'pointer' : 'default'
}

function onMouseDown(e: MouseEvent) {
  const { x, y } = getPos(e)
  const node = hitTest(x, y)
  if (node) {
    isDragging = true
    dragTarget = node
    didMove = false
  }
}

function onMouseUp() {
  if (isDragging && dragTarget && !didMove) {
    emit('node-click', dragTarget.id)
  }
  isDragging = false
  dragTarget = null
}

function onMouseLeave() {
  hoverId = null
  tooltip.value = null
  isDragging = false
  dragTarget = null
}

// ===== Touch Events =====
function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const { x, y } = getPos(e.touches[0])
  const node = hitTest(x, y)
  if (node) {
    isDragging = true
    dragTarget = node
    didMove = false
    hoverId = node.id
    e.preventDefault()
  }
}

function onTouchMove(e: TouchEvent) {
  if (!isDragging || !dragTarget || !e.touches[0]) return
  const { x, y } = getPos(e.touches[0])
  dragTarget.x = x
  dragTarget.y = y
  dragTarget.vx = 0
  dragTarget.vy = 0
  didMove = true
  e.preventDefault()
}

function onTouchEnd() {
  if (isDragging && dragTarget && !didMove) {
    emit('node-click', dragTarget.id)
  }
  isDragging = false
  dragTarget = null
  hoverId = null
  tooltip.value = null
}

// ===== Canvas Setup =====
function resize() {
  const el = containerRef.value
  const canvas = canvasRef.value
  if (!el || !canvas) return
  dpr.value = window.devicePixelRatio || 1
  W.value = el.clientWidth
  H.value = el.clientHeight
  canvas.width = W.value * dpr.value
  canvas.height = H.value * dpr.value
  canvas.style.width = `${W.value}px`
  canvas.style.height = `${H.value}px`
}

// ===== Lifecycle =====
let ro: ResizeObserver

onMounted(() => {
  resize()
  init()
  t0 = performance.now()
  animId = requestAnimationFrame(render)
  ro = new ResizeObserver(resize)
  if (containerRef.value) ro.observe(containerRef.value)
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  ro?.disconnect()
})

watch(() => [props.nodes, props.edges], () => {
  init()
  t0 = performance.now()
}, { deep: true })
</script>

<template>
  <div ref="containerRef" class="atg-root">
    <canvas
      ref="canvasRef"
      @mousemove="onMouseMove"
      @mousedown="onMouseDown"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
    />

    <!-- Tooltip -->
    <Transition name="atg-tip">
      <div
        v-if="tooltip"
        class="atg-tooltip"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <span class="atg-tip-dot" :style="{ background: COLORS[tooltip.type]?.fill || '#94a3b8' }"></span>
        <span class="atg-tip-label">{{ tooltip.label }}</span>
        <span class="atg-tip-type">{{ tooltip.type }}</span>
      </div>
    </Transition>

    <!-- Legend -->
    <div class="atg-legend">
      <template v-for="(col, type) in COLORS" :key="type">
        <span v-if="type !== 'keyword' && type !== 'entity'" class="atg-legend-item">
          <span class="atg-legend-dot" :style="{ background: col.fill, boxShadow: `0 0 6px ${col.fill}` }"></span>
          <span>{{ type }}</span>
        </span>
      </template>
    </div>

    <!-- Hint -->
    <div class="atg-hint">
      Click to explore &middot; Drag to rearrange
    </div>
  </div>
</template>

<style scoped>
.atg-root {
  position: relative;
  width: 100%;
  height: 500px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid rgba(51, 65, 85, 0.4);
  box-shadow:
    0 0 0 1px rgba(15, 23, 42, 0.5),
    0 4px 24px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
  animation: atg-enter 0.7s ease-out;
}

@keyframes atg-enter {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.atg-legend {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  gap: 14px;
  padding: 7px 14px;
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 10px;
  border: 1px solid rgba(51, 65, 85, 0.45);
  font-size: 11px;
  color: rgba(148, 163, 184, 0.9);
  text-transform: capitalize;
}

.atg-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.atg-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.atg-hint {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 10px;
  color: rgba(100, 116, 139, 0.5);
  padding: 4px 10px;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 6px;
  border: 1px solid rgba(51, 65, 85, 0.3);
  letter-spacing: 0.02em;
}

.atg-tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 10px;
  border: 1px solid rgba(51, 65, 85, 0.6);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  white-space: nowrap;
  z-index: 10;
}

.atg-tip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}

.atg-tip-label {
  font-size: 12px;
  font-weight: 600;
  color: #e2e8f0;
  letter-spacing: 0.01em;
}

.atg-tip-type {
  font-size: 10px;
  color: #64748b;
  text-transform: capitalize;
}

.atg-tip-enter-active {
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.atg-tip-leave-active {
  transition: all 0.1s ease-in;
}
.atg-tip-enter-from,
.atg-tip-leave-to {
  opacity: 0;
  transform: translate(-50%, -92%);
}
</style>
