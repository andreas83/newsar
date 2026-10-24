<script setup lang="ts">
/**
 * One label for everything a language model produced, so readers can tell
 * machine output from reporting at a glance. Links to the methodology section.
 *
 * kind: 'generated' — prose the model wrote (summaries, descriptions)
 *       'extracted' — items the model pulled from text (claims, entities, keywords)
 *       'classified' — labels and scores the model assigned (framing, sentiment)
 */
interface Props {
  kind?: 'generated' | 'extracted' | 'classified'
  date?: string | Date | null
  basis?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  kind: 'generated',
  date: null,
  basis: null,
})

const LABELS = {
  generated: 'AI-generated',
  extracted: 'AI-extracted',
  classified: 'AI-classified',
}

const TOOLTIPS = {
  generated: 'Written by a language model from the source articles, not by an editor. It can be wrong or miss context; check the original reporting.',
  extracted: 'Picked out of the article text by a language model, not by an editor. Items can be missed or misread.',
  classified: 'Assigned by a language model, not by an editor. Treat it as a rough guide, not a verdict.',
}

// Pinned to en-US + UTC so server and client render the same string
const dateText = computed(() => {
  if (!props.date) return null
  const d = new Date(props.date)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
})
</script>

<template>
  <NuxtLink
    to="/methodology#ai-content"
    class="inline-flex items-center gap-1.5 px-1.5 py-0.5 border border-rule rounded-sm bg-panel font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-3 hover:text-accent hover:border-accent transition-colors whitespace-nowrap align-middle no-underline"
    :title="TOOLTIPS[kind]"
  >
    <span class="w-1.5 h-1.5 rounded-full bg-accent inline-block flex-shrink-0" aria-hidden="true" />
    {{ LABELS[kind] }}
    <span v-if="basis" class="font-medium normal-case tracking-normal">· {{ basis }}</span>
    <span v-if="dateText" class="font-medium normal-case tracking-normal">· {{ dateText }}</span>
  </NuxtLink>
</template>
