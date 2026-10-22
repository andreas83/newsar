<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

/**
 * Model diagnostics for the stock ML pipeline. The public page is /stocks/predictions
 * (News-spike watch); the metrics here are for whoever maintains the models.
 */
const activeTab = ref<'scorecard' | 'timeline' | 'dashboard'>('scorecard')

const { data: scorecard, pending: scorecardPending } = await useFetch(
  '/api/stocks/predictions?action=scorecard',
  { lazy: true }
)

const { data: history, pending: historyPending } = await useFetch(
  '/api/stocks/predictions?action=history',
  { lazy: true }
)

const { data: dashboard, pending: dashboardPending } = await useFetch(
  '/api/stocks/predictions?action=dashboard',
  { lazy: true }
)

/**
 * A win rate is only good news if it beats the base rate over the same window,
 * and an AUC is only a result if its interval clears 0.5. These three keep the
 * page from presenting a coin flip as performance.
 */
const beatsBaseline = computed(() => {
  const s = scorecard.value?.summary
  if (s?.winRate4w == null || s?.winRateBaseline == null) return false
  return s.winRate4w > s.winRateBaseline
})

const noSignal = computed(() => {
  const ci = scorecard.value?.scorecards?.mlDeciding?.ci
  if (!ci) return false
  return ci.low <= 0.5 && ci.high >= 0.5
})

const tradeGate = computed(() => scorecard.value?.contract?.sources?.ml_model ?? null)

const aucColor = computed(() => {
  const auc = scorecard.value?.summary?.auc
  if (auc == null) return 'text-ink'
  if (noSignal.value) return 'text-ink-3'
  return auc > 0.5 ? 'text-emerald-500' : 'text-rose-500'
})

useSeoMeta({
  title: 'ML Model Diagnostics - Newsar Admin',
})

function formatPct(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

function formatDate(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateShort(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function directionColor(dir: string): string {
  if (dir === 'bullish') return 'text-emerald-500'
  if (dir === 'bearish') return 'text-rose-500'
  return 'text-ink-3'
}

function directionBg(dir: string): string {
  if (dir === 'bullish') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  if (dir === 'bearish') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

function confidencePct(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  return (n * 100).toFixed(0) + '%'
}

function eventLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Timeline chart helpers
const modelColors: Record<string, string> = {
  xgb_4w_classifier: '#3b82f6',
  xgb_4w_alpha_classifier: '#8b5cf6',
  lgbm_4w_classifier: '#10b981',
  logreg_baseline: '#f59e0b',
}

const modelLabels: Record<string, string> = {
  xgb_4w_classifier: 'XGBoost 4w',
  xgb_4w_alpha_classifier: 'XGB Alpha 4w',
  lgbm_4w_classifier: 'LightGBM 4w',
  logreg_baseline: 'LogReg Baseline',
}

function getTimelinePoints(entries: any[], modelName: string): string {
  if (!entries?.length) return ''
  const validEntries = entries.filter(e => e.models?.[modelName]?.roc_auc != null)
  if (validEntries.length < 1) return ''

  const width = 760
  const height = 200
  const padX = 20
  const padY = 20

  return validEntries.map((entry, i) => {
    const x = validEntries.length === 1
      ? width / 2 + padX
      : padX + (i / (validEntries.length - 1)) * width
    const auc = entry.models[modelName].roc_auc
    const y = padY + height - ((auc - 0.4) / 0.6) * height
    return `${x},${y}`
  }).join(' ')
}

function getSampleBarPoints(entries: any[]): { x: number; height: number; label: string }[] {
  if (!entries?.length) return []
  const maxSamples = Math.max(...entries.map(e => e.total_samples || 0))
  const width = 760
  const padX = 20
  const barWidth = Math.min(30, width / entries.length - 4)

  return entries.map((entry, i) => {
    const x = entries.length === 1
      ? width / 2 + padX - barWidth / 2
      : padX + (i / (entries.length - 1)) * width - barWidth / 2
    const ratio = maxSamples > 0 ? (entry.total_samples || 0) / maxSamples : 0
    return {
      x,
      height: ratio * 50,
      label: String(entry.total_samples || 0),
    }
  })
}
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold">ML Model Diagnostics</h1>
      <p class="text-ink-3">
        Technical scorecard, training history and pipeline status for the stock models.
        Public view: <NuxtLink to="/stocks/predictions" class="text-accent hover:underline">News-spike watch</NuxtLink>.
      </p>
    </div>

    <!-- Tab Nav -->
    <div class="flex items-center gap-1 mb-6 border-b border-rule">
      <button
        v-for="tab in [
          { key: 'scorecard', label: 'Scorecard' },
          { key: 'timeline', label: 'Model Timeline' },
          { key: 'dashboard', label: 'Dashboard' },
        ]"
        :key="tab.key"
        class="px-4 py-2.5 text-sm font-mono font-medium transition-colors relative"
        :class="activeTab === tab.key ? 'text-ink' : 'text-ink-3 hover:text-ink'"
        @click="activeTab = tab.key as any"
      >
        {{ tab.label }}
        <div v-if="activeTab === tab.key" class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
      </button>
    </div>

    <!-- ====== SCORECARD TAB ====== -->
    <div v-if="activeTab === 'scorecard'">
      <div v-if="scorecardPending" class="py-12 text-center text-ink-3">Loading scorecard...</div>

      <template v-else-if="scorecard">
        <!-- Signals are published to build a track record; trading needs skill. -->
        <div
          v-if="tradeGate && !tradeGate.tradeable"
          class="mb-6 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4"
        >
          <div class="flex items-start gap-3">
            <Icon name="i-heroicons-hand-raised" class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div class="min-w-0">
              <div class="font-mono text-sm font-semibold text-amber-800 dark:text-amber-200">
                Not cleared to trade
              </div>
              <p class="text-sm text-amber-800/80 dark:text-amber-200/80 mt-1">
                Predictions are still published so the track record keeps building, but the paper
                portfolio will not open new positions: {{ tradeGate.reason }}.
                Existing positions continue to be managed.
              </p>
              <p class="text-xs font-mono text-amber-700/70 dark:text-amber-300/60 mt-2">
                {{ scorecard.contract?.criterion }}
              </p>
            </div>
          </div>
        </div>

        <!-- Summary Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Total Validated</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ scorecard.summary?.totalValidated || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Win Rate 4w</div>
            <div
              class="text-2xl font-mono font-bold"
              :class="beatsBaseline ? 'text-emerald-500' : 'text-rose-500'"
            >
              {{ scorecard.summary?.winRate4w != null ? (scorecard.summary.winRate4w * 100).toFixed(1) + '%' : '--' }}
            </div>
            <!-- A win rate without the number it must beat is what let a
                 below-baseline model look acceptable for four months. -->
            <div class="text-xs font-mono text-ink-4 mt-1">
              must beat {{ scorecard.summary?.winRateBaseline != null ? (scorecard.summary.winRateBaseline * 100).toFixed(1) + '%' : '--' }}
            </div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Avg Return (Bullish)</div>
            <div class="text-2xl font-mono font-bold" :class="(scorecard.summary?.avgReturnBullish ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
              {{ formatPct(scorecard.summary?.avgReturnBullish) }}
            </div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Avg Return (Bearish)</div>
            <div class="text-2xl font-mono font-bold text-ink">
              {{ formatPct(scorecard.summary?.avgReturnBearish) }}
            </div>
          </div>
        </div>

        <!-- What the win rate above does and does not establish. -->
        <div class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <div class="flex items-baseline justify-between mb-3">
            <h3 class="font-mono font-semibold text-sm text-ink">Signal Quality</h3>
            <span class="text-xs font-mono text-ink-4">graded on {{ scorecard.labelExpr }}</span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">ROC-AUC</div>
              <div class="text-lg font-mono font-bold" :class="aucColor">
                {{ scorecard.summary?.auc != null ? scorecard.summary.auc.toFixed(3) : '--' }}
              </div>
              <div class="text-xs font-mono text-ink-4 mt-0.5">
                <template v-if="scorecard.scorecards?.mlDeciding?.ci">
                  90% CI [{{ scorecard.scorecards.mlDeciding.ci.low.toFixed(3) }},
                  {{ scorecard.scorecards.mlDeciding.ci.high.toFixed(3) }}]
                </template>
                <template v-else>0.500 = chance</template>
              </div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Brier Skill</div>
              <div class="text-lg font-mono font-bold" :class="(scorecard.summary?.brierSkill ?? -1) > 0 ? 'text-emerald-500' : 'text-rose-500'">
                {{ scorecard.summary?.brierSkill != null ? scorecard.summary.brierSkill.toFixed(3) : '--' }}
              </div>
              <div class="text-xs font-mono text-ink-4 mt-0.5">&le;0 = worse than base rate</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Directional Calls</div>
              <div class="text-lg font-mono font-bold text-ink">
                {{ scorecard.summary?.nBullish ?? 0 }} / {{ scorecard.summary?.nBearish ?? 0 }}
              </div>
              <div class="text-xs font-mono text-ink-4 mt-0.5">bullish / bearish</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Effective n</div>
              <div class="text-lg font-mono font-bold text-ink">
                {{ scorecard.summary?.effectiveN?.nEff ?? '--' }}
              </div>
              <div class="text-xs font-mono text-ink-4 mt-0.5">
                of {{ scorecard.summary?.effectiveN?.nRaw ?? 0 }} rows &middot;
                {{ scorecard.summary?.effectiveN?.nEffMarket ?? 0 }} market windows
              </div>
            </div>
          </div>
          <p v-if="noSignal" class="text-xs text-ink-3 mt-4 pt-3 border-t border-rule/50">
            The confidence interval contains 0.500, so this track record does not yet
            distinguish the model from chance.
          </p>
        </div>

        <!-- Win Rate by Event Type -->
        <div v-if="scorecard.byEventType?.length" class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Win Rate by Event Type</h3>
          <div class="space-y-2">
            <div v-for="et in scorecard.byEventType" :key="et.eventType" class="flex items-center gap-3">
              <span class="text-xs font-mono text-ink w-44 truncate">{{ eventLabel(et.eventType) }}</span>
              <div class="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div
                  class="h-full rounded"
                  :class="(et.winRate ?? 0) >= 0.5 ? 'bg-emerald-400' : 'bg-rose-400'"
                  :style="{ width: ((et.winRate ?? 0) * 100) + '%' }"
                />
              </div>
              <span class="text-xs font-mono text-ink-3 w-14 text-right">
                {{ et.winRate != null ? (et.winRate * 100).toFixed(0) + '%' : '--' }}
              </span>
              <span class="text-xs font-mono text-ink-4 w-16 text-right" title="base rate over the same window">
                base {{ et.baseRate != null ? (et.baseRate * 100).toFixed(0) + '%' : '--' }}
              </span>
              <span class="text-xs font-mono text-ink-4 w-10 text-right">n={{ et.count }}</span>
            </div>
          </div>
        </div>

        <!-- Win Rate by Confidence -->
        <div v-if="scorecard.byConfidence?.length" class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Win Rate by Confidence Bucket</h3>
          <div class="space-y-2">
            <div v-for="cb in scorecard.byConfidence" :key="cb.bucket" class="flex items-center gap-3">
              <span class="text-xs font-mono text-ink w-32">{{ cb.bucket }}</span>
              <div class="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div
                  class="h-full rounded"
                  :class="(cb.winRate ?? 0) >= 0.5 ? 'bg-blue-400' : 'bg-amber-400'"
                  :style="{ width: ((cb.winRate ?? 0) * 100) + '%' }"
                />
              </div>
              <span class="text-xs font-mono text-ink-3 w-14 text-right">
                {{ cb.winRate != null ? (cb.winRate * 100).toFixed(0) + '%' : '--' }}
              </span>
              <span class="text-xs font-mono text-ink-4 w-16 text-right" title="base rate over the same window">
                base {{ cb.baseRate != null ? (cb.baseRate * 100).toFixed(0) + '%' : '--' }}
              </span>
              <span class="text-xs font-mono text-ink-4 w-10 text-right">n={{ cb.count }}</span>
            </div>
          </div>
        </div>

        <!-- Recent Validated Predictions Table -->
        <div v-if="scorecard.recent?.length" class="border border-rule rounded-lg bg-surface overflow-x-auto">
          <h3 class="font-mono font-semibold text-sm text-ink p-5 pb-0 mb-4">Recent Validated Predictions</h3>
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Ticker</th>
                <th class="text-left py-2.5 px-2">Direction</th>
                <th class="text-right py-2.5 px-2">Confidence</th>
                <th class="text-right py-2.5 px-2">Actual 4w</th>
                <th class="text-center py-2.5 px-2">Correct?</th>
                <th class="text-left py-2.5 px-2">Event</th>
                <th class="text-left py-2.5 px-4">Validated</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="pred in scorecard.recent"
                :key="pred.id"
                class="border-b border-rule/30 hover:bg-surface-1/50"
              >
                <td class="py-2 px-4 font-semibold">
                  <NuxtLink :to="`/stocks/${pred.ticker}`" class="text-accent hover:underline">{{ pred.ticker }}</NuxtLink>
                </td>
                <td class="py-2 px-2">
                  <span class="text-xs px-2 py-0.5 rounded-full" :class="directionBg(pred.signalDirection)">
                    {{ pred.signalDirection.toUpperCase() }}
                  </span>
                </td>
                <td class="py-2 px-2 text-right">{{ confidencePct(pred.mlConfidence) }}</td>
                <td class="py-2 px-2 text-right" :class="(pred.actualChange4w ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
                  {{ formatPct(pred.actualChange4w) }}
                </td>
                <td class="py-2 px-2 text-center text-lg">
                  <span v-if="pred.correct === true" class="text-emerald-500">&#10003;</span>
                  <span v-else-if="pred.correct === false" class="text-rose-500">&#10007;</span>
                  <span v-else class="text-ink-4">--</span>
                </td>
                <td class="py-2 px-2 text-xs text-ink-3">{{ eventLabel(pred.eventType) }}</td>
                <td class="py-2 px-4 text-xs text-ink-4">{{ formatDateShort(pred.validatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!scorecard.recent?.length && !scorecard.byEventType?.length" class="py-16 text-center">
          <p class="text-ink-3 mb-2">No validated ML predictions yet</p>
          <p class="text-sm text-ink-4">
            Predictions are validated after 4 weeks when actual price changes are measured.
          </p>
        </div>
      </template>
    </div>

    <!-- ====== MODEL TIMELINE TAB ====== -->
    <div v-if="activeTab === 'timeline'">
      <div v-if="historyPending" class="py-12 text-center text-ink-3">Loading training history...</div>

      <template v-else-if="history?.entries?.length">
        <!-- AUC Timeline Chart -->
        <div class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Model AUC Over Time</h3>

          <svg viewBox="0 0 800 260" class="w-full h-56" preserveAspectRatio="xMidYMid meet">
            <!-- Grid lines -->
            <line x1="20" y1="20" x2="20" y2="220" stroke="#e5e7eb" stroke-width="0.5" />
            <line x1="20" y1="220" x2="780" y2="220" stroke="#e5e7eb" stroke-width="0.5" />

            <!-- Y-axis labels (AUC 0.4 to 1.0) -->
            <text x="16" y="24" text-anchor="end" class="text-[10px] fill-current text-ink-4">1.0</text>
            <text x="16" y="90" text-anchor="end" class="text-[10px] fill-current text-ink-4">0.8</text>
            <text x="16" y="157" text-anchor="end" class="text-[10px] fill-current text-ink-4">0.6</text>
            <text x="16" y="224" text-anchor="end" class="text-[10px] fill-current text-ink-4">0.4</text>

            <!-- Horizontal grid lines -->
            <line x1="20" y1="87" x2="780" y2="87" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4" />
            <line x1="20" y1="153" x2="780" y2="153" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4" />

            <!-- Random baseline at AUC = 0.5 -->
            <line x1="20" y1="187" x2="780" y2="187" stroke="#ef4444" stroke-width="1" stroke-dasharray="6,3" />
            <text x="784" y="191" class="text-[9px] fill-current text-rose-400">0.5 (random)</text>

            <!-- Model lines -->
            <template v-for="(color, modelName) in modelColors" :key="modelName">
              <polyline
                v-if="getTimelinePoints(history.entries, modelName)"
                :points="getTimelinePoints(history.entries, modelName)"
                fill="none"
                :stroke="color"
                stroke-width="2"
              />
              <!-- Data points -->
              <template v-for="(entry, i) in history.entries.filter(e => e.models?.[modelName]?.roc_auc != null)" :key="i">
                <circle
                  :cx="history.entries.filter(e => e.models?.[modelName]?.roc_auc != null).length === 1
                    ? 400
                    : 20 + (i / (history.entries.filter(e => e.models?.[modelName]?.roc_auc != null).length - 1)) * 760"
                  :cy="20 + 200 - ((entry.models[modelName].roc_auc - 0.4) / 0.6) * 200"
                  r="3"
                  :fill="color"
                />
              </template>
            </template>
          </svg>

          <!-- Legend -->
          <div class="flex flex-wrap items-center gap-4 mt-3">
            <div v-for="(color, modelName) in modelColors" :key="modelName" class="flex items-center gap-2">
              <div class="w-4 h-0.5 rounded" :style="{ backgroundColor: color }" />
              <span class="text-xs font-mono text-ink-3">{{ modelLabels[modelName] || modelName }}</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-0.5 rounded border-t-2 border-dashed border-rose-400" />
              <span class="text-xs font-mono text-ink-4">Random baseline</span>
            </div>
          </div>
        </div>

        <!-- Sample Growth -->
        <div class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Training Sample Growth</h3>
          <svg viewBox="0 0 800 80" class="w-full h-16" preserveAspectRatio="xMidYMid meet">
            <rect
              v-for="(bar, i) in getSampleBarPoints(history.entries)"
              :key="i"
              :x="bar.x"
              :y="70 - bar.height"
              :width="Math.min(30, 760 / history.entries.length - 4)"
              :height="bar.height"
              class="fill-blue-400/60"
              rx="2"
            />
            <text
              v-for="(bar, i) in getSampleBarPoints(history.entries)"
              :key="'l' + i"
              :x="bar.x + Math.min(15, (760 / history.entries.length - 4) / 2)"
              :y="65 - bar.height"
              text-anchor="middle"
              class="text-[9px] fill-current text-ink-4"
            >
              {{ bar.label }}
            </text>
          </svg>
        </div>

        <!-- Training History Table -->
        <div class="border border-rule rounded-lg bg-surface overflow-x-auto">
          <h3 class="font-mono font-semibold text-sm text-ink p-5 pb-0 mb-4">Training History</h3>
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Date</th>
                <th class="text-right py-2.5 px-2">Samples</th>
                <th class="text-right py-2.5 px-2">Features</th>
                <th class="text-right py-2.5 px-2">Folds</th>
                <th class="text-right py-2.5 px-2">XGB AUC</th>
                <th class="text-right py-2.5 px-2">Alpha AUC</th>
                <th class="text-right py-2.5 px-2">LGBM AUC</th>
                <th class="text-right py-2.5 px-4">LogReg AUC</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(entry, i) in [...history.entries].reverse()"
                :key="i"
                class="border-b border-rule/30 hover:bg-surface-1/50"
              >
                <td class="py-2 px-4">{{ formatDate(entry.training_date) }}</td>
                <td class="py-2 px-2 text-right">{{ entry.total_samples }}</td>
                <td class="py-2 px-2 text-right">{{ entry.total_features }}</td>
                <td class="py-2 px-2 text-right">{{ entry.n_folds }}</td>
                <td class="py-2 px-2 text-right" :class="(entry.models?.xgb_4w_classifier?.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                  {{ entry.models?.xgb_4w_classifier?.roc_auc?.toFixed(3) ?? '--' }}
                </td>
                <td class="py-2 px-2 text-right" :class="(entry.models?.xgb_4w_alpha_classifier?.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                  {{ entry.models?.xgb_4w_alpha_classifier?.roc_auc?.toFixed(3) ?? '--' }}
                </td>
                <td class="py-2 px-2 text-right" :class="(entry.models?.lgbm_4w_classifier?.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                  {{ entry.models?.lgbm_4w_classifier?.roc_auc?.toFixed(3) ?? '--' }}
                </td>
                <td class="py-2 px-4 text-right" :class="(entry.models?.logreg_baseline?.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                  {{ entry.models?.logreg_baseline?.roc_auc?.toFixed(3) ?? '--' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div v-else class="py-16 text-center">
        <p class="text-ink-3 mb-2">No training history available</p>
        <p class="text-sm text-ink-4">
          Training history is recorded each time <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run ml:train</code> is run.
        </p>
      </div>
    </div>

    <!-- ====== DASHBOARD TAB ====== -->
    <div v-if="activeTab === 'dashboard'">
      <div v-if="dashboardPending" class="py-12 text-center text-ink-3">Loading dashboard...</div>

      <template v-else-if="dashboard">
        <!-- Pipeline Status Cards -->
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Total Anomalies</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.totalAnomalies?.toLocaleString() || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Validated Outcomes</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.validatedOutcomes || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Active ML Signals</div>
            <div class="text-2xl font-mono font-bold text-accent">{{ dashboard.pipeline?.activeMlSignals || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Mapped Tickers</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.mappedTickers || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Anomaly Coverage</div>
            <div class="text-2xl font-mono font-bold text-ink">
              {{ dashboard.pipeline?.tickersWithAnomalies || 0 }}
              <span class="text-sm text-ink-4 font-normal">/ {{ dashboard.pipeline?.mappedTickers || 0 }}</span>
            </div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Next Retrain</div>
            <div class="text-lg font-mono font-bold text-ink">{{ formatDate(dashboard.nextRetrainDate) }}</div>
          </div>
        </div>

        <!-- Data Coverage Progress -->
        <div class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Data Coverage</h3>
          <div class="space-y-4">
            <!-- Entity Mapping -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-mono text-ink-3">Entity Mapping</span>
                <span class="text-xs font-mono text-ink">
                  {{ dashboard.pipeline?.mappedTickers || 0 }} / {{ dashboard.pipeline?.totalTickers || 0 }}
                  ({{ dashboard.pipeline?.totalTickers ? ((dashboard.pipeline.mappedTickers / dashboard.pipeline.totalTickers) * 100).toFixed(0) : 0 }}%)
                </span>
              </div>
              <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-500 rounded-full transition-all"
                  :style="{ width: (dashboard.pipeline?.totalTickers ? (dashboard.pipeline.mappedTickers / dashboard.pipeline.totalTickers) * 100 : 0) + '%' }"
                />
              </div>
            </div>

            <!-- Anomaly Coverage -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-mono text-ink-3">Anomaly Coverage (mapped tickers with anomalies)</span>
                <span class="text-xs font-mono text-ink">
                  {{ dashboard.pipeline?.tickersWithAnomalies || 0 }} / {{ dashboard.pipeline?.mappedTickers || 0 }}
                  ({{ dashboard.pipeline?.mappedTickers ? ((dashboard.pipeline.tickersWithAnomalies / dashboard.pipeline.mappedTickers) * 100).toFixed(0) : 0 }}%)
                </span>
              </div>
              <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  class="h-full bg-emerald-500 rounded-full transition-all"
                  :style="{ width: (dashboard.pipeline?.mappedTickers ? (dashboard.pipeline.tickersWithAnomalies / dashboard.pipeline.mappedTickers) * 100 : 0) + '%' }"
                />
              </div>
            </div>

            <!-- Outcome Validation -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-mono text-ink-3">Outcome Validation (ML signals validated)</span>
                <span class="text-xs font-mono text-ink">
                  {{ dashboard.pipeline?.validatedOutcomes || 0 }} / {{ (dashboard.pipeline?.validatedMlSignals || 0) + (dashboard.pipeline?.activeMlSignals || 0) }}
                </span>
              </div>
              <div class="h-2 bg-surface-2 rounded-full overflow-hidden">
                <div
                  class="h-full bg-amber-500 rounded-full transition-all"
                  :style="{ width: (((dashboard.pipeline?.validatedMlSignals || 0) + (dashboard.pipeline?.activeMlSignals || 0)) > 0
                    ? (dashboard.pipeline.validatedOutcomes / ((dashboard.pipeline.validatedMlSignals || 0) + (dashboard.pipeline.activeMlSignals || 0))) * 100
                    : 0) + '%' }"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Current Model Performance -->
        <div v-if="dashboard.model" class="border border-rule rounded-lg p-5 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Current Model Performance</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Training Date</div>
              <div class="text-sm font-mono text-ink">{{ formatDate(dashboard.model.trainingDate) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Samples</div>
              <div class="text-sm font-mono text-ink">{{ dashboard.model.totalSamples?.toLocaleString() || '--' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Features</div>
              <div class="text-sm font-mono text-ink">{{ dashboard.model.totalFeatures || '--' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Walk-Forward Folds</div>
              <div class="text-sm font-mono text-ink">{{ dashboard.model.nFolds || '--' }}</div>
            </div>
          </div>

          <div v-if="dashboard.model.models" class="overflow-x-auto">
            <table class="w-full text-sm font-mono">
              <thead>
                <tr class="text-xs text-ink-4 border-b border-rule">
                  <th class="text-left py-2 pr-4">Model</th>
                  <th class="text-right py-2 pr-4">AUC</th>
                  <th class="text-right py-2 pr-4">Accuracy</th>
                  <th class="text-right py-2">F1</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(info, name) in dashboard.model.models" :key="name" class="border-b border-rule/30">
                  <td class="py-2 pr-4 font-semibold">{{ modelLabels[name as string] || name }}</td>
                  <td class="py-2 pr-4 text-right" :class="(info.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                    {{ info.roc_auc?.toFixed(3) ?? '--' }}
                  </td>
                  <td class="py-2 pr-4 text-right">
                    {{ info.accuracy != null ? (info.accuracy * 100).toFixed(1) + '%' : '--' }}
                  </td>
                  <td class="py-2 text-right">{{ info.f1?.toFixed(3) ?? '--' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-else class="border border-rule rounded-lg p-5 bg-surface">
          <p class="text-ink-3 text-center py-4">
            No ML model trained yet. Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run ml:train</code>.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
