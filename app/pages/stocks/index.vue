<script setup lang="ts">
const selectedSector = ref<string | null>(null)

const { data, pending, refresh } = await useFetch(
  () => `/api/stocks/watchlist${selectedSector.value ? `?sector=${selectedSector.value}` : ''}`,
  { watch: [selectedSector] }
)


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

    <!-- Sub Nav -->
    <StockSubNav />

    <p class="text-sm text-ink-3 mb-6">
      Looking for stocks with unusual news attention? See
      <NuxtLink to="/stocks/predictions" class="text-accent hover:underline">Spike watch</NuxtLink>.
    </p>

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

    <!-- ======== WATCHLIST ======== -->
    <div>
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
    </div>

  </Container>
</template>
