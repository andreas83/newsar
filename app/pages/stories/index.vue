<script setup lang="ts">
type LeanGroup = 'left' | 'center' | 'right' | 'unrated'

interface Outlet {
  id: number
  name: string
  shortName: string
  group: LeanGroup
}

interface StoryRow {
  id: number
  title: string | null
  summary: string | null
  articleCount: number
  firstSeen: string | Date
  lastUpdated: string | Date
  primaryRegion: string | null
  entities: Array<{ id: number; name: string; type: string }>
  counts: Record<number, number>
  otherCount: number
  fresh: number[]
  daily: number[]
  imageUrl: string | null
  imageLocalPath: string | null
}

const PAGE_SIZE = 50

const route = useRoute()
const router = useRouter()
const { selectedLanguage, setLanguage } = useLanguage()

// Filters live in the URL so a filtered list can be shared
const q = (key: string, fallback: string) => (typeof route.query[key] === 'string' ? route.query[key] as string : fallback)
const sortBy = ref(q('sort', 'trending'))
const dateRange = ref(q('when', 'all'))
const region = ref(q('region', 'all'))
const entityFilter = ref(q('entity', ''))
const entityFilterName = ref(q('name', ''))
const keywordFilter = ref(q('keyword', ''))

if (typeof route.query.language === 'string') setLanguage(route.query.language)

const filterQuery = computed(() => ({
  sortBy: sortBy.value,
  language: selectedLanguage.value,
  dateRange: dateRange.value,
  region: region.value,
  entity: entityFilter.value,
  keyword: keywordFilter.value,
}))

// Chips and region list ignore the entity filter so the other choices stay visible
const facetQuery = computed(() => ({
  language: selectedLanguage.value,
  dateRange: dateRange.value,
  region: region.value,
}))

const [
  { data: page },
  { data: regionData },
  { data: personsData },
  { data: orgsData },
] = await Promise.all([
  useFetch<any>('/api/stories', { query: computed(() => ({ ...filterQuery.value, limit: PAGE_SIZE })) }),
  useFetch<any>('/api/stories', { query: computed(() => ({ language: selectedLanguage.value, dateRange: dateRange.value, view: 'regions' })) }),
  useFetch<any>('/api/stories', { query: computed(() => ({ ...facetQuery.value, view: 'persons' })) }),
  useFetch<any>('/api/stories', { query: computed(() => ({ ...facetQuery.value, view: 'organizations' })) }),
])

// "Show more" pages, appended below the first page
const extra = ref<StoryRow[]>([])
const loadingMore = ref(false)

watch(filterQuery, () => {
  extra.value = []
  const query: Record<string, string> = {}
  if (sortBy.value !== 'trending') query.sort = sortBy.value
  if (dateRange.value !== 'all') query.when = dateRange.value
  if (region.value !== 'all') query.region = region.value
  if (entityFilter.value) {
    query.entity = entityFilter.value
    if (entityFilterName.value) query.name = entityFilterName.value
  }
  if (keywordFilter.value) query.keyword = keywordFilter.value
  router.replace({ query })
})

const storyList = computed<StoryRow[]>(() => [...(page.value?.stories || []), ...extra.value])
const outlets = computed<Outlet[]>(() => page.value?.outlets || [])
const days = computed<string[]>(() => page.value?.days || [])
const total = computed<number>(() => page.value?.total || 0)
const fallbackArticles = computed(() => page.value?.fallbackArticles || [])

async function loadMore() {
  loadingMore.value = true
  try {
    const next = await $fetch<any>('/api/stories', {
      query: { ...filterQuery.value, limit: PAGE_SIZE, offset: storyList.value.length },
    })
    extra.value.push(...(next?.stories || []))
  } finally {
    loadingMore.value = false
  }
}

// ── Filters ──
const sortOptions = [
  { label: 'Trending', value: 'trending' },
  { label: 'Newest', value: 'recent' },
  { label: 'Most articles', value: 'largest' },
]

const dateRangeOptions = [
  { label: 'Any time', value: 'all' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
]

const regionOptions = computed(() => {
  const options = [{ label: 'All regions', value: 'all' }]
  for (const g of (regionData.value?.groups || []) as Array<{ region: string; storyCount: number }>) {
    if (g.region && g.region !== 'Unknown') options.push({ label: `${g.region} (${g.storyCount})`, value: g.region })
  }
  return options
})

// People and organisations that appear in the most stories under the current filters
const entityChips = computed(() => {
  const all = [
    ...((personsData.value?.groups || []) as any[]).map(g => ({ ...g, type: 'person' })),
    ...((orgsData.value?.groups || []) as any[]).map(g => ({ ...g, type: 'organization' })),
  ]
  return all
    .filter(g => g.storyCount >= 2)
    .sort((a, b) => b.storyCount - a.storyCount)
    .slice(0, 12)
})

function toggleEntity(id: number, name: string) {
  if (entityFilter.value === String(id)) {
    entityFilter.value = ''
    entityFilterName.value = ''
    return
  }
  entityFilter.value = String(id)
  entityFilterName.value = name
  keywordFilter.value = ''
}

function clearFilters() {
  sortBy.value = 'trending'
  dateRange.value = 'all'
  region.value = 'all'
  entityFilter.value = ''
  entityFilterName.value = ''
  keywordFilter.value = ''
}

const hasFilters = computed(() =>
  dateRange.value !== 'all' || region.value !== 'all' || !!entityFilter.value || !!keywordFilter.value
)

const filterSentence = computed(() => {
  const parts: string[] = []
  if (entityFilterName.value) parts.push(`mentioning ${entityFilterName.value}`)
  if (keywordFilter.value) parts.push(`about “${keywordFilter.value}”`)
  if (region.value !== 'all') parts.push(`in ${region.value}`)
  if (dateRange.value !== 'all') parts.push(`updated in the last ${dateRangeOptions.find(o => o.value === dateRange.value)?.label}`)
  return parts.join(', ')
})

// ── Rows ──
const GROUP_LABELS: Record<LeanGroup, string> = { left: 'Left', center: 'Centre', right: 'Right', unrated: 'Not rated' }

const groups = computed(() => {
  const out: Array<{ group: LeanGroup; span: number }> = []
  for (const o of outlets.value) {
    const last = out[out.length - 1]
    if (last && last.group === o.group) last.span++
    else out.push({ group: o.group, span: 1 })
  }
  return out
})

const maxCount = computed(() => Math.max(1, ...storyList.value.flatMap(s => Object.values(s.counts))))
const maxDaily = computed(() => Math.max(1, ...storyList.value.flatMap(s => s.daily)))

const MAX_R = 10
function radius(n: number) {
  return Math.max(3, Math.sqrt(n / maxCount.value) * MAX_R)
}

const gridStyle = computed(() => ({ '--outlets': String(Math.max(1, outlets.value.length)) }))

function coverageLine(s: StoryRow) {
  const covered = outlets.value.filter(o => s.counts[o.id])
  const missing = outlets.value.filter(o => !s.counts[o.id]).map(o => o.shortName)
  let text = `Covered by ${covered.length} of ${outlets.value.length} outlets`
  if (missing.length && missing.length <= 3) text += `; not by ${missing.join(', ')}`
  return `${text}.`
}

function cellTitle(s: StoryRow, o: Outlet) {
  const n = s.counts[o.id] || 0
  if (!n) return `${o.name}: no articles on this story`
  return `${o.name}: ${n} article${n === 1 ? '' : 's'}${s.fresh.includes(o.id) ? ', newest in the last 24 hours' : ''}`
}

function utcDay(d: string | Date) {
  return new Date(d).toISOString().slice(0, 10)
}

function shortDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

// Day headings only make sense when the list is in time order
const todayIso = new Date().toISOString().slice(0, 10)
const yesterdayIso = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

function dayHeading(iso: string) {
  if (iso === todayIso) return 'Today'
  if (iso === yesterdayIso) return 'Yesterday'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
}

function showDayHeading(i: number) {
  if (sortBy.value !== 'recent') return false
  const s = storyList.value[i]
  if (!s) return false
  return i === 0 || utcDay(s.lastUpdated) !== utcDay(storyList.value[i - 1]!.lastUpdated)
}

// Stories older than the strip get a date span instead of an empty chart
function isQuiet(s: StoryRow) {
  return s.daily.every(n => n === 0)
}

function formatDate(date: string | Date | null) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

useHead({ title: 'Stories' })
</script>

<template>
  <Container>
    <!-- ═══ HEADER ═══ -->
    <header class="pt-8 pb-6 border-b border-rule">
      <h1 class="font-serif text-[36px] sm:text-[44px] font-bold leading-none tracking-[-0.01em] text-ink">Stories</h1>
      <p class="text-[15px] text-ink-3 mt-3 max-w-[68ch] leading-relaxed">
        Articles about the same event, grouped automatically. Each row shows which outlets covered the story,
        and how coverage built up over the last two weeks.
      </p>
    </header>

    <!-- ═══ FILTERS ═══ -->
    <section aria-label="Filter stories" class="py-5 border-b border-rule space-y-4">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div class="seg" role="radiogroup" aria-label="Sort by">
          <button
            v-for="o in sortOptions"
            :key="o.value"
            role="radio"
            :aria-checked="sortBy === o.value"
            :class="{ on: sortBy === o.value }"
            @click="sortBy = o.value"
          >
            {{ o.label }}
          </button>
        </div>
        <div class="seg" role="radiogroup" aria-label="Updated within">
          <button
            v-for="o in dateRangeOptions"
            :key="o.value"
            role="radio"
            :aria-checked="dateRange === o.value"
            :class="{ on: dateRange === o.value }"
            @click="dateRange = o.value"
          >
            {{ o.label }}
          </button>
        </div>
        <label class="flex items-center gap-2 text-[13px] text-ink-3">
          <span class="sr-only sm:not-sr-only">Region</span>
          <SelectMenu v-model="region" :options="regionOptions" size="sm" class="w-52" />
        </label>
      </div>

      <div v-if="entityChips.length || entityFilter || keywordFilter" class="flex flex-wrap items-center gap-2">
        <span class="text-[13px] text-ink-3 mr-1">In many of these stories:</span>
        <button
          v-if="keywordFilter"
          class="chip on"
          :aria-label="`Remove topic filter ${keywordFilter}`"
          @click="keywordFilter = ''"
        >
          {{ keywordFilter }} <span aria-hidden="true">×</span>
        </button>
        <button
          v-if="entityFilter && !entityChips.some(c => String(c.entityId) === entityFilter)"
          class="chip on"
          @click="toggleEntity(Number(entityFilter), entityFilterName)"
        >
          {{ entityFilterName || 'Selected entity' }} <span aria-hidden="true">×</span>
        </button>
        <button
          v-for="c in entityChips"
          :key="c.entityId"
          class="chip"
          :class="{ on: entityFilter === String(c.entityId) }"
          :aria-pressed="entityFilter === String(c.entityId)"
          @click="toggleEntity(c.entityId, c.name)"
        >
          {{ c.name }}
          <span class="tabular-nums opacity-60">{{ c.storyCount }}</span>
          <span v-if="entityFilter === String(c.entityId)" aria-hidden="true">×</span>
        </button>
      </div>
    </section>

    <!-- Result line -->
    <div class="flex flex-wrap items-baseline justify-between gap-3 pt-6 pb-4">
      <p class="text-[14px] text-ink-2" aria-live="polite">
        <span class="font-semibold text-ink tabular-nums">{{ total.toLocaleString('en-US') }}</span>
        {{ total === 1 ? 'story' : 'stories' }}{{ filterSentence ? ` ${filterSentence}` : '' }}
        <button v-if="hasFilters" class="ml-2 underline underline-offset-2 text-ink-3 hover:text-accent" @click="clearFilters">Clear filters</button>
      </p>
      <div v-if="storyList.length" class="hidden md:flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <span class="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4.5" class="dot-fresh" /></svg>Published on it in the last 24h</span>
        <span class="inline-flex items-center gap-1.5"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4.5" class="dot-old" /></svg>Earlier</span>
        <span class="inline-flex items-center gap-1.5"><span class="gap-mark" aria-hidden="true" />None</span>
        <span>Dot size = articles</span>
      </div>
    </div>

    <!-- ═══ LIST ═══ -->
    <section v-if="storyList.length" :style="gridStyle" class="pb-16">
      <!-- Column header, pinned under the nav on wide screens -->
      <div class="row head" aria-hidden="true">
        <div />
        <div class="text-[12px] text-ink-3 self-end">Story</div>
        <div class="cells self-end">
          <div v-for="(g, i) in groups" :key="i" class="band" :class="`lean-${g.group}`" :style="{ gridColumn: `span ${g.span}` }">
            {{ GROUP_LABELS[g.group] }}
          </div>
          <div v-for="o in outlets" :key="o.id" class="outlet" :title="o.name">{{ o.shortName }}</div>
        </div>
        <div class="text-[12px] text-ink-3 self-end leading-tight">Articles per day,<br>last 14 days</div>
      </div>

      <ol>
        <li v-for="(s, i) in storyList" :key="s.id">
          <h2 v-if="showDayHeading(i)" class="font-serif text-[18px] font-semibold text-ink pt-6 pb-2 border-b border-ink">
            {{ dayHeading(utcDay(s.lastUpdated)) }}
          </h2>
          <NuxtLink :to="`/stories/${s.id}`" class="row story group">
            <!-- Thumbnail -->
            <div class="thumb">
              <img
                v-if="s.imageLocalPath || s.imageUrl"
                :src="s.imageLocalPath || s.imageUrl || ''"
                alt=""
                loading="lazy"
                class="w-full h-full object-cover"
                @error="($event.target as HTMLElement)?.style.setProperty('visibility', 'hidden')"
              >
            </div>

            <!-- Text -->
            <div class="min-w-0">
              <h3 class="font-serif text-[18px] leading-snug font-semibold text-ink group-hover:text-accent transition-colors line-clamp-2 text-pretty">
                {{ s.title }}
              </h3>
              <p v-if="s.summary" class="text-[14px] leading-relaxed text-ink-3 mt-1 line-clamp-2 max-w-[75ch]">{{ s.summary }}</p>
              <p class="text-[12px] text-ink-3 mt-1.5">
                <span class="tabular-nums">{{ s.articleCount }}</span> articles, {{ shortDate(s.firstSeen) }}<template v-if="utcDay(s.firstSeen) !== utcDay(s.lastUpdated)"> to {{ shortDate(s.lastUpdated) }}</template><template v-if="s.primaryRegion">, {{ s.primaryRegion }}</template>
              </p>
              <p class="md:hidden text-[12px] text-ink-2 mt-1">{{ coverageLine(s) }}</p>
              <span class="sr-only">{{ outlets.map(o => cellTitle(s, o)).join('. ') }}</span>
            </div>

            <!-- Coverage dots -->
            <div class="cells cov" aria-hidden="true">
              <div v-for="o in outlets" :key="o.id" class="cell" :title="cellTitle(s, o)">
                <svg v-if="s.counts[o.id]" :width="MAX_R * 2 + 2" :height="MAX_R * 2 + 2">
                  <circle :cx="MAX_R + 1" :cy="MAX_R + 1" :r="radius(s.counts[o.id]!)" :class="s.fresh.includes(o.id) ? 'dot-fresh' : 'dot-old'" />
                </svg>
                <span v-else class="gap-mark" />
              </div>
            </div>

            <!-- Volume -->
            <div class="vol" aria-hidden="true">
              <p v-if="isQuiet(s)" class="text-[12px] text-ink-4 leading-tight">No articles in the last 14 days</p>
              <div v-else class="flex items-end gap-px h-7">
                <span
                  v-for="(n, d) in s.daily"
                  :key="d"
                  class="flex-1 rounded-t-[1px]"
                  :class="n === 0 ? 'bg-rule' : (d === s.daily.length - 1 ? 'bg-accent' : 'bg-ink-4')"
                  :style="{ height: n ? `${Math.max(12, (n / maxDaily) * 100)}%` : '1px' }"
                  :title="`${shortDate(`${days[d]}T00:00:00Z`)}: ${n} article${n === 1 ? '' : 's'}`"
                />
              </div>
            </div>
          </NuxtLink>
        </li>
      </ol>

      <div v-if="storyList.length < total" class="pt-8 flex items-center gap-4">
        <button
          class="px-4 py-2 border border-ink text-[14px] font-semibold text-ink hover:bg-ink hover:text-paper transition-colors disabled:opacity-50"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? 'Loading…' : `Show ${Math.min(PAGE_SIZE, total - storyList.length)} more` }}
        </button>
        <span class="text-[13px] text-ink-3">Showing {{ storyList.length }} of {{ total.toLocaleString('en-US') }}</span>
      </div>
    </section>

    <!-- Fallback: articles when no stories match -->
    <section v-else-if="fallbackArticles.length" class="pb-16">
      <p class="text-[14px] text-ink-2 mb-4 border-l-[3px] border-accent pl-3">
        No story groups mention {{ entityFilterName || keywordFilter }} yet. These are the single articles that do.
      </p>
      <ol class="divide-y divide-rule-soft border-t border-rule">
        <li v-for="article in fallbackArticles" :key="article.id">
          <NuxtLink :to="`/articles/${article.id}`" class="group block py-3">
            <span class="block text-[15px] font-medium text-ink group-hover:text-accent transition-colors">{{ article.title }}</span>
            <span class="block text-[12px] text-ink-3 mt-1">{{ article.feedName }}, {{ formatDate(article.publishedAt) }}</span>
          </NuxtLink>
        </li>
      </ol>
    </section>

    <!-- Empty state -->
    <section v-else class="py-16 max-w-lg">
      <h2 class="font-serif text-[22px] font-semibold text-ink mb-2">No stories match these filters</h2>
      <p class="text-[14px] text-ink-3 mb-4">Try a longer time range or another region.</p>
      <button class="px-4 py-2 border border-ink text-[14px] font-semibold text-ink hover:bg-ink hover:text-paper transition-colors" @click="clearFilters">
        Clear filters
      </button>
    </section>
  </Container>
</template>

<style scoped>
/* Segmented controls */
.seg {
  display: inline-flex;
  border: 1px solid var(--color-rule);
  background: var(--color-panel);
}
.seg button {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-ink-3);
  border-right: 1px solid var(--color-rule);
}
.seg button:last-child { border-right: 0; }
.seg button:hover { color: var(--color-ink); background: var(--color-paper-2); }
.seg button.on { background: var(--color-ink); color: var(--color-paper); }
.seg button:focus-visible, .chip:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 13px;
  border: 1px solid var(--color-rule);
  border-radius: 999px;
  color: var(--color-ink-2);
  background: var(--color-panel);
}
.chip:hover { border-color: var(--color-ink-3); color: var(--color-ink); }
.chip.on { background: var(--color-accent-tint); border-color: var(--color-accent); color: var(--color-accent-ink); }

/* Rows: thumbnail | text | outlet dots | volume */
.row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr) calc(54px * var(--outlets)) 120px;
  column-gap: 24px;
  align-items: center;
}
.cells {
  display: grid;
  grid-template-columns: repeat(var(--outlets), 54px);
}

.head {
  position: sticky;
  top: 84px;
  z-index: 10;
  background: var(--color-paper);
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--color-ink);
}
.band {
  border-top: 3px solid currentColor;
  margin: 0 3px 4px;
  padding-top: 3px;
  font-size: 11px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
.band.lean-left    { color: var(--color-blue); }
.band.lean-center  { color: var(--color-ink-3); }
.band.lean-right   { color: var(--color-red); }
.band.lean-unrated { color: var(--color-violet); }
.outlet {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.15;
  text-align: center;
  color: var(--color-ink-2);
  align-self: end;
  padding: 0 3px;
  hyphens: auto;
}

.story {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-rule-soft);
}
.story:hover { background: var(--color-paper-2); }
.story:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
.thumb {
  width: 112px;
  aspect-ratio: 4 / 3;
  background: var(--color-paper-2);
  overflow: hidden;
}

.cell { display: flex; align-items: center; justify-content: center; height: 24px; }
.dot-fresh { fill: var(--color-accent); }
.dot-old   { fill: var(--color-ink-3); }
.gap-mark {
  display: inline-block;
  width: 10px;
  height: 1.5px;
  background: var(--color-rule);
}

/* Narrow screens: thumbnail beside the text, dots and volume underneath without a header */
@media (max-width: 767px) {
  .head { display: none; }
  .row {
    grid-template-columns: minmax(0, 1fr) 80px;
    column-gap: 14px;
    row-gap: 10px;
    align-items: start;
  }
  .story .thumb { grid-column: 2; grid-row: 1; width: 80px; }
  .story > .min-w-0 { grid-column: 1; grid-row: 1; }
  .story .cov { display: none; }
  .story .vol { grid-column: 1 / -1; }
  .story .vol > div { max-width: 220px; height: 20px; }
}
</style>
