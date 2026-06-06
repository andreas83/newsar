<script setup lang="ts">
interface Bubble {
  keyword: string
  category: string
  count: number
  size: number
  relevance: number
}

const { data: trendingData } = await useFetch<{ bubbles: Bubble[]; timestamp: string }>('/api/trending', {
  query: { limit: 30 }
})

const bubbles = computed(() => trendingData.value?.bubbles || [])

// Get color based on category
function getCategoryColor(category: string) {
  const colors: Record<string, string> = {
    'entity': 'bg-blue-500 hover:bg-blue-600',
    'event': 'bg-red-500 hover:bg-red-600',
    'topic': 'bg-purple-500 hover:bg-purple-600',
    'general': 'bg-green-500 hover:bg-green-600',
    'technology': 'bg-indigo-500 hover:bg-indigo-600',
    'location': 'bg-orange-500 hover:bg-orange-600',
    'geographic region': 'bg-orange-400 hover:bg-orange-500',
    'sport': 'bg-yellow-500 hover:bg-yellow-600',
    'concept': 'bg-teal-500 hover:bg-teal-600',
    'action': 'bg-pink-500 hover:bg-pink-600',
    'law': 'bg-slate-600 hover:bg-slate-700',
    'project': 'bg-cyan-500 hover:bg-cyan-600',
  }
  return colors[category] || 'bg-gray-500 hover:bg-gray-600'
}

// Calculate size in rem units
function getBubbleSize(size: number) {
  const minSize = 3 // rem
  const maxSize = 8 // rem
  const range = maxSize - minSize
  return minSize + (size / 10) * range
}

// Handle bubble click - search for keyword
function handleBubbleClick(keyword: string) {
  navigateTo(`/search?q=${encodeURIComponent(keyword)}`)
}
</script>

<template>
  <div class="relative w-full py-8 px-4 bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 rounded-xl overflow-hidden">
    <div class="text-center mb-6">
      <h2 class="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2 flex items-center justify-center gap-2">
        <Icon name="i-heroicons-sparkles" class="w-6 h-6 text-yellow-500" />
        Trending Topics
      </h2>
      <p class="text-sm text-gray-600 dark:text-slate-400">
        Click a bubble to explore articles about that topic
      </p>
    </div>

    <!-- Bubbles Container -->
    <div
      v-if="bubbles.length"
      class="flex flex-wrap items-center justify-center gap-3 min-h-[300px] p-4"
    >
      <button
        v-for="(bubble, index) in bubbles"
        :key="`${bubble.keyword}-${index}`"
        :class="[
          'rounded-full shadow-lg transition-all duration-300 flex items-center justify-center text-white font-semibold cursor-pointer hover:scale-110 hover:shadow-xl',
          getCategoryColor(bubble.category)
        ]"
        :style="{
          width: `${getBubbleSize(bubble.size)}rem`,
          height: `${getBubbleSize(bubble.size)}rem`,
          fontSize: `${Math.max(0.7, bubble.size / 12)}rem`,
          animationDelay: `${index * 0.05}s`
        }"
        :title="`${bubble.keyword} - ${bubble.count} articles (${Math.round(bubble.relevance * 100)}% relevance)`"
        @click="handleBubbleClick(bubble.keyword)"
        class="animate-float"
      >
        <span class="text-center px-2 leading-tight">
          {{ bubble.keyword }}
        </span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-else class="flex items-center justify-center min-h-[300px]">
      <div class="text-center text-gray-500 dark:text-slate-400">
        <Icon name="i-heroicons-arrow-path" class="w-8 h-8 mx-auto mb-2 animate-spin" />
        <p>Loading trending topics...</p>
      </div>
    </div>

    <!-- Legend -->
    <div v-if="bubbles.length" class="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs">
      <div class="flex items-center gap-1">
        <div class="w-3 h-3 rounded-full bg-blue-500"></div>
        <span class="text-gray-600 dark:text-slate-400">People & Orgs</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-3 h-3 rounded-full bg-red-500"></div>
        <span class="text-gray-600 dark:text-slate-400">Events</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-3 h-3 rounded-full bg-purple-500"></div>
        <span class="text-gray-600 dark:text-slate-400">Topics</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-3 h-3 rounded-full bg-green-500"></div>
        <span class="text-gray-600 dark:text-slate-400">General</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-3 h-3 rounded-full bg-orange-500"></div>
        <span class="text-gray-600 dark:text-slate-400">Locations</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-3 h-3 rounded-full bg-gray-500"></div>
        <span class="text-gray-600 dark:text-slate-400">Other</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
}

.animate-float {
  animation: float 3s ease-in-out infinite;
}
</style>
