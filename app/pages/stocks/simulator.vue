<script setup lang="ts">
const activeTab = ref<'overview' | 'trades' | 'model'>('overview')
const selectedPortfolio = ref<number | null>(null)

const { data: comparison, pending: compPending } = await useFetch(
  '/api/stocks/paper-trading?action=comparison'
)

const { data: modelStatus } = await useFetch(
  '/api/stocks/ml-model?action=status',
  { lazy: true }
)

const { data: modelMetrics } = await useFetch(
  '/api/stocks/ml-model?action=metrics',
  { lazy: true }
)

const { data: modelFeatures } = await useFetch(
  '/api/stocks/ml-model?action=features',
  { lazy: true }
)

// Portfolio detail fetched when selected (client-only — depends on selectedPortfolio)
const { data: portfolioDetail, pending: detailPending, refresh: refreshDetail } = await useFetch(
  () => selectedPortfolio.value
    ? `/api/stocks/paper-trading?action=portfolio&id=${selectedPortfolio.value}`
    : null,
  { watch: [selectedPortfolio], lazy: true, server: false }
)

const { data: tradeHistory, pending: tradesPending } = await useFetch(
  () => selectedPortfolio.value
    ? `/api/stocks/paper-trading?action=trades&portfolio=${selectedPortfolio.value}`
    : null,
  { watch: [selectedPortfolio], lazy: true, server: false }
)

// Auto-select first portfolio
watch(() => comparison.value, (val: any) => {
  if (val?.portfolios?.length && !selectedPortfolio.value) {
    selectedPortfolio.value = val.portfolios[0].id
  }
}, { immediate: true })

useSeoMeta({
  title: 'Trading Simulator - Newsar',
  description: 'Paper trading simulator comparing ML predictions vs heuristic signals.',
})

function toNum(val: any): number | null {
  if (val == null) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

function formatMoney(val: any): string {
  const n = toNum(val)
  if (n == null) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatPct(val: any): string {
  const n = toNum(val)
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return sign + n.toFixed(2) + '%'
}

function pnlColor(val: any): string {
  const n = toNum(val)
  if (n == null) return 'text-ink-3'
  return n >= 0 ? 'text-emerald-500' : 'text-rose-500'
}
</script>

<template>
  <Container class="py-8">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-3xl font-bold font-serif text-ink mb-2">Trading Simulator</h1>
      <p class="text-ink-3">
        Paper trading comparison: ML model vs heuristic signals vs SPY benchmark.
      </p>
    </div>

    <!-- Tab Nav -->
    <div class="flex items-center gap-1 mb-6 border-b border-rule">
      <button
        v-for="tab in [
          { key: 'overview', label: 'Overview' },
          { key: 'trades', label: 'Trades' },
          { key: 'model', label: 'ML Model' },
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

    <!-- Loading -->
    <div v-if="compPending" class="py-16 text-center text-ink-3">
      Loading portfolio data...
    </div>

    <!-- No Data -->
    <div
      v-else-if="!comparison?.portfolios?.length"
      class="py-16 text-center"
    >
      <p class="text-ink-3 mb-4">No paper trading portfolios found.</p>
      <p class="text-sm text-ink-4">
        Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run paper:init</code> to create portfolios.
      </p>
    </div>

    <template v-else>
      <!-- OVERVIEW TAB -->
      <div v-if="activeTab === 'overview'">
        <!-- Strategy Comparison Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div
            v-for="p in comparison?.portfolios"
            :key="p.id"
            class="border border-rule rounded-lg p-5 cursor-pointer transition-all"
            :class="selectedPortfolio === p.id ? 'border-accent bg-surface-1' : 'bg-surface hover:border-accent/50'"
            @click="selectedPortfolio = p.id"
          >
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-mono font-semibold text-sm text-ink">{{ p.name }}</h3>
              <span class="text-xs px-2 py-0.5 rounded-full font-mono"
                :class="{
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300': p.strategy === 'ml_model',
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300': p.strategy === 'heuristic',
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': p.strategy === 'buy_and_hold',
                }"
              >
                {{ p.strategy === 'ml_model' ? 'ML' : p.strategy === 'heuristic' ? 'Heuristic' : 'Benchmark' }}
              </span>
            </div>

            <div class="text-2xl font-mono font-bold mb-1" :class="pnlColor(p.total_return_pct)">
              {{ formatPct(p.total_return_pct) }}
            </div>
            <div class="text-sm text-ink-3 font-mono">{{ formatMoney(p.current_value) }}</div>

            <div class="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-rule">
              <div>
                <div class="text-xs text-ink-4 font-mono">Trades</div>
                <div class="text-sm font-mono text-ink">{{ p.total_trades || 0 }}</div>
              </div>
              <div>
                <div class="text-xs text-ink-4 font-mono">Win Rate</div>
                <div class="text-sm font-mono text-ink">{{ p.win_rate_pct || 0 }}%</div>
              </div>
              <div>
                <div class="text-xs text-ink-4 font-mono">Max DD</div>
                <div class="text-sm font-mono text-rose-500">{{ (Number(p.max_drawdown) || 0).toFixed(1) }}%</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Equity Curve (SVG) -->
        <div v-if="comparison?.equityCurves" class="border border-rule rounded-lg p-5 mb-8 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Equity Curves</h3>

          <div v-if="Object.values(comparison.equityCurves).some((c: any) => c.length > 1)">
            <svg viewBox="0 0 800 300" class="w-full h-64" preserveAspectRatio="none">
              <template v-for="(portfolio, idx) in comparison.portfolios" :key="portfolio.id">
                <polyline
                  v-if="comparison.equityCurves[portfolio.id]?.length > 1"
                  :points="comparison.equityCurves[portfolio.id].map((s: any, i: number, arr: any[]) => {
                    const x = (i / (arr.length - 1)) * 780 + 10
                    const allValues = Object.values(comparison.equityCurves).flat().map((v: any) => Number(v.portfolio_value))
                    const minV = Math.min(...allValues)
                    const maxV = Math.max(...allValues)
                    const range = maxV - minV || 1
                    const y = 290 - ((Number(s.portfolio_value) - minV) / range) * 270
                    return `${x},${y}`
                  }).join(' ')"
                  fill="none"
                  :stroke="idx === 0 ? '#3b82f6' : idx === 1 ? '#f59e0b' : '#6b7280'"
                  stroke-width="2"
                />
              </template>
              <!-- Zero line -->
              <line x1="10" y1="150" x2="790" y2="150" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4" />
            </svg>

            <div class="flex items-center gap-6 mt-3">
              <div v-for="(p, idx) in comparison.portfolios" :key="p.id" class="flex items-center gap-2">
                <div
                  class="w-3 h-0.5 rounded"
                  :class="idx === 0 ? 'bg-blue-500' : idx === 1 ? 'bg-amber-500' : 'bg-gray-500'"
                />
                <span class="text-xs font-mono text-ink-3">{{ p.name }}</span>
              </div>
            </div>
          </div>
          <div v-else class="py-8 text-center text-ink-4 text-sm">
            No equity curve data yet. Run <code class="bg-surface-2 px-1 rounded text-xs">npm run paper:run</code> daily to accumulate data.
          </div>
        </div>

        <!-- Selected Portfolio Open Positions -->
        <div v-if="portfolioDetail && !detailPending" class="border border-rule rounded-lg p-5 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">
            Open Positions — {{ portfolioDetail.portfolio?.name }}
          </h3>

          <div v-if="portfolioDetail.openPositions?.length" class="overflow-x-auto">
            <table class="w-full text-sm font-mono">
              <thead>
                <tr class="text-xs text-ink-4 border-b border-rule">
                  <th class="text-left py-2 pr-4">Ticker</th>
                  <th class="text-left py-2 pr-4">Direction</th>
                  <th class="text-right py-2 pr-4">Entry</th>
                  <th class="text-right py-2 pr-4">Current</th>
                  <th class="text-right py-2 pr-4">Size</th>
                  <th class="text-right py-2 pr-4">P&L</th>
                  <th class="text-right py-2">P&L %</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="pos in portfolioDetail.openPositions" :key="pos.id" class="border-b border-rule/50">
                  <td class="py-2 pr-4 font-semibold">
                    <NuxtLink :to="`/stocks/${pos.ticker}`" class="text-accent hover:underline">
                      {{ pos.ticker }}
                    </NuxtLink>
                  </td>
                  <td class="py-2 pr-4">
                    <span :class="pos.direction === 'long' ? 'text-emerald-500' : 'text-rose-500'">
                      {{ pos.direction.toUpperCase() }}
                    </span>
                  </td>
                  <td class="py-2 pr-4 text-right">${{ Number(pos.entry_price).toFixed(2) }}</td>
                  <td class="py-2 pr-4 text-right">${{ Number(pos.current_price).toFixed(2) }}</td>
                  <td class="py-2 pr-4 text-right">{{ formatMoney(pos.position_size) }}</td>
                  <td class="py-2 pr-4 text-right" :class="pnlColor(pos.unrealized_pnl)">
                    {{ formatMoney(pos.unrealized_pnl) }}
                  </td>
                  <td class="py-2 text-right" :class="pnlColor(pos.unrealized_pnl_pct)">
                    {{ formatPct(pos.unrealized_pnl_pct) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="py-6 text-center text-ink-4 text-sm">
            No open positions.
          </div>
        </div>
      </div>

      <!-- TRADES TAB -->
      <div v-if="activeTab === 'trades'">
        <!-- Portfolio selector -->
        <div class="flex items-center gap-3 mb-6">
          <label class="text-sm font-mono text-ink-3">Portfolio:</label>
          <select
            v-model="selectedPortfolio"
            class="bg-surface border border-rule rounded px-3 py-1.5 text-sm font-mono text-ink"
          >
            <option v-for="p in comparison?.portfolios" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
        </div>

        <div v-if="tradesPending" class="py-8 text-center text-ink-3">Loading trades...</div>

        <div v-else-if="tradeHistory?.length" class="overflow-x-auto border border-rule rounded-lg bg-surface">
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Ticker</th>
                <th class="text-left py-2.5 px-2">Dir</th>
                <th class="text-right py-2.5 px-2">Entry</th>
                <th class="text-right py-2.5 px-2">Exit</th>
                <th class="text-right py-2.5 px-2">P&L</th>
                <th class="text-right py-2.5 px-2">P&L %</th>
                <th class="text-left py-2.5 px-2">Status</th>
                <th class="text-left py-2.5 px-4">Exit Reason</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tradeHistory" :key="t.id" class="border-b border-rule/30 hover:bg-surface-1/50">
                <td class="py-2 px-4 font-semibold">
                  <NuxtLink :to="`/stocks/${t.ticker}`" class="text-accent hover:underline">{{ t.ticker }}</NuxtLink>
                </td>
                <td class="py-2 px-2">
                  <span :class="t.direction === 'long' ? 'text-emerald-500' : 'text-rose-500'">
                    {{ t.direction === 'long' ? 'L' : 'S' }}
                  </span>
                </td>
                <td class="py-2 px-2 text-right">${{ Number(t.entry_price).toFixed(2) }}</td>
                <td class="py-2 px-2 text-right">{{ t.exit_price ? '$' + Number(t.exit_price).toFixed(2) : '—' }}</td>
                <td class="py-2 px-2 text-right" :class="pnlColor(t.pnl)">
                  {{ t.pnl != null ? formatMoney(t.pnl) : '—' }}
                </td>
                <td class="py-2 px-2 text-right" :class="pnlColor(t.pnl_percent)">
                  {{ t.pnl_percent != null ? formatPct(t.pnl_percent) : '—' }}
                </td>
                <td class="py-2 px-2">
                  <span
                    class="text-xs px-1.5 py-0.5 rounded"
                    :class="{
                      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300': t.status === 'open',
                      'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': t.status === 'closed',
                    }"
                  >
                    {{ t.status }}
                  </span>
                </td>
                <td class="py-2 px-4 text-ink-4 text-xs">{{ t.exit_reason || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="py-8 text-center text-ink-4 text-sm">
          No trades yet.
        </div>
      </div>

      <!-- ML MODEL TAB -->
      <div v-if="activeTab === 'model'">
        <!-- Model Status -->
        <div class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Model Status</h3>

          <div v-if="modelStatus?.hasModels" class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Trained</div>
              <div class="text-sm font-mono text-ink">
                {{ modelStatus.trainingDate ? new Date(modelStatus.trainingDate).toLocaleDateString() : '—' }}
              </div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Samples</div>
              <div class="text-sm font-mono text-ink">{{ modelStatus.totalSamples || '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Features</div>
              <div class="text-sm font-mono text-ink">{{ modelStatus.totalFeatures || '—' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Walk-Forward Folds</div>
              <div class="text-sm font-mono text-ink">{{ modelStatus.nFolds || '—' }}</div>
            </div>
          </div>

          <div v-else class="py-4 text-center text-ink-4 text-sm">
            No ML models trained. Run:
            <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs ml-1">npm run ml:features && npm run ml:train</code>
          </div>
        </div>

        <!-- Model Comparison -->
        <div v-if="modelMetrics?.models" class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Walk-Forward Performance</h3>

          <div class="overflow-x-auto">
            <table class="w-full text-sm font-mono">
              <thead>
                <tr class="text-xs text-ink-4 border-b border-rule">
                  <th class="text-left py-2 pr-4">Model</th>
                  <th class="text-right py-2 pr-4">AUC</th>
                  <th class="text-right py-2 pr-4">Accuracy</th>
                  <th class="text-right py-2 pr-4">Precision</th>
                  <th class="text-right py-2 pr-4">Recall</th>
                  <th class="text-right py-2">F1</th>
                </tr>
              </thead>
              <tbody>
                <!-- Random baseline -->
                <tr v-if="modelMetrics.randomBaseline" class="border-b border-rule/30 text-ink-4">
                  <td class="py-2 pr-4">Random (baseline)</td>
                  <td class="py-2 pr-4 text-right">0.500</td>
                  <td class="py-2 pr-4 text-right">{{ (modelMetrics.randomBaseline.accuracy_always_majority * 100).toFixed(1) }}%</td>
                  <td class="py-2 pr-4 text-right">—</td>
                  <td class="py-2 pr-4 text-right">—</td>
                  <td class="py-2 text-right">—</td>
                </tr>

                <!-- Heuristic -->
                <tr v-if="modelMetrics.heuristicBaseline?.['5d']?.accuracy != null" class="border-b border-rule/30">
                  <td class="py-2 pr-4">Heuristic (5d)</td>
                  <td class="py-2 pr-4 text-right">{{ modelMetrics.heuristicBaseline['5d'].roc_auc?.toFixed(3) || '—' }}</td>
                  <td class="py-2 pr-4 text-right">{{ (modelMetrics.heuristicBaseline['5d'].accuracy * 100).toFixed(1) }}%</td>
                  <td class="py-2 pr-4 text-right">—</td>
                  <td class="py-2 pr-4 text-right">—</td>
                  <td class="py-2 text-right">{{ modelMetrics.heuristicBaseline['5d'].f1?.toFixed(3) || '—' }}</td>
                </tr>

                <!-- ML Models -->
                <tr v-for="(info, name) in modelMetrics.models" :key="name" class="border-b border-rule/30">
                  <td class="py-2 pr-4 font-semibold">{{ name }}</td>
                  <td class="py-2 pr-4 text-right" :class="info.avgMetrics.roc_auc > 0.55 ? 'text-emerald-500 font-bold' : ''">
                    {{ info.avgMetrics.roc_auc?.toFixed(3) || '—' }}
                  </td>
                  <td class="py-2 pr-4 text-right">
                    {{ info.avgMetrics.accuracy ? (info.avgMetrics.accuracy * 100).toFixed(1) + '%' : info.avgMetrics.direction_accuracy ? (info.avgMetrics.direction_accuracy * 100).toFixed(1) + '%' : '—' }}
                  </td>
                  <td class="py-2 pr-4 text-right">{{ info.avgMetrics.precision ? (info.avgMetrics.precision * 100).toFixed(1) + '%' : '—' }}</td>
                  <td class="py-2 pr-4 text-right">{{ info.avgMetrics.recall ? (info.avgMetrics.recall * 100).toFixed(1) + '%' : '—' }}</td>
                  <td class="py-2 text-right">{{ info.avgMetrics.f1?.toFixed(3) || info.avgMetrics.rmse ? 'RMSE=' + info.avgMetrics.rmse?.toFixed(2) : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Feature Importance -->
        <div v-if="modelFeatures?.featureImportance" class="border border-rule rounded-lg p-5 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Feature Importance (Top 20)</h3>

          <div v-for="(features, modelName) in modelFeatures.featureImportance" :key="modelName" class="mb-6 last:mb-0">
            <h4 class="text-xs font-mono text-ink-3 mb-3">{{ modelName }}</h4>

            <div class="space-y-1.5">
              <div
                v-for="(feat, idx) in features.slice(0, 20)"
                :key="feat.feature"
                class="flex items-center gap-3"
              >
                <span class="text-xs font-mono text-ink-4 w-6 text-right">{{ idx + 1 }}.</span>
                <span class="text-xs font-mono text-ink w-48 truncate">{{ feat.feature }}</span>
                <div class="flex-1 h-3 bg-surface-2 rounded overflow-hidden">
                  <div
                    class="h-full rounded"
                    :class="idx < 3 ? 'bg-accent' : idx < 7 ? 'bg-blue-400' : 'bg-blue-300'"
                    :style="{ width: (feat.importance / features[0].importance * 100) + '%' }"
                  />
                </div>
                <span class="text-xs font-mono text-ink-4 w-16 text-right">{{ feat.importance.toFixed(4) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </Container>
</template>
