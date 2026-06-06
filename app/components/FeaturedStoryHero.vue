<template>
  <NuxtLink v-if="story" :to="`/stories/${story.id}`" class="group block">
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_1fr] border border-rule overflow-hidden bg-panel">
      <!-- Image -->
      <div class="relative aspect-[16/10] lg:aspect-auto overflow-hidden bg-[#1E1810]">
        <img
          v-if="story.imageLocalPath || story.imageUrl"
          :src="story.imageLocalPath || story.imageUrl"
          :alt="story.title || ''"
          class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
          @error="($event.target as HTMLElement)?.style.setProperty('display', 'none')"
        />
        <div v-else class="w-full h-full flex items-center justify-center">
          <span class="font-mono text-sm tracking-[0.2em] text-ink-4 uppercase">Newsar Intel</span>
        </div>
        <!-- Overlay caption -->
        <div class="img-caption">
          <span v-if="story.status" class="uppercase">{{ story.status }}</span>
          <span>{{ formatTime(story.lastUpdated) }}</span>
        </div>
      </div>

      <!-- Content -->
      <div class="flex flex-col p-6 lg:p-8">
        <!-- Kicker -->
        <div class="text-kicker flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full animate-pulse" :class="{
            'bg-intel-red': story.status === 'trending',
            'bg-intel-blue': story.status === 'emerging',
            'bg-intel-green': story.status === 'active',
          }" />
          Lead Story
        </div>

        <!-- Headline -->
        <h2 class="font-serif text-2xl sm:text-3xl lg:text-[34px] font-bold text-ink leading-tight mb-3 group-hover:text-accent transition-colors">
          {{ story.title }}
        </h2>

        <!-- Description -->
        <p v-if="story.description" class="text-[15px] text-ink-3 leading-relaxed mb-4 line-clamp-3">
          {{ story.description }}
        </p>

        <!-- Entities -->
        <div v-if="story.entities?.length" class="flex flex-wrap gap-1.5 mb-4">
          <span
            v-for="entity in story.entities.slice(0, 5)"
            :key="entity.id"
            class="intel-chip"
          >
            {{ entity.name }}
          </span>
        </div>

        <!-- Spacer -->
        <div class="flex-1" />

        <!-- Stats + coverage bar -->
        <div class="border-t border-rule-soft pt-4 mt-auto">
          <div class="flex items-center gap-5 text-xs text-ink-3 font-mono tracking-wider mb-3">
            <span>{{ story.articleCount }} ARTICLES</span>
            <span class="sep-dot" />
            <span>{{ story.sourceCount }} SOURCES</span>
            <span v-if="story.trendingScore" class="sep-dot" />
            <span v-if="story.trendingScore" class="text-intel-red">TRENDING {{ (story.trendingScore * 100).toFixed(0) }}%</span>
          </div>

          <!-- Coverage diversity bar -->
          <div v-if="totalCoverage > 0" class="flex items-center gap-3">
            <div class="flex h-1 flex-1 overflow-hidden bg-paper-2">
              <div
                v-if="story.leftCount"
                class="bg-blue-500"
                :style="{ width: `${(story.leftCount / totalCoverage) * 100}%` }"
              />
              <div
                v-if="story.centerCount"
                class="bg-ink-4"
                :style="{ width: `${(story.centerCount / totalCoverage) * 100}%` }"
              />
              <div
                v-if="story.rightCount"
                class="bg-red-500"
                :style="{ width: `${(story.rightCount / totalCoverage) * 100}%` }"
              />
            </div>
            <span class="font-mono text-[10px] text-ink-4 tracking-wider whitespace-nowrap">L / C / R</span>
          </div>
        </div>
      </div>
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
interface Props {
  story: {
    id: number
    title: string | null
    description: string | null
    status: string | null
    articleCount: number
    sourceCount: number
    leftCount: number
    centerCount: number
    rightCount: number
    entities: Array<{ id: number; name: string; type: string; slug: string | null }>
    imageUrl: string | null
    imageLocalPath: string | null
    trendingScore: number | null
    lastUpdated: string | Date | null
  }
}

const props = defineProps<Props>()

const totalCoverage = computed(() =>
  (props.story.leftCount || 0) + (props.story.centerCount || 0) + (props.story.rightCount || 0)
)

function formatTime(date: string | Date | null) {
  if (!date) return ''
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>
