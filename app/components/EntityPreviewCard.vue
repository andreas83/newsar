<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible && entityData"
        ref="cardRef"
        class="fixed z-50 w-80 max-w-sm"
        :style="{ ...cardStyle, pointerEvents: 'auto' }"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <div class="bg-panel rounded-sm border border-rule p-4 shadow-lg">
          <!-- Loading State -->
          <div v-if="loading" class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-ink"></div>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="text-intel-red text-sm p-4">
            Failed to load entity preview
          </div>

          <!-- Entity Preview Content -->
          <div v-else class="space-y-3">
            <!-- Header -->
            <div class="flex items-start gap-3">
              <img
                v-if="entityData.imageUrl"
                :src="entityData.imageUrl"
                :alt="entityData.name"
                class="w-16 h-16 rounded-sm object-cover flex-shrink-0"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="font-bold text-ink text-base truncate">
                    {{ entityData.name }}
                  </h3>
                  <span
                    class="px-2 py-0.5 text-xs font-medium rounded-sm flex-shrink-0"
                    :class="typeClass"
                  >
                    {{ entityData.type }}
                  </span>
                </div>
                <p v-if="entityData.shortDescription" class="text-sm text-ink-3 line-clamp-2">
                  {{ entityData.shortDescription }}
                </p>
              </div>
            </div>

            <!-- Stats -->
            <div class="flex gap-4 text-xs text-ink-3 border-t border-rule-soft pt-3">
              <div>
                <span class="text-ink-4">Mentions:</span>
                <span class="ml-1 font-semibold text-ink">{{ entityData.stats.totalMentions }}</span>
              </div>
              <div v-if="entityData.stats.mentions7d > 0">
                <span class="text-ink-4">Last 7d:</span>
                <span class="ml-1 font-semibold text-ink">{{ entityData.stats.mentions7d }}</span>
              </div>
              <div v-if="entityData.stats.trendingScore > 0.1">
                <span class="text-orange-600 font-semibold">🔥 Trending</span>
              </div>
            </div>

            <!-- Recent Articles -->
            <div v-if="entityData.recentArticles && entityData.recentArticles.length > 0" class="border-t border-rule-soft pt-3">
              <p class="text-xs font-semibold text-ink-2 mb-2">Recent News:</p>
              <ul class="space-y-1.5">
                <li
                  v-for="article in entityData.recentArticles.slice(0, 3)"
                  :key="article.id"
                  class="text-xs text-ink-3 line-clamp-1"
                >
                  • {{ article.title }}
                </li>
              </ul>
            </div>

            <!-- View Full Link -->
            <div class="border-t border-rule-soft pt-3">
              <NuxtLink
                :to="`/${entityData.type}/${entityData.slug}`"
                class="text-sm text-accent hover:text-accent-ink font-medium"
              >
                View full profile →
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
interface EntityPreviewData {
  id: number
  type: string
  name: string
  slug: string
  shortDescription: string | null
  imageUrl: string | null
  wikiUrl: string | null
  stats: {
    totalMentions: number
    mentions7d: number
    mentions24h: number
    trendingScore: number
  }
  recentArticles: Array<{
    id: number
    title: string
    publishedAt: string
  }>
}

interface Props {
  entityId: number | null
  x: number
  y: number
  visible: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const cardRef = ref<HTMLElement | null>(null)
const entityData = ref<EntityPreviewData | null>(null)
const loading = ref(false)
const error = ref(false)
const isHovered = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

// Fetch entity preview data when entityId changes
watch(() => props.entityId, async (newId) => {
  if (!newId) {
    entityData.value = null
    return
  }

  loading.value = true
  error.value = false

  try {
    const response = await $fetch<EntityPreviewData>(`/api/entities/preview?id=${newId}`)
    entityData.value = response
  } catch (e) {
    console.error('Failed to fetch entity preview:', e)
    error.value = true
  } finally {
    loading.value = false
  }
})

// Position card near cursor
const cardStyle = computed(() => {
  const offsetX = 20
  const offsetY = 10

  return {
    left: `${props.x + offsetX}px`,
    top: `${props.y + offsetY}px`,
  }
})

// Type-specific styling
const typeClass = computed(() => {
  if (!entityData.value) return ''

  const typeClasses: Record<string, string> = {
    person: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
    organization: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
    location: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    event: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  }

  return typeClasses[entityData.value.type] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300'
})

function handleMouseEnter() {
  isHovered.value = true
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function handleMouseLeave() {
  isHovered.value = false
  hideTimer = setTimeout(() => {
    if (!isHovered.value) {
      emit('close')
    }
  }, 200)
}

// Cleanup on unmount
onUnmounted(() => {
  if (hideTimer) {
    clearTimeout(hideTimer)
  }
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
