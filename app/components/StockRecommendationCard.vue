<script setup lang="ts">
const props = defineProps<{
  recommendation: {
    id: number
    signalDirection: string
    signalStrength: number
    shortTerm: { direction: string; confidence: number; expectedChange: number | null }
    mediumTerm: { direction: string; confidence: number; expectedChange: number | null }
    scoring: {
      eventStrength: number
      historicalWinrate: number
      anomalyConfidence: number
      sourceDiversity: number
      mentionMultiplier: number
    }
    eventType: string
    eventDate: string | Date
    triggerMetadata?: any
    status: string
    actualChange5d?: number | null
    actualChange4w?: number | null
    ticker?: string
    companyName?: string
    sector?: string
    entitySlug?: string | null
    currentPrice?: number | null
    currentChangePercent?: number | null
  }
  compact?: boolean
}>()

const rec = computed(() => props.recommendation)

const dirColor = computed(() => {
  if (rec.value.signalDirection === 'bullish') return 'border-l-green-500'
  if (rec.value.signalDirection === 'bearish') return 'border-l-red-500'
  return 'border-l-gray-400'
})

function formatEventType(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatChange(v: number | null | undefined) {
  if (v == null) return '--'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function changeColor(v: number | null | undefined) {
  if (v == null) return 'text-ink-4'
  return v >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
}

const scoreBars = computed(() => [
  { label: 'Win Rate', value: rec.value.scoring.historicalWinrate, weight: 0.35 },
  { label: 'Anomaly', value: rec.value.scoring.anomalyConfidence, weight: 0.20 },
  { label: 'Event', value: rec.value.scoring.eventStrength, weight: 0.15 },
  { label: 'Sources', value: rec.value.scoring.sourceDiversity, weight: 0.15 },
  { label: 'Multiplier', value: rec.value.scoring.mentionMultiplier, weight: 0.15 },
])
</script>

<template>
  <div
    class="bg-panel border border-rule rounded-sm border-l-4 transition-colors"
    :class="dirColor"
  >
    <div :class="compact ? 'p-3' : 'p-4 sm:p-5'">
      <!-- Header: Ticker + Signal -->
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <NuxtLink
              v-if="rec.ticker"
              :to="`/stocks/${rec.ticker}`"
              class="font-mono font-bold text-ink hover:text-accent transition-colors"
              :class="compact ? 'text-sm' : 'text-base'"
            >
              {{ rec.ticker }}
            </NuxtLink>
            <StockSignalBadge
              :direction="rec.signalDirection as any"
              :strength="rec.signalStrength"
              :compact="compact"
            />
            <span
              v-if="rec.status !== 'active'"
              class="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded-sm"
              :class="rec.status === 'validated' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-paper-2 text-ink-4'"
            >
              {{ rec.status }}
            </span>
          </div>
          <div v-if="rec.companyName && !compact" class="text-xs text-ink-3 mt-0.5">
            {{ rec.companyName }}
            <span v-if="rec.sector" class="text-ink-4"> &middot; {{ rec.sector }}</span>
          </div>
        </div>
        <div v-if="rec.currentPrice" class="text-right flex-shrink-0">
          <div class="font-mono font-bold text-ink text-sm">${{ rec.currentPrice.toFixed(2) }}</div>
          <div
            v-if="rec.currentChangePercent != null"
            class="text-xs font-mono"
            :class="changeColor(rec.currentChangePercent)"
          >
            {{ formatChange(rec.currentChangePercent) }}
          </div>
        </div>
      </div>

      <!-- Dual Timeframe -->
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="bg-paper rounded-sm p-2.5 border border-rule-soft">
          <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4 mb-1">Short Term (1-5d)</div>
          <div class="flex items-center gap-1.5">
            <StockSignalBadge :direction="rec.shortTerm.direction as any" :strength="rec.shortTerm.confidence" compact />
            <span v-if="rec.shortTerm.expectedChange != null" class="text-xs font-mono" :class="changeColor(rec.shortTerm.expectedChange)">
              Exp: {{ formatChange(rec.shortTerm.expectedChange) }}
            </span>
          </div>
          <div v-if="rec.actualChange5d != null" class="mt-1 text-[10px] font-mono">
            <span class="text-ink-4">Actual:</span>
            <span class="ml-1 font-medium" :class="changeColor(rec.actualChange5d)">{{ formatChange(rec.actualChange5d) }}</span>
          </div>
        </div>
        <div class="bg-paper rounded-sm p-2.5 border border-rule-soft">
          <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4 mb-1">Medium Term (1-4w)</div>
          <div class="flex items-center gap-1.5">
            <StockSignalBadge :direction="rec.mediumTerm.direction as any" :strength="rec.mediumTerm.confidence" compact />
            <span v-if="rec.mediumTerm.expectedChange != null" class="text-xs font-mono" :class="changeColor(rec.mediumTerm.expectedChange)">
              Exp: {{ formatChange(rec.mediumTerm.expectedChange) }}
            </span>
          </div>
          <div v-if="rec.actualChange4w != null" class="mt-1 text-[10px] font-mono">
            <span class="text-ink-4">Actual:</span>
            <span class="ml-1 font-medium" :class="changeColor(rec.actualChange4w)">{{ formatChange(rec.actualChange4w) }}</span>
          </div>
        </div>
      </div>

      <!-- Trigger Info -->
      <div v-if="!compact" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-ink-4 mb-3">
        <span>
          <span class="text-ink-3">Event:</span> {{ formatEventType(rec.eventType) }}
        </span>
        <span>
          <span class="text-ink-3">Date:</span> {{ formatDate(rec.eventDate) }}
        </span>
        <span v-if="rec.triggerMetadata?.multiplier">
          <span class="text-ink-3">Multiplier:</span> {{ rec.triggerMetadata.multiplier.toFixed(1) }}x
        </span>
        <span v-if="rec.triggerMetadata?.sourceCount">
          <span class="text-ink-3">Sources:</span> {{ rec.triggerMetadata.sourceCount }}
        </span>
        <span v-if="rec.triggerMetadata?.mentionCount">
          <span class="text-ink-3">Mentions:</span> {{ rec.triggerMetadata.mentionCount }}
        </span>
      </div>

      <!-- Score Breakdown (non-compact) -->
      <div v-if="!compact" class="space-y-1.5">
        <div class="text-[10px] font-mono uppercase tracking-widest text-ink-4">Score Breakdown</div>
        <div v-for="bar in scoreBars" :key="bar.label" class="flex items-center gap-2">
          <span class="text-[10px] font-mono text-ink-4 w-16 flex-shrink-0">{{ bar.label }}</span>
          <div class="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all"
              :class="rec.signalDirection === 'bullish' ? 'bg-green-500/60' : rec.signalDirection === 'bearish' ? 'bg-red-500/60' : 'bg-gray-400/60'"
              :style="{ width: `${(bar.value * 100).toFixed(0)}%` }"
            />
          </div>
          <span class="text-[10px] font-mono text-ink-4 w-8 text-right">{{ (bar.value * 100).toFixed(0) }}%</span>
        </div>
      </div>

      <!-- Entity Link (compact) -->
      <div v-if="compact && rec.entitySlug" class="mt-2">
        <NuxtLink
          :to="`/organization/${rec.entitySlug}`"
          class="text-[10px] font-mono text-accent hover:text-accent-ink"
        >
          View Entity →
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
