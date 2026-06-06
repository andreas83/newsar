<script setup lang="ts">
import * as d3 from 'd3'

const props = withDefaults(defineProps<{
  ticker: string
  days?: number
  height?: number
  showVolume?: boolean
  showAnomalies?: boolean
}>(), {
  days: 30,
  height: 200,
  showVolume: true,
  showAnomalies: true,
})

const chartRef = ref<HTMLElement | null>(null)
const selectedDays = ref(props.days)
const loading = ref(true)
const priceData = ref<any>(null)
const volumeData = ref<any>(null)

const chartHeight = computed(() => props.height)

async function fetchData() {
  loading.value = true
  try {
    const fetches: Promise<any>[] = [
      $fetch(`/api/stocks/${props.ticker}/history?days=${selectedDays.value}`),
    ]
    if (props.showVolume || props.showAnomalies) {
      fetches.push(
        $fetch(`/api/stocks/${props.ticker}/volume?days=${selectedDays.value}`)
      )
    }
    const [historyRes, volRes] = await Promise.all(fetches)
    priceData.value = historyRes
    volumeData.value = volRes || null
  } catch {
    priceData.value = null
    volumeData.value = null
  }
  loading.value = false
  nextTick(drawChart)
}

function selectDays(d: number) {
  selectedDays.value = d
  fetchData()
}

function drawChart() {
  if (!chartRef.value || !priceData.value?.prices?.length) return

  const container = chartRef.value
  container.innerHTML = ''

  const prices = [...priceData.value.prices].reverse()
  const hasVolume = props.showVolume && volumeData.value?.dailyVolume?.length > 0
  const hasAnomalies = props.showAnomalies && volumeData.value?.anomalies?.length > 0

  const margin = { top: 10, right: 50, bottom: 24, left: 10 }
  const width = container.clientWidth
  const totalHeight = chartHeight.value

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', totalHeight)
    .attr('viewBox', `0 0 ${width} ${totalHeight}`)

  const innerW = width - margin.left - margin.right
  const innerH = totalHeight - margin.top - margin.bottom

  // Split vertical space: price area (70%) + gap (5%) + volume bars (25%)
  const priceH = hasVolume ? Math.floor(innerH * 0.68) : innerH
  const gapH = hasVolume ? Math.floor(innerH * 0.04) : 0
  const volH = hasVolume ? innerH - priceH - gapH : 0

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Shared x-scale
  const xScale = d3.scaleTime()
    .domain(d3.extent(prices, d => new Date(d.fetchedAt)) as [Date, Date])
    .range([0, innerW])

  // --- Price chart ---
  const yExtent = d3.extent(prices, d => d.price) as [number, number]
  const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1
  const yScale = d3.scaleLinear()
    .domain([yExtent[0] - yPad, yExtent[1] + yPad])
    .range([priceH, 0])

  const firstPrice = prices[0]?.price ?? 0
  const lastPrice = prices[prices.length - 1]?.price ?? 0
  const isPositive = lastPrice >= firstPrice
  const lineColor = isPositive ? '#16a34a' : '#dc2626'
  const fillColor = isPositive ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)'

  // Area
  const area = d3.area<any>()
    .x(d => xScale(new Date(d.fetchedAt)))
    .y0(priceH)
    .y1(d => yScale(d.price))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(prices)
    .attr('d', area)
    .attr('fill', fillColor)

  // Line
  const line = d3.line<any>()
    .x(d => xScale(new Date(d.fetchedAt)))
    .y(d => yScale(d.price))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(prices)
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', lineColor)
    .attr('stroke-width', 1.5)

  // --- Anomaly markers on price chart ---
  const anomalyDateSet = new Set<string>()
  if (hasAnomalies) {
    // Deduplicate by date (keep highest severity)
    const anomalyMap = new Map<string, any>()
    for (const a of volumeData.value.anomalies) {
      const dateStr = new Date(a.eventDate).toISOString().split('T')[0]
      anomalyDateSet.add(dateStr)
      const existing = anomalyMap.get(dateStr)
      if (!existing || a.eventType === 'volume_spike_3x') {
        anomalyMap.set(dateStr, a)
      }
    }

    for (const [dateStr, anomaly] of anomalyMap) {
      const x = xScale(new Date(dateStr))
      if (x < 0 || x > innerW) continue

      const is3x = anomaly.eventType === 'volume_spike_3x'
      const color = is3x ? '#ef4444' : '#f59e0b'

      g.append('line')
        .attr('x1', x).attr('x2', x)
        .attr('y1', 0).attr('y2', priceH)
        .attr('stroke', color)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,3')
        .attr('opacity', 0.5)

      // Small diamond marker at top
      g.append('path')
        .attr('d', 'M0,-4 L3,0 L0,4 L-3,0 Z')
        .attr('transform', `translate(${x}, 6)`)
        .attr('fill', color)
        .attr('opacity', 0.8)
    }
  }

  // --- Volume bars ---
  if (hasVolume) {
    const volGroup = g.append('g')
      .attr('transform', `translate(0, ${priceH + gapH})`)

    const dailyVolume: any[] = volumeData.value.dailyVolume
    const maxMentions = d3.max(dailyVolume, d => d.mentionCount) || 1
    const yVol = d3.scaleLinear()
      .domain([0, maxMentions])
      .range([volH, 0])

    const barWidth = Math.max(1.5, Math.min(8, innerW / (dailyVolume.length || 1) - 1))

    volGroup.selectAll('.vol-bar')
      .data(dailyVolume)
      .join('rect')
      .attr('class', 'vol-bar')
      .attr('x', (d: any) => xScale(new Date(d.date)) - barWidth / 2)
      .attr('y', (d: any) => yVol(d.mentionCount))
      .attr('width', barWidth)
      .attr('height', (d: any) => volH - yVol(d.mentionCount))
      .attr('fill', (d: any) => {
        const isAnomaly = anomalyDateSet.has(d.date)
        return isAnomaly ? 'rgba(239, 68, 68, 0.5)' : 'rgba(99, 102, 241, 0.3)'
      })
      .attr('rx', 1)

    // Volume label
    volGroup.append('text')
      .attr('x', 0)
      .attr('y', -2)
      .attr('class', 'text-[9px] fill-current text-ink-4')
      .attr('fill', '#9ca3af')
      .style('font-size', '9px')
      .text('News Vol.')

    // Light y-axis for volume
    volGroup.append('g')
      .attr('transform', `translate(${innerW},0)`)
      .call(d3.axisRight(yVol).ticks(2).tickFormat(d3.format('d') as any))
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('.tick text').attr('class', 'text-[9px] fill-current text-ink-4').attr('fill', '#9ca3af').style('font-size', '9px'))
      .call(g => g.selectAll('.tick line').remove())
  }

  // --- Axes ---
  // X axis at bottom of entire chart
  const xAxisY = hasVolume ? priceH + gapH + volH : priceH
  g.append('g')
    .attr('transform', `translate(0,${xAxisY})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%b %d') as any))
    .call(g => g.select('.domain').remove())
    .call(g => g.selectAll('.tick text').attr('class', 'text-[10px] fill-current text-ink-4'))
    .call(g => g.selectAll('.tick line').attr('stroke', 'currentColor').attr('class', 'text-rule-soft'))

  // Y axis (right) for price
  g.append('g')
    .attr('transform', `translate(${innerW},0)`)
    .call(d3.axisRight(yScale).ticks(4).tickFormat(d => `$${d}`))
    .call(g => g.select('.domain').remove())
    .call(g => g.selectAll('.tick text').attr('class', 'text-[10px] fill-current text-ink-4'))
    .call(g => g.selectAll('.tick line').attr('stroke', 'currentColor').attr('class', 'text-rule-soft'))

  // --- Tooltip crosshair ---
  const bisect = d3.bisector((d: any) => new Date(d.fetchedAt)).left
  const dailyVolume: any[] = volumeData.value?.dailyVolume || []

  const crosshairLine = g.append('line')
    .attr('y1', 0).attr('y2', xAxisY)
    .attr('stroke', '#6b7280')
    .attr('stroke-width', 0.5)
    .attr('stroke-dasharray', '2,2')
    .style('display', 'none')

  const tooltipEl = d3.select(container)
    .append('div')
    .style('position', 'absolute')
    .style('pointer-events', 'none')
    .style('opacity', '0')
    .style('z-index', '10')
    .attr('class', 'bg-panel border border-rule rounded-sm px-2.5 py-1.5 text-[10px] font-mono shadow-sm')

  svg.append('rect')
    .attr('x', margin.left).attr('y', margin.top)
    .attr('width', innerW).attr('height', xAxisY)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair')
    .on('mousemove', function (event) {
      const [mx] = d3.pointer(event, this)
      const x = mx - margin.left
      if (x < 0 || x > innerW) return

      const date = xScale.invert(x)
      const idx = Math.min(bisect(prices, date), prices.length - 1)
      const p = prices[idx]
      if (!p) return

      const dateStr = d3.timeFormat('%Y-%m-%d')(new Date(p.fetchedAt))
      const dateDisplay = d3.timeFormat('%b %d, %Y')(new Date(p.fetchedAt))

      const vol = dailyVolume.find((v: any) => v.date === dateStr)
      const anomaly = volumeData.value?.anomalies?.find((a: any) =>
        new Date(a.eventDate).toISOString().split('T')[0] === dateStr
      )

      let html = `<div class="text-ink-3 mb-0.5">${dateDisplay}</div>`
      html += `<div class="text-ink font-semibold">$${p.price?.toFixed(2) ?? '--'}</div>`
      if (vol) {
        html += `<div class="text-indigo-400 mt-0.5">${vol.mentionCount} article${vol.mentionCount !== 1 ? 's' : ''} / ${vol.sourceCount} source${vol.sourceCount !== 1 ? 's' : ''}</div>`
      }
      if (anomaly) {
        const label = anomaly.eventType.replace(/_/g, ' ')
        const keywords = anomaly.metadata?.new_keywords?.slice(0, 3)
        html += `<div class="text-red-400 mt-0.5">${label}</div>`
        if (keywords?.length) {
          html += `<div class="text-amber-400/80">${keywords.join(', ')}</div>`
        }
      }

      crosshairLine
        .attr('x1', xScale(new Date(p.fetchedAt)))
        .attr('x2', xScale(new Date(p.fetchedAt)))
        .style('display', null)

      tooltipEl
        .html(html)
        .style('opacity', '1')
        .style('left', `${Math.min(mx + 12, width - 160)}px`)
        .style('top', `${margin.top + 4}px`)
    })
    .on('mouseleave', () => {
      crosshairLine.style('display', 'none')
      tooltipEl.style('opacity', '0')
    })
}

onMounted(() => {
  fetchData()
  window.addEventListener('resize', drawChart)
})

onUnmounted(() => {
  window.removeEventListener('resize', drawChart)
})
</script>

<template>
  <div class="relative">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-mono font-semibold text-ink-2 uppercase tracking-wider">
        {{ ticker }} Price Chart
      </h3>
      <div class="flex gap-1">
        <button
          v-for="d in [7, 30, 90, 365]"
          :key="d"
          class="px-2 py-0.5 text-[10px] font-mono uppercase rounded-sm transition-colors"
          :class="selectedDays === d
            ? 'bg-accent text-white'
            : 'text-ink-3 hover:bg-paper-2'"
          @click="selectDays(d)"
        >
          {{ d === 365 ? '1Y' : `${d}D` }}
        </button>
      </div>
    </div>
    <div v-if="loading" class="flex items-center justify-center" :style="{ height: `${chartHeight}px` }">
      <span class="text-sm text-ink-3">Loading chart...</span>
    </div>
    <div
      v-else
      ref="chartRef"
      class="w-full relative"
      :style="{ height: `${chartHeight}px` }"
    />
  </div>
</template>
