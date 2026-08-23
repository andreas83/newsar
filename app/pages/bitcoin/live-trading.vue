<script setup lang="ts">
const { data: status, pending: statusPending, refresh: refreshStatus } = await useFetch(
  '/api/bitcoin/live-trading?action=status', { lazy: true }
)

const { data: trades, pending: tradesPending } = await useFetch(
  '/api/bitcoin/live-trading?action=trades', { lazy: true }
)

const { data: equityCurve } = await useFetch(
  '/api/bitcoin/live-trading?action=equity', { lazy: true }
)

const showAudit = ref(false)
const { data: auditLog, pending: auditPending } = await useFetch(
  () => showAudit.value ? '/api/bitcoin/live-trading?action=audit&limit=50' : null,
  { watch: [showAudit], lazy: true, server: false }
)

const confirmEmergency = ref(false)
const actionPending = ref(false)

async function emergencyClose() {
  actionPending.value = true
  try {
    await $fetch('/api/bitcoin/live-trading', { method: 'POST', body: { action: 'emergency_close' } })
    await refreshStatus()
    confirmEmergency.value = false
  } finally {
    actionPending.value = false
  }
}

async function toggleKillSwitch(active: boolean) {
  actionPending.value = true
  try {
    await $fetch('/api/bitcoin/live-trading', {
      method: 'POST',
      body: { action: 'toggle_kill_switch', active, reason: active ? 'Manual resume' : 'Manual halt' },
    })
    await refreshStatus()
  } finally {
    actionPending.value = false
  }
}

useSeoMeta({
  title: 'BTC Live Trading - Newsar',
  description: 'Live Bitcoin trading via Binance, powered by ML predictions.',
})

function formatMoney(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function formatBtc(val: any): string {
  const n = Number(val)
  if (val == null || isNaN(n)) return '--'
  return n.toFixed(6)
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
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function formatDateOnly(val: any): string {
  if (!val) return '--'
  return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <Container class="py-8">
    <div class="mb-6">
      <div class="flex items-center gap-3 mb-2">
        <h1 class="text-3xl font-bold font-serif text-ink">BTC Live Trading</h1>
        <span
          v-if="status?.environment"
          class="px-3 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider"
          :class="status.environment === 'live'
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 animate-pulse'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'"
        >
          {{ status.environment }}
        </span>
      </div>
      <p class="text-ink-3">Real Binance orders driven by ML predictions. {{ status?.environment === 'live' ? 'Using real funds.' : 'Testnet mode — fake money.' }}</p>
    </div>
    <BitcoinSubNav />

    <!-- Loading -->
    <div v-if="statusPending" class="py-16 text-center text-ink-3">Loading...</div>

    <!-- No portfolio -->
    <div v-else-if="!status?.portfolio" class="py-16 text-center">
      <p class="text-ink-3 mb-4">No live trading portfolio found.</p>
      <p class="text-sm text-ink-4">Run <code class="bg-surface-2 px-1.5 py-0.5 rounded text-xs">npm run btc:live-run</code> to create one.</p>
    </div>

    <template v-else>
      <!-- Portfolio + Safety Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <!-- Portfolio Card -->
        <div class="border border-rule rounded-lg p-5 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Portfolio</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-xs text-ink-4 font-mono">Value</div>
              <div class="text-xl font-mono font-bold text-ink">{{ formatMoney(status.portfolio.currentValue) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Total Return</div>
              <div class="text-xl font-mono font-bold" :class="pnlColor(status.portfolio.totalReturn)">
                {{ formatPct(status.portfolio.totalReturn) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Total P&L</div>
              <div class="text-sm font-mono" :class="pnlColor(status.portfolio.totalPnl)">{{ formatMoney(status.portfolio.totalPnl) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Total Fees</div>
              <div class="text-sm font-mono text-ink-3">{{ formatMoney(status.portfolio.totalFees) }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Trades</div>
              <div class="text-sm font-mono text-ink">{{ status.portfolio.totalTrades }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Win Rate</div>
              <div class="text-sm font-mono text-ink">{{ status.portfolio.winRate?.toFixed(0) || 0 }}%</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Max Drawdown</div>
              <div class="text-sm font-mono text-rose-500">{{ status.portfolio.maxDrawdown?.toFixed(1) || 0 }}%</div>
            </div>
            <div>
              <div class="text-xs text-ink-4 font-mono">Available Capital</div>
              <div class="text-sm font-mono text-ink">{{ formatMoney(status.portfolio.currentCapital) }}</div>
            </div>
          </div>
        </div>

        <!-- Safety Panel -->
        <div class="border border-rule rounded-lg p-5 bg-surface">
          <h3 class="font-mono font-semibold text-sm text-ink mb-4">Safety Controls</h3>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-mono text-ink-3">Kill Switch</span>
              <button
                class="px-3 py-1.5 text-xs font-mono font-semibold rounded transition-colors"
                :class="status.safety.isActive
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300'"
                :disabled="actionPending"
                @click="toggleKillSwitch(!status.safety.isActive)"
              >
                {{ status.safety.isActive ? 'ACTIVE' : 'HALTED' }}
              </button>
            </div>
            <div v-if="status.safety.haltReason" class="text-xs font-mono text-rose-500 bg-rose-50 dark:bg-rose-900/20 p-2 rounded">
              Halt reason: {{ status.safety.haltReason }}
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-mono text-ink-3">Daily Loss Remaining</span>
              <span class="text-sm font-mono" :class="status.safety.dailyLossRemaining > 100 ? 'text-ink' : 'text-rose-500'">
                {{ formatMoney(status.safety.dailyLossRemaining) }}
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-mono text-ink-3">Max Position</span>
              <span class="text-sm font-mono text-ink">{{ formatMoney(status.safety.maxPositionUsd) }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-mono text-ink-3">API Key</span>
              <span class="text-xs font-mono" :class="status.safety.hasApiKey ? 'text-emerald-500' : 'text-rose-500'">
                {{ status.safety.hasApiKey ? 'Configured' : 'Missing' }}
              </span>
            </div>
            <div v-if="status.exchangeBalance" class="flex items-center justify-between">
              <span class="text-sm font-mono text-ink-3">Exchange USDT</span>
              <span class="text-sm font-mono text-ink">{{ formatMoney(status.exchangeBalance.usdt) }}</span>
            </div>

            <!-- Emergency Close -->
            <div class="pt-3 border-t border-rule">
              <div v-if="!confirmEmergency">
                <button
                  class="w-full px-3 py-2 text-xs font-mono font-semibold rounded bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 transition-colors"
                  :disabled="actionPending || !status.openPositions?.length"
                  @click="confirmEmergency = true"
                >
                  Close All Positions
                </button>
              </div>
              <div v-else class="space-y-2">
                <p class="text-xs text-rose-600 font-mono">Confirm: close all open positions via market orders?</p>
                <div class="flex gap-2">
                  <button
                    class="flex-1 px-3 py-2 text-xs font-mono font-bold rounded bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                    :disabled="actionPending"
                    @click="emergencyClose"
                  >
                    {{ actionPending ? 'Closing...' : 'CONFIRM CLOSE ALL' }}
                  </button>
                  <button
                    class="px-3 py-2 text-xs font-mono rounded border border-rule text-ink-3 hover:bg-surface-1 transition-colors"
                    @click="confirmEmergency = false"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Open Position Card -->
      <div v-if="status.openPositions?.length" class="border border-rule rounded-lg p-5 bg-surface mb-6">
        <h3 class="font-mono font-semibold text-sm text-ink mb-4">Open Position</h3>
        <div v-for="pos in status.openPositions" :key="pos.id" class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div class="text-xs text-ink-4 font-mono">Direction</div>
            <div class="text-sm font-mono font-semibold text-emerald-500">LONG</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Entry Price</div>
            <div class="text-sm font-mono text-ink">{{ formatMoney(pos.entry_price) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Current Price</div>
            <div class="text-sm font-mono text-ink">{{ formatMoney(pos.currentPrice) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Unrealized P&L</div>
            <div class="text-sm font-mono font-semibold" :class="pnlColor(pos.unrealizedPnl)">
              {{ formatMoney(pos.unrealizedPnl) }} ({{ formatPct(pos.unrealizedPnlPct) }})
            </div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">BTC Amount</div>
            <div class="text-sm font-mono text-ink">{{ formatBtc(pos.btc_amount) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Position Size</div>
            <div class="text-sm font-mono text-ink">{{ formatMoney(pos.position_size) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Stop Loss</div>
            <div class="text-sm font-mono text-rose-500">{{ formatMoney(pos.stop_loss) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Take Profit</div>
            <div class="text-sm font-mono text-emerald-500">{{ formatMoney(pos.take_profit) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Order ID</div>
            <div class="text-xs font-mono text-ink-4 truncate">{{ pos.entry_order_id || '--' }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Entry Fee</div>
            <div class="text-sm font-mono text-ink-3">{{ formatMoney(pos.entry_fee) }}</div>
          </div>
          <div>
            <div class="text-xs text-ink-4 font-mono">Opened</div>
            <div class="text-sm font-mono text-ink-3">{{ formatDateShort(pos.entry_date) }}</div>
          </div>
        </div>
      </div>

      <!-- Equity Curve -->
      <div v-if="equityCurve?.length" class="border border-rule rounded-lg p-5 mb-6 bg-surface">
        <h3 class="font-mono font-semibold text-sm text-ink mb-4">Equity Curve</h3>
        <div v-if="equityCurve.length > 1">
          <svg viewBox="0 0 800 250" class="w-full h-56" preserveAspectRatio="none">
            <polyline
              :points="(equityCurve as any[]).map((s: any, i: number, arr: any[]) => {
                const x = (i / (arr.length - 1)) * 780 + 10
                const vals = arr.map((v: any) => Number(v.portfolio_value))
                const minV = Math.min(...vals)
                const maxV = Math.max(...vals)
                const range = maxV - minV || 1
                const y = 240 - ((Number(s.portfolio_value) - minV) / range) * 220
                return `${x},${y}`
              }).join(' ')"
              fill="none"
              stroke="#3b82f6"
              stroke-width="2"
            />
          </svg>
        </div>
        <div v-else class="py-8 text-center text-ink-4 text-sm">
          Run <code class="bg-surface-2 px-1 rounded text-xs">npm run btc:live-run</code> daily to accumulate data.
        </div>
      </div>

      <!-- Trade History -->
      <div class="border border-rule rounded-lg bg-surface mb-6">
        <div class="p-5 pb-0">
          <h3 class="font-mono font-semibold text-sm text-ink">Trade History</h3>
        </div>

        <div v-if="tradesPending" class="p-5 text-center text-ink-3">Loading...</div>
        <div v-else-if="(trades as any[])?.length" class="overflow-x-auto mt-4">
          <table class="w-full text-sm font-mono">
            <thead>
              <tr class="text-xs text-ink-4 border-b border-rule bg-surface-1">
                <th class="text-left py-2.5 px-4">Dir</th>
                <th class="text-right py-2.5 px-2">Entry</th>
                <th class="text-right py-2.5 px-2">Exit</th>
                <th class="text-right py-2.5 px-2">BTC</th>
                <th class="text-right py-2.5 px-2">P&L</th>
                <th class="text-right py-2.5 px-2">Fees</th>
                <th class="text-left py-2.5 px-2">Status</th>
                <th class="text-left py-2.5 px-2">Reason</th>
                <th class="text-left py-2.5 px-4">Order ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in (trades as any[])" :key="t.id" class="border-b border-rule/30 hover:bg-surface-1/50">
                <td class="py-2 px-4">
                  <span class="text-emerald-500">LONG</span>
                </td>
                <td class="py-2 px-2 text-right">{{ formatMoney(t.entry_price) }}</td>
                <td class="py-2 px-2 text-right">{{ t.exit_price ? formatMoney(t.exit_price) : '--' }}</td>
                <td class="py-2 px-2 text-right">{{ formatBtc(t.btc_amount) }}</td>
                <td class="py-2 px-2 text-right" :class="pnlColor(t.pnl)">{{ t.pnl != null ? formatMoney(t.pnl) : '--' }}</td>
                <td class="py-2 px-2 text-right text-ink-4">
                  {{ Number(t.entry_fee || 0) + Number(t.exit_fee || 0) > 0 ? formatMoney(Number(t.entry_fee || 0) + Number(t.exit_fee || 0)) : '--' }}
                </td>
                <td class="py-2 px-2">
                  <span class="text-xs px-1.5 py-0.5 rounded"
                    :class="t.status === 'open' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'">
                    {{ t.status }}
                  </span>
                </td>
                <td class="py-2 px-2 text-ink-4 text-xs">{{ t.exit_reason || '--' }}</td>
                <td class="py-2 px-4 text-ink-4 text-xs truncate max-w-32">{{ t.entry_order_id || '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="p-5 text-center text-ink-4 text-sm">No trades yet.</div>
      </div>

      <!-- Audit Log -->
      <div class="border border-rule rounded-lg bg-surface">
        <button
          class="w-full p-5 text-left flex items-center justify-between"
          @click="showAudit = !showAudit"
        >
          <h3 class="font-mono font-semibold text-sm text-ink">Audit Log</h3>
          <span class="text-xs font-mono text-ink-4">{{ showAudit ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="showAudit" class="border-t border-rule">
          <div v-if="auditPending" class="p-5 text-center text-ink-3">Loading...</div>
          <div v-else-if="(auditLog as any[])?.length" class="max-h-96 overflow-y-auto">
            <div
              v-for="log in (auditLog as any[])"
              :key="log.id"
              class="px-5 py-2.5 border-b border-rule/30 text-xs font-mono"
            >
              <div class="flex items-center gap-3">
                <span class="text-ink-4 whitespace-nowrap">{{ formatDateShort(log.created_at) }}</span>
                <span class="px-1.5 py-0.5 rounded text-xs"
                  :class="{
                    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300': log.action.includes('open') || log.action === 'run_completed',
                    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300': log.action.includes('halt') || log.action.includes('failed') || log.action === 'emergency_close_all',
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300': log.action.includes('close') && !log.action.includes('emergency'),
                    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': !log.action.includes('open') && !log.action.includes('halt') && !log.action.includes('failed') && !log.action.includes('close'),
                  }"
                >
                  {{ log.action }}
                </span>
                <span v-if="log.trade_id" class="text-ink-4">#{{ log.trade_id }}</span>
              </div>
              <div v-if="log.details" class="mt-1 text-ink-4 truncate">
                {{ typeof log.details === 'string' ? log.details : JSON.stringify(log.details) }}
              </div>
            </div>
          </div>
          <div v-else class="p-5 text-center text-ink-4 text-sm">No audit log entries.</div>
        </div>
      </div>
    </template>
  </Container>
</template>
