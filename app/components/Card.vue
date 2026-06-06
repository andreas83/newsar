<script setup lang="ts">
interface Props {
  padding?: boolean
}

withDefaults(defineProps<Props>(), {
  padding: true,
})
</script>

<template>
  <div class="bg-panel border border-rule overflow-hidden">
    <div v-if="$slots.header" class="px-6 py-4 border-b border-rule bg-paper-2">
      <slot name="header" />
    </div>

    <div :class="padding ? 'px-6 py-4' : ''">
      <slot />
    </div>

    <div v-if="$slots.footer" class="px-6 py-4 border-t border-rule bg-paper-2">
      <slot name="footer" />
    </div>
  </div>
</template>
