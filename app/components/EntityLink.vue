<template>
  <NuxtLink
    :to="entityUrl"
    class="entity-link"
    :class="entityClass"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <slot>{{ entityName }}</slot>
  </NuxtLink>
</template>

<script setup lang="ts">
interface Props {
  entityId: number
  entityType: 'person' | 'organization' | 'location' | 'event' | 'topic'
  entityName: string
  entitySlug: string
}

const props = defineProps<Props>()

// Compute entity URL
const entityUrl = computed(() => `/${props.entityType}/${props.entitySlug}`)

// Compute entity-specific CSS class
const entityClass = computed(() => `entity-${props.entityType}`)

// Hover state management
let hoverTimer: ReturnType<typeof setTimeout> | null = null
const isHovered = ref(false)

const emit = defineEmits<{
  showPreview: [entityId: number, x: number, y: number]
  hidePreview: []
}>()

function handleMouseEnter(event: MouseEvent) {
  // Delay showing preview by 300ms to avoid flickering
  hoverTimer = setTimeout(() => {
    isHovered.value = true

    // Get mouse position for preview positioning
    const x = event.clientX
    const y = event.clientY

    emit('showPreview', props.entityId, x, y)
  }, 300)
}

function handleMouseLeave() {
  // Clear hover timer if user moves away before delay
  if (hoverTimer) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }

  isHovered.value = false
  emit('hidePreview')
}

// Cleanup on unmount
onUnmounted(() => {
  if (hoverTimer) {
    clearTimeout(hoverTimer)
  }
})
</script>

<style scoped>
.entity-link {
  @apply relative inline-block cursor-pointer font-medium underline decoration-2 decoration-dotted underline-offset-2 transition-colors;
}

.entity-link:hover {
  @apply no-underline;
}

.entity-person {
  @apply text-blue-700 decoration-blue-300 hover:text-blue-900 hover:bg-blue-50;
}

:root.dark .entity-person {
  @apply text-blue-400 decoration-blue-600 hover:text-blue-300 hover:bg-blue-900/30;
}

.entity-organization {
  @apply text-purple-700 decoration-purple-300 hover:text-purple-900 hover:bg-purple-50;
}

:root.dark .entity-organization {
  @apply text-purple-400 decoration-purple-600 hover:text-purple-300 hover:bg-purple-900/30;
}

.entity-location {
  @apply text-green-700 decoration-green-300 hover:text-green-900 hover:bg-green-50;
}

:root.dark .entity-location {
  @apply text-green-400 decoration-green-600 hover:text-green-300 hover:bg-green-900/30;
}

.entity-event {
  @apply text-orange-700 decoration-orange-300 hover:text-orange-900 hover:bg-orange-50;
}

:root.dark .entity-event {
  @apply text-orange-400 decoration-orange-600 hover:text-orange-300 hover:bg-orange-900/30;
}

.entity-topic {
  @apply text-teal-700 decoration-teal-300 hover:text-teal-900 hover:bg-teal-50;
}

:root.dark .entity-topic {
  @apply text-teal-400 decoration-teal-600 hover:text-teal-300 hover:bg-teal-900/30;
}
</style>
