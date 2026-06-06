<script setup lang="ts">
import { Network } from 'vis-network/standalone'
import type { Data, Options, Node, Edge } from 'vis-network/standalone'

interface GraphNode {
  id: string
  label: string
  type: string
  category: string
  size: number
}

interface GraphEdge {
  from: string
  to: string
  type: string
  strength: number
  width: number
}

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNode?: string | null
  getNodeColor?: (category: string) => string
  getEdgeColor?: (type: string) => string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  nodeClick: [nodeId: string]
  nodeDoubleClick: [nodeId: string]
}>()

const containerRef = ref<HTMLElement | null>(null)
let network: Network | null = null

// Default color functions if not provided
const defaultNodeColor = (category: string): string => {
  const colors: Record<string, string> = {
    person: '#3b82f6',       // blue
    organization: '#10b981', // green
    location: '#f59e0b',     // amber
    event: '#8b5cf6',        // purple
    keyword: '#6b7280',      // gray
    entity: '#3b82f6',       // blue fallback
  }
  return colors[category] || '#6b7280'
}

const defaultEdgeColor = (type: string): string => {
  const colors: Record<string, string> = {
    synonym: '#10b981', // green
    parent: '#f59e0b', // amber
    child: '#06b6d4', // cyan
    co_occurrence: '#ef4444', // red
    related: '#8b5cf6', // purple
  }
  return colors[type] || '#9ca3af'
}

// Convert nodes to vis-network format
const visNodes = computed(() => {
  const getColor = props.getNodeColor || defaultNodeColor

  return props.nodes.map((node, index) => ({
    id: node.id,
    label: node.label,
    title: `${node.label}\nType: ${node.type}\nCategory: ${node.category}`,
    color: {
      background: getColor(node.category),
      border: props.selectedNode === node.id ? '#1f2937' : getColor(node.category),
      highlight: {
        background: getColor(node.category),
        border: '#1f2937',
      },
    },
    borderWidth: props.selectedNode === node.id ? 4 : 2,
    size: node.size * 3,
    font: {
      size: 14,
      color: '#1f2937',
      face: 'system-ui, -apple-system, sans-serif',
    },
    shape: 'dot',
    // Randomize initial positions to prevent clustering
    x: (Math.random() - 0.5) * 1000,
    y: (Math.random() - 0.5) * 1000,
  }))
})

// Convert edges to vis-network format
const visEdges = computed(() => {
  const getColor = props.getEdgeColor || defaultEdgeColor

  return props.edges.map((edge) => {
    const coCount = (edge as any).cooccurrenceCount
    return {
      from: edge.from,
      to: edge.to,
      title: `${edge.type}\nStrength: ${Math.round(edge.strength * 100)}%${coCount ? `\nShared articles: ${coCount}` : ''}`,
      label: coCount ? String(coCount) : undefined,
      font: coCount ? { size: 10, color: '#64748b', strokeWidth: 3, strokeColor: '#ffffff' } : undefined,
      color: {
        color: getColor(edge.type),
        highlight: getColor(edge.type),
        opacity: 0.6,
      },
      width: edge.width || 1,
      smooth: {
        type: 'continuous',
        roundness: 0.5,
      },
      arrows: {
        to: {
          enabled: edge.type === 'parent' || edge.type === 'child',
          scaleFactor: 0.5,
        },
      },
    }
  })
})

// Network options
const options: Options = {
  nodes: {
    shape: 'dot',
    scaling: {
      min: 10,
      max: 30,
    },
    font: {
      size: 14,
      face: 'system-ui',
    },
  },
  edges: {
    smooth: {
      type: 'continuous',
    },
    scaling: {
      min: 1,
      max: 5,
    },
    font: {
      size: 10,
      align: 'middle',
    },
  },
  physics: {
    enabled: true,
    stabilization: {
      enabled: true,
      iterations: 200, // Increased for better layout
      updateInterval: 25,
      fit: true, // Fit the network after stabilization
    },
    barnesHut: {
      gravitationalConstant: -4000, // Stronger repulsion to spread nodes
      centralGravity: 0.1, // Lower central gravity for more spread
      springLength: 200, // Longer springs for more spacing
      springConstant: 0.05,
      damping: 0.15, // Higher damping for faster stabilization
      avoidOverlap: 0.8, // Better overlap avoidance
    },
    solver: 'barnesHut', // Explicitly set solver
    timestep: 0.5, // Simulation speed
    adaptiveTimestep: true, // Adaptive timestep for better performance
  },
  interaction: {
    hover: true,
    tooltipDelay: 200,
    hideEdgesOnDrag: true,
    hideEdgesOnZoom: true,
  },
  layout: {
    improvedLayout: true,
    randomSeed: undefined, // Allow random layout each time
  },
}

// Initialize network
function initNetwork() {
  if (!containerRef.value) return

  const data: Data = {
    nodes: visNodes.value,
    edges: visEdges.value,
  }

  network = new Network(containerRef.value, data, options)

  // Event handlers
  network.on('click', (params) => {
    if (params.nodes.length > 0) {
      emit('nodeClick', params.nodes[0] as string)
    }
  })

  network.on('doubleClick', (params) => {
    if (params.nodes.length > 0) {
      emit('nodeDoubleClick', params.nodes[0] as string)
    }
  })

  // Fit network after stabilization completes
  network.once('stabilizationIterationsDone', () => {
    setTimeout(() => {
      network?.fit({
        animation: {
          duration: 1000,
          easingFunction: 'easeInOutQuad',
        },
      })
    }, 100)
  })

  // Also fit immediately in case stabilization is disabled
  setTimeout(() => {
    network?.fit({
      animation: {
        duration: 500,
        easingFunction: 'easeInOutQuad',
      },
    })
  }, 50)
}

// Update network when data changes
function updateNetwork() {
  if (!network) return

  const data: Data = {
    nodes: visNodes.value,
    edges: visEdges.value,
  }

  network.setData(data)

  // Stabilize and fit after data update
  network.stabilize()

  // Wait for stabilization to complete before fitting
  network.once('stabilizationIterationsDone', () => {
    setTimeout(() => {
      network?.fit({
        animation: {
          duration: 500,
          easingFunction: 'easeInOutQuad',
        },
      })
    }, 100)
  })
}

// Focus on selected node
function focusNode(nodeId: string) {
  if (!network) return

  network.selectNodes([nodeId])
  network.focus(nodeId, {
    scale: 1.5,
    animation: {
      duration: 500,
      easingFunction: 'easeInOutQuad',
    },
  })
}

// Expose methods
defineExpose({
  focusNode,
  fit: () => network?.fit(),
  stabilize: () => network?.stabilize(),
})

// Lifecycle
onMounted(() => {
  initNetwork()
})

onUnmounted(() => {
  if (network) {
    network.destroy()
    network = null
  }
})

// Watch for data changes
watch(
  () => [props.nodes, props.edges],
  () => {
    updateNetwork()
  },
  { deep: true }
)

// Watch for selected node changes
watch(
  () => props.selectedNode,
  (newNode) => {
    if (newNode && network) {
      focusNode(newNode)
    }
  }
)
</script>

<template>
  <div ref="containerRef" class="w-full h-full min-h-[300px] bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700"></div>
</template>

<style scoped>
/* vis-network overrides */
:deep(.vis-network) {
  outline: none;
}

:deep(.vis-tooltip) {
  position: absolute;
  visibility: hidden;
  padding: 8px;
  white-space: pre-line;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px;
  color: #1f2937;
  background-color: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  pointer-events: none;
  z-index: 50;
}

:root.dark :deep(.vis-tooltip) {
  color: #f1f5f9;
  background-color: #1e293b;
  border-color: #475569;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
}
</style>
