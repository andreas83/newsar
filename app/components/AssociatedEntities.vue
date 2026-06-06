<template>
  <div v-if="associatedEntities && associatedEntities.length > 0" class="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
    <div class="flex items-center gap-2 mb-4">
      <Icon :name="sectionIcon" class="w-5 h-5" :class="iconColorClass" />
      <h2 class="text-xl font-bold text-gray-900 dark:text-slate-100">{{ sectionTitle }}</h2>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <NuxtLink
        v-for="entity in associatedEntities"
        :key="entity.id"
        :to="`/${entity.type}/${entity.slug}`"
        class="associated-entity-card"
      >
        <div class="flex items-center gap-3">
          <!-- Mini portrait -->
          <div class="flex-shrink-0">
            <img
              v-if="entity.imageUrl"
              :src="entity.imageUrl"
              :alt="entity.name"
              class="w-10 h-10 rounded-lg object-cover border border-gray-200 dark:border-slate-700"
              @error="handleImageError($event)"
            />
            <div
              class="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold text-white"
              :style="{ background: getAvatarGradient(entity.name), display: entity.imageUrl ? 'none' : 'flex' }"
            >
              {{ getInitials(entity.name) }}
            </div>
          </div>

          <!-- Entity info -->
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-900 dark:text-slate-100 truncate text-sm">
              {{ entity.name }}
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              <span>{{ entity.coOccurrenceCount }} shared articles</span>
              <span v-if="entity.trendingScore > 0.1" class="text-orange-600 font-medium">
                Trending
              </span>
            </div>
          </div>

          <!-- Arrow -->
          <Icon name="i-heroicons-chevron-right" class="w-4 h-4 text-gray-400 dark:text-slate-500 flex-shrink-0" />
        </div>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
interface AssociatedEntity {
  id: number
  type: string
  name: string
  slug: string
  coOccurrenceCount: number
  avgSentiment: number
  shortDescription: string | null
  imageUrl: string | null
  trendingScore: number
}

interface Props {
  entityId: number
  relatedType: 'person' | 'organization'
  limit?: number
}

const props = withDefaults(defineProps<Props>(), {
  limit: 10,
})

const associatedEntities = ref<AssociatedEntity[] | null>(null)

const sectionTitle = computed(() => {
  return props.relatedType === 'person' ? 'Key People' : 'Associated Organizations'
})

const sectionIcon = computed(() => {
  return props.relatedType === 'person' ? 'i-heroicons-users' : 'i-heroicons-building-office-2'
})

const iconColorClass = computed(() => {
  return props.relatedType === 'person' ? 'text-blue-500' : 'text-green-500'
})

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return (name[0] || '?').toUpperCase()
}

function handleImageError(event: Event) {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
  const sibling = img.nextElementSibling as HTMLElement | null
  if (sibling) sibling.style.display = 'flex'
}

function getAvatarGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const hue1 = Math.abs(hash % 360)
  const hue2 = (hue1 + 40) % 360
  return `linear-gradient(135deg, hsl(${hue1}, 55%, 45%) 0%, hsl(${hue2}, 55%, 35%) 100%)`
}

onMounted(async () => {
  try {
    const response = await $fetch<{ relationships: AssociatedEntity[] }>('/api/entities/relationships', {
      query: {
        entityId: props.entityId,
        relatedType: props.relatedType,
        limit: props.limit,
      },
    })
    if (response.relationships && response.relationships.length > 0) {
      associatedEntities.value = response.relationships
    }
  } catch {
    // Non-critical, fail silently
  }
})
</script>

<style scoped>
.associated-entity-card {
  display: block;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  transition: all 0.15s ease;
}

:root.dark .associated-entity-card {
  border-color: #334155;
}

.associated-entity-card:hover {
  background: #f9fafb;
  border-color: #d1d5db;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

:root.dark .associated-entity-card:hover {
  background: #1e293b;
  border-color: #475569;
}
</style>
