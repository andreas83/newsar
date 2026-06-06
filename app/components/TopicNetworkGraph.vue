<script setup lang="ts">
const router = useRouter()

interface Keyword {
  keyword: string
  relevance?: number
  category?: string
}

interface Entity {
  name: string
  type: string
  relevance?: number
}

interface Props {
  keywords: (Keyword | string)[]
  entities?: Entity[]
}

const props = defineProps<Props>()

// Get the center for the graph - prefer entities (match entity_relationships) over keywords
const centerTerm = computed(() => {
  // First try entities - they have relationship data
  if (props.entities && props.entities.length > 0) {
    return props.entities[0].name
  }
  // Fall back to keywords
  if (props.keywords.length === 0) return null
  const first = props.keywords[0]
  return typeof first === 'string' ? first : first.keyword
})

// Fetch graph data for the center term
const { data: graphData } = await useFetch('/api/topics/graph', {
  query: {
    center: centerTerm,
    depth: 2,
    minStrength: 0.3,
    limit: 50,
  },
  key: `topic-graph-${centerTerm.value}`,
})

// Check if we have data to display
const hasGraphData = computed(() => {
  return graphData.value && graphData.value.nodes && graphData.value.nodes.length > 0
})

// Navigate to entity page on node click
function handleNodeClick(nodeId: string) {
  if (!graphData.value?.nodes) return
  const node = graphData.value.nodes.find((n: any) => n.id === nodeId)
  if (node && node.slug && node.type) {
    router.push(`/${node.type}/${node.slug}`)
  }
}

const legendItems = [
  { color: '#3b82f6', label: 'Person' },
  { color: '#10b981', label: 'Organization' },
  { color: '#f59e0b', label: 'Location' },
  { color: '#8b5cf6', label: 'Event' },
]
</script>

<template>
  <div>
    <div v-if="hasGraphData && graphData" class="border dark:border-slate-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-800">
      <div class="mb-3 flex items-center justify-between">
        <div class="text-sm text-gray-600 dark:text-slate-400">
          Network visualization showing {{ graphData.meta.nodeCount }} related topics
        </div>
        <NuxtLink
          :to="`/topics/graph?center=${encodeURIComponent(centerTerm || '')}`"
          class="text-sm text-primary hover:underline"
        >
          View Full Graph
        </NuxtLink>
      </div>
      <div class="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-700" style="height: 500px;">
        <NetworkGraph
          v-if="graphData.nodes && graphData.edges"
          :nodes="graphData.nodes"
          :edges="graphData.edges"
          :selected-node="null"
          @node-click="handleNodeClick"
        />
      </div>
      <div class="flex flex-wrap items-center gap-4 mt-2 px-1 text-xs text-gray-500 dark:text-slate-400">
        <template v-for="item in legendItems" :key="item.label">
          <span class="flex items-center gap-1">
            <span class="inline-block w-2.5 h-2.5 rounded-full" :style="{ background: item.color }"></span>
            {{ item.label }}
          </span>
        </template>
        <span class="text-gray-400 dark:text-slate-500">|</span>
        <span>Click node to navigate</span>
        <span class="text-gray-400 dark:text-slate-500">|</span>
        <span>Edge numbers = shared articles</span>
      </div>
    </div>
    <div v-else class="text-sm text-gray-500 dark:text-slate-400 italic p-4 bg-gray-50 dark:bg-slate-800 rounded-lg border border-dashed dark:border-slate-700">
      No topic relationship data available yet. This graph will appear once topic relationships have been computed.
    </div>
  </div>
</template>
