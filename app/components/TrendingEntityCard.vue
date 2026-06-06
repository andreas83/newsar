<template>
  <div
    class="group flex flex-col border border-rule bg-panel overflow-hidden cursor-pointer hover:border-accent transition-all"
    @click="$emit('click')"
  >
    <!-- Image -->
    <div class="relative w-full h-44 overflow-hidden bg-paper-2">
      <img
        v-if="imageUrl"
        :src="imageUrl"
        :alt="name"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
      <div v-else class="w-full h-full flex items-center justify-center" :style="{ background: placeholderGradient }">
        <Icon :name="icon" class="w-16 h-16 text-white/90" />
      </div>

      <!-- Velocity Badge -->
      <div
        v-if="velocity !== undefined && velocity !== 0"
        class="absolute top-2 right-2 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm"
        :class="velocity > 0 ? 'bg-intel-green/90' : 'bg-intel-red/90'"
      >
        <Icon :name="velocityIcon" class="w-3 h-3" />
        <span>{{ formatVelocity(velocity) }}</span>
      </div>
    </div>

    <!-- Content -->
    <div class="flex flex-col gap-2.5 p-4 flex-1">
      <div class="flex flex-col gap-1.5">
        <Badge :color="badgeColor" size="sm">{{ type }}</Badge>
        <h3 class="text-lg font-bold text-ink leading-snug line-clamp-2">{{ name }}</h3>
      </div>

      <!-- Trending Score -->
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-1">
          <Icon name="i-heroicons-fire" class="w-3 h-3 text-intel-red" />
          <span class="text-xs text-ink-3">Trending</span>
        </div>
        <div class="h-1 bg-paper-2 overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-intel-red to-red-500 transition-[width] duration-300"
            :style="{ width: trendingPercent + '%' }"
          />
        </div>
        <span class="text-xs font-semibold text-ink-2 self-end font-mono">{{ trendingPercent }}%</span>
      </div>

      <!-- Stats -->
      <div class="flex items-center gap-1.5 pt-2 border-t border-rule-soft text-ink-3">
        <Icon name="i-heroicons-newspaper" class="w-3.5 h-3.5 text-ink-4" />
        <span class="text-[13px]">{{ mentionCount }} mentions</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  name: string
  type: string
  imageUrl: string | null
  trendingScore: number
  mentionCount: number
  velocity?: number
  badgeColor: 'blue' | 'green' | 'orange' | 'purple' | 'teal'
  icon: string
}>()

defineEmits<{
  click: []
}>()

const placeholderGradient = computed(() => {
  const gradients: Record<string, string> = {
    person: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    organization: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
    location: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    event: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
    topic: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
  }
  return gradients[props.type] || gradients.person
})

const trendingPercent = computed(() => {
  return Math.min(Math.round(props.trendingScore * 100), 100)
})

const velocityIcon = computed(() => {
  if (!props.velocity) return 'i-heroicons-minus'
  return props.velocity > 0 ? 'i-heroicons-arrow-trending-up' : 'i-heroicons-arrow-trending-down'
})

function formatVelocity(velocity: number): string {
  const abs = Math.abs(velocity)
  if (abs < 1) return '—'
  return velocity > 0 ? `+${abs.toFixed(0)}%` : `${velocity.toFixed(0)}%`
}
</script>
