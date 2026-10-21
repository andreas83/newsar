<script setup lang="ts">
const activeTab = ref<'active' | 'scorecard' | 'timeline' | 'dashboard'>('active')

const { data: activePredictions, pending: activePending } = await useFetch(
  '/api/bitcoin/predictions?action=active', { lazy: true }
)
const { data: scorecard, pending: scorecardPending } = await useFetch(
  '/api/bitcoin/predictions?action=scorecard', { lazy: true }
)
const { data: history, pending: historyPending } = await useFetch(
  '/api/bitcoin/predictions?action=history', { lazy: true }
)
const { data: dashboard, pending: dashboardPending } = await useFetch(
  '/api/bitcoin/predictions?action=dashboard', { lazy: true }
)

useSeoMeta({
  title: 'BTC Predictions - Newsar',
  description: 'Bitcoin ML predictions, model performance, and pipeline status.',
})

function formatPct(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}
function formatDate(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateShort(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

const modelColors: Record<string, string> = {
  btc_xgb_2w_classifier: '#3b82f6',
  btc_lgbm_2w_classifier: '#10b981',
  btc_logreg_baseline: '#f59e0b',
}
const modelLabels: Record<string, string> = {
  btc_xgb_2w_classifier: 'XGBoost 2w',
  btc_lgbm_2w_classifier: 'LightGBM 2w',
  btc_logreg_baseline: 'LogReg Baseline',
}

function getTimelinePoints(entries: any[], modelName: string): string {
  if (!entries?.length) return ''
  const valid = entries.filter(e => e.models?.[modelName]?.roc_auc != null)
  if (valid.length < 1) return ''
  const w = 760, h = 200, px = 20, py = 20
  return valid.map((entry, i) => {
    const x = valid.length === 1 ? w / 2 + px : px + (i / (valid.length - 1)) * w
    const auc = entry.models[modelName].roc_auc
    const y = py + h - ((auc - 0.4) / 0.6) * h
    return `${x},${y}`
  }).join(' ')
}
</script>

<template>
  <Container class="py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-bold font-serif text-ink mb-2">BTC Predictions</h1>
      <p class="text-ink-3">Machine learning predictions for Bitcoin price direction (2-week horizon).</p>
    </div>
    <BitcoinSubNav />

    <ArchivedBanner title="BTC model retired" retired-on="23 August 2026"
      reference="See BTC_MODEL_ASSESSMENT.md for the full analysis.">
      These predictions are no longer generated. Over 92 validated forecasts the model scored AUC 0.476 (95% CI 0.34–0.61) — indistinguishable from chance — and at one prediction per day on a 14-day horizon it would take roughly 20 years to accumulate enough independent observations to prove otherwise. The history below is kept as the record.
    </ArchivedBanner>

    <!-- Tab Nav -->
    <div class="flex items-center gap-1 mb-6 border-b border-rule">
      <button
        v-for="tab in [
          { key: 'active', label: 'Active' },
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
        <span v-if="tab.key === 'active' && activePredictions?.count"
          class="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono rounded-sm bg-accent/10 text-accent">
          {{ activePredictions.count }}
        </span>
        <div v-if="activeTab === tab.key" class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
      </button>
    </div>

    <!-- ACTIVE TAB -->
    <div v-if="activeTab === 'active'">
      <div v-if="activePending" class="py-12 text-center text-ink-3">Loading predictions...</div>
      <template v-else-if="activePredictions?.predictions?.length">
        <!-- Current Price -->
        <div v-if="activePredictions.currentPrice" class="mb-4 text-sm font-mono text-ink-3">
          Current BTC: <span class="text-ink font-semibold">${{ activePredictions.currentPrice.price?.toLocaleString('en-US', { maximumFractionDigits: 0 }) }}</span>
          <span class="ml-2" :class="(activePredictions.currentPrice.changePercent24h ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
            {{ formatPct(activePredictions.currentPrice.changePercent24h) }}
          </span>
        </div>

        <div class="overflow-x-auto border border-rule rounded-lg bg-surface">
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Date</th>
                <th class="text-left py-2.5 px-2">Direction</th>
                <th class="text-right py-2.5 px-2">P(Up 2w)</th>
                <th class="text-right py-2.5 px-2">Confidence</th>
                <th class="text-left py-2.5 px-2">Top Features</th>
                <th class="text-left py-2.5 px-4">Expires</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pred in activePredictions.predictions" :key="pred.id"
                class="border-b border-rule/30 hover:bg-surface-1/50">
                <td class="py-2 px-4">{{ formatDateShort(pred.predictionDate) }}</td>
                <td class="py-2 px-2">
                  <span class="text-xs px-2 py-0.5 rounded-full font-mono" :class="directionBg(pred.direction)">
                    {{ pred.direction.toUpperCase() }}
                  </span>
                </td>
                <td class="py-2 px-2 text-right" :class="(pred.probUp2w ?? 0) > 0.5 ? 'text-emerald-500' : 'text-rose-500'">
                  {{ pred.probUp2w != null ? (pred.probUp2w * 100).toFixed(1) + '%' : '--' }}
                </td>
                <td class="py-2 px-2 text-right">{{ confidencePct(pred.confidence) }}</td>
                <td class="py-2 px-2 text-xs text-ink-3">
                  <span v-if="pred.topFeatures?.length">
                    {{ pred.topFeatures.slice(0, 3).map((f: any) => f.feature).join(', ') }}
                  </span>
                  <span v-else>--</span>
                </td>
                <td class="py-2 px-4 text-xs text-ink-4">{{ formatDateShort(pred.expiresAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Upcoming Events -->
        <div v-if="activePredictions.upcomingEvents?.length" class="mt-4 border border-rule rounded-lg p-4 bg-surface">
          <h4 class="text-xs text-ink-4 font-mono mb-2">Upcoming Calendar Events</h4>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div v-for="evt in activePredictions.upcomingEvents" :key="evt.eventDate + evt.eventType"
              class="flex items-center gap-2 text-xs font-mono">
              <span class="px-1.5 py-0.5 rounded text-[10px]"
                :class="evt.expectedImpact === 'high' ? 'bg-rose-100 text-rose-700' : evt.expectedImpact === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'">
                {{ evt.expectedImpact }}
              </span>
              <span class="text-ink">{{ evt.name || evt.eventType }}</span>
              <span class="text-ink-4">{{ formatDateShort(evt.eventDate) }}</span>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="py-16 text-center">
        <p class="text-ink-3 mb-2">No active BTC predictions</p>
        <p class="text-sm text-ink-4">Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run btc:signals</code> to generate predictions.</p>
      </div>
    </div>

    <!-- SCORECARD TAB -->
    <div v-if="activeTab === 'scorecard'">
      <div v-if="scorecardPending" class="py-12 text-center text-ink-3">Loading scorecard...</div>
      <template v-else-if="scorecard">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Total Validated</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ scorecard.summary?.totalValidated || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Win Rate 2w</div>
            <div class="text-2xl font-mono font-bold" :class="(scorecard.summary?.winRate ?? 0) >= 0.5 ? 'text-emerald-500' : 'text-rose-500'">
              {{ scorecard.summary?.winRate != null ? (scorecard.summary.winRate * 100).toFixed(1) + '%' : '--' }}
            </div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Avg Return (Bull)</div>
            <div class="text-2xl font-mono font-bold" :class="(scorecard.summary?.avgReturnBullish ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
              {{ formatPct(scorecard.summary?.avgReturnBullish) }}
            </div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Avg Return (Bear)</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ formatPct(scorecard.summary?.avgReturnBearish) }}</div>
          </div>
        </div>

        <!-- By Confidence -->
        <div v-if="scorecard.byConfidence?.length" class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Win Rate by Confidence</h3>
          <div class="space-y-2">
            <div v-for="cb in scorecard.byConfidence" :key="cb.bucket" class="flex items-center gap-3">
              <span class="text-xs font-mono text-ink w-32">{{ cb.bucket }}</span>
              <div class="flex-1 h-4 bg-surface-2 rounded overflow-hidden">
                <div class="h-full rounded" :class="(cb.winRate ?? 0) >= 0.5 ? 'bg-blue-400' : 'bg-amber-400'"
                  :style="{ width: ((cb.winRate ?? 0) * 100) + '%' }" />
              </div>
              <span class="text-xs font-mono text-ink-3 w-14 text-right">
                {{ cb.winRate != null ? (cb.winRate * 100).toFixed(0) + '%' : '--' }}
              </span>
              <span class="text-xs font-mono text-ink-4 w-10 text-right">n={{ cb.count }}</span>
            </div>
          </div>
        </div>

        <!-- Recent Validated -->
        <div v-if="scorecard.recent?.length" class="border border-rule rounded-lg bg-surface overflow-x-auto">
          <h3 class="font-mono font-semibold text-sm text-ink p-5 pb-0 mb-4">Recent Validated</h3>
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Date</th>
                <th class="text-left py-2.5 px-2">Direction</th>
                <th class="text-right py-2.5 px-2">Confidence</th>
                <th class="text-right py-2.5 px-2">Actual 2w</th>
                <th class="text-center py-2.5 px-2">Correct?</th>
                <th class="text-left py-2.5 px-4">Validated</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pred in scorecard.recent" :key="pred.id" class="border-b border-rule/30 hover:bg-surface-1/50">
                <td class="py-2 px-4">{{ formatDateShort(pred.predictionDate) }}</td>
                <td class="py-2 px-2">
                  <span class="text-xs px-2 py-0.5 rounded-full" :class="directionBg(pred.direction)">{{ pred.direction.toUpperCase() }}</span>
                </td>
                <td class="py-2 px-2 text-right">{{ confidencePct(pred.confidence) }}</td>
                <td class="py-2 px-2 text-right" :class="(pred.actualChange2w ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'">
                  {{ formatPct(pred.actualChange2w) }}
                </td>
                <td class="py-2 px-2 text-center text-lg">
                  <span v-if="pred.correct === true" class="text-emerald-500">&#10003;</span>
                  <span v-else-if="pred.correct === false" class="text-rose-500">&#10007;</span>
                  <span v-else class="text-ink-4">--</span>
                </td>
                <td class="py-2 px-4 text-xs text-ink-4">{{ formatDateShort(pred.validatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!scorecard.recent?.length && !scorecard.byConfidence?.length" class="py-16 text-center">
          <p class="text-ink-3">No validated predictions yet (validated after 2 weeks).</p>
        </div>
      </template>
    </div>

    <!-- TIMELINE TAB -->
    <div v-if="activeTab === 'timeline'">
      <div v-if="historyPending" class="py-12 text-center text-ink-3">Loading...</div>
      <template v-else-if="history?.entries?.length">
        <div class="border border-rule rounded-lg p-5 bg-surface mb-6">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Model AUC Over Time</h3>
          <svg viewBox="0 0 800 260" class="w-full h-56" preserveAspectRatio="xMidYMid meet">
            <line x1="20" y1="20" x2="20" y2="220" stroke="#e5e7eb" stroke-width="0.5" />
            <line x1="20" y1="220" x2="780" y2="220" stroke="#e5e7eb" stroke-width="0.5" />
            <text x="16" y="24" text-anchor="end" class="text-[10px] fill-current text-ink-4">1.0</text>
            <text x="16" y="90" text-anchor="end" class="text-[10px] fill-current text-ink-4">0.8</text>
            <text x="16" y="157" text-anchor="end" class="text-[10px] fill-current text-ink-4">0.6</text>
            <text x="16" y="224" text-anchor="end" class="text-[10px] fill-current text-ink-4">0.4</text>
            <line x1="20" y1="87" x2="780" y2="87" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4" />
            <line x1="20" y1="153" x2="780" y2="153" stroke="#e5e7eb" stroke-width="0.5" stroke-dasharray="4" />
            <line x1="20" y1="187" x2="780" y2="187" stroke="#ef4444" stroke-width="1" stroke-dasharray="6,3" />

            <template v-for="(color, modelName) in modelColors" :key="modelName">
              <polyline v-if="getTimelinePoints(history.entries, modelName)"
                :points="getTimelinePoints(history.entries, modelName)"
                fill="none" :stroke="color" stroke-width="2" />
            </template>
          </svg>
          <div class="flex flex-wrap items-center gap-4 mt-3">
            <div v-for="(color, modelName) in modelColors" :key="modelName" class="flex items-center gap-2">
              <div class="w-4 h-0.5 rounded" :style="{ backgroundColor: color }" />
              <span class="text-xs font-mono text-ink-3">{{ modelLabels[modelName] || modelName }}</span>
            </div>
          </div>
        </div>

        <div class="border border-rule rounded-lg bg-surface overflow-x-auto">
          <h3 class="font-mono font-semibold text-sm text-ink p-5 pb-0 mb-4">Training History</h3>
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Date</th>
                <th class="text-right py-2.5 px-2">Samples</th>
                <th class="text-right py-2.5 px-2">Folds</th>
                <th class="text-right py-2.5 px-2">XGB AUC</th>
                <th class="text-right py-2.5 px-2">LGBM AUC</th>
                <th class="text-right py-2.5 px-4">LogReg AUC</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(entry, i) in [...history.entries].reverse()" :key="i" class="border-b border-rule/30">
                <td class="py-2 px-4">{{ formatDate(entry.training_date) }}</td>
                <td class="py-2 px-2 text-right">{{ entry.total_samples }}</td>
                <td class="py-2 px-2 text-right">{{ entry.n_folds }}</td>
                <td class="py-2 px-2 text-right" :class="(entry.models?.btc_xgb_2w_classifier?.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                  {{ entry.models?.btc_xgb_2w_classifier?.roc_auc?.toFixed(3) ?? '--' }}
                </td>
                <td class="py-2 px-2 text-right" :class="(entry.models?.btc_lgbm_2w_classifier?.roc_auc ?? 0) > 0.55 ? 'text-emerald-500 font-bold' : ''">
                  {{ entry.models?.btc_lgbm_2w_classifier?.roc_auc?.toFixed(3) ?? '--' }}
                </td>
                <td class="py-2 px-4 text-right">{{ entry.models?.btc_logreg_baseline?.roc_auc?.toFixed(3) ?? '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div v-else class="py-16 text-center">
        <p class="text-ink-3">No training history. Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run ml:btc-train</code>.</p>
      </div>
    </div>

    <!-- DASHBOARD TAB -->
    <div v-if="activeTab === 'dashboard'">
      <div v-if="dashboardPending" class="py-12 text-center text-ink-3">Loading...</div>
      <template v-else-if="dashboard">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Daily Features</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.totalFeatures || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Price Records</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.totalPrices?.toLocaleString() || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Active Predictions</div>
            <div class="text-2xl font-mono font-bold text-accent">{{ dashboard.pipeline?.activePredictions || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Calendar Events</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.totalCalendarEvents || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Validated Predictions</div>
            <div class="text-2xl font-mono font-bold text-ink">{{ dashboard.pipeline?.validatedPredictions || 0 }}</div>
          </div>
          <div class="border border-rule rounded-lg p-4 bg-surface">
            <div class="text-xs text-ink-4 font-mono mb-1">Next Retrain</div>
            <div class="text-lg font-mono font-bold text-ink">{{ formatDate(dashboard.nextRetrainDate) }}</div>
          </div>
        </div>

        <div v-if="dashboard.model" class="border border-rule rounded-lg p-5 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Current Model Performance</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Training Date</div>
              <div class="text-sm font-mono text-ink">{{ formatDate(dashboard.model.trainingDate) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Samples</div>
              <div class="text-sm font-mono text-ink">{{ dashboard.model.totalSamples || '--' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Features</div>
              <div class="text-sm font-mono text-ink">{{ dashboard.model.totalFeatures || '--' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono mb-1">Folds</div>
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
                  <td class="py-2 pr-4 text-right">{{ info.accuracy != null ? (info.accuracy * 100).toFixed(1) + '%' : '--' }}</td>
                  <td class="py-2 text-right">{{ info.f1?.toFixed(3) ?? '--' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="border border-rule rounded-lg p-5 bg-surface">
          <p class="text-ink-3 text-center py-4">No model trained. Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run ml:btc-train</code>.</p>
        </div>
      </template>
    </div>
  </Container>
</template>
