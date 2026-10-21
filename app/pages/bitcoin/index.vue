<script setup lang="ts">
const priceRange = ref('7d')

const { data: prices, pending: pricesPending, refresh: refreshPrices } = await useFetch(
  () => `/api/bitcoin/prices?range=${priceRange.value}`,
  { lazy: true }
)

const { data: news, pending: newsPending } = await useFetch(
  '/api/bitcoin/news?limit=10',
  { lazy: true }
)

const { data: predictions } = await useFetch(
  '/api/bitcoin/predictions?action=active',
  { lazy: true }
)

watch(priceRange, () => refreshPrices())

useSeoMeta({
  title: 'Bitcoin - Newsar',
  description: 'Bitcoin price and news.',
})

function formatMoney(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatPct(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

function formatDate(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// SVG chart helpers
function getChartPath(history: any[]): string {
  if (!history?.length || history.length < 2) return ''
  const prices = history.map(h => h.price)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = maxP - minP || 1
  const w = 760, h = 200, padX = 20, padY = 10

  return history.map((point, i) => {
    const x = padX + (i / (history.length - 1)) * w
    const y = padY + h - ((point.price - minP) / range) * h
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
}

function getChartFill(history: any[]): string {
  if (!history?.length || history.length < 2) return ''
  const path = getChartPath(history)
  const w = 760, h = 200, padX = 20, padY = 10
  return `${path} L${padX + w},${padY + h} L${padX},${padY + h} Z`
}

function sentimentColor(val: number | null): string {
  if (val == null) return 'text-ink-4'
  if (val > 0.1) return 'text-emerald-500'
  if (val < -0.1) return 'text-rose-500'
  return 'text-ink-4'
}
</script>

<template>
  <Container class="py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-bold font-serif text-ink mb-2">Bitcoin</h1>
      <p class="text-ink-3">Bitcoin price and news. The prediction and trading experiments are retired; their pages are kept as the record.</p>
    </div>

    <BitcoinSubNav />

    <!-- Price Card -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="md:col-span-2 border border-rule rounded-lg p-5 bg-surface">
        <div v-if="pricesPending" class="py-8 text-center text-ink-3">Loading price...</div>
        <template v-else-if="prices?.current">
          <div class="flex items-baseline gap-4 mb-4">
            <span class="text-4xl font-mono font-bold text-ink">
              ${{ prices.current.price?.toLocaleString('en-US', { maximumFractionDigits: 0 }) }}
            </span>
            <span class="text-lg font-mono" :class="(prices.current.changePercent24h ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
              {{ formatPct(prices.current.changePercent24h) }}
            </span>
            <span class="text-xs text-ink-4 font-mono">24h</span>
          </div>

          <div class="grid grid-cols-3 gap-4 mb-4">
            <div>
              <div class="text-xs text-ink-4 font-mono mb-0.5">Volume 24h</div>
              <div class="text-sm font-mono text-ink">{{ formatMoney(prices.current.volume24h) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-0.5">Market Cap</div>
              <div class="text-sm font-mono text-ink">{{ formatMoney(prices.current.marketCap) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-0.5">24h Range</div>
              <div class="text-sm font-mono text-ink">
                ${{ prices.stats?.low24h?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '--' }}
                —
                ${{ prices.stats?.high24h?.toLocaleString('en-US', { maximumFractionDigits: 0 }) || '--' }}
              </div>
            </div>
          </div>

          <!-- Range selector -->
          <div class="flex items-center gap-2 mb-3">
            <button
              v-for="r in ['7d', '30d', '90d', '1y']"
              :key="r"
              class="px-3 py-1 text-xs font-mono rounded transition-colors"
              :class="priceRange === r ? 'bg-accent text-white' : 'bg-surface-2 text-ink-3 hover:text-ink'"
              @click="priceRange = r"
            >{{ r }}</button>
          </div>

          <!-- Price Chart -->
          <svg v-if="prices.history?.length > 1" viewBox="0 0 800 230" class="w-full h-48" preserveAspectRatio="none">
            <path :d="getChartFill(prices.history)" class="fill-accent/10" />
            <path :d="getChartPath(prices.history)" fill="none" class="stroke-accent" stroke-width="2" />
          </svg>
          <div v-else class="py-8 text-center text-ink-4 text-sm">No chart data</div>
        </template>
        <div v-else class="py-8 text-center text-ink-4">No price data. Run <code class="bg-surface-2 px-1 rounded text-xs">npm run btc:backfill 30</code></div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-4">
        <!-- Model status: the BTC model was retired, so no live call is shown -->
        <div class="border border-rule rounded-lg p-4 bg-surface">
          <div class="text-xs text-ink-4 font-mono mb-2">Price prediction</div>
          <p class="text-sm text-ink-3">
            None. Our Bitcoin model was retired on 23 Aug 2026 after it did no better than chance.
          </p>
          <NuxtLink to="/bitcoin/predictions" class="text-xs text-accent hover:underline mt-2 block">See its record</NuxtLink>
        </div>

        <!-- Upcoming Events -->
        <div class="border border-rule rounded-lg p-4 bg-surface">
          <div class="text-xs text-ink-4 font-mono mb-2">Upcoming Events</div>
          <template v-if="predictions?.upcomingEvents?.length">
            <div v-for="evt in predictions.upcomingEvents.slice(0, 3)" :key="evt.eventDate + evt.eventType"
              class="flex items-center justify-between py-1 border-b border-rule/30 last:border-0">
              <span class="text-xs font-mono text-ink">{{ evt.name || evt.eventType }}</span>
              <span class="text-xs font-mono text-ink-4">{{ formatDate(evt.eventDate) }}</span>
            </div>
          </template>
          <div v-else class="text-sm text-ink-4">No upcoming events</div>
        </div>
      </div>
    </div>

    <!-- Recent News -->
    <div class="border border-rule rounded-lg bg-surface">
      <h3 class="font-mono font-semibold text-sm text-ink p-5 pb-0 mb-4">Recent Bitcoin News</h3>
      <div v-if="newsPending" class="p-5 text-center text-ink-3">Loading...</div>
      <div v-else-if="news?.articles?.length" class="divide-y divide-rule/30">
        <a
          v-for="article in news.articles"
          :key="article.id"
          :href="article.url"
          target="_blank"
          rel="noopener"
          class="flex items-start gap-3 px-5 py-3 hover:bg-surface-1/50 transition-colors"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm text-ink font-medium truncate">{{ article.title }}</div>
            <div class="text-xs text-ink-4 font-mono mt-0.5">
              {{ article.feedName }} · {{ formatDate(article.publishedAt) }}
              <span v-if="article.sentiment != null" class="ml-2" :class="sentimentColor(article.sentiment)">
                {{ article.sentiment > 0 ? '+' : '' }}{{ article.sentiment.toFixed(2) }}
              </span>
            </div>
          </div>
        </a>
      </div>
      <div v-else class="p-5 text-center text-ink-4 text-sm">No Bitcoin articles found</div>
    </div>
  </Container>
</template>
