<script setup lang="ts">
const { data: stats, refresh } = await useFetch('/api/admin/stocks/stats', { lazy: true })

const collecting = ref(false)
async function triggerCollection() {
  collecting.value = true
  try {
    await $fetch('/api/admin/stocks/collect', { method: 'POST' })
    await refresh()
  } catch (e) {
    console.error('Collection error:', e)
  } finally {
    collecting.value = false
  }
}
</script>

<template>
  <Card>
    <template #header>
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold flex items-center gap-2">
          <Icon name="i-heroicons-chart-bar" class="w-5 h-5 text-green-600" />
          Stock Market Tracking
        </h3>
        <button
          class="text-xs font-mono px-2 py-1 rounded-sm bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          :disabled="collecting"
          @click="triggerCollection"
        >
          {{ collecting ? 'Collecting...' : 'Collect Now' }}
        </button>
      </div>
    </template>

    <div v-if="stats" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="p-3 bg-paper-2/50 rounded-sm border border-rule">
        <div class="text-xs text-ink-3 mb-1">Active Tickers</div>
        <div class="text-xl font-bold text-ink">{{ stats.activeTickers }}</div>
        <div class="text-xs text-ink-4 mt-0.5">of {{ stats.totalTickers }} total</div>
      </div>

      <div class="p-3 bg-paper-2/50 rounded-sm border border-rule">
        <div class="text-xs text-ink-3 mb-1">Mapped to Entities</div>
        <div class="text-xl font-bold text-ink">{{ stats.mappedTickers }}</div>
        <div class="text-xs text-ink-4 mt-0.5">
          {{ stats.activeTickers > 0 ? Math.round((stats.mappedTickers / stats.activeTickers) * 100) : 0 }}% linked
        </div>
      </div>

      <div class="p-3 bg-paper-2/50 rounded-sm border border-rule">
        <div class="text-xs text-ink-3 mb-1">Price Points</div>
        <div class="text-xl font-bold text-ink">{{ (stats.totalPricePoints || 0).toLocaleString() }}</div>
        <div class="text-xs text-ink-4 mt-0.5">AV quota: {{ stats.alphaVantageQuota }}</div>
      </div>

      <div class="p-3 bg-paper-2/50 rounded-sm border border-rule">
        <div class="text-xs text-ink-3 mb-1">Market Status</div>
        <div class="text-xl font-bold" :class="stats.isMarketOpen ? 'text-green-600' : 'text-ink-3'">
          {{ stats.isMarketOpen ? 'Open' : 'Closed' }}
        </div>
        <div class="text-xs text-ink-4 mt-0.5">{{ stats.marketStatus }}</div>
      </div>
    </div>

    <div v-else class="text-sm text-ink-3 text-center py-4">
      Loading stock stats...
    </div>
  </Card>
</template>
