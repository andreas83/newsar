<script setup lang="ts">
interface Props {
  value: number // 0-100
  color?: 'primary' | 'green' | 'blue' | 'purple' | 'yellow'
  height?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  color: 'primary',
  height: 'md',
})

const colorClasses = {
  primary: 'bg-accent',
  green: 'bg-intel-green',
  blue: 'bg-intel-blue',
  purple: 'bg-intel-violet',
  yellow: 'bg-yellow-600',
}

const heightClasses = {
  sm: 'h-0.5',
  md: 'h-1',
  lg: 'h-1.5',
}
</script>

<template>
  <div :class="['w-full bg-paper-2 overflow-hidden', heightClasses[height]]">
    <div
      :class="['h-full transition-all duration-300', colorClasses[color]]"
      :style="{ width: `${Math.min(100, Math.max(0, value))}%` }"
    />
  </div>
</template>
