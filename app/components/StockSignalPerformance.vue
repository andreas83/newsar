<script setup lang="ts">
const props = defineProps<{
  stats: {
    overall: {
      totalSignals: number
      validatedCount: number
      activeCount: number
      winRate5d: number | null
      winRate4w: number | null
      avgReturn5d: number | null
      avgReturn4w: number | null
      avgSignalStrength: number
    }
    byEventType: Array<{
      eventType: string
      count: number
      validated: number
      avgStrength: number
      avgReturn5d: number | null
      winRate: number | null
    }>
    profiles: {
      tickersWithProfiles: number
      totalProfiles: number
      avgSampleCount: number
      avgConfidence: number
    }
  }
}>()

function formatPct(v: number | null) {
  if (v == null) return '--'
  return `${(v * 100).toFixed(1)}%`
}

function formatReturn(v: number | null) {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function formatEventType(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function returnColor(v: number | null) {
  if (v == null) return 'text-ink-4'
  return v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
}
</script>

<template>
  <div class="bg-panel border border-rule rounded-sm p-5">
    <h3 class="text-sm font-mono font-semibold text-ink-2 uppercase tracking-wider mb-4">
      Signal Performance
    </h3>

    <!-- Summary Stats Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
      <div>
        <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4">Active</div>
        <div class="text-xl font-mono font-bold text-ink mt-0.5">{{ stats.overall.activeCount }}</div>
      </div>
      <div>
        <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4">Validated</div>
        <div class="text-xl font-mono font-bold text-ink mt-0.5">{{ stats.overall.validatedCount }}</div>
      </div>
      <div>
        <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4">5d Win Rate</div>
        <div
          class="text-xl font-mono font-bold mt-0.5"
          :class="stats.overall.winRate5d != null && stats.overall.winRate5d > 0.5 ? 'text-green-600 dark:text-green-400' : 'text-ink'"
        >
          {{ formatPct(stats.overall.winRate5d) }}
        </div>
      </div>
      <div>
        <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4">Avg Return (5d)</div>
        <div class="text-xl font-mono font-bold mt-0.5" :class="returnColor(stats.overall.avgReturn5d)">
          {{ formatReturn(stats.overall.avgReturn5d) }}
        </div>
      </div>
    </div>

    <!-- Event Type Breakdown -->
    <div v-if="stats.byEventType.length > 0">
      <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4 mb-2">By Event Type</div>
      <div class="divide-y divide-rule-soft">
        <div
          v-for="evt in stats.byEventType"
          :key="evt.eventType"
          class="flex items-center justify-between py-2"
        >
          <div>
            <span class="text-xs font-mono text-ink">{{ formatEventType(evt.eventType) }}</span>
            <span class="text-[10px] font-mono text-ink-4 ml-2">n={{ evt.count }}</span>
          </div>
          <div class="flex items-center gap-4">
            <span v-if="evt.winRate != null" class="text-xs font-mono" :class="evt.winRate > 0.5 ? 'text-green-600' : 'text-ink-3'">
              {{ formatPct(evt.winRate) }}
            </span>
            <span class="text-xs font-mono" :class="returnColor(evt.avgReturn5d)">
              {{ formatReturn(evt.avgReturn5d) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Profile Coverage -->
    <div class="mt-4 pt-3 border-t border-rule-soft flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-ink-4">
      <span>
        Profiles: <span class="text-ink-3">{{ stats.profiles.totalProfiles }}</span>
        across <span class="text-ink-3">{{ stats.profiles.tickersWithProfiles }}</span> tickers
      </span>
      <span>
        Avg samples: <span class="text-ink-3">{{ stats.profiles.avgSampleCount.toFixed(1) }}</span>
      </span>
      <span>
        Avg confidence: <span class="text-ink-3">{{ formatPct(stats.profiles.avgConfidence) }}</span>
      </span>
    </div>
  </div>
</template>
