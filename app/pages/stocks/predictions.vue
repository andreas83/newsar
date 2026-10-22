<script setup lang="ts">
/**
 * News-spike watch — the one public page for the stock prediction work.
 *
 * Every number is phrased as one question: "did the stock beat the market
 * (SPY) over the next 4 weeks?" Model guesses are shown next to the odds of
 * any stock doing so and labelled unproven, because the live record shows no
 * skill. Model diagnostics (AUC, Brier, training history) live at /admin/ml-models.
 */
const activeTab = ref<'now' | 'record'>('now')
const hideThin = ref(false)

const { data: now, pending: nowPending } = await useFetch('/api/stocks/watch?action=now', { lazy: true })
const { data: record, pending: recordPending } = await useFetch('/api/stocks/watch?action=record', { lazy: true })

useSeoMeta({
  title: 'News-spike watch - Newsar',
  description: 'Stocks that suddenly got unusual news attention, what happened next, and an honest track record of our models.',
})

/** One card per ticker: its latest spike, plus how many it had in the window. */
const cards = computed(() => {
  const byTicker = new Map<string, any>()
  for (const s of (now.value?.spikes ?? []) as any[]) {
    const existing = byTicker.get(s.ticker)
    if (existing) existing.spikeCount++
    else byTicker.set(s.ticker, { ...s, spikeCount: 1 })
  }
  return [...byTicker.values()]
})

const isThin = (c: any) => c.flags.includes('Based on a single article')
const visibleCards = computed(() => (hideThin.value ? cards.value.filter(c => !isThin(c)) : cards.value))
const thinCount = computed(() => cards.value.filter(isThin).length)

function pct(val: number | null | undefined, digits = 1): string {
  if (val == null || !Number.isFinite(val)) return '--'
  return (val >= 0 ? '+' : '') + val.toFixed(digits) + '%'
}

function pts(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '--'
  return (val >= 0 ? '+' : '−') + Math.abs(val).toFixed(1) + ' pts'
}

function share(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '--'
  return Math.round(val * 100) + '%'
}

function formatDay(val: string | null | undefined): string {
  if (!val) return '--'
  return new Date(String(val).slice(0, 10) + 'T00:00:00Z')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function signColor(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return 'text-ink-3'
  return val >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

/** Calls in words, always relative to the market — the event they are graded on. */
function callLabel(direction: string | null | undefined): string {
  if (direction === 'bullish') return 'Beat the market'
  if (direction === 'bearish') return 'Lag the market'
  return 'No clear view'
}

function sourceLabel(source: string): string {
  return source === 'ml_model' ? 'ML model' : 'Rule-based score'
}
</script>

<template>
  <Container class="py-8">
    <!-- Header -->
    <div class="mb-6 max-w-3xl">
      <h1 class="text-3xl font-bold font-serif text-ink mb-2">News-spike watch</h1>
      <p class="text-ink-2">
        When a company suddenly appears in the news far more than usual, we log it and follow the stock
        for the next 4 weeks, comparing it with the overall market (the S&amp;P 500, via SPY).
        Our models also make a guess.
      </p>
    </div>

    <StockSubNav />

    <!-- Honest status, always visible -->
    <div class="mb-6 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4">
      <div class="flex items-start gap-3">
        <Icon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div class="min-w-0 text-sm text-amber-900 dark:text-amber-100">
          <div class="font-semibold mb-1">Research, not advice: no model here has shown it can predict the outcome.</div>
          <ul v-if="record?.sources" class="space-y-0.5 text-amber-900/80 dark:text-amber-100/80">
            <li v-for="s in record.sources" :key="s.source">
              <span class="font-medium">{{ s.label }}:</span> {{ s.verdict }}
            </li>
          </ul>
          <button class="mt-2 text-xs font-mono underline" @click="activeTab = 'record'">See the full track record</button>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 mb-6 border-b border-rule">
      <button
        v-for="tab in [{ key: 'now', label: 'Open spikes' }, { key: 'record', label: 'Track record' }]"
        :key="tab.key"
        class="px-4 py-2.5 text-sm font-mono font-medium transition-colors relative"
        :class="activeTab === tab.key ? 'text-ink' : 'text-ink-3 hover:text-ink'"
        @click="activeTab = tab.key as any"
      >
        {{ tab.label }}
        <span v-if="tab.key === 'now' && cards.length" class="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono rounded-sm bg-surface-2 text-ink-3">
          {{ cards.length }}
        </span>
        <div v-if="activeTab === tab.key" class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
      </button>
    </div>

    <!-- ====== OPEN SPIKES ====== -->
    <div v-if="activeTab === 'now'">
      <div v-if="nowPending" class="py-12 text-center text-ink-3">Loading…</div>

      <template v-else-if="cards.length">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4 text-sm text-ink-3">
          <p>
            {{ cards.length }} companies with a news spike in the last {{ now?.horizonDays }} days.
            Typically {{ share(now?.baseRate) }} of stocks beat the market after a spike.
          </p>
          <label v-if="thinCount" class="flex items-center gap-2 cursor-pointer select-none">
            <input v-model="hideThin" type="checkbox" class="accent-current">
            Hide {{ thinCount }} based on a single article
          </label>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <article v-for="c in visibleCards" :key="c.ticker" class="border border-rule rounded-lg bg-surface p-5 flex flex-col gap-4">
            <!-- Title -->
            <header class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <NuxtLink :to="`/stocks/${c.ticker}`" class="font-mono font-bold text-lg text-ink hover:text-accent">{{ c.ticker }}</NuxtLink>
                <div class="text-sm text-ink-3 truncate">{{ c.companyName }}<span v-if="c.sector"> · {{ c.sector }}</span></div>
              </div>
              <div class="text-right text-xs font-mono text-ink-3 shrink-0">
                <div>Result on {{ formatDay(c.resolvesOn) }}</div>
                <div>{{ c.daysLeft }} days left</div>
              </div>
            </header>

            <!-- What happened -->
            <section>
              <h3 class="text-xs font-mono uppercase tracking-wide text-ink-4 mb-1">What happened · {{ formatDay(c.eventDate) }}</h3>
              <p class="text-sm text-ink">
                {{ c.trigger }}<span v-if="c.spikeCount > 1" class="text-ink-3"> — {{ c.spikeCount }} spikes in the last 4 weeks</span>
              </p>
              <ul v-if="c.articles.length" class="mt-2 space-y-1">
                <li v-for="a in c.articles" :key="a.id" class="text-sm">
                  <NuxtLink :to="`/articles/${a.id}`" class="text-ink-2 hover:text-accent">“{{ a.title }}”</NuxtLink>
                  <span v-if="a.source" class="text-ink-4 text-xs"> — {{ a.source }}</span>
                </li>
              </ul>
              <div v-if="c.keywords.length" class="mt-2 flex flex-wrap gap-1">
                <span v-for="k in c.keywords" :key="k" class="px-1.5 py-0.5 text-[11px] font-mono rounded-sm bg-surface-2 text-ink-3">{{ k }}</span>
              </div>
              <ul v-if="c.flags.length" class="mt-2 space-y-0.5">
                <li v-for="f in c.flags" :key="f" class="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <Icon name="i-heroicons-exclamation-circle" class="w-3.5 h-3.5 shrink-0" /> {{ f }}
                </li>
              </ul>
            </section>

            <!-- Since then -->
            <section>
              <h3 class="text-xs font-mono uppercase tracking-wide text-ink-4 mb-1">Since then</h3>
              <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm font-mono">
                <span>Stock <span :class="signColor(c.changeSince)">{{ pct(c.changeSince) }}</span></span>
                <span>Market <span :class="signColor(c.spyChangeSince)">{{ pct(c.spyChangeSince) }}</span></span>
                <span v-if="c.vsMarketSoFar != null" class="font-semibold" :class="signColor(c.vsMarketSoFar)">
                  {{ c.vsMarketSoFar >= 0 ? 'ahead of' : 'behind' }} the market by {{ Math.abs(c.vsMarketSoFar).toFixed(1) }} pts
                </span>
              </div>
            </section>

            <!-- Context and guess -->
            <section class="mt-auto pt-3 border-t border-rule text-sm space-y-1.5">
              <p v-if="c.setup?.n" class="text-ink-2">
                <span class="text-ink-4">Usually:</span>{{ ' ' }}
                after spikes like this, {{ share(c.setup.beatRate) }} of stocks beat the market
                (average {{ pts(c.setup.avgExcess) }}, {{ c.setup.n }} past cases).
              </p>
              <p v-if="c.lean" class="text-ink-2">
                <span class="text-ink-4">{{ sourceLabel(c.lean.source) }} guess (unproven):</span>{{ ' ' }}
                <template v-if="c.lean.probBeatSpy != null">
                  {{ share(c.lean.probBeatSpy) }} chance to beat the market, vs {{ share(c.lean.typical) }} typical
                </template>
                <template v-else>{{ callLabel(c.lean.direction).toLowerCase() }}</template>
              </p>
            </section>
          </article>
        </div>
      </template>

      <div v-else class="border border-rule rounded-lg p-8 bg-surface text-center text-ink-3">
        No news spikes in the last 4 weeks.
      </div>
    </div>

    <!-- ====== TRACK RECORD ====== -->
    <div v-if="activeTab === 'record'">
      <div v-if="recordPending" class="py-12 text-center text-ink-3">Loading…</div>

      <template v-else-if="record">
        <p class="text-sm text-ink-3 mb-4 max-w-3xl">
          Each call is a guess about whether a stock will <strong class="text-ink-2">beat or lag the market over 4 weeks</strong>.
          A call is right if the stock did what was guessed. To count as skill, a model has to be right more often
          than simply making the same guess about every stock in the same period.
          {{ record.excludedBackfill }}
        </p>

        <div class="grid gap-4 md:grid-cols-2 mb-8">
          <div v-for="s in record.sources" :key="s.source" class="border border-rule rounded-lg bg-surface p-5">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 class="font-mono font-semibold text-ink">{{ s.label }}</h3>
              <span
                class="px-2 py-0.5 text-[11px] font-mono rounded-sm"
                :class="s.hasEdge ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'"
              >{{ s.hasEdge ? 'Some skill' : 'No proven skill' }}</span>
            </div>
            <p class="text-sm text-ink mb-4">{{ s.verdict }}</p>

            <dl class="grid grid-cols-2 gap-3 text-sm mb-4">
              <div>
                <dt class="text-xs text-ink-4 font-mono">Right</dt>
                <dd class="font-mono text-lg text-ink">{{ share(s.hitRate) }}</dd>
                <dd class="text-xs text-ink-4">vs {{ share(s.naiveHitRate) }} by always guessing the same</dd>
              </div>
              <div>
                <dt class="text-xs text-ink-4 font-mono">Following the calls vs holding SPY</dt>
                <dd class="font-mono text-lg" :class="signColor(s.avgPayoff)">{{ pts(s.avgPayoff) }}</dd>
                <dd class="text-xs text-ink-4">average per call</dd>
              </div>
            </dl>

            <table class="w-full text-sm mb-3">
              <thead>
                <tr class="text-xs text-ink-4 font-mono text-left">
                  <th class="py-1 font-normal">Guess</th>
                  <th class="py-1 font-normal text-right">Calls</th>
                  <th class="py-1 font-normal text-right">Right</th>
                  <th class="py-1 font-normal text-right">Same guess on all</th>
                </tr>
              </thead>
              <tbody class="font-mono">
                <tr v-for="d in s.byDirection" :key="d.direction" class="border-t border-rule">
                  <td class="py-1.5 font-sans">{{ callLabel(d.direction) }}</td>
                  <td class="py-1.5 text-right">{{ d.n }}</td>
                  <td class="py-1.5 text-right">{{ d.n ? share(d.hitRate) : '--' }}</td>
                  <td class="py-1.5 text-right text-ink-3">{{ d.n ? share(d.coinFlip) : '--' }}</td>
                </tr>
                <tr class="border-t border-rule text-ink-3">
                  <td class="py-1.5 font-sans">No clear view</td>
                  <td class="py-1.5 text-right">{{ s.nNeutral }}</td>
                  <td colspan="2" />
                </tr>
              </tbody>
            </table>

            <p class="text-xs text-ink-4">
              {{ formatDay(s.windowStart) }} – {{ formatDay(s.windowEnd) }} ·
              only {{ s.independentWindows }} separate 4-week market periods, so even a real small edge would not show up yet.
            </p>
            <details class="mt-2 text-xs text-ink-4">
              <summary class="cursor-pointer">Technical details</summary>
              <p class="mt-1 font-mono">
                AUC {{ s.auc?.toFixed(3) ?? '--' }}<template v-if="s.aucCi"> (90% CI {{ s.aucCi[0].toFixed(2) }}–{{ s.aucCi[1].toFixed(2) }})</template>;
                0.5 = coin flip. Effective independent samples ≈ {{ s.effectiveN }}.
              </p>
            </details>
          </div>
        </div>

        <!-- Month by month -->
        <h2 class="font-mono font-semibold text-ink mb-2">Month by month</h2>
        <p class="text-sm text-ink-3 mb-3">Average result of following each call, compared with just holding SPY.</p>
        <div class="overflow-x-auto border border-rule rounded-lg bg-surface mb-8">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-xs text-ink-4 font-mono border-b border-rule bg-surface-1 text-left">
                <th class="py-2 px-4 font-normal">Month</th>
                <th class="py-2 px-2 font-normal">Source</th>
                <th class="py-2 px-2 font-normal text-right">Calls</th>
                <th class="py-2 px-4 font-normal text-right">vs SPY</th>
              </tr>
            </thead>
            <tbody class="font-mono">
              <tr v-for="m in record.monthly" :key="m.month + m.source" class="border-b border-rule last:border-0">
                <td class="py-1.5 px-4">{{ m.month }}</td>
                <td class="py-1.5 px-2 font-sans text-ink-2">{{ sourceLabel(m.source) }}</td>
                <td class="py-1.5 px-2 text-right">{{ m.n }}</td>
                <td class="py-1.5 px-4 text-right" :class="signColor(m.avgPayoff)">{{ pts(m.avgPayoff) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Recent resolved calls -->
        <h2 class="font-mono font-semibold text-ink mb-2">Recently resolved calls</h2>
        <div class="overflow-x-auto border border-rule rounded-lg bg-surface">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-xs text-ink-4 font-mono border-b border-rule bg-surface-1 text-left">
                <th class="py-2 px-4 font-normal">Spike</th>
                <th class="py-2 px-2 font-normal">Stock</th>
                <th class="py-2 px-2 font-normal">Guess</th>
                <th class="py-2 px-2 font-normal text-right">Stock</th>
                <th class="py-2 px-2 font-normal text-right">Market</th>
                <th class="py-2 px-4 font-normal text-right">Result</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in record.recent" :key="r.id" class="border-b border-rule last:border-0">
                <td class="py-1.5 px-4 font-mono text-ink-3 whitespace-nowrap">{{ formatDay(r.eventDate) }}</td>
                <td class="py-1.5 px-2">
                  <NuxtLink :to="`/stocks/${r.ticker}`" class="font-mono font-semibold text-ink hover:text-accent">{{ r.ticker }}</NuxtLink>
                </td>
                <td class="py-1.5 px-2 text-ink-2 whitespace-nowrap">{{ callLabel(r.direction) }} <span class="text-ink-4 text-xs">· {{ sourceLabel(r.source) }}</span></td>
                <td class="py-1.5 px-2 text-right font-mono" :class="signColor(r.change)">{{ pct(r.change) }}</td>
                <td class="py-1.5 px-2 text-right font-mono" :class="signColor(r.benchmark)">{{ pct(r.benchmark) }}</td>
                <td class="py-1.5 px-4 text-right whitespace-nowrap">
                  <span :class="r.correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                    {{ r.correct ? 'Right' : 'Wrong' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </Container>
</template>
