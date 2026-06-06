<script setup lang="ts">
const props = defineProps<{
  direction: 'bullish' | 'bearish' | 'neutral'
  strength: number
  compact?: boolean
}>()

const label = computed(() => {
  if (props.direction === 'bullish') return 'Bullish'
  if (props.direction === 'bearish') return 'Bearish'
  return 'Neutral'
})

const arrow = computed(() => {
  if (props.direction === 'bullish') return '\u2191'
  if (props.direction === 'bearish') return '\u2193'
  return '\u2194'
})

const pct = computed(() => `${(props.strength * 100).toFixed(0)}%`)

const colorClasses = computed(() => {
  if (props.direction === 'bullish') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'
  if (props.direction === 'bearish') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
  return 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 font-mono font-medium border rounded-sm"
    :class="[
      colorClasses,
      compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
    ]"
  >
    <span>{{ arrow }}</span>
    <span v-if="!compact">{{ label }}</span>
    <span class="opacity-75">{{ pct }}</span>
  </span>
</template>
