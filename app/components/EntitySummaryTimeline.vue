<template>
  <div v-if="entries.length > 0" class="bg-panel rounded-sm border border-rule p-6">
    <div class="flex items-baseline justify-between gap-3 mb-1">
      <h2 class="text-xl font-bold text-ink">Summary Evolution</h2>
      <span class="text-xs font-mono text-ink-3">{{ total }} {{ total === 1 ? 'entry' : 'entries' }}</span>
    </div>
    <p class="text-sm text-ink-3 mb-5">How coverage of {{ entityName }} changed, week by week. Each point links to its sources.</p>

    <!-- Coverage and storylines on one weekly grid, so columns line up -->
    <div v-if="activity.length > 1" class="mb-6 overflow-x-auto">
      <div class="grid items-end gap-x-[2px]" :style="gridStyle">
        <div class="text-xs font-mono text-ink-3 pr-2 self-center">Articles / week</div>
        <div
          v-for="a in activity"
          :key="a.week"
          class="rounded-t-[1px]"
          :class="a.week === activity[activity.length - 1].week ? 'bg-accent' : 'bg-ink-4'"
          :style="{ height: barHeight(a.articles) + 'px' }"
          :title="`Week of ${shortDate(a.week)}: ${a.articles} articles`"
        />

        <div />
        <div class="text-[11px] font-mono text-ink-4 pt-1" :style="{ gridColumn: `2 / span ${Math.ceil(activity.length / 2)}` }">{{ shortDate(activity[0].week) }}</div>
        <div class="text-[11px] font-mono text-ink-4 pt-1 text-right" :style="{ gridColumn: `${2 + Math.ceil(activity.length / 2)} / -1` }">peak {{ maxActivity }} · {{ shortDate(activity[activity.length - 1].week) }}</div>

        <template v-if="strip.themes.length">
          <div class="col-span-full text-xs font-mono text-ink-3 mt-4 mb-1">Storylines</div>
          <template v-for="t in strip.themes" :key="t.label">
            <div class="text-xs text-ink-2 truncate pr-2 py-[1px]" :title="t.label">{{ t.label }}</div>
            <div
              v-for="a in activity"
              :key="a.week"
              class="h-3 my-[1px] rounded-[1px]"
              :class="t.weeks.includes(a.week) ? 'bg-accent' : 'bg-paper-2'"
              :title="`${t.label} · week of ${shortDate(a.week)}`"
            />
          </template>
        </template>
      </div>
    </div>

    <!-- Entries -->
    <div class="relative">
      <div class="absolute left-[5px] top-2 bottom-2 w-px bg-rule" />
      <div class="space-y-6">
        <div v-for="entry in visibleEntries" :key="entry.id" class="relative pl-6">
          <div class="absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full border-2 bg-panel" :class="entry.isCurrent ? 'border-accent bg-accent' : 'border-accent'" />

          <!-- Weekly version -->
          <template v-if="entry.kind === 'week'">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1.5">
              <span class="text-sm font-semibold text-ink">{{ range(entry.periodStart, entry.periodEnd) }}</span>
              <span v-if="entry.isCurrent" class="px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-sm bg-paper-2 text-accent">Latest</span>
              <span v-if="entry.stats" class="text-xs font-mono text-ink-3">
                {{ entry.stats.articles }} articles · {{ entry.stats.outlets }} outlets
              </span>
            </div>

            <p v-if="entry.descriptionChanged" class="text-sm mb-2">
              <span class="text-[10px] font-mono uppercase text-accent mr-1">New role</span>
              <span class="text-ink-2">{{ entry.shortDescription }}</span>
            </p>

            <div v-if="entry.themes?.length" class="flex flex-wrap gap-1 mb-2">
              <span v-for="t in entry.themes" :key="t" class="px-1.5 py-0.5 text-[11px] rounded-sm bg-paper-2 text-ink-3">{{ t }}</span>
            </div>

            <ul v-if="entry.developments.length" class="space-y-1.5">
              <li v-for="(d, i) in entry.developments" :key="i" class="text-sm text-ink-2 leading-relaxed flex gap-2">
                <span class="text-xs font-mono text-ink-4 whitespace-nowrap pt-0.5 w-12 shrink-0">{{ shortDate(d.date) }}</span>
                <span>
                  {{ d.text }}
                  <NuxtLink
                    v-for="(s, j) in d.sources"
                    :key="s.id"
                    :to="`/articles/${s.id}`"
                    class="text-[11px] font-mono text-accent hover:text-accent-ink align-super ml-0.5"
                    :title="[s.title, s.outlet].filter(Boolean).join(' — ')"
                  >[{{ j + 1 }}]</NuxtLink>
                </span>
              </li>
            </ul>
            <p v-else class="text-sm text-ink-3">No major new developments.</p>
          </template>

          <!-- Legacy note (written before structured versions existed) -->
          <template v-else>
            <div class="text-sm font-semibold text-ink mb-1.5">{{ longDate(entry.date) }}</div>
            <p class="text-sm text-ink-2 leading-relaxed">{{ entry.changeNote }}</p>
            <div v-if="entry.articleContext?.articleTitles?.length" class="mt-1.5 flex flex-wrap gap-x-3 text-xs">
              <template v-for="(title, idx) in entry.articleContext.articleTitles.slice(0, 3)" :key="idx">
                <NuxtLink v-if="entry.articleContext.articleIds?.[idx]" :to="`/articles/${entry.articleContext.articleIds[idx]}`" class="text-accent hover:text-accent-ink truncate max-w-xs">{{ title }}</NuxtLink>
              </template>
            </div>
          </template>

          <!-- Profile as of this point -->
          <details v-if="entry.summary" class="mt-2 group">
            <summary class="text-xs text-accent hover:text-accent-ink cursor-pointer list-none">
              <span class="group-open:hidden">Show profile as of {{ entry.kind === 'week' ? endDay(entry.periodEnd) : shortDate(entry.date) }}</span>
              <span class="hidden group-open:inline">Hide profile</span>
            </summary>
            <div class="mt-2 text-sm text-ink-3 bg-paper rounded p-3 leading-relaxed">
              <p v-if="entry.shortDescription" class="font-medium text-ink-2 mb-1">{{ entry.shortDescription }}</p>
              {{ entry.summary }}
            </div>
          </details>
        </div>
      </div>
    </div>

    <div v-if="hiddenCount > 0 || hasMore" class="mt-5 pl-6">
      <button class="text-sm text-accent hover:text-accent-ink font-medium" :disabled="loadingMore" @click="showMore">
        {{ loadingMore ? 'Loading…' : `Show earlier weeks` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Source { id: number; title: string | null; outlet: string | null }
interface Development { date: string; text: string; articleIds: number[]; theme: string | null; sources: Source[] }
interface TimelineEntry {
  kind: 'week' | 'note'
  id: string
  isCurrent?: boolean
  periodStart?: string | null
  periodEnd?: string | null
  date?: string
  changeNote?: string | null
  articleContext?: { articleIds?: number[]; articleTitles?: string[] } | null
  shortDescription: string | null
  summary: string | null
  developments: Development[]
  themes?: string[]
  stats?: { articles: number; outlets: number } | null
  descriptionChanged?: boolean
}

const props = defineProps<{
  entityId: number
  /** Unused since the component loads its own data; kept for existing callers. */
  historyCount?: number
}>()

const INITIAL = 3
const PAGE = 10

const entries = ref<TimelineEntry[]>([])
const entityName = ref('')
const activity = ref<{ week: string; articles: number }[]>([])
const strip = ref<{ themes: { label: string; weeks: string[] }[] }>({ themes: [] })
const total = ref(0)
const hasMore = ref(false)
const shown = ref(INITIAL)
const loadingMore = ref(false)

const visibleEntries = computed(() => entries.value.slice(0, shown.value))
const hiddenCount = computed(() => Math.max(0, entries.value.length - shown.value))
const maxActivity = computed(() => Math.max(1, ...activity.value.map(a => a.articles)))

const BAR_MAX_PX = 40
function barHeight(n: number) {
  return n > 0 ? Math.max(2, (n / maxActivity.value) * BAR_MAX_PX) : 0
}

const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(5.5rem, 11rem) repeat(${activity.value.length}, minmax(0.3rem, 1fr))`,
}))

async function fetchPage(offset: number) {
  return await $fetch<any>(`/api/entities/${props.entityId}/timeline`, { query: { limit: PAGE * 2, offset } })
}

onMounted(async () => {
  try {
    const data = await fetchPage(0)
    entries.value = data.entries
    entityName.value = data.entityName
    activity.value = data.activity ?? []
    strip.value = data.themeStrip ?? { themes: [] }
    total.value = data.pagination.total
    hasMore.value = data.pagination.hasMore
  } catch (err) {
    console.error('Failed to load summary timeline:', err)
  }
})

async function showMore() {
  if (hiddenCount.value > 0) {
    shown.value += PAGE
    return
  }
  loadingMore.value = true
  try {
    const data = await fetchPage(entries.value.length)
    entries.value.push(...data.entries)
    hasMore.value = data.pagination.hasMore
    shown.value += PAGE
  } finally {
    loadingMore.value = false
  }
}

function toDate(v: string | null | undefined) {
  return v ? new Date(String(v).length === 10 ? `${v}T00:00:00Z` : v) : null
}

function shortDate(v: string | null | undefined) {
  const d = toDate(v)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
}

function longDate(v: string | null | undefined) {
  const d = toDate(v)
  return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ''
}

/** Last day of a window whose end is exclusive (midnight Monday → Sunday). */
function endDay(end: string | null | undefined) {
  const e = toDate(end)
  if (!e) return ''
  const last = e.getUTCHours() === 0 && e.getUTCMinutes() === 0 ? new Date(e.getTime() - 86_400_000) : e
  return shortDate(last.toISOString())
}

/** "Oct 12 – 18, 2026" — the end is exclusive (next Monday), so show the day before. */
function range(start: string | null | undefined, end: string | null | undefined) {
  const s = toDate(start), e0 = toDate(end)
  if (!e0) return ''
  const e = new Date(e0.getTime() - (e0.getUTCHours() === 0 && e0.getUTCMinutes() === 0 ? 86_400_000 : 0))
  const year = e.getUTCFullYear()
  if (!s) return longDate(e.toISOString())
  const sameMonth = s.getUTCMonth() === e.getUTCMonth()
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  const left = s.toLocaleDateString('en-US', opts)
  const right = sameMonth ? String(e.getUTCDate()) : e.toLocaleDateString('en-US', opts)
  return `${left} – ${right}, ${year}`
}
</script>
