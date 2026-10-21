<script setup lang="ts">
/**
 * Marks a page whose underlying model or job has been retired.
 *
 * The pages stay reachable on purpose: their equity curves and prediction
 * history are the evidence for the retirement decision, and deleting them
 * would erase the record of what was tried.
 */
interface Props {
  title?: string
  retiredOn?: string
  reference?: string
}

withDefaults(defineProps<Props>(), {
  title: 'Archived',
  retiredOn: '',
  reference: '',
})
</script>

<template>
  <div class="mb-6 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4">
    <div class="flex items-start gap-3">
      <Icon name="i-heroicons-archive-box" class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      <div class="min-w-0">
        <div class="font-mono text-sm font-semibold text-amber-800 dark:text-amber-200">
          {{ title }}<span v-if="retiredOn" class="font-normal"> — {{ retiredOn }}</span>
        </div>
        <p class="text-sm text-amber-800/80 dark:text-amber-200/80 mt-1">
          <slot />
        </p>
        <p v-if="reference" class="text-xs font-mono text-amber-700/70 dark:text-amber-300/60 mt-2">
          {{ reference }}
        </p>
      </div>
    </div>
  </div>
</template>
