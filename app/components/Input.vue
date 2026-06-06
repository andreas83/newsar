<script setup lang="ts">
interface Props {
  modelValue?: string | number
  placeholder?: string
  type?: string
  icon?: string
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
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
  <div class="relative">
    <span v-if="icon" :class="[icon, 'absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-4']" />
    <input
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :class="[
        'w-full rounded-sm border border-rule bg-panel text-ink placeholder-ink-4 focus:border-accent focus:ring-2 focus:ring-accent focus:ring-opacity-50 transition-colors',
        sizeClasses[size],
        icon ? 'pl-10' : '',
      ]"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
