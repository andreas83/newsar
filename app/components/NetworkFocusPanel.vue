<script setup lang="ts">
import type { GraphNode, NetworkSelection } from './EntityNetworkGraph.vue'

/**
 * Side panel for a focused network node: who it is, its strongest
 * connections (click to walk the graph), and the trail of visited nodes.
 */
const props = withDefaults(defineProps<{
  selection: NetworkSelection | null
  maxItems?: number
  compact?: boolean
}>(), {
  maxItems: 10,
  compact: false,
})

const emit = defineEmits<{
  focus: [id: number]
  open: [node: GraphNode]
  close: []
}>()

const typeMeta: Record<string, { label: string; color: string }> = {
  person: { label: 'Person', color: '#3b82f6' },
  organization: { label: 'Organization', color: '#10b981' },
  location: { label: 'Location', color: '#f59e0b' },
  event: { label: 'Event', color: '#8b5cf6' },
  topic: { label: 'Topic', color: '#14b8a6' },
}

const showAll = ref(false)
const trail = ref<GraphNode[]>([])

// Breadcrumb of the exploration path; revisiting a node rewinds to it
watch(() => props.selection?.node.id, (id) => {
  showAll.value = false
  const node = props.selection?.node
  if (id == null || !node) {
    trail.value = []
    return
  }
  const idx = trail.value.findIndex(n => n.id === id)
  if (idx >= 0) {
    trail.value = trail.value.slice(0, idx + 1)
  } else {
    trail.value = [...trail.value, node].slice(-6)
  }
}, { immediate: true })

const connections = computed(() => props.selection?.connections ?? [])
const visibleConnections = computed(() =>
  showAll.value ? connections.value : connections.value.slice(0, props.maxItems),
)
const maxCount = computed(() => Math.max(1, ...connections.value.map(c => c.cooccurrenceCount)))

function toneOf(sc: number | null): { label: string; cls: string } | null {
  if (sc === null) return null
  if (sc > 0.3) return { label: 'similar tone', cls: 'tone-similar' }
  if (sc < -0.3) return { label: 'opposed tone', cls: 'tone-opposed' }
  return null
}
</script>

<template>
  <aside v-if="selection" class="focus-panel" :class="{ 'focus-panel-compact': compact }" @click.stop>
    <button class="focus-close" title="Close (Esc)" @click="emit('close')">
      <span class="i-heroicons-x-mark w-4 h-4" />
    </button>

    <!-- Trail -->
    <nav v-if="trail.length > 1" class="focus-trail" aria-label="Exploration path">
      <template v-for="(n, i) in trail" :key="n.id">
        <span v-if="i > 0" class="focus-trail-sep">›</span>
        <button
          class="focus-trail-item"
          :class="{ 'focus-trail-current': i === trail.length - 1 }"
          :title="n.name"
          @click="emit('focus', n.id)"
        >
          {{ n.name }}
        </button>
      </template>
    </nav>

    <!-- Identity -->
    <div class="pr-6">
      <div class="focus-type">
        <span class="focus-type-dot" :style="{ background: typeMeta[selection.node.type]?.color || '#6b7280' }" />
        {{ typeMeta[selection.node.type]?.label || selection.node.type }}
      </div>
      <h3 class="focus-name">{{ selection.node.name }}</h3>
      <p v-if="selection.node.shortDescription && !compact" class="focus-desc">
        {{ selection.node.shortDescription }}
      </p>
    </div>

    <!-- Connections -->
    <div class="focus-section-head">
      <span>Strongest connections</span>
      <span class="focus-count">{{ connections.length }}</span>
    </div>

    <p v-if="connections.length === 0" class="text-xs text-ink-4 py-2">
      No connections with the current filters.
    </p>

    <ul class="focus-list">
      <li v-for="c in visibleConnections" :key="c.node.id">
        <button class="focus-row" :title="`Focus ${c.node.name}`" @click="emit('focus', c.node.id)">
          <span class="focus-row-dot" :style="{ background: typeMeta[c.node.type]?.color || '#6b7280' }" />
          <span class="focus-row-main">
            <span class="focus-row-name">{{ c.node.name }}</span>
            <span class="focus-row-bar">
              <span class="focus-row-fill" :style="{ width: Math.max(4, (c.cooccurrenceCount / maxCount) * 100) + '%' }" />
            </span>
          </span>
          <span class="focus-row-meta">
            <span class="focus-row-count">{{ c.cooccurrenceCount.toLocaleString('en-US') }}</span>
            <span v-if="toneOf(c.sentimentCorrelation)" class="focus-tone" :class="toneOf(c.sentimentCorrelation)!.cls">
              {{ toneOf(c.sentimentCorrelation)!.label }}
            </span>
          </span>
        </button>
      </li>
    </ul>

    <button
      v-if="connections.length > maxItems"
      class="focus-more"
      @click="showAll = !showAll"
    >
      {{ showAll ? 'Show fewer' : `Show all ${connections.length}` }}
    </button>

    <p v-if="connections.length" class="focus-footnote">Numbers = articles mentioning both</p>

    <!-- Actions -->
    <div class="focus-actions">
      <Button
        v-if="selection.node.slug"
        size="sm"
        block
        @click="emit('open', selection.node)"
      >
        Open {{ (typeMeta[selection.node.type]?.label || 'entity').toLowerCase() }} page
      </Button>
      <slot name="actions" :node="selection.node" />
    </div>
  </aside>
</template>

<style scoped>
.focus-panel {
  position: absolute;
  top: 60px;
  right: 12px;
  width: 280px;
  max-height: calc(100% - 72px);
  height: fit-content;
  z-index: 20;
  display: flex;
  flex-direction: column;
  padding: 14px;
  overflow-y: auto;
  background: color-mix(in srgb, var(--color-panel, #fff) 94%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--color-rule, #d9d3c3);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(23, 20, 14, 0.12);
}

.focus-panel-compact {
  top: 52px;
  width: 250px;
  padding: 12px;
}

@media (max-width: 640px) {
  .focus-panel {
    top: auto;
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    max-height: 45%;
  }
}

.focus-close {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px;
  border-radius: 4px;
  color: var(--color-ink-4);
  transition: color 0.15s, background 0.15s;
}

.focus-close:hover {
  color: var(--color-ink);
  background: var(--color-paper-2);
}

/* Trail */
.focus-trail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin: -2px 24px 10px 0;
  font-size: 11px;
  line-height: 1.4;
}

.focus-trail-item {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink-3);
  padding: 0 3px;
  border-radius: 3px;
}

.focus-trail-item:hover {
  color: var(--color-accent);
  background: var(--color-paper-2);
}

.focus-trail-current {
  color: var(--color-ink);
  font-weight: 600;
}

.focus-trail-sep {
  color: var(--color-ink-4);
}

/* Identity */
.focus-type {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-ink-3);
  margin-bottom: 4px;
}

.focus-type-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.focus-name {
  font-family: 'Newsreader', Georgia, serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--color-ink);
  margin-bottom: 6px;
}

.focus-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-ink-3);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 4px;
}

/* Connections */
.focus-section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 10px 0 4px;
  padding-top: 10px;
  border-top: 1px solid var(--color-rule-soft, #e6e1d3);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-ink-3);
}

.focus-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: var(--color-ink-4);
}

.focus-list {
  display: flex;
  flex-direction: column;
  margin: 0 -6px;
}

.focus-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 6px;
  border-radius: 6px;
  text-align: left;
  transition: background 0.12s;
}

.focus-row:hover {
  background: var(--color-paper-2);
}

.focus-row:hover .focus-row-name {
  color: var(--color-accent);
}

.focus-row-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.focus-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.focus-row-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s;
}

.focus-row-bar {
  display: block;
  height: 3px;
  border-radius: 2px;
  background: var(--color-paper-2);
  overflow: hidden;
}

.focus-row-fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--color-ink-4);
}

.focus-row-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
  gap: 1px;
}

.focus-row-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--color-ink-2);
  font-variant-numeric: tabular-nums;
}

.focus-tone {
  font-size: 9px;
  font-weight: 500;
  white-space: nowrap;
}

.tone-similar {
  color: #16a34a;
}

.tone-opposed {
  color: #dc2626;
}

.focus-more {
  align-self: flex-start;
  margin-top: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-accent);
}

.focus-more:hover {
  text-decoration: underline;
}

.focus-footnote {
  margin-top: 6px;
  font-size: 10px;
  color: var(--color-ink-4);
}

.focus-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
</style>
