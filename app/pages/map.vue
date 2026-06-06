<script setup lang="ts">
type Hotspot = {
  id: number
  name: string
  slug: string
  shortDescription: string | null
  imageUrl: string | null
  mentionCount: number
  trendingScore: number
  articleCount: number
  articleCount24h: number
  lastMentioned: string | null
  avgBias: number | null
  avgSensationalism: number | null
  avgPropaganda: number | null
  categories: Record<string, number>
  topCategory: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  lat: number | null
  lon: number | null
}

type GeocodedHotspot = Hotspot & { lat: number; lon: number }

const CATEGORY_COLORS: Record<string, string> = {
  conflict: '#B91C1C',
  politics: '#6D28D9',
  economy: '#D97706',
  diplomacy: '#1D4ED8',
  health: '#059669',
  environment: '#15803D',
  technology: '#0891B2',
  society: '#C2410C',
  other: '#6B6353',
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

const windowHours = ref(168)
const activeCategories = ref<Set<string>>(new Set(['conflict', 'politics', 'economy', 'diplomacy', 'health', 'environment', 'technology', 'society', 'other']))
const activeSeverities = ref<Set<string>>(new Set(['critical', 'high', 'medium']))
const selectedId = ref<number | null>(null)

const { data, pending, refresh } = await useFetch<{
  hotspots: Hotspot[]
  timeline: Array<Record<string, any>>
  pings: Array<any>
  stats: {
    hotspotCount: number
    critical: number
    high: number
    medium: number
    low: number
    categoryTotals: Record<string, number>
    windowHours: number
  }
}>('/api/map/hotspots', {
  query: computed(() => ({ hours: windowHours.value, limit: 60 })),
})

const geocoded = ref<GeocodedHotspot[]>([])
const geocodePending = ref(false)
const mapContainer = ref<HTMLElement | null>(null)
let mapInstance: any = null
let markerLayer: any = null
let leaflet: any = null

async function geocodeAll() {
  if (!data.value?.hotspots) return
  geocodePending.value = true
  const results: GeocodedHotspot[] = []
  const needGeocode: string[] = []

  // Use server-provided coordinates; collect names that need geocoding
  for (const h of data.value.hotspots) {
    if (h.lat !== null && h.lon !== null) {
      results.push({ ...h, lat: h.lat, lon: h.lon })
    } else {
      needGeocode.push(h.name)
    }
  }

  // Batch-geocode missing locations via server endpoint (handles Nominatim + DB cache)
  if (needGeocode.length > 0) {
    try {
      const res = await $fetch<{ results: Record<string, { lat: number; lon: number } | null> }>('/api/map/geocode', {
        method: 'POST',
        body: { names: needGeocode },
      })
      for (const h of data.value.hotspots) {
        if (h.lat === null || h.lon === null) {
          const coords = res.results[h.name]
          if (coords) results.push({ ...h, ...coords })
        }
      }
    } catch (e) {
      console.warn('[Map] Batch geocode failed:', e)
    }
  }

  geocoded.value = results
  geocodePending.value = false
  renderMarkers()
}

const filtered = computed(() => {
  return geocoded.value.filter(h => {
    if (!activeCategories.value.has(h.topCategory)) return false
    if (!activeSeverities.value.has(h.severity)) return false
    return true
  })
})

const rankedList = computed(() => {
  return [...(data.value?.hotspots || [])]
    .filter(h => activeCategories.value.has(h.topCategory))
    .filter(h => activeSeverities.value.has(h.severity))
    .sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (s !== 0) return s
      return b.articleCount - a.articleCount
    })
})

const selected = computed(() => {
  if (selectedId.value === null) return rankedList.value[0] || null
  return rankedList.value.find(h => h.id === selectedId.value) || null
})

function selectHotspot(id: number) {
  selectedId.value = id
  const hs = geocoded.value.find(h => h.id === id)
  if (hs && mapInstance) {
    mapInstance.flyTo([hs.lat, hs.lon], Math.max(mapInstance.getZoom(), 5), { duration: 0.6 })
  }
}

function toggleCat(c: string) {
  if (activeCategories.value.has(c)) activeCategories.value.delete(c)
  else activeCategories.value.add(c)
  activeCategories.value = new Set(activeCategories.value)
  renderMarkers()
}
function toggleSev(s: string) {
  if (activeSeverities.value.has(s)) activeSeverities.value.delete(s)
  else activeSeverities.value.add(s)
  activeSeverities.value = new Set(activeSeverities.value)
  renderMarkers()
}

function renderMarkers() {
  if (!mapInstance || !leaflet) return
  if (markerLayer) markerLayer.clearLayers()
  else markerLayer = leaflet.layerGroup().addTo(mapInstance)

  for (const h of filtered.value) {
    const color = CATEGORY_COLORS[h.topCategory] || CATEGORY_COLORS.other
    const radius = Math.min(28, 6 + Math.sqrt(h.articleCount) * 2)
    const strokeWidth = h.severity === 'critical' ? 3 : h.severity === 'high' ? 2 : 1

    const circle = leaflet.circleMarker([h.lat, h.lon], {
      radius,
      color: '#fff',
      weight: strokeWidth,
      fillColor: color,
      fillOpacity: 0.85,
    })
    const lastSeen = h.lastMentioned ? timeAgo(h.lastMentioned) : '—'
    circle.bindTooltip(
      `<div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.35;">
        <div style="font-weight:700;color:#17140E;font-family:'IBM Plex Sans',sans-serif;font-size:13px;">${escapeHtml(h.name)}</div>
        <div style="color:#6B6353; margin:3px 0;">${h.topCategory.toUpperCase()} · ${h.severity.toUpperCase()}</div>
        <div><b>${h.articleCount}</b> articles · <b>${h.articleCount24h}</b> in 24h</div>
        <div style="color:#6B6353;">Last: ${lastSeen}</div>
      </div>`,
      { direction: 'top', offset: [0, -2], opacity: 1 }
    )
    circle.on('click', () => { selectedId.value = h.id })
    circle.addTo(markerLayer)
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function timeAgo(d: string | Date) {
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function severityColor(s: string) {
  if (s === 'critical') return '#B91C1C'
  if (s === 'high') return '#D97706'
  if (s === 'medium') return '#F59E0B'
  return '#6B6353'
}

function severityBg(s: string) {
  if (s === 'critical') return '#FEE2E2'
  if (s === 'high') return '#FEF3C7'
  if (s === 'medium') return '#FEF9E7'
  return '#EEEBE2'
}

function biasLabel(b: number | null) {
  if (b === null) return '—'
  if (b <= -0.6) return 'Far Left'
  if (b <= -0.2) return 'Center-Left'
  if (b < 0.2) return 'Center'
  if (b < 0.6) return 'Center-Right'
  return 'Far Right'
}

// Timeline sparkline
const timelineData = computed(() => {
  const buckets = data.value?.timeline || []
  const cats = ['conflict', 'politics', 'economy', 'diplomacy', 'health', 'environment', 'technology', 'society']
  const maxTotal = Math.max(1, ...buckets.map(b => cats.reduce((s, c) => s + (Number(b[c]) || 0), 0)))
  return { buckets, cats, maxTotal }
})

// Build stacked area SVG
function areaPoints(series: number[], offset: number[], max: number, w = 720, h = 140) {
  if (series.length === 0) return ''
  const step = w / Math.max(1, series.length - 1)
  const top = series.map((v, i) => {
    const x = i * step
    const y = h - ((v + offset[i]) / max) * (h - 10)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const bot = series.map((_, i) => {
    const x = (series.length - 1 - i) * step
    const y = h - (offset[series.length - 1 - i] / max) * (h - 10)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return [...top, ...bot].join(' ')
}

const stackedSeries = computed(() => {
  const { buckets, cats, maxTotal } = timelineData.value
  if (buckets.length === 0) return { layers: [], maxTotal }
  const offsets = new Array(buckets.length).fill(0)
  const layers: Array<{ cat: string; color: string; points: string }> = []
  for (const cat of cats) {
    const series = buckets.map(b => Number(b[cat]) || 0)
    const points = areaPoints(series, [...offsets], maxTotal)
    layers.push({ cat, color: CATEGORY_COLORS[cat], points })
    for (let i = 0; i < series.length; i++) offsets[i] += series[i]
  }
  return { layers, maxTotal }
})

onMounted(async () => {
  if (!mapContainer.value) return
  const L = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  leaflet = L

  mapInstance = L.map(mapContainer.value, {
    center: [25, 10],
    zoom: 2,
    minZoom: 2,
    maxZoom: 12,
    worldCopyJump: true,
    zoomControl: true,
    scrollWheelZoom: true,
  })

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(mapInstance)

  await geocodeAll()
})

onUnmounted(() => {
  if (mapInstance) { mapInstance.remove(); mapInstance = null }
})

watch(() => data.value?.hotspots?.length, () => {
  if (mapInstance) geocodeAll()
})

useSeoMeta({
  title: 'Maps · Newsar Intel — Global news hotspots',
  description: 'Live global map of news hotspots. Locations plotted by article density, severity and source diversity — OpenStreetMap + AI classification.',
})

function pct(n: number | undefined, total: number | undefined) {
  if (!n || !total) return 0
  return Math.min(100, Math.round((n / total) * 100))
}
function formatClock(d: string | Date) {
  const dt = new Date(d)
  return dt.toISOString().slice(11, 16)
}
</script>

<template>
  <div class="map-page">
    <!-- HEADER STRIP -->
    <section class="hdr-wrap">
      <div>
        <div class="class-strip">
          <span class="chip-ink">Map · Live-Ops</span>
          <span class="chip-amber">{{ data?.stats.hotspotCount || 0 }} hotspots</span>
          <span class="class-sep">·</span>
          <span>Tiles · OpenStreetMap / CARTO</span>
          <span class="class-sep">·</span>
          <span>Window · {{ Math.round((windowHours / 24) * 10) / 10 }}d</span>
        </div>
        <h1>Where the world is making news — live.</h1>
        <p>Every location Newsar tracked in the past {{ Math.round(windowHours / 24) }} days, plotted by article density and classified by category. Filter by severity, category, or time — click a marker for the underlying coverage.</p>
        <div class="dash-stats">
          <div class="stat">
            <div class="label">Hotspots</div>
            <div class="value">{{ data?.stats.hotspotCount || 0 }}<sub>active</sub></div>
            <div class="trend">▬ geocoded {{ geocoded.length }}</div>
          </div>
          <div class="stat">
            <div class="label">Critical</div>
            <div class="value">{{ data?.stats.critical || 0 }}<sub>clusters</sub></div>
            <div class="trend" style="color:var(--color-red)">▲ high severity</div>
          </div>
          <div class="stat">
            <div class="label">High</div>
            <div class="value">{{ data?.stats.high || 0 }}<sub>clusters</sub></div>
            <div class="trend">▬ elevated</div>
          </div>
          <div class="stat">
            <div class="label">Pings · 24h</div>
            <div class="value">{{ data?.pings?.length || 0 }}<sub>events</sub></div>
            <div class="trend">▬ live feed</div>
          </div>
        </div>
      </div>

      <aside class="severity-card">
        <div class="card-hd"><h3>Severity distribution</h3><span>{{ Math.round(windowHours / 24) }}d</span></div>
        <div class="sev-body">
          <div class="sev-row">
            <span>Critical</span>
            <div class="bb"><span :style="{ width: pct(data?.stats.critical, data?.stats.hotspotCount) + '%', background: '#B91C1C' }" /></div>
            <span class="v">{{ data?.stats.critical || 0 }}</span>
          </div>
          <div class="sev-row">
            <span>High</span>
            <div class="bb"><span :style="{ width: pct(data?.stats.high, data?.stats.hotspotCount) + '%', background: '#D97706' }" /></div>
            <span class="v">{{ data?.stats.high || 0 }}</span>
          </div>
          <div class="sev-row">
            <span>Medium</span>
            <div class="bb"><span :style="{ width: pct(data?.stats.medium, data?.stats.hotspotCount) + '%', background: '#F59E0B' }" /></div>
            <span class="v">{{ data?.stats.medium || 0 }}</span>
          </div>
          <div class="sev-row">
            <span>Low</span>
            <div class="bb"><span :style="{ width: pct(data?.stats.low, data?.stats.hotspotCount) + '%', background: '#15803D' }" /></div>
            <span class="v">{{ data?.stats.low || 0 }}</span>
          </div>
        </div>
      </aside>
    </section>

    <!-- MAIN 3-col MAP WORKSTATION -->
    <div class="sect-head">
      <span class="num">§ 01</span>
      <h2>Live operations view</h2>
      <span class="tag">{{ data?.hotspots?.length || 0 }} locations · OSM basemap</span>
    </div>

    <section class="maps-wrap">
      <!-- LEFT: filters -->
      <aside class="maps-col left">
        <div class="panel-hd"><h3>Filters</h3><span>Applied · {{ activeCategories.size + activeSeverities.size }}</span></div>

        <div class="filt-sect">
          <label>Categories</label>
          <div
            v-for="[cat, color] in Object.entries(CATEGORY_COLORS).filter(([c]) => c !== 'other')"
            :key="cat"
            class="filt-check"
            :class="{ inactive: !activeCategories.has(cat) }"
            @click="toggleCat(cat)"
          >
            <span class="sw" :style="{ background: color, opacity: activeCategories.has(cat) ? 1 : 0.3 }" />
            <span style="text-transform:capitalize">{{ cat }}</span>
            <b>{{ data?.stats.categoryTotals?.[cat] || 0 }}</b>
          </div>
        </div>

        <div class="filt-sect">
          <label>Severity</label>
          <div>
            <span
              v-for="s in ['critical', 'high', 'medium', 'low']"
              :key="s"
              class="filt-pill"
              :class="{ active: activeSeverities.has(s) }"
              @click="toggleSev(s)"
            >{{ s }}</span>
          </div>
        </div>

        <div class="filt-sect">
          <label>Time window</label>
          <div style="display:flex; gap:6px;">
            <span class="filt-pill" :class="{ active: windowHours === 24 }" @click="windowHours = 24; refresh()">24h</span>
            <span class="filt-pill" :class="{ active: windowHours === 72 }" @click="windowHours = 72; refresh()">72h</span>
            <span class="filt-pill" :class="{ active: windowHours === 168 }" @click="windowHours = 168; refresh()">7d</span>
            <span class="filt-pill" :class="{ active: windowHours === 720 }" @click="windowHours = 720; refresh()">30d</span>
          </div>
        </div>

        <div class="filt-sect">
          <label>Top entities in view</label>
          <div class="pill-wrap">
            <span
              v-for="h in rankedList.slice(0, 10)"
              :key="h.id"
              class="filt-pill"
              :class="{ active: selected?.id === h.id }"
              @click="selectHotspot(h.id)"
            >{{ h.name }}</span>
          </div>
        </div>

        <div class="filt-sect" style="border-bottom:0;">
          <label>Data source</label>
          <div style="font-family:var(--font-mono); font-size:10px; color: var(--color-ink-3); line-height:1.5;">
            Entities extracted by local AI (qwen2.5:14b) · Coordinates resolved via Nominatim (OpenStreetMap). Classifications: language, political bias, sensationalism, propaganda risk.
          </div>
        </div>
      </aside>

      <!-- CENTER: map -->
      <div class="maps-col">
        <div class="map-toolbar">
          <button class="active">Global</button>
          <span class="grow" />
          <span class="zoom" v-if="geocodePending">Geocoding · {{ geocoded.length }}/{{ data?.hotspots?.length || 0 }} …</span>
          <span class="zoom" v-else>{{ filtered.length }} markers shown</span>
        </div>

        <div class="map-canvas">
          <div ref="mapContainer" class="leaflet-host" />
          <div v-if="pending" class="map-overlay">Loading…</div>
        </div>

        <div class="map-below">
          <div>
            <div class="k">Legend · Category</div>
            <div v-for="cat in ['conflict', 'politics', 'economy', 'diplomacy', 'health', 'environment', 'technology', 'society']" :key="cat" class="legend-row">
              <i :style="{ background: CATEGORY_COLORS[cat] }" />
              <span style="text-transform:capitalize">{{ cat }}</span>
              <b>{{ data?.stats.categoryTotals?.[cat] || 0 }}</b>
            </div>
          </div>
          <div>
            <div class="k">Scale · Marker radius</div>
            <div style="display:flex; align-items:end; gap:10px; padding-top:4px;">
              <span class="dot" style="width:8px; height:8px" />
              <span class="dot" style="width:14px; height:14px" />
              <span class="dot" style="width:22px; height:22px" />
              <span class="dot" style="width:32px; height:32px" />
            </div>
            <div class="legend-row" style="margin-top:6px;">
              <span style="font-family: var(--font-mono); font-size:10px; color: var(--color-ink-3);">5 art · 25 · 80 · 150+</span>
            </div>
          </div>
          <div>
            <div class="k">Severity · Stroke weight</div>
            <div class="legend-row"><i class="stroke-ring crit" /> Critical</div>
            <div class="legend-row"><i class="stroke-ring hi" /> High</div>
            <div class="legend-row"><i class="stroke-ring md" /> Medium</div>
          </div>
        </div>
      </div>

      <!-- RIGHT: hotspot list + details -->
      <aside class="maps-col right">
        <div class="panel-hd"><h3>Top hotspots</h3><span>{{ rankedList.length }} · severity</span></div>
        <div class="hotspots">
          <div
            v-for="(h, i) in rankedList.slice(0, 12)"
            :key="h.id"
            class="hotspot"
            :class="{ active: selected?.id === h.id }"
            @click="selectHotspot(h.id)"
          >
            <div class="rank">{{ String(i + 1).padStart(2, '0') }}</div>
            <div>
              <div class="nm">
                {{ h.name }}
                <small>{{ h.topCategory }} · {{ h.articleCount }} articles · {{ h.articleCount24h }}/24h</small>
              </div>
            </div>
            <div class="sev" :style="{ background: severityBg(h.severity), color: severityColor(h.severity) }">
              {{ h.severity.slice(0, 4).toUpperCase() }}
            </div>
          </div>
          <div v-if="rankedList.length === 0" style="padding: 20px; text-align:center; color: var(--color-ink-3); font-family: var(--font-mono); font-size: 11px;">
            No hotspots in current filter.
          </div>
        </div>

        <div v-if="selected" class="detail">
          <div class="crumb">§ Selected · Hotspot</div>
          <h3>{{ selected.name }}</h3>
          <div class="k-row">
            <div><div class="k">Articles</div><div class="v">{{ selected.articleCount }}</div></div>
            <div><div class="k">Articles · 24h</div><div class="v">{{ selected.articleCount24h }}</div></div>
            <div>
              <div class="k">Severity</div>
              <div class="v" :style="{ color: severityColor(selected.severity) }" style="text-transform: capitalize">{{ selected.severity }}</div>
            </div>
            <div><div class="k">Avg bias</div><div class="v">{{ biasLabel(selected.avgBias) }}</div></div>
          </div>
          <p v-if="selected.shortDescription">{{ selected.shortDescription }}</p>
          <p v-else>
            {{ selected.name }} appears in <b>{{ selected.articleCount }}</b> articles across the current window, spanning {{ Object.keys(selected.categories).length }} category·ies. Top category: <b style="text-transform:capitalize">{{ selected.topCategory }}</b>.
          </p>
          <div style="display:flex; gap:8px;">
            <NuxtLink :to="`/location/${selected.slug}`" class="btn">Open brief →</NuxtLink>
            <a :href="`https://www.openstreetmap.org/search?query=${encodeURIComponent(selected.name)}`" target="_blank" rel="noopener" class="btn secondary">OSM ↗</a>
          </div>
        </div>
      </aside>
    </section>

    <!-- BOTTOM: timeline + recent pings -->
    <div class="sect-head">
      <span class="num">§ 02</span>
      <h2>Activity over 24 hours</h2>
      <span class="tag">Hourly buckets · stacked by category</span>
    </div>

    <section class="ts-strip">
      <div class="timeline-card">
        <div class="card-hd">
          <h3>Hotspot volume</h3><span>Stacked by category</span>
        </div>
        <div class="ts-body">
          <div class="ts-chart">
            <svg viewBox="0 0 720 140" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
              <g v-for="layer in stackedSeries.layers" :key="layer.cat">
                <polygon :points="layer.points" :fill="layer.color" fill-opacity="0.7" />
              </g>
              <g font-family="JetBrains Mono" font-size="9" fill="#9A9080">
                <text x="0" y="138">−24h</text>
                <text x="180" y="138">−18h</text>
                <text x="360" y="138">−12h</text>
                <text x="540" y="138">−6h</text>
                <text x="690" y="138">NOW</text>
              </g>
            </svg>
          </div>
          <div class="ts-bottom">
            <span>24h window</span>
            <span>{{ timelineData.buckets.length }} buckets</span>
            <span>max {{ stackedSeries.maxTotal }}/h</span>
          </div>
        </div>
        <div class="ts-legend">
          <span v-for="cat in timelineData.cats" :key="cat">
            <i :style="{ background: CATEGORY_COLORS[cat] }" />
            <span style="text-transform:capitalize">{{ cat }}</span>
          </span>
        </div>
      </div>

      <aside class="card">
        <div class="card-hd"><h3>Recent pings</h3><span>Live feed</span></div>
        <div class="latest">
          <NuxtLink
            v-for="p in (data?.pings || []).slice(0, 8)"
            :key="p.articleId"
            :to="`/articles/${p.articleId}`"
            class="latest-row"
          >
            <div class="time">
              <b>{{ formatClock(p.publishedAt) }}</b>
              <span>{{ timeAgo(p.publishedAt) }}</span>
            </div>
            <div class="title">
              {{ p.title }}
              <small>{{ p.locationName }} · {{ p.feedName }}</small>
            </div>
            <span class="ping-tag" :style="{ color: CATEGORY_COLORS[p.category] }">{{ (p.category || 'other').slice(0, 4).toUpperCase() }}</span>
          </NuxtLink>
          <div v-if="!data?.pings?.length" style="padding: 20px; text-align:center; color: var(--color-ink-3); font-family: var(--font-mono); font-size: 11px;">
            No recent pings.
          </div>
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.map-page {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 var(--pad) 48px;
  position: relative;
  z-index: 0;
  isolation: isolate;
}

/* HEADER STRIP */
.hdr-wrap {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: var(--gap-xl);
  align-items: start;
  padding: var(--gap-lg) 0 var(--gap-xl);
  border-bottom: 2px solid var(--color-ink);
  margin-bottom: var(--gap-lg);
}
.class-strip {
  display: flex; align-items: center; gap: var(--gap-md);
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--color-ink-3); margin-bottom: var(--gap-md); flex-wrap: wrap;
}
.chip-ink { padding: 3px 7px; background: var(--color-ink); color: var(--color-paper); border-radius: 2px; }
.chip-amber { padding: 3px 7px; background: var(--color-accent); color: #fff; border-radius: 2px; }
.class-sep { color: var(--color-ink-4); }
.hdr-wrap h1 {
  font-family: var(--font-head, 'IBM Plex Sans', sans-serif);
  font-size: 42px; font-weight: 600; letter-spacing: -0.025em;
  margin: 0 0 10px; line-height: 1.05; color: var(--color-ink);
}
.hdr-wrap p {
  font-family: var(--font-serif, 'Newsreader', serif);
  font-size: 17px; color: var(--color-ink-2);
  max-width: 56ch; margin: 0 0 18px; text-wrap: pretty;
}
.dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--color-rule); background: var(--color-panel); }
.stat { padding: 14px 16px; border-right: 1px solid var(--color-rule); }
.stat:last-child { border-right: 0; }
.stat .label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-ink-3); margin-bottom: 4px; }
.stat .value { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 26px; font-weight: 700; color: var(--color-ink); letter-spacing: -0.02em; line-height: 1; }
.stat .value sub { font-family: var(--font-mono); font-size: 10px; font-weight: 500; color: var(--color-ink-3); margin-left: 4px; vertical-align: baseline; }
.stat .trend { font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); margin-top: 4px; }

/* severity mini card */
.severity-card { background: var(--color-panel); border: 1px solid var(--color-rule); }
.card-hd { padding: 12px 14px; border-bottom: 1px solid var(--color-rule); display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ink-3); }
.card-hd h3 { margin: 0; color: var(--color-ink); font-size: 10px; font-weight: 600; }
.sev-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.sev-row { display: grid; grid-template-columns: 80px 1fr 30px; align-items: center; gap: 10px; font-family: var(--font-mono); font-size: 11px; color: var(--color-ink-2); }
.sev-row .bb { height: 8px; background: var(--color-paper-2); overflow: hidden; }
.sev-row .bb span { display: block; height: 100%; }
.sev-row .v { text-align: right; font-weight: 600; color: var(--color-ink); }

/* SECTION HEAD */
.sect-head {
  display: flex; align-items: baseline; gap: 12px;
  padding-bottom: 10px; border-bottom: 1px solid var(--color-ink);
  margin-top: var(--gap-xl);
}
.sect-head .num { font-family: var(--font-mono); font-size: 11px; color: var(--color-ink-3); letter-spacing: 0.08em; }
.sect-head h2 { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 20px; margin: 0; font-weight: 600; color: var(--color-ink); }
.sect-head .tag { font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); letter-spacing: 0.08em; margin-left: auto; text-transform: uppercase; }

/* MAPS WORKSTATION */
.maps-wrap {
  display: grid; grid-template-columns: 260px minmax(0, 1fr) 340px;
  gap: 0; border: 1px solid var(--color-rule); background: var(--color-panel);
  margin-top: 0;
}
.maps-col { padding: 0; min-width: 0; }
.maps-col.left { border-right: 1px solid var(--color-rule); }
.maps-col.right { border-left: 1px solid var(--color-rule); }

.panel-hd {
  padding: 10px 14px; border-bottom: 1px solid var(--color-rule);
  display: flex; justify-content: space-between; align-items: center;
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ink-3);
  background: var(--color-paper);
}
.panel-hd h3 { margin: 0; color: var(--color-ink); font-size: 10px; font-weight: 600; }

/* LEFT filter */
.filt-sect { padding: 12px 14px; border-bottom: 1px solid var(--color-rule-soft); }
.filt-sect label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ink-3); display: block; margin-bottom: 8px; font-weight: 600; }
.filt-check {
  display: flex; align-items: center; gap: 8px; padding: 4px 0;
  font-family: var(--font-mono); font-size: 11px; color: var(--color-ink-2);
  cursor: pointer; user-select: none;
}
.filt-check .sw { width: 10px; height: 10px; display: inline-block; border: 1px solid var(--color-rule); }
.filt-check b { margin-left: auto; color: var(--color-ink); font-weight: 600; }
.filt-check.inactive { opacity: 0.5; }
.filt-check:hover { color: var(--color-ink); }
.pill-wrap { display: flex; flex-wrap: wrap; gap: 4px; }
.filt-pill {
  display: inline-flex; align-items: center; padding: 3px 7px;
  border: 1px solid var(--color-rule); background: var(--color-paper);
  font-family: var(--font-mono); font-size: 10px; margin: 2px 2px 2px 0;
  white-space: nowrap; cursor: pointer; text-transform: capitalize;
}
.filt-pill.active { background: var(--color-ink); color: var(--color-paper); border-color: var(--color-ink); }

/* MAP center */
.map-toolbar {
  display: flex; gap: 0; border-bottom: 1px solid var(--color-rule);
  background: var(--color-paper); font-family: var(--font-mono); font-size: 11px;
  align-items: stretch;
}
.map-toolbar button {
  padding: 10px 14px; color: var(--color-ink-3);
  border-right: 1px solid var(--color-rule);
  letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600;
  font-size: 10px; background: transparent; cursor: pointer;
}
.map-toolbar button.active { color: var(--color-ink); background: var(--color-panel); box-shadow: inset 0 -2px 0 var(--color-accent); }
.map-toolbar .grow { flex: 1; }
.map-toolbar .zoom { display: flex; align-items: center; gap: 8px; padding: 0 14px; color: var(--color-ink-3); }

.map-canvas {
  position: relative; aspect-ratio: 16 / 9;
  background: #0C0A09; overflow: hidden; border-bottom: 1px solid var(--color-rule);
}
.leaflet-host { position: absolute; inset: 0; width: 100%; height: 100%; }
.map-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #A7A08C; font-family: var(--font-mono); font-size: 12px; pointer-events: none;
}

.map-below { display: grid; grid-template-columns: 1fr 1fr 1fr; background: var(--color-paper); }
.map-below > div { padding: 12px 14px; border-right: 1px solid var(--color-rule); }
.map-below > div:last-child { border-right: 0; }
.map-below .k { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ink-3); margin-bottom: 6px; }
.legend-row { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2); padding: 2px 0; }
.legend-row i { width: 10px; height: 10px; display: inline-block; }
.legend-row b { margin-left: auto; color: var(--color-ink); }
.dot { display: inline-block; background: var(--color-ink); border-radius: 50%; }
.stroke-ring { border: 1px solid var(--color-ink); background: transparent !important; border-radius: 50%; }
.stroke-ring.crit { border-width: 3px; border-color: var(--color-red); }
.stroke-ring.hi { border-width: 2px; border-color: var(--color-accent); }
.stroke-ring.md { border-width: 1px; border-color: var(--color-ink-3); }

/* RIGHT hotspots */
.hotspots { display: flex; flex-direction: column; max-height: 420px; overflow-y: auto; }
.hotspot {
  padding: 12px 14px; border-bottom: 1px solid var(--color-rule-soft);
  display: grid; grid-template-columns: 32px 1fr auto;
  gap: 10px; align-items: start; cursor: pointer;
}
.hotspot:hover { background: var(--color-paper); }
.hotspot.active { background: var(--color-accent-tint); box-shadow: inset 3px 0 0 var(--color-accent); }
.hotspot .rank { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--color-ink-3); padding-top: 2px; }
.hotspot .nm { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 13px; font-weight: 600; color: var(--color-ink); line-height: 1.2; letter-spacing: -0.01em; }
.hotspot .nm small { display: block; font-family: var(--font-mono); font-weight: 500; font-size: 10px; color: var(--color-ink-3); letter-spacing: 0.04em; text-transform: uppercase; margin-top: 2px; }
.hotspot .sev { font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 2px; align-self: center; }

/* detail */
.detail { background: var(--color-paper); border-top: 1px solid var(--color-rule); padding: 14px; }
.detail .crumb { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-ink-3); margin-bottom: 6px; }
.detail h3 { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; color: var(--color-ink); }
.detail .k-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.detail .k-row .k { font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 2px; }
.detail .k-row .v { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 15px; font-weight: 600; color: var(--color-ink); }
.detail p { font-family: var(--font-serif, 'Newsreader', serif); font-size: 13px; line-height: 1.5; color: var(--color-ink-2); margin: 0 0 10px; text-wrap: pretty; }
.btn {
  padding: 7px 10px; font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600;
  border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-paper);
  display: inline-block; text-decoration: none;
}
.btn.secondary { background: var(--color-panel); color: var(--color-ink); border-color: var(--color-rule); }

/* BOTTOM timeline */
.ts-strip { display: grid; grid-template-columns: 1fr 380px; gap: var(--gap-xl); margin-top: var(--gap-md); margin-bottom: var(--gap-xl); }
.timeline-card, .card { background: var(--color-panel); border: 1px solid var(--color-rule); }
.ts-body { padding: 16px var(--pad); }
.ts-chart { height: 140px; position: relative; margin-bottom: 16px; }
.ts-bottom { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); letter-spacing: 0.06em; text-transform: uppercase; }
.ts-legend { display: flex; gap: 16px; padding: 10px var(--pad); border-top: 1px solid var(--color-rule-soft); font-family: var(--font-mono); font-size: 10.5px; color: var(--color-ink-2); flex-wrap: wrap; }
.ts-legend i { width: 14px; height: 2px; display: inline-block; margin-right: 5px; vertical-align: middle; }

/* pings */
.latest { display: flex; flex-direction: column; }
.latest-row {
  display: grid; grid-template-columns: 54px 1fr auto;
  gap: 10px; padding: 10px var(--pad); border-top: 1px solid var(--color-rule-soft);
  align-items: center; font-family: var(--font-mono); font-size: 11px;
  color: var(--color-ink-2); text-decoration: none;
}
.latest-row:hover { background: var(--color-paper); }
.latest-row .time b { color: var(--color-ink); display: block; }
.latest-row .time span { color: var(--color-ink-3); }
.latest-row .title { font-family: var(--font-head, 'IBM Plex Sans', sans-serif); font-size: 12.5px; font-weight: 600; color: var(--color-ink); line-height: 1.3; }
.latest-row .title small { display: block; font-family: var(--font-mono); font-size: 10px; color: var(--color-ink-3); margin-top: 2px; font-weight: 500; }
.ping-tag { font-family: var(--font-mono); font-size: 9px; padding: 1px 5px; border: 1px solid var(--color-rule); font-weight: 700; }

@media (max-width: 1100px) {
  .hdr-wrap { grid-template-columns: 1fr; }
  .maps-wrap { grid-template-columns: 1fr; }
  .maps-col.left, .maps-col.right { border-left: 0; border-right: 0; border-top: 1px solid var(--color-rule); }
  .ts-strip { grid-template-columns: 1fr; }
  .dash-stats { grid-template-columns: repeat(2, 1fr); }
}
</style>
