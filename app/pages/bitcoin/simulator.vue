<script setup lang="ts">
const selectedPortfolio = ref<number | null>(null)

const { data: leaderboard, pending: leaderboardPending } = await useFetch(
  '/api/bitcoin/simulator?action=leaderboard', { lazy: true }
)

const { data: tradeHistory, pending: tradesPending } = await useFetch(
  () => selectedPortfolio.value ? `/api/bitcoin/simulator?action=trades&portfolio=${selectedPortfolio.value}` : null,
  { watch: [selectedPortfolio], lazy: true, server: false }
)

watch(() => leaderboard.value, (val: any) => {
  if (val?.portfolios?.length && !selectedPortfolio.value) {
    selectedPortfolio.value = val.portfolios[0].id
  }
}, { immediate: true })

useSeoMeta({
  title: 'BTC Simulator - Newsar',
  description: 'Bitcoin trading simulator: ML Model vs Random vs Buy & Hold.',
})

function formatMoney(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function formatPct(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}
function pnlColor(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return 'text-ink-3'
  return n >= 0 ? 'text-emerald-500' : 'text-rose-500'
}
function formatDateShort(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function strategyBg(strategy: string): string {
  if (strategy === 'ml_model') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  if (strategy === 'random') return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
}

function strategyLabel(s: string): string {
  if (s === 'ml_model') return 'ML Model'
  if (s === 'random') return 'Random'
  return 'Buy & Hold'
}

function rankBadge(rank: number): string {
  if (rank === 1) return 'text-amber-500'
  if (rank === 2) return 'text-gray-400'
  if (rank === 3) return 'text-amber-700'
  return 'text-ink-4'
}
</script>

<template>
  <Container class="py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-bold font-serif text-ink mb-2">BTC Simulator</h1>
      <p class="text-ink-3">Leaderboard: ML Model vs Random vs Buy & Hold strategies.</p>
    </div>
    <BitcoinSubNav />

    <div v-if="leaderboardPending" class="py-16 text-center text-ink-3">Loading...</div>

    <div v-else-if="!leaderboard?.portfolios?.length" class="py-16 text-center">
      <p class="text-ink-3 mb-4">No simulator portfolios found.</p>
      <p class="text-sm text-ink-4">Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run btc:sim-init</code></p>
    </div>

    <template v-else>
      <!-- Leaderboard Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div
          v-for="p in leaderboard.portfolios"
          :key="p.id"
          class="border border-rule rounded-lg p-5 cursor-pointer transition-all"
          :class="selectedPortfolio === p.id ? 'border-accent bg-surface-1' : 'bg-surface hover:border-accent/50'"
          @click="selectedPortfolio = p.id"
        >
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <span class="text-lg font-mono font-bold" :class="rankBadge(p.rank)">
                #{{ p.rank }}
              </span>
              <h3 class="font-mono font-semibold text-sm text-ink">{{ p.name }}</h3>
            </div>
            <span class="text-xs px-2 py-0.5 rounded-full font-mono" :class="strategyBg(p.strategy)">
              {{ strategyLabel(p.strategy) }}
            </span>
          </div>

          <div class="text-2xl font-mono font-bold mb-1" :class="pnlColor(p.totalReturn)">
            {{ formatPct(p.totalReturn) }}
          </div>
          <div class="text-sm text-ink-3 font-mono">{{ formatMoney(p.currentValue) }}</div>

          <div class="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-rule">
            <div>
              <div class="text-xs text-ink-4 font-mono">Trades</div>
              <div class="text-sm font-mono text-ink">{{ p.totalTrades || 0 }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Win Rate</div>
              <div class="text-sm font-mono text-ink">{{ p.winRate?.toFixed(0) || 0 }}%</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Max DD</div>
              <div class="text-sm font-mono text-rose-500">{{ p.maxDrawdown?.toFixed(1) || 0 }}%</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Equity Curve -->
      <div v-if="leaderboard.equityCurves" class="border border-rule rounded-lg p-5 mb-8 bg-surface">
        <h3 class="font-mono font-semibold text-sm text-ink mb-4">Equity Curves</h3>
        <div v-if="Object.values(leaderboard.equityCurves).some((c: any) => c.length > 1)">
          <svg viewBox="0 0 800 300" class="w-full h-64" preserveAspectRatio="none">
            <template v-for="(portfolio, idx) in leaderboard.portfolios" :key="portfolio.id">
              <polyline
                v-if="leaderboard.equityCurves[portfolio.id]?.length > 1"
                :points="leaderboard.equityCurves[portfolio.id].map((s: any, i: number, arr: any[]) => {
                  const x = (i / (arr.length - 1)) * 780 + 10
                  const allVals = Object.values(leaderboard.equityCurves).flat().map((v: any) => Number(v.portfolio_value))
                  const minV = Math.min(...allVals)
                  const maxV = Math.max(...allVals)
                  const range = maxV - minV || 1
                  const y = 290 - ((Number(s.portfolio_value) - minV) / range) * 270
                  return `${x},${y}`
                }).join(' ')"
                fill="none"
                :stroke="idx === 0 ? '#3b82f6' : idx === 1 ? '#a855f7' : '#6b7280'"
                stroke-width="2"
              />
            </template>
          </svg>
          <div class="flex items-center gap-6 mt-3">
            <div v-for="(p, idx) in leaderboard.portfolios" :key="p.id" class="flex items-center gap-2">
              <div class="w-3 h-0.5 rounded"
                :class="idx === 0 ? 'bg-blue-500' : idx === 1 ? 'bg-purple-500' : 'bg-gray-500'" />
              <span class="text-xs font-mono text-ink-3">{{ p.name }}</span>
            </div>
          </div>
        </div>
        <div v-else class="py-8 text-center text-ink-4 text-sm">
          Run <code class="bg-surface-2 px-1 rounded text-xs">npm run btc:sim-run</code> daily to accumulate data.
        </div>
      </div>

      <!-- Trade History -->
      <div class="border border-rule rounded-lg bg-surface">
        <div class="flex items-center justify-between p-5 pb-0">
          <h3 class="font-mono font-semibold text-sm text-ink">Trade History</h3>
          <select v-model="selectedPortfolio"
            class="bg-surface border border-rule rounded px-3 py-1.5 text-sm font-mono text-ink">
            <option v-for="p in leaderboard.portfolios" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <div v-if="tradesPending" class="p-5 text-center text-ink-3">Loading...</div>
        <div v-else-if="tradeHistory?.length" class="overflow-x-auto mt-4">
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Dir</th>
                <th class="text-right py-2.5 px-2">Entry</th>
                <th class="text-right py-2.5 px-2">Exit</th>
                <th class="text-right py-2.5 px-2">BTC</th>
                <th class="text-right py-2.5 px-2">P&L</th>
                <th class="text-right py-2.5 px-2">P&L %</th>
                <th class="text-left py-2.5 px-2">Status</th>
                <th class="text-left py-2.5 px-4">Reason</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tradeHistory" :key="t.id" class="border-b border-rule/30 hover:bg-surface-1/50">
                <td class="py-2 px-4">
                  <span :class="t.direction === 'long' ? 'text-emerald-500' : 'text-rose-500'">
                    {{ t.direction === 'long' ? 'LONG' : 'SHORT' }}
                  </span>
                </td>
                <td class="py-2 px-2 text-right">${{ Number(t.entry_price).toLocaleString('en-US', { maximumFractionDigits: 0 }) }}</td>
                <td class="py-2 px-2 text-right">{{ t.exit_price ? '$' + Number(t.exit_price).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--' }}</td>
                <td class="py-2 px-2 text-right">{{ Number(t.btc_amount).toFixed(4) }}</td>
                <td class="py-2 px-2 text-right" :class="pnlColor(t.pnl)">{{ t.pnl != null ? formatMoney(t.pnl) : '--' }}</td>
                <td class="py-2 px-2 text-right" :class="pnlColor(t.pnl_percent)">{{ t.pnl_percent != null ? formatPct(t.pnl_percent) : '--' }}</td>
                <td class="py-2 px-2">
                  <span class="text-xs px-1.5 py-0.5 rounded"
                    :class="t.status === 'open' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'">
                    {{ t.status }}
                  </span>
                </td>
                <td class="py-2 px-4 text-ink-4 text-xs">{{ t.exit_reason || '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="p-5 text-center text-ink-4 text-sm">No trades yet.</div>
      </div>

      <!-- Strategy Descriptions -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <div class="border border-rule rounded-lg p-4 bg-surface">
          <h4 class="font-mono font-semibold text-sm text-ink mb-2">ML Model</h4>
          <p class="text-xs text-ink-3 leading-relaxed">
            Trades based on XGBoost + LightGBM ensemble predictions. Opens position when direction is not neutral and confidence exceeds threshold. Risk 10% per trade, 5% stop-loss, 15% take-profit.
          </p>
        </div>
        <div class="border border-rule rounded-lg p-4 bg-surface">
          <h4 class="font-mono font-semibold text-sm text-ink mb-2">Random</h4>
          <p class="text-xs text-ink-3 leading-relaxed">
            Seeded PRNG determines daily action: 20% buy, 20% sell, 60% hold. Same risk rules as ML. Serves as a statistical baseline — if ML can't beat random, the model has no edge.
          </p>
        </div>
        <div class="border border-rule rounded-lg p-4 bg-surface">
          <h4 class="font-mono font-semibold text-sm text-ink mb-2">Buy & Hold</h4>
          <p class="text-xs text-ink-3 leading-relaxed">
            Single long position on day 1 with 95% of capital. No stop-loss, no trading. The benchmark every active strategy must beat to justify its complexity.
          </p>
        </div>
      </div>
    </template>
  </Container>
</template>
