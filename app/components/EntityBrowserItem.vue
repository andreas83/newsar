<template>
  <NuxtLink
    :to="`/${entity.type}/${entity.slug}`"
    class="group flex items-center gap-3.5 px-4 py-3 bg-panel border border-rule hover:border-accent hover:bg-paper-2 transition-colors"
  >
    <!-- Type Icon / Avatar -->
    <div
      class="flex-shrink-0 w-10 h-10 flex items-center justify-center overflow-hidden"
      :style="{ background: avatarGradient }"
    >
      <img
        v-if="entity.imageUrl"
        :src="entity.imageUrl"
        :alt="entity.name"
        class="w-full h-full object-cover"
      />
      <Icon v-else :name="typeIcon" class="w-5 h-5 text-white" />
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="text-[15px] font-semibold text-ink truncate group-hover:text-accent transition-colors">{{ entity.name }}</span>
        <span
          v-if="entity.subtype"
          class="flex-shrink-0 px-1.5 py-px text-[10px] font-semibold rounded-sm"
          :class="getSubtypeClasses(entity.subtype)"
        >{{ getSubtypeLabel(entity.subtype) }}</span>
        <Icon
          v-if="entity.trendingScore > 0.1"
          name="i-heroicons-fire"
          class="flex-shrink-0 w-3.5 h-3.5 text-intel-red"
        />
      </div>
      <p class="text-[13px] text-ink-3 mt-0.5 truncate">
        {{ entity.shortDescription || `${entity.mentionCount} article mention${entity.mentionCount !== 1 ? 's' : ''}` }}
      </p>
    </div>

    <!-- Mention Count Badge -->
    <div v-if="entity.mentionCount > 0" class="hidden sm:flex flex-shrink-0 items-center gap-1 px-2.5 py-1 bg-paper-2 border border-rule-soft text-xs font-semibold text-ink-3 font-mono">
      <Icon name="i-heroicons-newspaper" class="w-3.5 h-3.5" />
      <span>{{ formatCount(entity.mentionCount) }}</span>
    </div>

    <!-- Arrow -->
    <Icon name="i-heroicons-chevron-right" class="flex-shrink-0 w-4 h-4 text-ink-4 group-hover:text-accent transition-colors" />
  </NuxtLink>
</template>

<script setup lang="ts">
interface BrowseEntity {
  id: number
  type: string
  subtype?: string | null
  name: string
  slug: string | null
  shortDescription: string | null
  imageUrl: string | null
  mentionCount: number
  trendingScore: number
}

const { getSubtypeLabel, getSubtypeClasses } = useEntitySubtypes()

const props = defineProps<{
  entity: BrowseEntity
}>()

const typeIcons: Record<string, string> = {
  person: 'i-heroicons-user',
  organization: 'i-heroicons-building-office',
  location: 'i-heroicons-map-pin',
  event: 'i-heroicons-calendar',
  topic: 'i-heroicons-light-bulb',
}

const typeIcon = computed(() => typeIcons[props.entity.type] || 'i-heroicons-cube')

const avatarGradient = computed(() => {
  const gradients: Record<string, string> = {
    person: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    organization: 'linear-gradient(135deg, #10b981, #047857)',
    location: 'linear-gradient(135deg, #f59e0b, #d97706)',
    event: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    topic: 'linear-gradient(135deg, #14b8a6, #0d9488)',
  }
  return gradients[props.entity.type] || gradients.person
})

function formatCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toString()
}
</script>
