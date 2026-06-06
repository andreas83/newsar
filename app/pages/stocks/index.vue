<script setup lang="ts">
const selectedSector = ref<string | null>(null)
const activeTab = ref<'watchlist' | 'signals'>('watchlist')

const { data, pending, refresh } = await useFetch(
  () => `/api/stocks/watchlist${selectedSector.value ? `?sector=${selectedSector.value}` : ''}`,
  { watch: [selectedSector] }
)

const { data: signalData, pending: signalsPending } = await useFetch(
  () => `/api/stocks/recommendations?status=active${selectedSector.value ? `&sector=${selectedSector.value}` : ''}`,
  { watch: [selectedSector], lazy: true }
)

const { data: statsData } = await useFetch('/api/stocks/signal-stats', { lazy: true })

useSeoMeta({
  title: 'Markets - Newsar',
  description: 'Track stock prices and market movements correlated with news coverage.',
  ogTitle: 'Markets - Newsar',
  ogDescription: 'Track stock prices and market movements correlated with news coverage.',
})
</script>

<template>
  <Container class="py-8">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-3xl font-bold font-serif text-ink mb-2">Markets</h1>
      <p class="text-ink-3">
        Stock prices and market movements correlated with news coverage.
      </p>
    </div>

    <!-- Tab Nav -->
    <div class="flex items-center gap-1 mb-6 border-b border-rule">
      <button
        class="px-4 py-2.5 text-sm font-mono font-medium transition-colors relative"
        :class="activeTab === 'watchlist'
          ? 'text-ink'
          : 'text-ink-3 hover:text-ink'"
        @click="activeTab = 'watchlist'"
      >
        Watchlist
        <div v-if="activeTab === 'watchlist'" class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
      </button>
      <button
        class="px-4 py-2.5 text-sm font-mono font-medium transition-colors relative"
        :class="activeTab === 'signals'
          ? 'text-ink'
          : 'text-ink-3 hover:text-ink'"
        @click="activeTab = 'signals'"
      >
        Signals
        <span
          v-if="signalData?.count"
          class="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono rounded-sm bg-accent/10 text-accent"
        >
          {{ signalData.count }}
        </span>
        <div v-if="activeTab === 'signals'" class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
      </button>
      <NuxtLink
        to="/stocks/simulator"
        class="px-4 py-2.5 text-sm font-mono font-medium transition-colors relative text-ink-3 hover:text-ink"
      >
        Simulator
      </NuxtLink>
    </div>

    <!-- Sector Filter -->
    <div v-if="data?.sectors?.length" class="flex flex-wrap gap-1.5 mb-6">
      <button
        class="px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
        :class="!selectedSector
          ? 'bg-accent text-white'
          : 'bg-paper-2 text-ink-3 hover:text-ink hover:bg-paper-2/80'"
        @click="selectedSector = null"
      >
        All
      </button>
      <button
        v-for="sector in data.sectors"
        :key="sector"
        class="px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors"
        :class="selectedSector === sector
          ? 'bg-accent text-white'
          : 'bg-paper-2 text-ink-3 hover:text-ink hover:bg-paper-2/80'"
        @click="selectedSector = sector"
      >
        {{ sector }}
      </button>
    </div>

    <!-- ======== WATCHLIST TAB ======== -->
    <template v-if="activeTab === 'watchlist'">
      <!-- Loading -->
      <div v-if="pending" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div v-for="i in 12" :key="i" class="animate-pulse bg-panel border border-rule rounded-sm p-4">
          <div class="h-4 bg-paper-2 rounded w-16 mb-2" />
          <div class="h-3 bg-paper-2 rounded w-32 mb-4" />
          <div class="h-6 bg-paper-2 rounded w-24" />
        </div>
      </div>

      <!-- Stock Grid -->
      <div v-else-if="data?.items?.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <NuxtLink
          v-for="item in data.items"
          :key="item.id"
          :to="`/stocks/${item.ticker}`"
          class="block"
        >
          <StockCard
            :ticker="item.ticker"
            :company-name="item.companyName"
            :price="item.price"
            :change-amount="item.changeAmount"
            :change-percent="item.changePercent"
            :sector="item.sector"
            :entity-id="item.entityId"
            :market-status="item.marketStatus"
            :sparkline="item.sparkline"
          />
        </NuxtLink>
      </div>

      <div v-else class="text-center py-12 text-ink-3">
        <p class="text-lg mb-2">No stocks tracked yet</p>
        <p class="text-sm">Run <code class="bg-paper-2 px-1.5 py-0.5 rounded text-xs">npm run stocks:seed</code> to add initial tickers.</p>
      </div>

      <!-- Market summary footer -->
      <div v-if="data?.items?.length" class="mt-8 pt-6 border-t border-rule">
        <div class="flex flex-wrap justify-center gap-6 text-sm text-ink-3 font-mono">
          <div>
            <span class="text-ink-4">Tracked:</span>
            <span class="ml-1 text-ink font-semibold">{{ data.items.length }}</span>
          </div>
          <div>
            <span class="text-green-600">Gainers:</span>
            <span class="ml-1 font-semibold">{{ data.items.filter(i => (i.changePercent ?? 0) > 0).length }}</span>
          </div>
          <div>
            <span class="text-red-600">Losers:</span>
            <span class="ml-1 font-semibold">{{ data.items.filter(i => (i.changePercent ?? 0) < 0).length }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ======== SIGNALS TAB ======== -->
    <template v-if="activeTab === 'signals'">
      <!-- Performance Summary -->
      <StockSignalPerformance v-if="statsData" :stats="statsData" class="mb-6" />

      <!-- Loading -->
      <div v-if="signalsPending" class="space-y-4">
        <div v-for="i in 4" :key="i" class="animate-pulse bg-panel border border-rule rounded-sm p-5">
          <div class="h-5 bg-paper-2 rounded w-24 mb-3" />
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div class="h-16 bg-paper-2 rounded" />
            <div class="h-16 bg-paper-2 rounded" />
          </div>
          <div class="h-3 bg-paper-2 rounded w-48" />
        </div>
      </div>

      <!-- Recommendation Cards -->
      <div v-else-if="signalData?.recommendations?.length" class="space-y-4">
        <StockRecommendationCard
          v-for="rec in signalData.recommendations"
          :key="rec.id"
          :recommendation="rec"
        />
      </div>

      <div v-else class="text-center py-12 text-ink-3">
        <p class="text-lg mb-2">No active signals</p>
        <p class="text-sm">Signals are generated when news volume anomalies are detected for tracked stocks.</p>
      </div>
    </template>
  </Container>
</template>
