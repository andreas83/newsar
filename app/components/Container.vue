<script setup lang="ts">
interface Props {
  wide?: boolean
}

withDefaults(defineProps<Props>(), {
  wide: false,
})
</script>

<template>
  <div :class="wide ? 'max-w-[1440px] mx-auto px-6' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'">
    <slot />
  </div>
</template>
