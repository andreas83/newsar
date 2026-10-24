<script lang="ts">
export type HourBucket = {
  hour: string
  total: number
  prev: number
  partial: boolean
  cats: Record<string, number>
  prevCats: Record<string, number>
}
export type Place = { id: number; name: string; slug: string; n: number; prev: number; hours: number[] }
export type WireArticle = {
  articleId: number
  title: string
  publishedAt: string
  feedName: string
  category: string
  hourIndex: number
  places: Array<{ name: string; slug: string }>
}
export type Activity = {
  windowStart: string
  generatedAt: string
  total: number
  prevTotal: number
  hours: HourBucket[]
  categories: Record<string, { n: number; prev: number }>
  places: Place[]
  placeCount: number
  articles: WireArticle[]
}
</script>

<script setup lang="ts">
const props = defineProps<{
  activity: Activity | null | undefined
  colors: Record<string, string>
  mappedIds: Set<number>
  loading?: boolean
}>()
const emit = defineEmits<{ (e: 'select-place', id: number): void }>()

// Fixed topic order: colour follows the topic, never its rank
const TOPICS = ['conflict', 'politics', 'economy', 'diplomacy', 'health', 'environment', 'technology', 'society', 'other', 'pending']
const TOPIC_LABEL: Record<string, string> = { pending: 'Not yet analysed' }
const topicLabel = (c: string) => TOPIC_LABEL[c] || c.charAt(0).toUpperCase() + c.slice(1)
const topicColor = (c: string) => `var(--c-${TOPICS.includes(c) ? c : 'other'})`
const colorVars = computed(() => Object.fromEntries(TOPICS.map(c => [`--c-${c}-l`, props.colors[c] || props.colors.other || '#6B6353'])))

const hours = computed(() => props.activity?.hours || [])
const focusCat = ref<string | null>(null)
const hoverIdx = ref<number | null>(null)
const pinnedIdx = ref<number | null>(null)
const showTable = ref(false)

// SSR renders UTC; the browser switches to the reader's own zone after hydration
const tz = ref('UTC')
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
  try { tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch {}
})
const tzShort = computed(() => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz.value, timeZoneName: 'short' }).formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value || tz.value
  } catch { return tz.value }
})
function clock(d: string | number | Date) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz.value }).format(new Date(d))
}
function localHour(d: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz.value }).format(new Date(d)))
}
function weekday(d: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', timeZone: tz.value }).format(new Date(d))
}
function hourRange(i: number) {
  const b = hours.value[i]
  if (!b) return ''
  if (b.partial) return `${clock(b.hour)} – now`
  return `${clock(b.hour)} – ${clock(new Date(b.hour).getTime() + 3600_000)}`
}
function signed(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0'
}
function pctChange(n: number, prev: number) {
  if (!prev) return null
  return Math.round(((n - prev) / prev) * 100)
}
function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

// Series under the current emphasis
const valueAt = (b: HourBucket) => focusCat.value ? (b.cats[focusCat.value] || 0) : b.total
const prevAt = (b: HourBucket) => focusCat.value ? (b.prevCats[focusCat.value] || 0) : b.prev

// ── KPI tiles ──
const kpis = computed(() => {
  const a = props.activity
  if (!a) return null
  let peak = 0
  hours.value.forEach((b, i) => { if (b.total > hours.value[peak]!.total) peak = i })
  const lastFull = hours.value[hours.value.length - 2]
  return {
    total: a.total,
    delta: a.total - a.prevTotal,
    pct: pctChange(a.total, a.prevTotal),
    peakIdx: peak,
    peak: hours.value[peak],
    lastFull,
    places: a.placeCount,
    topPlace: a.places[0]?.name,
    pending: a.categories.pending?.n || 0,
  }
})

// ── Main chart geometry ──
const chartHost = ref<HTMLElement | null>(null)
const width = ref(760)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!chartHost.value) return
  ro = new ResizeObserver(entries => {
    const w = entries[0]?.contentRect.width
    if (w) width.value = Math.max(320, Math.round(w))
  })
  ro.observe(chartHost.value)
})
onBeforeUnmount(() => ro?.disconnect())

const M = { top: 22, right: 8, bottom: 40, left: 34 }
const PLOT_H = 190
const H = PLOT_H + M.top + M.bottom

function niceStep(max: number) {
  const raw = max / 4
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s >= raw) return s
  return Math.ceil(raw / 1000) * 1000
}

const geom = computed(() => {
  const hs = hours.value
  const plotW = width.value - M.left - M.right
  const band = plotW / Math.max(1, hs.length)
  const barW = Math.max(4, Math.min(24, band - 4))
  const rawMax = Math.max(1, ...hs.map(b => Math.max(valueAt(b), prevAt(b))))
  const step = niceStep(rawMax)
  const yMax = Math.ceil(rawMax / step) * step
  const y = (v: number) => M.top + PLOT_H - (v / yMax) * PLOT_H
  const ticks: number[] = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)

  const bars = hs.map((b, i) => {
    const cx = M.left + band * i + band / 2
    const x = cx - barW / 2
    const total = b.total
    const focus = focusCat.value ? (b.cats[focusCat.value] || 0) : total
    return { i, b, cx, x, total, focus, yTotal: y(total), yFocus: y(focus) }
  })

  // "Same hour yesterday" as a step line, one flat segment per band
  let prevPath = ''
  hs.forEach((b, i) => {
    const x0 = M.left + band * i + 1
    const x1 = M.left + band * (i + 1) - 1
    const yy = y(prevAt(b))
    prevPath += `M${x0.toFixed(1)},${yy.toFixed(1)}H${x1.toFixed(1)}`
  })

  let peakIdx = 0
  hs.forEach((b, i) => { if (valueAt(b) > valueAt(hs[peakIdx]!)) peakIdx = i })

  const labels = hs.map((b, i) => {
    const lh = localHour(b.hour)
    return { i, cx: M.left + band * i + band / 2, text: clock(b.hour), show: i % 3 === 0 && i < hs.length - 1, day: lh === 0 && i > 0 ? weekday(b.hour) : null, dayX: M.left + band * i }
  })

  return { plotW, band, barW, yMax, y, ticks, bars, prevPath, peakIdx, labels }
})

// Column with a 4px rounded data-end, square at the baseline
function colPath(x: number, w: number, yTop: number, yBase: number) {
  const h = yBase - yTop
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`
}

const activeIdx = computed(() => hoverIdx.value ?? pinnedIdx.value)

function onChartKey(e: KeyboardEvent) {
  const n = hours.value.length
  if (!n) return
  const cur = activeIdx.value ?? n - 1
  if (e.key === 'ArrowLeft') { hoverIdx.value = Math.max(0, cur - 1); e.preventDefault() }
  else if (e.key === 'ArrowRight') { hoverIdx.value = Math.min(n - 1, cur + 1); e.preventDefault() }
  else if (e.key === 'Enter' || e.key === ' ') { togglePin(cur); e.preventDefault() }
  else if (e.key === 'Escape') { pinnedIdx.value = null; hoverIdx.value = null }
}
function togglePin(i: number) {
  pinnedIdx.value = pinnedIdx.value === i ? null : i
}

// Tooltip contents for the active hour
const tip = computed(() => {
  const i = activeIdx.value
  if (i === null) return null
  const b = hours.value[i]
  if (!b) return null
  const g = geom.value
  const cats = TOPICS
    .map(c => ({ c, n: b.cats[c] || 0 }))
    .filter(r => r.n > 0)
    .sort((a, z) => z.n - a.n)
  const placeCounts = new Map<string, number>()
  for (const a of props.activity?.articles || []) {
    if (a.hourIndex !== i) continue
    for (const p of a.places) placeCounts.set(p.name, (placeCounts.get(p.name) || 0) + 1)
  }
  const places = [...placeCounts.entries()].sort((a, z) => z[1] - a[1]).slice(0, 3)
  const left = Math.min(Math.max(g.bars[i]!.cx, 120), width.value - 120)
  return { i, b, cats: cats.slice(0, 5), more: Math.max(0, cats.length - 5), places, left, value: valueAt(b), prev: prevAt(b) }
})

// ── Topics ──
// Shares are of analysed articles only: the newest hours always carry a backlog of
// unanalysed ones, so raw counts would make every topic look like it is falling.
const topicRows = computed(() => {
  const cats = props.activity?.categories || {}
  const get = (c: string) => ({ n: cats[c]?.n || 0, prev: cats[c]?.prev || 0 })
  const base = { n: 0, prev: 0 }
  for (const [c, v] of Object.entries(cats)) if (c !== 'pending') { base.n += v.n; base.prev += v.prev }
  const share = (v: number, d: number) => d ? v / d : 0
  const named = TOPICS.filter(c => c !== 'other' && c !== 'pending')
    .map(c => {
      const v = get(c)
      return { c, ...v, s: share(v.n, base.n), ps: share(v.prev, base.prev) }
    })
    .filter(r => r.n || r.prev)
    .sort((a, z) => z.s - a.s)
  const max = Math.max(0.01, ...named.map(r => Math.max(r.s, r.ps)))
  return { named, max, base, other: get('other'), pending: get('pending') }
})
function pts(r: { s: number; ps: number }) {
  const d = Math.round((r.s - r.ps) * 1000) / 10
  return d > 0 ? `+${d.toFixed(1)}` : d < 0 ? `−${Math.abs(d).toFixed(1)}` : '±0'
}
function toggleFocus(c: string) {
  focusCat.value = focusCat.value === c ? null : c
}

// ── Places ──
const placeMax = computed(() => Math.max(1, ...(props.activity?.places || []).flatMap(p => p.hours)))
function heat(n: number) {
  if (!n) return 0
  return 0.22 + 0.78 * (n / placeMax.value)
}
function pickPlace(p: Place) {
  if (props.mappedIds.has(p.id)) emit('select-place', p.id)
  else navigateTo(`/location/${p.slug}`)
}

// ── Wire (articles), scoped by the pinned hour and the topic emphasis ──
const wireLimit = ref(30)
const wire = computed(() => {
  let list = props.activity?.articles || []
  if (pinnedIdx.value !== null) list = list.filter(a => a.hourIndex === pinnedIdx.value)
  if (focusCat.value) list = list.filter(a => a.category === focusCat.value)
  return list
})
watch([pinnedIdx, focusCat], () => { wireLimit.value = 30 })
</script>

<template>
  <div class="act" :class="{ loading }" :style="colorVars">
    <!-- KPI row -->
    <div v-if="kpis" class="kpis">
      <div class="kpi">
        <div class="label">Articles, last 24h</div>
        <div class="value">{{ kpis.total.toLocaleString('en-US') }}</div>
        <div class="delta">
          <template v-if="kpis.pct !== null">{{ kpis.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(kpis.pct) }}%</template>
          <span>vs previous 24h ({{ (kpis.total - kpis.delta).toLocaleString('en-US') }})</span>
        </div>
      </div>
      <button type="button" class="kpi kpi-btn" @click="togglePin(kpis.peakIdx)">
        <div class="label">Busiest hour</div>
        <div class="value">{{ kpis.peak ? clock(kpis.peak.hour) : '—' }}</div>
        <div class="delta"><span>{{ kpis.peak?.total || 0 }} articles · {{ pinnedIdx === kpis.peakIdx ? 'showing below' : 'show articles' }}</span></div>
      </button>
      <div class="kpi">
        <div class="label">Last full hour</div>
        <div class="value">{{ kpis.lastFull?.total || 0 }}</div>
        <div class="delta"><span>{{ kpis.lastFull ? hourRange(hours.length - 2) : '' }} · {{ kpis.lastFull?.prev || 0 }} same hour yesterday</span></div>
      </div>
      <div class="kpi">
        <div class="label">Places in the news</div>
        <div class="value">{{ kpis.places }}</div>
        <div class="delta"><span v-if="kpis.topPlace">most covered: {{ kpis.topPlace }}</span></div>
      </div>
    </div>

    <div class="grid-top">
      <!-- Main chart -->
      <section class="card chart-card">
        <header class="card-hd">
          <div>
            <h3>{{ focusCat ? `${topicLabel(focusCat)} articles per hour` : 'Articles per hour' }}</h3>
            <p class="sub">
              Each column is one clock hour, times in {{ tzShort }}.
              <template v-if="focusCat">Gray is all other topics.</template>
            </p>
          </div>
          <div class="hd-tools">
            <span class="key"><i class="key-bar" :style="focusCat ? { background: topicColor(focusCat) } : {}" /> Last 24h</span>
            <span class="key"><i class="key-line" /> Same hour yesterday</span>
            <button v-if="focusCat" type="button" class="chip" @click="focusCat = null">{{ topicLabel(focusCat) }} <span aria-hidden="true">×</span></button>
            <button type="button" class="chip" :aria-pressed="showTable" @click="showTable = !showTable">{{ showTable ? 'Chart' : 'Table' }}</button>
          </div>
        </header>

        <div v-show="!showTable" ref="chartHost" class="chart-host">
          <svg
            :width="width" :height="H" :viewBox="`0 0 ${width} ${H}`"
            role="img"
            :aria-label="`Articles per hour over the last 24 hours, ${activity?.total || 0} in total. Use left and right arrow keys to move between hours, Enter to list that hour's articles.`"
            tabindex="0"
            class="chart"
            @keydown="onChartKey"
            @mouseleave="hoverIdx = null"
            @blur="hoverIdx = null"
          >

            <!-- grid + y ticks -->
            <g class="grid">
              <g v-for="t in geom.ticks" :key="t">
                <line :x1="M.left" :x2="width - M.right" :y1="geom.y(t)" :y2="geom.y(t)" :class="{ base: t === 0 }" />
                <text :x="M.left - 8" :y="geom.y(t) + 3" text-anchor="end">{{ t }}</text>
              </g>
            </g>

            <!-- day boundary -->
            <g v-for="l in geom.labels.filter(l => l.day)" :key="'d' + l.i" class="daymark">
              <line :x1="l.dayX" :x2="l.dayX" :y1="M.top - 10" :y2="M.top + PLOT_H" />
              <text :x="l.dayX + 4" :y="M.top - 4">{{ l.day }}</text>
            </g>

            <!-- active band wash -->
            <rect
              v-if="activeIdx !== null"
              :x="M.left + geom.band * activeIdx" :y="M.top - 6"
              :width="geom.band" :height="PLOT_H + 6"
              class="band-wash"
            />

            <!-- columns -->
            <g v-for="bar in geom.bars" :key="bar.b.hour" class="col" :class="{ dim: pinnedIdx !== null && pinnedIdx !== bar.i }">
              <template v-if="focusCat">
                <!-- context: the rest of the hour in gray, a 2px surface gap above the focus segment -->
                <path
                  v-if="bar.total > bar.focus"
                  :d="colPath(bar.x, geom.barW, bar.yTotal, bar.focus ? bar.yFocus - 2 : geom.y(0))"
                  class="ctx"
                />
                <path
                  v-if="bar.focus"
                  :d="bar.total > bar.focus
                    ? `M${bar.x},${geom.y(0)}V${bar.yFocus}H${bar.x + geom.barW}V${geom.y(0)}Z`
                    : colPath(bar.x, geom.barW, bar.yFocus, geom.y(0))"
                  :style="{ fill: topicColor(focusCat) }"
                  :class="{ partial: bar.b.partial }"
                />
              </template>
              <path
                v-else
                :d="colPath(bar.x, geom.barW, bar.yTotal, geom.y(0))"
                class="main"
                :class="{ partial: bar.b.partial }"
              />
            </g>

            <!-- yesterday -->
            <path :d="geom.prevPath" class="prev-line" />

            <!-- direct labels: the peak, and the live hour -->
            <g class="dlabel">
              <text
                v-if="geom.bars[geom.peakIdx] && valueAt(geom.bars[geom.peakIdx]!.b) > 0 && geom.peakIdx !== geom.bars.length - 1"
                :x="geom.bars[geom.peakIdx]!.cx"
                :y="geom.y(valueAt(geom.bars[geom.peakIdx]!.b)) - 6"
                text-anchor="middle"
              >{{ valueAt(geom.bars[geom.peakIdx]!.b) }}</text>
              <text
                v-if="geom.bars.length"
                :x="geom.bars[geom.bars.length - 1]!.cx"
                :y="geom.y(valueAt(geom.bars[geom.bars.length - 1]!.b)) - 6"
                text-anchor="middle"
                class="live"
              >{{ valueAt(geom.bars[geom.bars.length - 1]!.b) }}</text>
            </g>

            <!-- x axis -->
            <g class="xaxis">
              <template v-for="l in geom.labels" :key="'x' + l.i">
                <text v-if="l.show" :x="l.cx" :y="M.top + PLOT_H + 16" text-anchor="middle">{{ l.text }}</text>
              </template>
              <g v-if="geom.labels.length" :transform="`translate(${geom.labels[geom.labels.length - 1]!.cx}, ${M.top + PLOT_H + 16})`">
                <circle cx="-17" cy="-3.5" r="3" class="live-dot" />
                <text x="-10" text-anchor="start" class="now">NOW</text>
              </g>
              <text v-if="pinnedIdx !== null && geom.bars[pinnedIdx]" :x="geom.bars[pinnedIdx]!.cx" :y="M.top + PLOT_H + 32" text-anchor="middle" class="pin">▲ {{ clock(geom.bars[pinnedIdx]!.b.hour) }}</text>
            </g>

            <!-- hit targets: the whole band, not just the painted column -->
            <rect
              v-for="bar in geom.bars"
              :key="'h' + bar.i"
              :x="M.left + geom.band * bar.i" :y="M.top - 10"
              :width="geom.band" :height="PLOT_H + 30"
              class="hit"
              @mouseenter="hoverIdx = bar.i"
              @click="togglePin(bar.i)"
            />
          </svg>

          <!-- tooltip -->
          <div v-if="tip" class="tip" :style="{ left: tip.left + 'px' }" role="status">
            <div class="tip-when">{{ hourRange(tip.i) }} <span v-if="tip.b.partial">· so far</span></div>
            <div class="tip-val"><b>{{ tip.value }}</b> {{ focusCat ? topicLabel(focusCat).toLowerCase() + ' ' : '' }}article{{ tip.value === 1 ? '' : 's' }}</div>
            <div class="tip-cmp">
              {{ signed(tip.value - tip.prev) }} vs {{ tip.b.partial ? 'this time' : 'same hour' }} yesterday ({{ tip.prev }})
            </div>
            <div v-if="tip.cats.length && !focusCat" class="tip-rows">
              <div v-for="r in tip.cats" :key="r.c" class="tip-row">
                <i :style="{ background: topicColor(r.c) }" :class="{ hatched: r.c === 'pending' }" />
                <b>{{ r.n }}</b><span>{{ topicLabel(r.c) }}</span>
              </div>
              <div v-if="tip.more" class="tip-more">+{{ tip.more }} more topics</div>
            </div>
            <div v-if="tip.places.length" class="tip-places">
              <span class="k">Places</span> {{ tip.places.map(p => p[0]).join(' · ') }}
            </div>
            <div class="tip-hint">{{ pinnedIdx === tip.i ? 'Click again to show all hours' : 'Click to list this hour\'s articles' }}</div>
          </div>
        </div>

        <div v-if="showTable" class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th>Hour ({{ tzShort }})</th><th class="num">Articles</th><th class="num">Yesterday</th><th class="num">Change</th><th>Top topic</th></tr>
            </thead>
            <tbody>
              <tr v-for="(b, i) in hours" :key="b.hour" :class="{ pinned: pinnedIdx === i }" @click="togglePin(i)">
                <td>{{ hourRange(i) }}</td>
                <td class="num">{{ valueAt(b) }}</td>
                <td class="num">{{ prevAt(b) }}</td>
                <td class="num">{{ signed(valueAt(b) - prevAt(b)) }}</td>
                <td>{{ topicLabel(Object.entries(b.cats).filter(([c]) => c !== 'pending' && c !== 'other').sort((a, z) => z[1] - a[1])[0]?.[0] || '—') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Wire -->
      <aside class="card wire-card">
        <header class="card-hd">
          <div>
            <h3>Wire</h3>
            <p class="sub">
              <template v-if="pinnedIdx !== null">{{ hourRange(pinnedIdx) }}</template>
              <template v-else>Newest first</template>
              · {{ wire.length }} article{{ wire.length === 1 ? '' : 's' }}<template v-if="focusCat"> on {{ topicLabel(focusCat).toLowerCase() }}</template>
            </p>
          </div>
          <button v-if="pinnedIdx !== null" type="button" class="chip" @click="pinnedIdx = null">All hours <span aria-hidden="true">×</span></button>
        </header>
        <div class="wire">
          <NuxtLink v-for="a in wire.slice(0, wireLimit)" :key="a.articleId" :to="`/articles/${a.articleId}`" class="wire-row">
            <div class="time">
              <b>{{ clock(a.publishedAt) }}</b>
              <span v-if="mounted">{{ timeAgo(a.publishedAt) }}</span>
            </div>
            <div class="title">
              {{ a.title }}
              <small>
                <template v-if="a.places.length">{{ a.places.map(p => p.name).join(', ') }} · </template>{{ a.feedName }}
              </small>
            </div>
            <span v-if="a.category !== 'pending'" class="tag"><i :style="{ background: topicColor(a.category) }" />{{ a.category.slice(0, 4) }}</span>
            <span v-else />
          </NuxtLink>
          <button v-if="wire.length > wireLimit" type="button" class="more" @click="wireLimit += 30">Show {{ Math.min(30, wire.length - wireLimit) }} more</button>
          <div v-if="!wire.length" class="empty">No articles in this slice.</div>
        </div>
      </aside>
    </div>

    <div class="grid-bottom">
      <!-- Topics -->
      <section class="card">
        <header class="card-hd">
          <div>
            <h3>What it was about</h3>
            <p class="sub">Bar is the last 24h, tick is the previous 24h. Click a topic to highlight it in the chart.</p>
          </div>
        </header>
        <div class="topics">
          <div class="topic-axis" aria-hidden="true">
            <span />
            <span>Share of analysed articles</span>
            <span class="n">24h</span>
            <span class="d">pts</span>
          </div>
          <button
            v-for="r in topicRows.named"
            :key="r.c"
            type="button"
            class="topic"
            :class="{ on: focusCat === r.c, off: focusCat && focusCat !== r.c }"
            :aria-pressed="focusCat === r.c"
            :title="`${topicLabel(r.c)}: ${r.n} articles, ${(r.s * 100).toFixed(1)}% of analysed (previous 24h: ${r.prev}, ${(r.ps * 100).toFixed(1)}%)`"
            @click="toggleFocus(r.c)"
          >
            <span class="nm"><i :style="{ background: topicColor(r.c) }" />{{ topicLabel(r.c) }}</span>
            <span class="track">
              <span class="fill" :style="{ width: (r.s / topicRows.max) * 100 + '%', background: topicColor(r.c) }" />
              <span class="tick" :style="{ left: `calc(${(r.ps / topicRows.max) * 100}% - 1px)` }" />
              <span class="pct" :style="{ left: `calc(${(Math.max(r.s, r.ps) / topicRows.max) * 100}% + 6px)` }">{{ Math.round(r.s * 100) }}%</span>
            </span>
            <span class="n">{{ r.n }}</span>
            <span class="d">{{ pts(r) }}</span>
          </button>
          <div class="coverage">
            <div class="cov-bar" role="img" :aria-label="`${topicRows.base.n - topicRows.other.n} with a topic, ${topicRows.other.n} other, ${topicRows.pending.n} not yet analysed`">
              <span class="cov-k" :style="{ flex: topicRows.base.n - topicRows.other.n }" />
              <span class="cov-o" :style="{ flex: topicRows.other.n }" />
              <span class="cov-p hatched" :style="{ flex: topicRows.pending.n }" />
            </div>
            <div class="cov-legend">
              <span><i class="cov-k" />{{ topicRows.base.n - topicRows.other.n }} with a topic</span>
              <button type="button" :class="{ on: focusCat === 'other' }" @click="toggleFocus('other')"><i class="cov-o" />{{ topicRows.other.n }} other</button>
              <button type="button" :class="{ on: focusCat === 'pending' }" @click="toggleFocus('pending')"><i class="cov-p hatched" />{{ topicRows.pending.n }} not yet analysed</button>
            </div>
          </div>
        </div>
        <p class="foot">Topics come from AI-extracted keywords. The newest articles are still in the analysis queue, so shares only count analysed ones; "pts" is the change in share against the previous 24h.</p>
      </section>

      <!-- Places -->
      <section class="card">
        <header class="card-hd">
          <div>
            <h3>Where it happened</h3>
            <p class="sub">Most-mentioned places, hour by hour. Darker means more articles.</p>
          </div>
        </header>
        <div class="places">
          <div class="place-axis" aria-hidden="true">
            <span />
            <span class="strip-axis"><span>−24h</span><span>−12h</span><span>now</span></span>
            <span class="n">24h</span>
            <span class="d">vs prev</span>
          </div>
          <div v-for="p in activity?.places || []" :key="p.id" class="place">
            <button type="button" class="nm" :title="mappedIds.has(p.id) ? 'Show on map' : 'Open location brief'" @click="pickPlace(p)">
              {{ p.name }}<span v-if="mappedIds.has(p.id)" class="pin-ico" aria-hidden="true">◎</span>
            </button>
            <span class="strip" @mouseleave="hoverIdx = null">
              <span
                v-for="(n, i) in p.hours"
                :key="i"
                class="cell"
                :class="{ active: activeIdx === i }"
                :style="{ '--a': heat(n) }"
                :title="`${p.name} · ${hourRange(i)}: ${n} article${n === 1 ? '' : 's'}`"
                @mouseenter="hoverIdx = i"
              />
            </span>
            <span class="n">{{ p.n }}</span>
            <span class="d">{{ p.prev ? signed(p.n - p.prev) : 'new' }}</span>
          </div>
          <div v-if="!activity?.places?.length" class="empty">No places mentioned yet.</div>
        </div>
        <p class="foot">◎ places are on the map above; click one to fly there. Others open their location brief.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.act {
  transition: opacity 0.2s;
  --c-conflict: var(--c-conflict-l); --c-politics: var(--c-politics-l); --c-economy: var(--c-economy-l);
  --c-diplomacy: var(--c-diplomacy-l); --c-health: var(--c-health-l); --c-environment: var(--c-environment-l);
  --c-technology: var(--c-technology-l); --c-society: var(--c-society-l); --c-other: var(--c-other-l);
  --c-pending: var(--color-ink-4);
}
/* Dark mode: lighter steps of the same hues, validated against the dark panel */
html.dark .act {
  --c-conflict: #EF4444; --c-politics: #8B5CF6; --c-economy: #F59E0B; --c-diplomacy: #3B82F6;
  --c-health: #10B981; --c-environment: #84CC16; --c-technology: #06B6D4; --c-society: #F97316; --c-other: #8A8475;
}
.act.loading { opacity: 0.6; }

.card { background: var(--color-panel); border: 1px solid var(--color-rule); min-width: 0; }
.card-hd {
  padding: 12px 14px; border-bottom: 1px solid var(--color-rule);
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;
}
.card-hd h3 { margin: 0; font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 15px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.01em; }
.card-hd .sub { margin: 3px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-3); }
.hd-tools { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2); }
.key { display: inline-flex; align-items: center; gap: 6px; }
.key-bar { width: 8px; height: 12px; border-radius: 2px 2px 0 0; background: var(--color-ink-2); display: inline-block; }
.key-line { width: 14px; height: 0; border-top: 2px solid var(--color-ink-4); display: inline-block; }
.chip {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 4px 8px; border: 1px solid var(--color-rule); background: var(--color-paper); color: var(--color-ink); cursor: pointer;
}
.chip:hover { border-color: var(--color-ink-3); }
.chip[aria-pressed="true"] { background: var(--color-ink); color: var(--color-paper); border-color: var(--color-ink); }

/* KPI row */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--color-rule); background: var(--color-panel); margin-bottom: var(--gap-md); }
.kpi { padding: 14px 16px; border-right: 1px solid var(--color-rule); text-align: left; min-width: 0; }
.kpi:last-child { border-right: 0; }
.kpi-btn { background: transparent; border-top: 0; border-bottom: 0; border-left: 0; cursor: pointer; font: inherit; color: inherit; }
.kpi-btn:hover { background: var(--color-paper); }
.kpi .label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-ink-3); margin-bottom: 6px; }
.kpi .value { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 30px; font-weight: 600; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1; }
.kpi .delta { font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink); margin-top: 6px; font-weight: 600; line-height: 1.4; }
.kpi .delta span { color: var(--color-ink-3); font-weight: 500; margin-left: 2px; }

.grid-top { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: var(--gap-md); }
.grid-bottom { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: var(--gap-md); margin-top: var(--gap-md); }

/* Chart */
.chart-host { position: relative; padding: 8px 14px 4px; }
.chart { display: block; outline: none; overflow: visible; }
.chart:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.grid line { stroke: var(--color-rule-soft); stroke-width: 1; shape-rendering: crispEdges; }
.grid line.base { stroke: var(--color-rule); }
.grid text, .xaxis text, .daymark text { font-family: var(--font-mono); font-size: 10px; fill: var(--color-ink-3); font-variant-numeric: tabular-nums; }
.daymark line { stroke: var(--color-rule); stroke-width: 1; shape-rendering: crispEdges; }
.daymark text { font-weight: 600; fill: var(--color-ink-2); text-transform: uppercase; letter-spacing: 0.06em; }
.xaxis .now { font-weight: 700; fill: var(--color-ink); letter-spacing: 0.08em; }
.xaxis .pin { font-weight: 700; fill: var(--color-ink); }
.live-dot { fill: var(--color-red); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .live-dot { animation: none; } }
.band-wash { fill: var(--color-ink); opacity: 0.05; }
.col path.main { fill: var(--color-ink-2); }
.col path.ctx { fill: var(--color-rule); }
.col.dim { opacity: 0.35; }
.col path { transition: opacity 0.15s; }
.col path.partial { opacity: 0.5; }
.prev-line { fill: none; stroke: var(--color-ink-4); stroke-width: 2; stroke-linecap: round; pointer-events: none; }
.dlabel text { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; fill: var(--color-ink); font-variant-numeric: tabular-nums; }
.hit { fill: transparent; cursor: pointer; }

.tip {
  position: absolute; top: 4px; transform: translateX(-50%); width: 220px; pointer-events: none; z-index: 5;
  background: var(--color-panel); border: 1px solid var(--color-rule); box-shadow: 0 6px 20px var(--color-card-shadow);
  padding: 10px 12px; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2);
}
.tip-when { color: var(--color-ink-3); text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
.tip-val { margin-top: 4px; font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 13px; color: var(--color-ink-2); }
.tip-val b { font-size: 20px; color: var(--color-ink); font-weight: 600; margin-right: 2px; }
.tip-cmp { color: var(--color-ink-3); margin-top: 2px; }
.tip-rows { border-top: 1px solid var(--color-rule-soft); margin-top: 8px; padding-top: 6px; display: flex; flex-direction: column; gap: 3px; }
.tip-row { display: grid; grid-template-columns: 14px 22px 1fr; align-items: center; gap: 6px; }
.tip-row i { height: 2px; width: 12px; display: inline-block; }
.tip-row i.hatched { height: 2px; background: var(--color-ink-4) !important; }
.tip-row b { color: var(--color-ink); text-align: right; font-variant-numeric: tabular-nums; }
.tip-more { color: var(--color-ink-3); padding-left: 48px; }
.tip-places { border-top: 1px solid var(--color-rule-soft); margin-top: 6px; padding-top: 6px; color: var(--color-ink); line-height: 1.4; }
.tip-places .k { color: var(--color-ink-3); text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.06em; margin-right: 4px; }
.tip-hint { margin-top: 6px; color: var(--color-ink-4); font-size: 9.5px; }

.table-wrap { max-height: 300px; overflow: auto; }
.tbl { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 11px; }
.tbl th { position: sticky; top: 0; background: var(--color-paper); text-align: left; font-weight: 600; color: var(--color-ink-3); text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; padding: 8px 14px; border-bottom: 1px solid var(--color-rule); }
.tbl td { padding: 6px 14px; border-bottom: 1px solid var(--color-rule-soft); color: var(--color-ink-2); }
.tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl tr { cursor: pointer; }
.tbl tbody tr:hover, .tbl tr.pinned { background: var(--color-paper); }

/* Wire */
/* The chart sets the row height; the wire scrolls within it */
.wire-card { display: flex; flex-direction: column; height: 0; min-height: 100%; }
.wire { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
.wire-row {
  display: grid; grid-template-columns: 48px 1fr auto; gap: 10px; padding: 9px 14px;
  border-bottom: 1px solid var(--color-rule-soft); align-items: start;
  font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2); text-decoration: none;
}
.wire-row:hover { background: var(--color-paper); }
.wire-row .time b { color: var(--color-ink); display: block; font-variant-numeric: tabular-nums; }
.wire-row .time span { color: var(--color-ink-4); font-size: 9.5px; }
.wire-row .title { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 12.5px; font-weight: 600; color: var(--color-ink); line-height: 1.3; }
.wire-row .title small { display: block; font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); margin-top: 3px; font-weight: 500; }
.wire-row .tag { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; text-transform: uppercase; color: var(--color-ink-3); font-weight: 600; padding-top: 2px; }
.wire-row .tag i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.more { padding: 10px; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2); background: var(--color-paper); border: 0; cursor: pointer; text-transform: uppercase; letter-spacing: 0.06em; }
.more:hover { color: var(--color-ink); }
.empty { padding: 20px; text-align: center; color: var(--color-ink-3); font-family: var(--font-mono); font-size: 11px; }

.hatched { background: repeating-linear-gradient(45deg, var(--color-ink-4) 0 2px, transparent 2px 5px) !important; }

/* Topics */
.topics { padding: 8px 6px; display: flex; flex-direction: column; }
.topic-axis { display: grid; grid-template-columns: 130px 1fr 36px 44px; gap: 10px; padding: 0 8px 4px; font-family: var(--font-mono); font-size: 9.5px; color: var(--color-ink-4); text-transform: uppercase; letter-spacing: 0.06em; }
.topic-axis .n, .topic-axis .d { text-align: right; }
.topic {
  display: grid; grid-template-columns: 130px 1fr 36px 44px; align-items: center; gap: 10px;
  padding: 6px 8px; background: transparent; border: 0; cursor: pointer; text-align: left;
  font-family: var(--font-mono); font-size: 11px; color: var(--color-ink-2); transition: opacity 0.15s;
}
.topic:hover { background: var(--color-paper); }
.topic.on { background: var(--color-paper); box-shadow: inset 2px 0 0 var(--color-ink); }
.topic.off { opacity: 0.45; }
.topic .nm { display: inline-flex; align-items: center; gap: 8px; color: var(--color-ink); font-weight: 600; }
.topic .nm i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; flex: none; }
.topic .track { position: relative; height: 10px; }
.topic .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 3px 3px 0; min-width: 0; }
.topic .tick { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--color-ink); border-radius: 1px; }
.topic .pct { position: absolute; top: 50%; transform: translateY(-50%); font-size: 10px; color: var(--color-ink-3); font-variant-numeric: tabular-nums; }
.topic .track { margin-right: 34px; }
.topic .n { text-align: right; color: var(--color-ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.topic .d { text-align: right; color: var(--color-ink-3); font-variant-numeric: tabular-nums; }
.coverage { margin: 8px 8px 4px; padding-top: 10px; border-top: 1px solid var(--color-rule-soft); }
.cov-bar { display: flex; gap: 2px; height: 8px; }
.cov-bar span { border-radius: 2px; min-width: 0; }
.cov-k { background: var(--color-ink-2); }
.cov-o { background: var(--color-ink-4); }
.cov-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2); }
.cov-legend > * { display: inline-flex; align-items: center; gap: 6px; }
.cov-legend button { background: transparent; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.cov-legend button:hover, .cov-legend button.on { color: var(--color-ink); text-decoration: underline; text-underline-offset: 2px; }
.cov-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.foot { margin: 0; padding: 10px 14px; border-top: 1px solid var(--color-rule-soft); font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); line-height: 1.5; }

/* Places */
.places { padding: 8px 14px; }
.place-axis, .place { display: grid; grid-template-columns: 130px 1fr 34px 44px; gap: 10px; align-items: center; }
.place-axis { font-family: var(--font-mono); font-size: 9.5px; color: var(--color-ink-4); text-transform: uppercase; letter-spacing: 0.06em; padding-bottom: 4px; }
.place-axis .n, .place-axis .d { text-align: right; }
.strip-axis { display: flex; justify-content: space-between; }
.place { padding: 4px 0; font-family: var(--font-mono); font-size: 11px; }
.place .nm {
  background: transparent; border: 0; padding: 0; cursor: pointer; text-align: left;
  font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 12.5px; font-weight: 600; color: var(--color-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.place .nm:hover { text-decoration: underline; text-underline-offset: 2px; }
.pin-ico { color: var(--color-ink-3); margin-left: 5px; font-size: 10px; }
.strip { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; height: 16px; }
.cell { background: var(--color-paper-2); border-radius: 2px; position: relative; }
.cell::after { content: ''; position: absolute; inset: 0; border-radius: 2px; background: var(--color-accent); opacity: var(--a); }
.cell.active { outline: 1.5px solid var(--color-ink); outline-offset: 0; z-index: 1; }
.place .n { text-align: right; color: var(--color-ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.place .d { text-align: right; color: var(--color-ink-3); font-variant-numeric: tabular-nums; }

@media (max-width: 1100px) {
  .grid-top, .grid-bottom { grid-template-columns: 1fr; }
  .wire-card { height: auto; min-height: 0; }
  .wire { max-height: 420px; }
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .kpi:nth-child(2) { border-right: 0; }
  .kpi:nth-child(-n+2) { border-bottom: 1px solid var(--color-rule); }
}
@media (max-width: 560px) {
  .topic, .topic-axis { grid-template-columns: 100px 1fr 30px 40px; gap: 6px; }
  .place-axis, .place { grid-template-columns: 90px 1fr 28px 36px; gap: 6px; }
  .kpi .value { font-size: 24px; }
}
</style>
