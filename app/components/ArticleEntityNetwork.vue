<script setup lang="ts">
import { forceSimulation, forceLink, forceManyBody, forceCollide, scaleLog } from 'd3'

interface NetNode {
  id: string
  label: string
  type: string
  slug: string
  inArticle: boolean
  relevance: number
  role: string | null
}

interface NetEdge {
  from: string
  to: string
  count: number
  context: boolean
}

interface PlacedNode extends NetNode {
  x: number
  y: number
  r: number
  labelX: number
  labelY: number
  anchor: 'start' | 'middle' | 'end'
  text: string
}

const props = defineProps<{ articleId: number }>()

const { data } = await useFetch<{ nodes: NetNode[]; edges: NetEdge[] }>('/api/articles/network', {
  query: { id: props.articleId },
  key: `article-network-${props.articleId}`,
})

// Same type palette and letter badges as the entity list on the article page
const TYPES: Record<string, { label: string; letter: string; color: string }> = {
  person: { label: 'Person', letter: 'P', color: 'var(--color-blue)' },
  organization: { label: 'Organization', letter: 'O', color: 'var(--color-violet)' },
  location: { label: 'Location', letter: 'L', color: 'var(--color-green)' },
  event: { label: 'Event', letter: 'E', color: '#C2410C' },
  topic: { label: 'Topic', letter: 'T', color: '#0D9488' },
}
const typeOf = (t: string) => TYPES[t] || { label: t, letter: '?', color: 'var(--color-ink-3)' }

const nodes = computed(() => data.value?.nodes || [])
const edges = computed(() => data.value?.edges || [])
const innerNodes = computed(() => nodes.value.filter(n => n.inArticle))
const contextNodes = computed(() => nodes.value.filter(n => !n.inArticle))
const nodeById = computed(() => new Map(nodes.value.map(n => [n.id, n])))
const hasTies = computed(() => edges.value.length > 0)

const fmt = (n: number) => n.toLocaleString('en-US')
const entityHref = (n: NetNode) => `/${n.type}/${n.slug}`
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s)

// ---- Layout -----------------------------------------------------------------

const containerRef = ref<HTMLElement | null>(null)
const width = ref(720)
const compact = computed(() => width.value < 600)
const height = computed(() => (compact.value ? 460 : 480))

const layout = computed(() => {
  const W = width.value
  const H = height.value
  const cx = W / 2
  const cy = H / 2 - 4
  // Context sits on an outer ellipse; article entities fill the inner zone
  const ry = H / 2 - 44
  const rx = compact.value ? Math.max(ry * 0.75, W / 2 - 40) : Math.max(ry, W / 2 - 150)
  const sx = rx / ry
  const innerMax = ry * 0.68
  const labelMax = compact.value ? 14 : 24

  const inner = innerNodes.value.map((n, i) => {
    const a = (i / Math.max(1, innerNodes.value.length)) * Math.PI * 2
    const target = 16 + (1 - Math.min(1, n.relevance)) * (innerMax - 16)
    return {
      ...n,
      r: 7 + Math.min(1, n.relevance) * 8,
      target,
      text: truncate(n.label, labelMax),
      x: cx + Math.cos(a) * target * sx,
      y: cy + Math.sin(a) * target,
    } as any
  })
  const innerMap = new Map(inner.map(n => [n.id, n]))
  const innerLinks = edges.value
    .filter(e => !e.context && innerMap.has(e.from) && innerMap.has(e.to))
    .map(e => ({ source: e.from, target: e.to, count: e.count }))

  // Elliptical radial force: pull each node towards its target ring
  const ellipse = (alpha: number) => {
    for (const n of inner) {
      const nx = (n.x - cx) / sx
      const ny = n.y - cy
      const d = Math.hypot(nx, ny) || 1
      const k = ((n.target - d) / d) * 0.12 * alpha
      n.vx += nx * k * sx
      n.vy += ny * k
    }
  }
  // Keep the inner cloud inside the inner zone so it never collides with context
  const clamp = () => {
    for (const n of inner) {
      const nx = (n.x - cx) / sx
      const ny = n.y - cy
      const d = Math.hypot(nx, ny)
      if (d > innerMax) {
        n.x = cx + (nx / d) * innerMax * sx
        n.y = cy + (ny / d) * innerMax
      }
    }
  }

  const sim = forceSimulation(inner)
    .force('link', forceLink(innerLinks).id((d: any) => d.id).distance(70).strength(0.04))
    .force('charge', forceManyBody().strength(-90))
    .force('collide', forceCollide((d: any) => d.r + 10 + Math.min(d.text.length * 2.4, 44)).iterations(2))
    .force('ellipse', ellipse)
    .stop()
  for (let i = 0; i < 320; i++) {
    sim.tick()
    clamp()
  }

  // Context entities sit at the circular mean angle of the article entities they connect
  const ctx = contextNodes.value.map((n) => {
    let sxSum = 0
    let sySum = 0
    for (const e of edges.value) {
      const other = e.from === n.id ? e.to : e.to === n.id ? e.from : null
      const m = other ? innerMap.get(other) : null
      if (!m) continue
      const w = Math.log(1 + e.count)
      sxSum += ((m.x - cx) / sx) * w
      sySum += (m.y - cy) * w
    }
    return { ...n, angle: Math.atan2(sySum, sxSum || 0.001) }
  }).sort((a, b) => a.angle - b.angle)

  // Spread context angles so neighbours keep a minimum gap
  const minGap = (Math.PI * 2) / Math.max(ctx.length, compact.value ? 7 : 11)
  for (let pass = 0; pass < 60; pass++) {
    let moved = false
    for (let i = 0; i < ctx.length && ctx.length > 1; i++) {
      const a = ctx[i]
      const b = ctx[(i + 1) % ctx.length]
      let gap = b.angle - a.angle
      if (i === ctx.length - 1) gap += Math.PI * 2
      if (gap < minGap) {
        const push = (minGap - gap) / 2
        a.angle -= push
        b.angle += push
        moved = true
      }
    }
    if (!moved) break
  }

  const placed: PlacedNode[] = []
  for (const n of inner) {
    placed.push({
      ...n,
      x: n.x,
      y: n.y,
      labelX: n.x,
      labelY: n.y + n.r + 13,
      anchor: 'middle',
    })
  }
  for (const n of ctx) {
    const x = cx + Math.cos(n.angle) * rx
    const y = cy + Math.sin(n.angle) * ry
    const c = Math.cos(n.angle)
    const r = 6.5
    let anchor: PlacedNode['anchor'] = 'middle'
    let labelX = x
    let labelY = y + r + 13
    if (!compact.value && Math.abs(c) > 0.35) {
      anchor = c > 0 ? 'start' : 'end'
      labelX = x + (c > 0 ? r + 7 : -(r + 7))
      labelY = y + 4
    } else if (Math.sin(n.angle) < 0) {
      labelY = y - r - 7
    }
    placed.push({ ...n, x, y, r, labelX, labelY, anchor, text: truncate(n.label, labelMax) })
  }

  return { W, H, cx, cy, rx, ry, innerMax, sx, nodes: placed, map: new Map(placed.map(n => [n.id, n])) }
})

const widthScale = computed(() => {
  const max = Math.max(2, ...edges.value.filter(e => !e.context).map(e => e.count))
  return scaleLog().domain([1, max]).range([0.9, 5]).clamp(true)
})

// At rest each context node shows only its two strongest ties; hover reveals the rest
const primaryContextEdges = computed(() => {
  const keep = new Set<NetEdge>()
  for (const n of contextNodes.value) {
    edges.value
      .filter(e => e.from === n.id || e.to === n.id)
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .forEach(e => keep.add(e))
  }
  return keep
})

const drawnEdges = computed(() => {
  const { map, cx, cy } = layout.value
  return edges.value
    .filter(e => map.has(e.from) && map.has(e.to))
    .map((e) => {
      const a = map.get(e.from)!
      const b = map.get(e.to)!
      // Bend each edge slightly away from the centre so parallel ties separate
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const ox = mx - cx
      const oy = my - cy
      const ol = Math.hypot(ox, oy) || 1
      const bend = Math.min(18, Math.hypot(b.x - a.x, b.y - a.y) * 0.08)
      const qx = mx + (ox / ol) * bend
      const qy = my + (oy / ol) * bend
      return {
        ...e,
        key: `${e.from}-${e.to}`,
        d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`,
        w: e.context ? 0.8 : widthScale.value(e.count),
        secondary: e.context && !primaryContextEdges.value.has(e),
      }
    })
    .sort((x, y) => Number(y.context) - Number(x.context) || x.count - y.count)
})

// ---- Interaction ------------------------------------------------------------

const activeId = ref<string | null>(null)
const activeType = ref<string | null>(null)

const neighbours = computed(() => {
  const map = new Map<string, number>()
  if (!activeId.value) return map
  for (const e of edges.value) {
    if (e.from === activeId.value) map.set(e.to, e.count)
    else if (e.to === activeId.value) map.set(e.from, e.count)
  }
  return map
})

function nodeState(n: NetNode) {
  if (activeId.value) {
    if (n.id === activeId.value) return 'is-active'
    return neighbours.value.has(n.id) ? 'is-near' : 'is-dim'
  }
  if (activeType.value) return n.type === activeType.value ? 'is-near' : 'is-dim'
  return ''
}

function edgeState(e: NetEdge) {
  if (activeId.value) return e.from === activeId.value || e.to === activeId.value ? 'is-on' : 'is-dim'
  if (activeType.value) {
    const a = nodeById.value.get(e.from)
    const b = nodeById.value.get(e.to)
    return a?.type === activeType.value || b?.type === activeType.value ? '' : 'is-dim'
  }
  return ''
}

const tooltip = computed(() => {
  if (!activeId.value) return null
  const n = layout.value.map.get(activeId.value)
  if (!n) return null
  const ties = [...neighbours.value.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, count]) => ({ label: nodeById.value.get(id)?.label || '', count }))
  const linked = [...neighbours.value.keys()].filter(id => nodeById.value.get(id)?.inArticle).length
  return {
    node: n,
    ties,
    linked,
    left: (n.x / layout.value.W) * 100,
    top: ((n.y - n.r - 10) / layout.value.H) * 100,
    flip: n.y < 130,
  }
})

function go(n: NetNode) {
  navigateTo(entityHref(n))
}

// ---- Side lists -------------------------------------------------------------

const strongestTies = computed(() => {
  const list = edges.value
    .filter(e => !e.context)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(e => ({ ...e, a: nodeById.value.get(e.from)!, b: nodeById.value.get(e.to)! }))
  const max = Math.max(1, ...list.map(t => t.count))
  return list.map(t => ({ ...t, pct: Math.max(4, Math.sqrt(t.count / max) * 100) }))
})

const contextList = computed(() => contextNodes.value.map((n) => {
  const links = edges.value.filter(e => e.from === n.id || e.to === n.id)
  return { ...n, links: links.length }
}).sort((a, b) => b.links - a.links))

const presentTypes = computed(() => {
  const seen = new Set(nodes.value.map(n => n.type))
  return Object.keys(TYPES).filter(t => seen.has(t))
})

// ---- Size tracking ----------------------------------------------------------

let ro: ResizeObserver | null = null
onMounted(() => {
  if (!containerRef.value) return
  width.value = Math.round(containerRef.value.clientWidth) || 720
  ro = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width)
    if (w && Math.abs(w - width.value) > 8) width.value = w
  })
  ro.observe(containerRef.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div v-if="innerNodes.length > 1" class="aen">
    <!-- Legend: type identity + what the marks mean -->
    <div class="aen-legend">
      <button
        v-for="t in presentTypes"
        :key="t"
        type="button"
        class="aen-legend-type"
        @mouseenter="activeType = t"
        @mouseleave="activeType = null"
        @focus="activeType = t"
        @blur="activeType = null"
      >
        <span class="aen-badge" :style="{ background: typeOf(t).color }">{{ typeOf(t).letter }}</span>
        {{ typeOf(t).label }}
      </button>
      <span class="aen-legend-sep" />
      <span class="aen-legend-key"><i class="aen-key-fill" />In this article</span>
      <span class="aen-legend-key"><i class="aen-key-ring" />Wider coverage</span>
      <span class="aen-legend-key"><i class="aen-key-line" />Line weight = articles in common</span>
    </div>

    <div ref="containerRef" class="aen-stage" :style="{ height: `${layout.H}px` }">
      <ClientOnly>
        <svg
          :viewBox="`0 0 ${layout.W} ${layout.H}`"
          :width="layout.W"
          :height="layout.H"
          role="img"
          :aria-label="`Network of ${innerNodes.length} entities in this article and ${contextNodes.length} recurring entities from wider coverage`"
          @mouseleave="activeId = null"
        >
          <!-- Zone guides -->
          <ellipse
            v-if="contextNodes.length"
            class="aen-guide"
            :cx="layout.cx" :cy="layout.cy" :rx="layout.rx" :ry="layout.ry"
          />
          <ellipse
            class="aen-zone"
            :cx="layout.cx" :cy="layout.cy"
            :rx="(layout.innerMax + 26) * layout.sx" :ry="layout.innerMax + 26"
          />
          <text
            v-if="contextNodes.length"
            class="aen-zone-label"
            x="0" y="14"
          >Wider coverage ┄</text>

          <!-- Edges -->
          <g fill="none">
            <path
              v-for="e in drawnEdges"
              :key="e.key"
              :d="e.d"
              class="aen-edge"
              :class="[e.context ? 'is-context' : '', e.secondary ? 'is-secondary' : '', edgeState(e)]"
              :stroke-width="e.w"
            />
          </g>

          <!-- Nodes -->
          <a
            v-for="n in layout.nodes"
            :key="n.id"
            :href="entityHref(n)"
            class="aen-node"
            :class="[n.inArticle ? 'is-inner' : 'is-context', nodeState(n)]"
            :aria-label="`${n.label}, ${typeOf(n.type).label}${n.inArticle ? '' : ', wider coverage'}`"
            @click.prevent="go(n)"
            @mouseenter="activeId = n.id"
            @focus="activeId = n.id"
            @blur="activeId = null"
          >
            <circle :cx="n.x" :cy="n.y" :r="n.r + 10" class="aen-hit" />
            <circle
              :cx="n.x" :cy="n.y" :r="n.r"
              class="aen-dot"
              :style="n.inArticle ? { fill: typeOf(n.type).color } : { stroke: typeOf(n.type).color }"
            />
            <text
              :x="n.x" :y="n.y + 3.4"
              text-anchor="middle"
              class="aen-letter"
              :class="{ 'is-big': n.r > 10 }"
              :style="n.inArticle ? {} : { fill: typeOf(n.type).color }"
            >{{ typeOf(n.type).letter }}</text>
            <text
              :x="n.labelX" :y="n.labelY"
              :text-anchor="n.anchor"
              class="aen-label"
              :class="{ 'is-key': n.inArticle && n.relevance >= 0.8 }"
            >{{ n.text }}</text>
          </a>
        </svg>

        <!-- Tooltip -->
        <div
          v-if="tooltip"
          class="aen-tip"
          :class="{ 'is-below': tooltip.flip }"
          :style="{ left: `${tooltip.left}%`, top: tooltip.flip ? `calc(${tooltip.top}% + ${tooltip.node.r * 2 + 30}px)` : `${tooltip.top}%` }"
        >
          <div class="aen-tip-hd">
            <span class="aen-badge" :style="{ background: typeOf(tooltip.node.type).color }">{{ typeOf(tooltip.node.type).letter }}</span>
            <strong>{{ tooltip.node.label }}</strong>
          </div>
          <div class="aen-tip-meta">
            <template v-if="tooltip.node.inArticle">
              In this article · relevance {{ tooltip.node.relevance.toFixed(1) }}<template v-if="tooltip.node.role && tooltip.node.role !== 'context' && tooltip.node.role !== 'neutral'"> · {{ tooltip.node.role }}</template>
            </template>
            <template v-else>
              Not named here · linked to {{ tooltip.linked }} of this article's entities
            </template>
          </div>
          <ul v-if="tooltip.ties.length" class="aen-tip-ties">
            <li v-for="t in tooltip.ties" :key="t.label">
              <span>{{ t.label }}</span><span class="aen-num">{{ fmt(t.count) }}</span>
            </li>
          </ul>
          <div class="aen-tip-foot">Articles in common · click to open</div>
        </div>

        <template #fallback>
          <div class="aen-loading">Laying out network…</div>
        </template>
      </ClientOnly>

      <p v-if="!hasTies" class="aen-empty">
        These entities haven't appeared together in other coverage yet.
      </p>
    </div>

    <!-- Readable companion: the same data as ranked lists -->
    <div v-if="strongestTies.length || contextList.length" class="aen-lists">
      <div v-if="strongestTies.length">
        <h4 class="aen-list-hd">Strongest ties <span>articles in common</span></h4>
        <ul class="aen-ties">
          <li
            v-for="t in strongestTies"
            :key="`${t.from}-${t.to}`"
            @mouseenter="activeId = t.from"
            @mouseleave="activeId = null"
          >
            <div class="aen-tie-names">
              <NuxtLink :to="entityHref(t.a)">{{ t.a.label }}</NuxtLink>
              <span class="aen-tie-x">&amp;</span>
              <NuxtLink :to="entityHref(t.b)">{{ t.b.label }}</NuxtLink>
            </div>
            <div class="aen-tie-bar"><span :style="{ width: `${t.pct}%` }" /></div>
            <div class="aen-num">{{ fmt(t.count) }}</div>
          </li>
        </ul>
      </div>
      <div v-if="contextList.length">
        <h4 class="aen-list-hd">Recurring context <span>not named in this article</span></h4>
        <ul class="aen-context">
          <li
            v-for="c in contextList"
            :key="c.id"
            @mouseenter="activeId = c.id"
            @mouseleave="activeId = null"
          >
            <span class="aen-badge is-ring" :style="{ color: typeOf(c.type).color, borderColor: typeOf(c.type).color }">{{ typeOf(c.type).letter }}</span>
            <NuxtLink :to="entityHref(c)">{{ c.label }}</NuxtLink>
            <span class="aen-num">links {{ c.links }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
  <div v-else class="aen-empty-block">
    Not enough entities in this article to draw a network.
  </div>
</template>

<style scoped>
.aen { --mono: "JetBrains Mono", ui-monospace, monospace; --sans: "IBM Plex Sans", "Inter", system-ui, sans-serif; }

/* Legend */
.aen-legend {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--color-ink-3); padding-bottom: 12px; border-bottom: 1px solid var(--color-rule-soft);
}
.aen-legend-type {
  display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none;
  font: inherit; letter-spacing: inherit; text-transform: inherit; color: inherit; cursor: default;
}
.aen-legend-type:hover, .aen-legend-type:focus-visible { color: var(--color-ink); outline: none; }
.aen-legend-sep { width: 1px; height: 12px; background: var(--color-rule); }
.aen-legend-key { display: inline-flex; align-items: center; gap: 6px; }
.aen-key-fill { width: 9px; height: 9px; border-radius: 50%; background: var(--color-ink-3); }
.aen-key-ring { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--color-ink-3); }
.aen-key-line { width: 18px; height: 0; border-top: 3px solid var(--color-ink-4); border-radius: 2px; }

.aen-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 15px; height: 15px; border-radius: 50%; flex: none;
  font-family: var(--mono); font-size: 8.5px; font-weight: 700; letter-spacing: 0;
  color: var(--color-paper);
}
.aen-badge.is-ring { background: transparent; border: 1.5px solid; }

/* Stage */
.aen-stage { position: relative; width: 100%; margin-top: 4px; }
.aen-stage svg { display: block; overflow: visible; font-family: var(--sans); }
.aen-loading, .aen-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-family: var(--mono); font-size: 11px; color: var(--color-ink-4); pointer-events: none;
}
.aen-empty { inset: auto 0 6px 0; }
.aen-empty-block { font-family: var(--mono); font-size: 11px; color: var(--color-ink-4); padding: 16px 0; }

.aen-guide { fill: none; stroke: var(--color-rule); stroke-dasharray: 2 5; }
.aen-zone { fill: var(--color-paper-2); opacity: 0.55; stroke: none; }
.aen-zone-label {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase;
  fill: var(--color-ink-4);
}

/* Edges */
.aen-edge { stroke: var(--color-ink-3); stroke-opacity: 0.38; stroke-linecap: round; transition: stroke-opacity 0.15s, stroke 0.15s; }
.aen-edge.is-context { stroke: var(--color-ink-4); stroke-opacity: 0.4; stroke-dasharray: 2 3; }
.aen-edge.is-secondary { stroke-opacity: 0; }
.aen-edge.is-on { stroke: var(--color-ink); stroke-opacity: 0.85; }
.aen-edge.is-dim { stroke-opacity: 0.06; }

/* Nodes */
.aen-node { cursor: pointer; outline: none; transition: opacity 0.15s; }
.aen-hit { fill: transparent; }
.aen-dot { stroke: var(--color-paper); stroke-width: 2; transition: stroke-width 0.15s; }
.aen-node.is-context .aen-dot { fill: var(--color-paper); stroke-width: 1.5; }
.aen-letter { font-family: var(--mono); font-size: 8.5px; font-weight: 700; fill: var(--color-paper); pointer-events: none; }
.aen-label {
  font-size: 11.5px; fill: var(--color-ink-2); pointer-events: none;
  paint-order: stroke; stroke: var(--color-paper); stroke-width: 3.5px; stroke-linejoin: round;
}
.aen-label.is-key { font-weight: 600; fill: var(--color-ink); }
.aen-letter.is-big { font-size: 10px; }
.aen-node.is-context .aen-label { font-size: 11px; fill: var(--color-ink-3); }
.aen-node.is-dim { opacity: 0.18; }
.aen-node.is-active .aen-dot { stroke: var(--color-ink); stroke-width: 2.5; }
.aen-node.is-active .aen-label, .aen-node.is-near .aen-label { fill: var(--color-ink); }
.aen-node:focus-visible .aen-dot { stroke: var(--color-ink); stroke-width: 3; }

/* Tooltip */
.aen-tip {
  position: absolute; transform: translate(-50%, -100%); z-index: 5; pointer-events: none;
  min-width: 200px; max-width: 260px; padding: 10px 12px;
  background: var(--color-paper); border: 1px solid var(--color-rule);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.12); font-size: 12px; color: var(--color-ink-2);
}
.aen-tip.is-below { transform: translate(-50%, 0); }
.aen-tip-hd { display: flex; align-items: center; gap: 7px; color: var(--color-ink); font-size: 13px; }
.aen-tip-meta { margin-top: 4px; color: var(--color-ink-3); font-size: 11.5px; }
.aen-tip-ties { list-style: none; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px dotted var(--color-rule); }
.aen-tip-ties li { display: flex; justify-content: space-between; gap: 12px; padding: 1px 0; }
.aen-tip-foot {
  margin-top: 6px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--color-ink-4);
}
.aen-num { font-family: var(--mono); font-size: 10.5px; color: var(--color-ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Lists */
.aen-lists {
  display: grid; grid-template-columns: 1.3fr 1fr; gap: 28px;
  margin-top: 8px; padding-top: 16px; border-top: 1px solid var(--color-rule-soft);
}
@media (max-width: 640px) { .aen-lists { grid-template-columns: 1fr; gap: 20px; } }
.aen-list-hd {
  margin: 0 0 8px; font-family: var(--mono); font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ink);
}
.aen-list-hd span { font-weight: 400; color: var(--color-ink-4); margin-left: 6px; letter-spacing: 0.06em; }
.aen-ties, .aen-context { list-style: none; margin: 0; padding: 0; }
.aen-ties li {
  display: grid; grid-template-columns: minmax(0, 1fr) 64px 48px; align-items: center; gap: 10px;
  padding: 6px 0; border-bottom: 1px dotted var(--color-rule-soft);
}
.aen-tie-names { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.aen-tie-names a, .aen-context a { color: var(--color-ink); text-decoration: none; }
.aen-tie-names a:hover, .aen-context a:hover { text-decoration: underline; text-underline-offset: 2px; }
.aen-tie-x { color: var(--color-ink-4); margin: 0 5px; }
.aen-tie-bar { height: 4px; background: var(--color-paper-2); }
.aen-tie-bar span { display: block; height: 100%; background: var(--color-ink-3); border-radius: 0 2px 2px 0; }
.aen-ties .aen-num { text-align: right; }
.aen-context li {
  display: grid; grid-template-columns: 15px minmax(0, 1fr) auto; align-items: center; gap: 8px;
  padding: 5px 0; border-bottom: 1px dotted var(--color-rule-soft); font-size: 13px;
}
.aen-context a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
