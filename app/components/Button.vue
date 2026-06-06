<script setup lang="ts">
interface Props {
  variant?: 'solid' | 'outline' | 'ghost'
  color?: 'primary' | 'gray' | 'green' | 'red' | 'blue'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  label?: string
  to?: string
  href?: string
  block?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'solid',
  color: 'primary',
  size: 'md',
  block: false,
  disabled: false,
})

const variantClasses = {
  solid: {
    primary: 'bg-accent text-white hover:bg-accent-ink',
    gray: 'bg-ink-3 text-white hover:bg-ink-2',
    green: 'bg-intel-green text-white hover:bg-green-800',
    red: 'bg-intel-red text-white hover:bg-red-800',
    blue: 'bg-intel-blue text-white hover:bg-blue-800',
  },
  outline: {
    primary: 'border border-accent text-accent hover:bg-accent-tint',
    gray: 'border border-rule text-ink-2 hover:bg-paper-2',
    green: 'border border-green-600 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20',
    red: 'border border-red-600 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
    blue: 'border border-blue-600 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  },
  ghost: {
    primary: 'text-accent hover:bg-accent-tint',
    gray: 'text-ink-3 hover:bg-paper-2 hover:text-ink',
    green: 'text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20',
    red: 'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
    blue: 'text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20',
  },
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
}

const buttonClasses = computed(() => [
  'btn-intel',
  variantClasses[props.variant][props.color],
  sizeClasses[props.size],
  props.block ? 'w-full' : '',
])

const component = computed(() => {
  if (props.to) return resolveComponent('NuxtLink')
  if (props.href) return 'a'
  return 'button'
})

const componentProps = computed(() => {
  if (props.to) return { to: props.to }
  if (props.href) return { href: props.href, target: '_blank', rel: 'noopener noreferrer' }
  return { type: 'button', disabled: props.disabled }
})
</script>

<template>
  <component :is="component" v-bind="componentProps" :class="buttonClasses">
    <span v-if="icon" :class="icon" class="w-5 h-5" />
    <slot>{{ label }}</slot>
  </component>
</template>
