<script setup lang="ts">
interface Props {
  color?: 'primary' | 'gray' | 'green' | 'red' | 'blue' | 'orange' | 'purple' | 'sky' | 'emerald' | 'yellow'
  variant?: 'solid' | 'subtle'
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  color: 'gray',
  variant: 'solid',
  size: 'md',
})

const colorClasses = {
  solid: {
    primary: 'bg-accent text-white',
    gray: 'bg-ink-3 text-white',
    green: 'bg-intel-green text-white',
    red: 'bg-intel-red text-white',
    blue: 'bg-intel-blue text-white',
    orange: 'bg-intel-amber text-white',
    purple: 'bg-intel-violet text-white',
    sky: 'bg-blue-500 text-white',
    emerald: 'bg-green-600 text-white',
    yellow: 'bg-yellow-600 text-white',
  },
  subtle: {
    primary: 'bg-accent-tint text-accent-ink',
    gray: 'bg-paper-2 text-ink-3',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    orange: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    sky: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  },
}

const sizeClasses = {
  xs: 'px-2 py-0.5 text-xs',
  sm: 'px-2.5 py-0.5 text-sm',
  md: 'px-3 py-1 text-sm',
  lg: 'px-4 py-1.5 text-base',
}

const badgeClasses = computed(() => [
  'inline-flex items-center gap-1 font-medium rounded-sm',
  colorClasses[props.variant][props.color],
  sizeClasses[props.size],
])
</script>

<template>
  <span :class="badgeClasses">
    <slot />
  </span>
</template>
