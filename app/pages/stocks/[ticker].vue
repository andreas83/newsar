<script setup lang="ts">
const route = useRoute()
const ticker = (route.params.ticker as string).toUpperCase()

const selectedDays = ref(30)

const { data, pending, error } = await useFetch(
  () => `/api/stocks/${ticker}/history?days=${selectedDays.value}`,
  { watch: [selectedDays] }
)

const { data: mentionData } = await useFetch(
  () => `/api/stocks/${ticker}/mentions?days=${selectedDays.value}`,
  { watch: [selectedDays] }
)

const { data: peopleData } = await useFetch(
  () => `/api/stocks/${ticker}/people`
)

const { data: signalData } = await useFetch(
  () => `/api/stocks/${ticker}/signals`,
  { lazy: true }
)

const activeSignal = computed(() =>
  signalData.value?.signals?.find((s: any) => s.status === 'active') ?? null
)
const pastSignals = computed(() =>
  signalData.value?.signals?.filter((s: any) => s.status !== 'active') ?? []
)

function formatSignalDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatEventShort(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function hitCheck(rec: any) {
  if (rec.actualChange5d == null) return null
  if (rec.signalDirection === 'bullish' && rec.actualChange5d > 0) return true
  if (rec.signalDirection === 'bearish' && rec.actualChange5d < 0) return true
  if (rec.signalDirection === 'neutral') return null
  return false
}

function formatPctShort(v: number | null) {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function personInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const roleColors: Record<string, string> = {
  executive: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  associated: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  political: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
}

function roleColor(type: string) {
  return roleColors[type] || roleColors.associated
}

// Computed values from latest price entry
const latestPrice = computed(() => data.value?.prices?.[0] ?? null)
const isPositive = computed(() => (latestPrice.value?.changePercent ?? 0) >= 0)

const formattedPrice = computed(() =>
  latestPrice.value?.price != null ? `$${latestPrice.value.price.toFixed(2)}` : '--'
)
const formattedChange = computed(() => {
  const cp = latestPrice.value?.changePercent
  if (cp == null) return ''
  const sign = cp >= 0 ? '+' : ''
  return `${sign}${cp.toFixed(2)}%`
})
const formattedChangeAmt = computed(() => {
  const ca = latestPrice.value?.changeAmount
  if (ca == null) return ''
  const sign = ca >= 0 ? '+' : ''
  return `${sign}$${Math.abs(ca).toFixed(2)}`
})

function formatVolume(v: number | null) {
  if (v == null) return '--'
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toString()
}

function formatDollars(v: number | null) {
  if (v == null) return '--'
  return `$${v.toFixed(2)}`
}

function formatRelativeTime(date: string | Date) {
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sentimentColor(s: number | null) {
  if (s == null) return 'text-ink-4'
  if (s > 0.2) return 'text-green-600 dark:text-green-400'
  if (s < -0.2) return 'text-red-600 dark:text-red-400'
  return 'text-ink-3'
}

function sentimentLabel(s: number | null) {
  if (s == null) return 'Neutral'
  if (s > 0.4) return 'Positive'
  if (s > 0.2) return 'Slightly Positive'
  if (s < -0.4) return 'Negative'
  if (s < -0.2) return 'Slightly Negative'
  return 'Neutral'
}

// SEO
const pageTitle = computed(() =>
  data.value ? `${ticker} ${data.value.companyName} - Markets - Newsar` : `${ticker} - Markets - Newsar`
)
const pageDesc = computed(() =>
  data.value ? `Stock price and news coverage for ${data.value.companyName} (${ticker})` : `Stock data for ${ticker}`
)

useSeoMeta({
  title: pageTitle,
  description: pageDesc,
  ogTitle: pageTitle,
  ogDescription: pageDesc,
})
</script>

<template>
  <div class="min-h-screen bg-paper">
    <!-- Loading -->
    <div v-if="pending && !data" class="max-w-6xl mx-auto px-4 py-8">
      <div class="animate-pulse">
        <div class="h-6 bg-paper-2 rounded w-20 mb-2" />
        <div class="h-4 bg-paper-2 rounded w-48 mb-6" />
        <div class="h-80 bg-paper-2 rounded mb-6" />
        <div class="grid grid-cols-4 gap-4">
          <div v-for="i in 4" :key="i" class="h-16 bg-paper-2 rounded" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="max-w-6xl mx-auto px-4 py-8">
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-sm p-6">
        <h1 class="text-xl font-bold text-red-900 dark:text-red-300 mb-2">Ticker Not Found</h1>
        <p class="text-red-700 dark:text-red-400 mb-4">{{ ticker }} is not in the watchlist.</p>
        <NuxtLink to="/stocks" class="text-accent hover:text-accent-ink font-mono text-sm">
          ← Back to Markets
        </NuxtLink>
      </div>
    </div>

    <!-- Main Content -->
    <div v-else-if="data" class="max-w-6xl mx-auto px-4 py-8">
      <!-- Breadcrumb -->
      <nav class="flex items-center gap-1.5 text-xs font-mono text-ink-4 mb-6">
        <NuxtLink to="/stocks" class="hover:text-accent transition-colors">Markets</NuxtLink>
        <span>/</span>
        <span class="text-ink-2">{{ ticker }}</span>
      </nav>

      <!-- Header Panel -->
      <div class="bg-panel border border-rule rounded-sm p-5 mb-6">
        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <!-- Left: Identity -->
          <div>
            <div class="flex items-center gap-3 mb-1">
              <h1 class="text-3xl font-mono font-bold text-ink tracking-tight">{{ ticker }}</h1>
              <span
                v-if="data.exchange"
                class="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-paper-2 text-ink-4 rounded-sm"
              >
                {{ data.exchange }}
              </span>
              <span
                v-if="latestPrice?.marketStatus"
                class="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded-sm"
                :class="latestPrice.marketStatus === 'open'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-paper-2 text-ink-4'"
              >
                {{ latestPrice.marketStatus === 'open' ? 'Market Open' : latestPrice.marketStatus === 'pre_market' ? 'Pre-Market' : latestPrice.marketStatus === 'after_hours' ? 'After Hours' : 'Closed' }}
              </span>
            </div>
            <p class="text-ink-3 text-base">{{ data.companyName }}</p>
            <div class="flex items-center gap-2 mt-2">
              <span
                v-if="data.sector"
                class="px-1.5 py-0.75 text-[10px] font-mono font-medium uppercase tracking-widest bg-accent text-white rounded-sm"
              >
                {{ data.sector }}
              </span>
              <NuxtLink
                v-if="data.entitySlug"
                :to="`/organization/${data.entitySlug}`"
                class="px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-sm hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
              >
                View Entity Profile →
              </NuxtLink>
            </div>
          </div>

          <!-- Right: Price -->
          <div class="sm:text-right">
            <div class="text-4xl font-mono font-bold text-ink tracking-tight leading-none">
              {{ formattedPrice }}
            </div>
            <div class="flex items-center sm:justify-end gap-2 mt-1.5">
              <span
                class="text-lg font-mono font-semibold"
                :class="isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
              >
                {{ formattedChange }}
              </span>
              <span
                v-if="latestPrice?.changeAmount != null"
                class="text-sm font-mono text-ink-4"
              >
                ({{ formattedChangeAmt }})
              </span>
            </div>
            <div v-if="latestPrice?.fetchedAt" class="text-[10px] font-mono text-ink-4 mt-1">
              {{ formatRelativeTime(latestPrice.fetchedAt) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Chart + Sidebar Layout -->
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
        <!-- Chart (3/4) -->
        <div class="lg:col-span-3 bg-panel border border-rule rounded-sm p-5">
          <ClientOnly>
            <StockPriceChart
              :ticker="ticker"
              :days="selectedDays"
              :height="380"
              :show-volume="true"
              :show-anomalies="true"
            />
          </ClientOnly>
        </div>

        <!-- Sidebar (1/4) -->
        <div class="space-y-6">
        <div class="bg-panel border border-rule rounded-sm p-5">
          <h3 class="text-[10px] font-mono uppercase tracking-widest text-ink-4 mb-4">
            Latest Session
          </h3>

          <div class="space-y-3">
            <div class="flex justify-between items-baseline">
              <span class="text-xs font-mono text-ink-4">Open</span>
              <span class="text-sm font-mono font-semibold text-ink">{{ formatDollars(latestPrice?.openPrice) }}</span>
            </div>
            <div class="border-t border-rule-soft" />

            <div class="flex justify-between items-baseline">
              <span class="text-xs font-mono text-ink-4">High</span>
              <span class="text-sm font-mono font-semibold text-green-600 dark:text-green-400">{{ formatDollars(latestPrice?.highPrice) }}</span>
            </div>
            <div class="border-t border-rule-soft" />

            <div class="flex justify-between items-baseline">
              <span class="text-xs font-mono text-ink-4">Low</span>
              <span class="text-sm font-mono font-semibold text-red-600 dark:text-red-400">{{ formatDollars(latestPrice?.lowPrice) }}</span>
            </div>
            <div class="border-t border-rule-soft" />

            <div class="flex justify-between items-baseline">
              <span class="text-xs font-mono text-ink-4">Close</span>
              <span class="text-sm font-mono font-semibold text-ink">{{ formatDollars(latestPrice?.price) }}</span>
            </div>
            <div class="border-t border-rule-soft" />

            <div class="flex justify-between items-baseline">
              <span class="text-xs font-mono text-ink-4">Volume</span>
              <span class="text-sm font-mono font-semibold text-ink">{{ formatVolume(latestPrice?.volume) }}</span>
            </div>

            <template v-if="latestPrice?.previousClose != null">
              <div class="border-t border-rule-soft" />
              <div class="flex justify-between items-baseline">
                <span class="text-xs font-mono text-ink-4">Prev Close</span>
                <span class="text-sm font-mono font-semibold text-ink">{{ formatDollars(latestPrice.previousClose) }}</span>
              </div>
            </template>
          </div>

          <!-- Price Range Bar -->
          <div v-if="latestPrice?.lowPrice && latestPrice?.highPrice" class="mt-5 pt-4 border-t border-rule">
            <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4 mb-2">Day Range</div>
            <div class="relative h-1.5 bg-paper-2 rounded-full">
              <div
                class="absolute top-0 h-1.5 rounded-full"
                :class="isPositive ? 'bg-green-500/40' : 'bg-red-500/40'"
                :style="{
                  left: '0%',
                  width: latestPrice.price != null
                    ? `${Math.min(100, Math.max(0, ((latestPrice.price - latestPrice.lowPrice) / (latestPrice.highPrice - latestPrice.lowPrice)) * 100))}%`
                    : '50%'
                }"
              />
              <div
                v-if="latestPrice.price != null"
                class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-800"
                :class="isPositive ? 'bg-green-600' : 'bg-red-600'"
                :style="{
                  left: `${Math.min(100, Math.max(0, ((latestPrice.price - latestPrice.lowPrice) / (latestPrice.highPrice - latestPrice.lowPrice)) * 100))}%`,
                  transform: 'translate(-50%, -50%)'
                }"
              />
            </div>
            <div class="flex justify-between mt-1">
              <span class="text-[10px] font-mono text-ink-4">{{ formatDollars(latestPrice.lowPrice) }}</span>
              <span class="text-[10px] font-mono text-ink-4">{{ formatDollars(latestPrice.highPrice) }}</span>
            </div>
          </div>

          <!-- Data Source -->
          <div v-if="latestPrice?.source" class="mt-4 pt-3 border-t border-rule">
            <div class="text-[10px] font-mono text-ink-4">
              Source: <span class="text-ink-3">{{ latestPrice.source }}</span>
            </div>
            <div class="text-[10px] font-mono text-ink-4">
              Points: <span class="text-ink-3">{{ data.prices?.length ?? 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Key People -->
        <div v-if="peopleData?.people?.length" class="bg-panel border border-rule rounded-sm p-5">
          <h3 class="text-[10px] font-mono uppercase tracking-widest text-ink-4 mb-3">
            Key People
          </h3>
          <div class="space-y-2">
            <NuxtLink
              v-for="person in peopleData.people.slice(0, 5)"
              :key="person.id"
              :to="`/person/${person.slug}`"
              class="flex items-center gap-2.5 hover:bg-paper-2/50 -mx-1.5 px-1.5 py-1.5 rounded-sm transition-colors"
            >
              <span
                class="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                :class="roleColor(person.relationshipType)"
              >
                {{ personInitials(person.name) }}
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-ink truncate">{{ person.name }}</div>
                <div class="text-[9px] font-mono text-ink-4">
                  {{ person.roleLabel }} · {{ person.coOccurrenceCount }} mentions
                </div>
              </div>
            </NuxtLink>
          </div>
        </div>
        </div>
      </div>

      <!-- Active Signal -->
      <StockRecommendationCard
        v-if="activeSignal"
        :recommendation="{
          ...activeSignal,
          ticker,
          companyName: data.companyName,
          sector: data.sector,
          entitySlug: data.entitySlug,
          currentPrice: latestPrice?.price ?? null,
          currentChangePercent: latestPrice?.changePercent ?? null,
        }"
      />

      <!-- Signal History -->
      <div v-if="pastSignals.length > 0" class="bg-panel border border-rule rounded-sm p-5">
        <h2 class="text-sm font-mono font-semibold text-ink-2 uppercase tracking-wider mb-4">
          Signal History
        </h2>
        <div class="overflow-x-auto">
          <table class="w-full text-xs font-mono">
            <thead>
              <tr class="text-left text-ink-4 border-b border-rule">
                <th class="pb-2 pr-3">Date</th>
                <th class="pb-2 pr-3">Event</th>
                <th class="pb-2 pr-3">Signal</th>
                <th class="pb-2 pr-3 text-right">Expected</th>
                <th class="pb-2 pr-3 text-right">Actual (5d)</th>
                <th class="pb-2 text-center">Hit?</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-rule-soft">
              <tr v-for="sig in pastSignals" :key="sig.id" class="text-ink-2">
                <td class="py-2 pr-3 text-ink-3">{{ formatSignalDate(sig.eventDate) }}</td>
                <td class="py-2 pr-3">{{ formatEventShort(sig.eventType) }}</td>
                <td class="py-2 pr-3">
                  <StockSignalBadge :direction="sig.signalDirection" :strength="sig.signalStrength" compact />
                </td>
                <td class="py-2 pr-3 text-right" :class="sig.shortTerm.expectedChange >= 0 ? 'text-green-600' : 'text-red-600'">
                  {{ formatPctShort(sig.shortTerm.expectedChange) }}
                </td>
                <td class="py-2 pr-3 text-right" :class="sig.actualChange5d != null ? (sig.actualChange5d >= 0 ? 'text-green-600' : 'text-red-600') : 'text-ink-4'">
                  {{ formatPctShort(sig.actualChange5d) }}
                </td>
                <td class="py-2 text-center">
                  <span v-if="hitCheck(sig) === true" class="text-green-600">Yes</span>
                  <span v-else-if="hitCheck(sig) === false" class="text-red-600">No</span>
                  <span v-else class="text-ink-4">--</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Related News -->
      <div v-if="mentionData?.mentions?.length" class="bg-panel border border-rule rounded-sm p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-mono font-semibold text-ink-2 uppercase tracking-wider">
            Related News
          </h2>
          <span class="text-[10px] font-mono text-ink-4">
            {{ mentionData.mentions.length }} articles ({{ selectedDays }}d)
          </span>
        </div>

        <div class="divide-y divide-rule-soft">
          <NuxtLink
            v-for="mention in mentionData.mentions"
            :key="mention.articleId"
            :to="`/articles/${mention.articleId}`"
            class="flex items-start gap-4 py-3 -mx-2 px-2 hover:bg-paper-2/50 rounded-sm transition-colors"
          >
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-medium text-ink leading-snug line-clamp-2 mb-1">
                {{ mention.title }}
              </h3>
              <div class="flex items-center gap-3 text-[11px] font-mono text-ink-4">
                <time :datetime="mention.publishedAt">
                  {{ formatRelativeTime(mention.publishedAt) }}
                </time>
                <span
                  v-if="mention.sentiment != null"
                  :class="sentimentColor(mention.sentiment)"
                >
                  {{ sentimentLabel(mention.sentiment) }}
                </span>
                <span v-if="mention.relevanceScore != null" class="text-ink-4">
                  Rel: {{ (mention.relevanceScore * 100).toFixed(0) }}%
                </span>
              </div>
            </div>
            <span class="flex-shrink-0 text-ink-4 text-xs mt-1">→</span>
          </NuxtLink>
        </div>
      </div>

      <!-- No mentions state -->
      <div
        v-else-if="mentionData && !mentionData.mentions?.length"
        class="bg-panel border border-rule rounded-sm p-5"
      >
        <div class="text-center py-6">
          <p class="text-sm text-ink-3 font-mono">
            {{ mentionData.entityId ? 'No news mentions in this period.' : 'This ticker is not linked to a news entity.' }}
          </p>
        </div>
      </div>

      <!-- Back link -->
      <div class="mt-6 pt-4 border-t border-rule">
        <NuxtLink
          to="/stocks"
          class="text-xs font-mono text-ink-4 hover:text-accent transition-colors"
        >
          ← Back to Markets
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
