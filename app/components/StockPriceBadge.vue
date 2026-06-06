<script setup lang="ts">
const props = defineProps<{
  ticker: string
  price: number | null
  changeAmount: number | null
  changePercent: number | null
  marketStatus?: string | null
}>()

const isPositive = computed(() => (props.changePercent ?? 0) >= 0)
const formattedPrice = computed(() =>
  props.price != null ? `$${props.price.toFixed(2)}` : '—'
)
const formattedChange = computed(() => {
  if (props.changePercent == null) return ''
  const sign = props.changePercent >= 0 ? '+' : ''
  return `${sign}${props.changePercent.toFixed(2)}%`
})
</script>

<template>
  <span class="inline-flex items-center gap-1.5 font-mono text-sm">
    <span class="font-semibold text-ink-2">{{ ticker }}</span>
    <span class="text-ink">{{ formattedPrice }}</span>
    <span
      v-if="changePercent != null"
      class="font-medium"
      :class="isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
    >
      {{ formattedChange }}
    </span>
    <span
      v-if="marketStatus && marketStatus !== 'open'"
      class="text-[10px] uppercase text-ink-4 tracking-wider"
    >
      {{ marketStatus === 'closed' ? 'Closed' : marketStatus === 'pre_market' ? 'Pre' : 'AH' }}
    </span>
  </span>
</template>
