<script setup lang="ts">
import * as d3 from 'd3'

const props = defineProps<{
  ticker: string
  companyName: string
  price: number | null
  changeAmount: number | null
  changePercent: number | null
  sector: string | null
  entityId: number | null
  marketStatus: string | null
  sparkline?: number[]
}>()

const isPositive = computed(() => (props.changePercent ?? 0) >= 0)
const formattedPrice = computed(() => props.price != null ? `$${props.price.toFixed(2)}` : '—')
const formattedChange = computed(() => {
  if (props.changePercent == null) return '—'
  const sign = props.changePercent >= 0 ? '+' : ''
  return `${sign}${props.changePercent.toFixed(2)}%`
})
const formattedChangeAmt = computed(() => {
  if (props.changeAmount == null) return ''
  const sign = props.changeAmount >= 0 ? '+' : ''
  return `${sign}$${Math.abs(props.changeAmount).toFixed(2)}`
})

// Mini sparkline from prop data — client only
const sparkRef = ref<HTMLElement | null>(null)

function drawSparkline() {
  if (!sparkRef.value || !props.sparkline?.length || props.sparkline.length < 2) return
  sparkRef.value.innerHTML = ''

  const data = props.sparkline
  const w = 80, h = 28
  const svg = d3.select(sparkRef.value)
    .append('svg')
    .attr('width', w)
    .attr('height', h)

  const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, w])
  const yExt = d3.extent(data) as [number, number]
  const pad = (yExt[1] - yExt[0]) * 0.15 || 0.5
  const y = d3.scaleLinear().domain([yExt[0] - pad, yExt[1] + pad]).range([h - 1, 1])

  const first = data[0]
  const last = data[data.length - 1]
  const color = last >= first ? '#16a34a' : '#dc2626'

  const line = d3.line<number>()
    .x((_, i) => x(i))
    .y(d => y(d))
    .curve(d3.curveMonotoneX)

  svg.append('path')
    .datum(data)
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.5)
}

onMounted(() => {
  nextTick(drawSparkline)
})
</script>

<template>
  <div class="bg-panel border border-rule rounded-sm p-4 hover:border-accent/30 transition-colors">
    <div class="flex items-start justify-between mb-3">
      <div class="min-w-0 flex-1">
        <div class="font-mono font-bold text-ink text-sm">{{ ticker }}</div>
        <div class="text-xs text-ink-3 truncate">{{ companyName }}</div>
      </div>
      <div ref="sparkRef" class="flex-shrink-0 ml-2" />
    </div>

    <div class="flex items-end justify-between">
      <div>
        <div class="text-xl font-bold font-mono text-ink">{{ formattedPrice }}</div>
        <div class="flex items-center gap-2 mt-0.5">
          <span
            class="text-sm font-mono font-medium"
            :class="isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
          >
            {{ formattedChange }}
          </span>
          <span
            v-if="changeAmount != null"
            class="text-xs font-mono text-ink-4"
          >
            {{ formattedChangeAmt }}
          </span>
        </div>
      </div>
      <div class="text-right">
        <span
          v-if="sector"
          class="inline-block px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm bg-paper-2 text-ink-3"
        >
          {{ sector }}
        </span>
        <div
          v-if="marketStatus"
          class="mt-1 text-[10px] font-mono uppercase tracking-wider"
          :class="marketStatus === 'open' ? 'text-green-600' : 'text-ink-4'"
        >
          {{ marketStatus === 'open' ? 'Live' : marketStatus === 'pre_market' ? 'Pre-Mkt' : marketStatus === 'after_hours' ? 'After-Hrs' : 'Closed' }}
        </div>
      </div>
    </div>
  </div>
</template>
