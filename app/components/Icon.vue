<script setup lang="ts">
interface Props {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
})

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
  xl: 'w-8 h-8',
}
</script>

<template>
  <span :class="[name, sizeClasses[size]]" class="inline-block" />
</template>
