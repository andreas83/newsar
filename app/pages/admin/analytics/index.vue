<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

type Row = { name: string, views: number, visitors?: number }

const rangeOptions = [
  { label: '24 hours', value: 1 },
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]
const days = ref(30)

const { data, pending, error, refresh } = await useFetch<any>('/api/admin/visitors', {
  query: { days },
  watch: [days],
})

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US')

function fmtDuration(ms: number | null | undefined) {
  if (!ms) return '–'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

// Fill gaps so days/hours without traffic still get a (zero) bar
const series = computed(() => {
  if (!data.value) return []
  const byBucket = new Map<string, any>(data.value.daily.map((r: any) => [r.bucket, r]))
  const botByDay = new Map<string, number>(data.value.botDaily.map((r: any) => [r.bucket, r.hits]))
  const hourly = data.value.days === 1
  const out = []
  const now = new Date()
  const steps = hourly ? 24 : data.value.days
  for (let i = steps - 1; i >= 0; i--) {
    const d = new Date(now)
    if (hourly) d.setHours(d.getHours() - i, 0, 0, 0)
    else d.setDate(d.getDate() - i)
    const pad = (x: number) => String(x).padStart(2, '0')
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const key = hourly ? `${day}T${pad(d.getHours())}:00` : day
    const row = byBucket.get(key)
    out.push({
      key,
      label: hourly ? `${pad(d.getHours())}:00` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`,
      views: row?.views ?? 0,
      visitors: row?.visitors ?? 0,
      filtered: row?.filtered ?? 0,
      botHits: hourly ? null : (botByDay.get(key) ?? 0),
    })
  }
  return out
})

const maxViews = computed(() => Math.max(1, ...series.value.map(s => s.views)))
const labelEvery = computed(() => Math.ceil(series.value.length / 10))

const botHitsTotal = computed(() => (data.value?.bots || []).reduce((a: number, b: any) => a + b.hits, 0))
const filteredTotal = computed(() => (data.value?.filtered || []).reduce((a: number, b: Row) => a + b.views, 0))
const humanShare = computed(() => {
  const human = data.value?.totals?.views ?? 0
  const all = human + filteredTotal.value + botHitsTotal.value
  return all ? Math.round((human / all) * 100) : 0
})

const breakdowns = computed(() => data.value
  ? [
      { title: 'Referrers', icon: 'i-heroicons-link', rows: data.value.referrers as Row[], empty: 'No external referrers yet' },
      { title: 'Campaigns (utm_source / ref)', icon: 'i-heroicons-megaphone', rows: data.value.campaigns as Row[], empty: 'No tagged links yet' },
      { title: 'Browsers', icon: 'i-heroicons-globe-alt', rows: data.value.browsers as Row[] },
      { title: 'Operating systems', icon: 'i-heroicons-computer-desktop', rows: data.value.oses as Row[] },
      { title: 'Devices', icon: 'i-heroicons-device-phone-mobile', rows: data.value.devices as Row[] },
      { title: 'Languages', icon: 'i-heroicons-language', rows: data.value.languages as Row[] },
    ]
  : [])

function share(rows: Row[], row: Row) {
  const max = Math.max(1, ...rows.map(r => r.views))
  return `${(row.views / max) * 100}%`
}
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">Visitors</h1>
        <p class="text-ink-3">Cookieless page views from real readers. Bots and headless crawlers are filtered out.</p>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex border border-rule">
          <button
            v-for="opt in rangeOptions"
            :key="opt.value"
            class="px-3 py-1.5 text-sm transition-colors"
            :class="days === opt.value ? 'bg-accent text-white' : 'bg-panel text-ink-3 hover:text-ink'"
            @click="days = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <button class="p-2 border border-rule bg-panel text-ink-3 hover:text-ink" title="Refresh" @click="refresh()">
          <Icon name="i-heroicons-arrow-path" :class="pending ? 'animate-spin' : ''" />
        </button>
      </div>
    </div>

    <Card v-if="error">
      <p class="text-red-600">Failed to load visitor stats: {{ error.message }}</p>
    </Card>

    <template v-else-if="data">
      <!-- KPIs -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-5 mb-6">
        <Card>
          <h3 class="text-sm font-medium text-ink-3">Page views</h3>
          <p class="text-2xl font-bold">{{ fmt(data.totals.views) }}</p>
          <p class="text-sm text-ink-3 mt-1">human, engaged</p>
        </Card>
        <Card>
          <h3 class="text-sm font-medium text-ink-3">Visitors</h3>
          <p class="text-2xl font-bold">{{ fmt(data.totals.visitors) }}</p>
          <p class="text-sm text-ink-3 mt-1">sum of daily uniques</p>
        </Card>
        <Card>
          <h3 class="text-sm font-medium text-ink-3">Right now</h3>
          <p class="text-2xl font-bold">{{ fmt(data.totals.live_visitors) }}</p>
          <p class="text-sm text-ink-3 mt-1">visitors, last 30 min</p>
        </Card>
        <Card>
          <h3 class="text-sm font-medium text-ink-3">Median time on page</h3>
          <p class="text-2xl font-bold">{{ fmtDuration(data.totals.median_duration_ms) }}</p>
          <p class="text-sm text-ink-3 mt-1">visible time</p>
        </Card>
        <Card>
          <h3 class="text-sm font-medium text-ink-3">Filtered out</h3>
          <p class="text-2xl font-bold">{{ fmt(filteredTotal + botHitsTotal) }}</p>
          <p class="text-sm text-ink-3 mt-1">{{ humanShare }}% of traffic is human</p>
        </Card>
      </div>

      <!-- Time series -->
      <Card class="mb-6">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">Page views {{ data.days === 1 ? 'per hour' : 'per day' }}</h2>
            <div class="flex items-center gap-4 text-xs text-ink-3">
              <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-3 bg-accent" /> views</span>
              <span class="flex items-center gap-1.5"><span class="inline-block w-3 h-0.5 bg-ink-3" /> visitors</span>
            </div>
          </div>
        </template>
        <div v-if="!data.totals.views" class="py-10 text-center text-ink-3">
          No human page views in this range yet. Data starts when the beacon went live.
        </div>
        <div v-else>
          <div class="relative h-48 flex items-end gap-px">
            <div
              v-for="s in series"
              :key="s.key"
              class="group relative flex-1 h-full flex items-end"
            >
              <div class="w-full bg-accent opacity-75 group-hover:opacity-100" :style="{ height: `${(s.views / maxViews) * 100}%` }" />
              <div
                class="absolute left-0 right-0 border-t-2 border-ink-3 pointer-events-none"
                :style="{ bottom: `${(s.visitors / maxViews) * 100}%` }"
              />
              <div class="absolute z-10 bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap bg-ink text-paper text-xs px-2 py-1.5 shadow">
                <div class="font-semibold">{{ s.label }}</div>
                <div>{{ fmt(s.views) }} views · {{ fmt(s.visitors) }} visitors</div>
                <div class="opacity-70">{{ fmt(s.filtered) }} filtered beacons<span v-if="s.botHits !== null"> · {{ fmt(s.botHits) }} bot requests</span></div>
              </div>
            </div>
          </div>
          <div class="flex gap-px mt-1 text-[10px] text-ink-4 font-mono">
            <div v-for="(s, i) in series" :key="s.key" class="flex-1 text-center overflow-visible whitespace-nowrap">
              {{ i % labelEvery === 0 ? s.label : '' }}
            </div>
          </div>
        </div>
      </Card>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-6">
        <!-- Top pages -->
        <Card class="lg:col-span-2">
          <template #header>
            <h2 class="font-semibold flex items-center gap-2"><Icon name="i-heroicons-document-text" class="text-ink-3" /> Top pages</h2>
          </template>
          <p v-if="!data.pages.length" class="text-ink-3 text-sm">No data yet</p>
          <table v-else class="w-full text-sm">
            <thead>
              <tr class="text-left text-ink-4 text-xs uppercase tracking-wide">
                <th class="pb-2 font-medium">Path</th>
                <th class="pb-2 font-medium text-right w-24">Visitors</th>
                <th class="pb-2 font-medium text-right w-24">Views</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.pages" :key="row.name" class="border-t border-rule-soft">
                <td class="py-1.5 pr-4 relative">
                  <div class="absolute inset-y-1 left-0 bg-accent-tint" :style="{ width: share(data.pages, row) }" />
                  <a :href="row.name" target="_blank" class="relative font-mono text-xs hover:text-accent break-all">{{ row.name }}</a>
                </td>
                <td class="py-1.5 text-right tabular-nums text-ink-3">{{ fmt(row.visitors) }}</td>
                <td class="py-1.5 text-right tabular-nums font-medium">{{ fmt(row.views) }}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <!-- Breakdowns -->
        <Card v-for="b in breakdowns" :key="b.title">
          <template #header>
            <h2 class="font-semibold flex items-center gap-2"><Icon :name="b.icon" class="text-ink-3" /> {{ b.title }}</h2>
          </template>
          <p v-if="!b.rows.length" class="text-ink-3 text-sm">{{ b.empty || 'No data yet' }}</p>
          <ul v-else class="space-y-1 text-sm">
            <li v-for="row in b.rows" :key="row.name" class="relative flex justify-between gap-4 px-2 py-1">
              <div class="absolute inset-y-0 left-0 bg-accent-tint" :style="{ width: share(b.rows, row) }" />
              <span class="relative truncate">{{ row.name }}</span>
              <span class="relative tabular-nums text-ink-3">{{ fmt(row.visitors) }} <span class="text-ink-4">/</span> {{ fmt(row.views) }}</span>
            </li>
          </ul>
        </Card>

        <!-- Bot filtering -->
        <Card>
          <template #header>
            <h2 class="font-semibold flex items-center gap-2"><Icon name="i-heroicons-funnel" class="text-ink-3" /> Filtered beacons</h2>
          </template>
          <p class="text-xs text-ink-3 mb-3">
            Visits that ran JavaScript but look automated. "Not engaged" means no interaction and less than 15s visible,
            typical for headless crawlers with a normal browser user agent.
          </p>
          <p v-if="!data.filtered.length" class="text-ink-3 text-sm">Nothing filtered</p>
          <ul v-else class="space-y-1 text-sm">
            <li v-for="row in data.filtered" :key="row.name" class="relative flex justify-between gap-4 px-2 py-1">
              <div class="absolute inset-y-0 left-0 bg-paper-2" :style="{ width: share(data.filtered, row) }" />
              <span class="relative truncate">{{ row.name }}</span>
              <span class="relative tabular-nums text-ink-3">{{ fmt(row.views) }}</span>
            </li>
          </ul>
        </Card>

        <Card>
          <template #header>
            <h2 class="font-semibold flex items-center gap-2"><Icon name="i-heroicons-bug-ant" class="text-ink-3" /> Bot page requests</h2>
          </template>
          <p class="text-xs text-ink-3 mb-3">
            Page requests from user agents that say they are bots. These never reach the visitor counts above.
          </p>
          <p v-if="!data.bots.length" class="text-ink-3 text-sm">No bot requests counted yet</p>
          <ul v-else class="space-y-1 text-sm">
            <li v-for="row in data.bots" :key="row.name" class="relative flex justify-between gap-4 px-2 py-1">
              <div class="absolute inset-y-0 left-0 bg-paper-2" :style="{ width: `${(row.hits / Math.max(1, data.bots[0].hits)) * 100}%` }" />
              <span class="relative truncate">{{ row.name }}</span>
              <span class="relative tabular-nums text-ink-3">{{ fmt(row.hits) }}</span>
            </li>
          </ul>
        </Card>
      </div>

      <p class="text-xs text-ink-4">
        Visitors are counted with a hash of IP and user agent salted with a random value that is discarded after two days.
        No cookies, no stored IPs; a visitor can't be followed across days. Admin sessions and /admin pages are not counted.
        Raw page views are kept 13 months.
      </p>
    </template>

    <Card v-else>
      <div class="py-12 text-center text-ink-3">Loading…</div>
    </Card>
  </div>
</template>
