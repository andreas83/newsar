<script setup lang="ts">
interface Option {
  label: string
  value: string
}

interface Props {
  modelValue: string
  options: Option[]
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
})

const emit = defineEmits(['update:modelValue'])

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-4 py-3 text-lg',
}
</script>

<template>
  <select
    :value="modelValue"
    :class="[
      'w-full rounded-sm border border-rule bg-panel text-ink focus:border-accent focus:ring-2 focus:ring-accent focus:ring-opacity-50 transition-colors cursor-pointer',
      sizeClasses[size],
    ]"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>
