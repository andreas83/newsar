<script setup lang="ts">
interface Bubble {
  id: number
  keyword: string
  category: string
  count: number
  size: number
  relevance: number
  position: { x: number; y: number }
}

interface Relationship {
  sourceId: number
  sourceKeyword: string
  targetId: number
  targetKeyword: string
  type: string
  strength: number
}

const props = defineProps<{
  showRelationships?: boolean
  layout?: 'clustered' | 'standard'
}>()

const showRelationships = computed(() => props.showRelationships !== false)
const layout = computed(() => props.layout || 'clustered')

const { data: trendingData } = await useFetch<{
  bubbles: Bubble[]
  relationships: Relationship[]
  timestamp: string
}>('/api/trending-enhanced', {
  query: computed(() => ({
    limit: 30,
    relationships: showRelationships.value,
  })),
})

const bubbles = computed(() => trendingData.value?.bubbles || [])
const relationships = computed(() => trendingData.value?.relationships || [])

// Hover state
const hoveredBubbleId = ref<number | null>(null)
const selectedBubbleId = ref<number | null>(null)

// Get related bubble IDs for highlighting
const relatedBubbleIds = computed(() => {
  const targetId = hoveredBubbleId.value || selectedBubbleId.value
  if (!targetId) return new Set<number>()

  const related = new Set<number>([targetId])

  for (const rel of relationships.value) {
    if (rel.sourceId === targetId) {
      related.add(rel.targetId)
    }
    if (rel.targetId === targetId) {
      related.add(rel.sourceId)
    }
  }

  return related
})

// Get visible relationships (connected to hovered/selected bubble)
const visibleRelationships = computed(() => {
  const targetId = hoveredBubbleId.value || selectedBubbleId.value
  if (!targetId || !showRelationships.value) return []

  return relationships.value.filter(
    (rel) => rel.sourceId === targetId || rel.targetId === targetId
  )
})

// Get color based on category
function getCategoryColor(category: string) {
  const colors: Record<string, string> = {
    entity: 'bg-blue-500 hover:bg-blue-600',
    event: 'bg-red-500 hover:bg-red-600',
    topic: 'bg-purple-500 hover:bg-purple-600',
    general: 'bg-green-500 hover:bg-green-600',
    technology: 'bg-indigo-500 hover:bg-indigo-600',
    location: 'bg-orange-500 hover:bg-orange-600',
    'geographic region': 'bg-orange-400 hover:bg-orange-500',
    sport: 'bg-yellow-500 hover:bg-yellow-600',
    concept: 'bg-teal-500 hover:bg-teal-600',
    action: 'bg-pink-500 hover:bg-pink-600',
    law: 'bg-slate-600 hover:bg-slate-700',
    project: 'bg-cyan-500 hover:bg-cyan-600',
  }
  return colors[category] || 'bg-gray-500 hover:bg-gray-600'
}

// Calculate size in rem units
function getBubbleSize(size: number) {
  const minSize = 2.5 // rem
  const maxSize = 8 // rem
  const range = maxSize - minSize
  return minSize + (size / 10) * range
}

// Check if bubble is dimmed (not related to hovered/selected)
function isBubbleDimmed(bubbleId: number) {
  const targetId = hoveredBubbleId.value || selectedBubbleId.value
  if (!targetId) return false
  return !relatedBubbleIds.value.has(bubbleId)
}

// Handle bubble click
function handleBubbleClick(bubble: Bubble) {
  if (selectedBubbleId.value === bubble.id) {
    selectedBubbleId.value = null
    navigateTo(`/search?q=${encodeURIComponent(bubble.keyword)}`)
  } else {
    selectedBubbleId.value = bubble.id
  }
}

// Get relationship line coordinates
function getRelationshipLine(rel: Relationship) {
  const sourceBubble = bubbles.value.find((b) => b.id === rel.sourceId)
  const targetBubble = bubbles.value.find((b) => b.id === rel.targetId)

  if (!sourceBubble || !targetBubble) return null

  return {
    x1: sourceBubble.position.x,
    y1: sourceBubble.position.y,
    x2: targetBubble.position.x,
    y2: targetBubble.position.y,
    strength: rel.strength,
    type: rel.type,
  }
}

// Get relationship line style
function getRelationshipStyle(rel: Relationship) {
  const colors: Record<string, string> = {
    co_occurrence: '#6366f1', // indigo
    synonym: '#8b5cf6', // purple
    related: '#06b6d4', // cyan
  }

  return {
    stroke: colors[rel.type] || '#9ca3af',
    strokeWidth: Math.max(1, rel.strength * 3),
    opacity: 0.3 + rel.strength * 0.4,
  }
}

// Clear selection when clicking outside
function handleContainerClick(event: MouseEvent) {
  if ((event.target as HTMLElement).classList.contains('bubbles-container')) {
    selectedBubbleId.value = null
  }
}
</script>

<template>
  <div class="relative w-full py-8 px-4 bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 rounded-xl overflow-hidden">
    <!-- Header -->
    <div class="text-center mb-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2 flex items-center justify-center gap-2">
        <Icon name="i-heroicons-sparkles" class="w-6 h-6 text-yellow-500" />
        Trending Topics
      </h2>
      <p class="text-sm text-gray-600 dark:text-slate-400">
        {{ layout === 'clustered' ? 'Related topics clustered together' : 'Click a bubble to explore articles' }}
        <span v-if="showRelationships" class="text-xs text-gray-500 dark:text-slate-400">
          • Hover to see connections
        </span>
      </p>
    </div>

    <!-- Bubbles Container -->
    <div
      v-if="bubbles.length"
      class="bubbles-container relative min-h-[500px] w-full"
      @click="handleContainerClick"
    >
      <!-- SVG for relationship lines -->
      <svg
        v-if="showRelationships && visibleRelationships.length"
        class="absolute inset-0 w-full h-full pointer-events-none"
        style="z-index: 1"
      >
        <g v-for="(rel, idx) in visibleRelationships" :key="`rel-${idx}`">
          <line
            v-if="getRelationshipLine(rel)"
            :x1="`${getRelationshipLine(rel)!.x1}%`"
            :y1="`${getRelationshipLine(rel)!.y1}%`"
            :x2="`${getRelationshipLine(rel)!.x2}%`"
            :y2="`${getRelationshipLine(rel)!.y2}%`"
            :style="getRelationshipStyle(rel)"
            class="transition-all duration-300"
          />
        </g>
      </svg>

      <!-- Bubbles with clustered positioning -->
      <button
        v-for="bubble in bubbles"
        :key="`${bubble.keyword}-${bubble.id}`"
        :class="[
          'absolute rounded-full shadow-lg transition-all duration-300 flex items-center justify-center text-white font-semibold cursor-pointer',
          getCategoryColor(bubble.category),
          {
            'opacity-30 scale-95': isBubbleDimmed(bubble.id),
            'scale-110 shadow-2xl ring-4 ring-white z-20': selectedBubbleId === bubble.id,
            'hover:scale-110 hover:shadow-xl z-10': !isBubbleDimmed(bubble.id),
          },
        ]"
        :style="{
          width: `${getBubbleSize(bubble.size)}rem`,
          height: `${getBubbleSize(bubble.size)}rem`,
          fontSize: `${Math.max(0.65, bubble.size / 12)}rem`,
          left: layout === 'clustered' ? `${bubble.position.x}%` : 'auto',
          top: layout === 'clustered' ? `${bubble.position.y}%` : 'auto',
          transform:
            layout === 'clustered'
              ? 'translate(-50%, -50%)'
              : 'none',
          position: layout === 'clustered' ? 'absolute' : 'relative',
          zIndex: hoveredBubbleId === bubble.id || selectedBubbleId === bubble.id ? 20 : 2,
        }"
        :title="`${bubble.keyword} - ${bubble.count} articles (${Math.round(bubble.relevance * 100)}% relevance)`"
        @mouseenter="hoveredBubbleId = bubble.id"
        @mouseleave="hoveredBubbleId = null"
        @click.stop="handleBubbleClick(bubble)"
      >
        <span class="text-center px-2 leading-tight">
          {{ bubble.keyword }}
        </span>
      </button>

      <!-- Fallback for standard layout -->
      <div
        v-if="layout === 'standard'"
        class="flex flex-wrap items-center justify-center gap-3 p-4"
      />
    </div>

    <!-- Loading State -->
    <div v-else class="flex items-center justify-center min-h-[500px]">
      <div class="text-center text-gray-500 dark:text-slate-400">
        <Icon name="i-heroicons-arrow-path" class="w-8 h-8 mx-auto mb-2 animate-spin" />
        <p>Loading trending topics...</p>
      </div>
    </div>

    <!-- Info Panel (when bubble selected) -->
    <div
      v-if="selectedBubbleId && relatedBubbleIds.size > 1"
      class="mt-4 p-4 bg-white dark:bg-slate-800 rounded-lg shadow-md border border-gray-200 dark:border-slate-700"
    >
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-semibold text-gray-900 dark:text-slate-100">
          Related to: {{ bubbles.find((b) => b.id === selectedBubbleId)?.keyword }}
        </h3>
        <button
          class="text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
          @click="selectedBubbleId = null"
        >
          <Icon name="i-heroicons-x-mark" class="w-5 h-5" />
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="relId in Array.from(relatedBubbleIds).filter((id) => id !== selectedBubbleId)"
          :key="relId"
          class="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-full text-sm"
        >
          {{ bubbles.find((b) => b.id === relId)?.keyword }}
        </span>
      </div>
      <div class="mt-3 flex gap-2">
        <UButton
          size="sm"
          @click="navigateTo(`/search?q=${encodeURIComponent(bubbles.find((b) => b.id === selectedBubbleId)?.keyword || '')}`)"
        >
          Search Articles
        </UButton>
        <UButton
          size="sm"
          variant="outline"
          @click="selectedBubbleId = null"
        >
          Clear Selection
        </UButton>
      </div>
    </div>

    <!-- Legend -->
    <div v-if="bubbles.length" class="mt-6">
      <div class="flex flex-wrap items-center justify-center gap-3 text-xs mb-2">
        <div class="flex items-center gap-1">
          <div class="w-3 h-3 rounded-full bg-blue-500" />
          <span class="text-gray-600 dark:text-slate-400">People & Orgs</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-3 h-3 rounded-full bg-red-500" />
          <span class="text-gray-600 dark:text-slate-400">Events</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-3 h-3 rounded-full bg-purple-500" />
          <span class="text-gray-600 dark:text-slate-400">Topics</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-3 h-3 rounded-full bg-green-500" />
          <span class="text-gray-600 dark:text-slate-400">General</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-3 h-3 rounded-full bg-orange-500" />
          <span class="text-gray-600 dark:text-slate-400">Locations</span>
        </div>
      </div>
      <div v-if="showRelationships" class="flex flex-wrap items-center justify-center gap-3 text-xs">
        <div class="flex items-center gap-1">
          <div class="w-3 h-0.5 bg-indigo-500" />
          <span class="text-gray-600 dark:text-slate-400">Co-occurrence</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-3 h-0.5 bg-purple-500" />
          <span class="text-gray-600 dark:text-slate-400">Synonyms</span>
        </div>
        <div class="flex items-center gap-1">
          <div class="w-3 h-0.5 bg-cyan-500" />
          <span class="text-gray-600 dark:text-slate-400">Related</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bubbles-container {
  position: relative;
  transition: all 0.3s ease;
}

button {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

button:hover {
  filter: brightness(1.1);
}
</style>
