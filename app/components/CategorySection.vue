<template>
  <section v-if="stories.length > 0">
    <!-- Category header — newspaper section divider -->
    <div class="intel-sect-head">
      <Icon :name="icon" class="w-4 h-4 text-ink-3" />
      <h2 class="sect-title">{{ displayName }}</h2>
      <span class="sect-tag">{{ stories.length }} stories</span>
    </div>

    <!-- Lead story (first) + secondary stories (rest) -->
    <div class="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-5">
      <!-- Lead story with image -->
      <NuxtLink
        :to="`/stories/${stories[0].id}`"
        class="group"
      >
        <div class="relative aspect-[16/10] overflow-hidden bg-paper-2 mb-3">
          <img
            v-if="stories[0].imageLocalPath || stories[0].imageUrl"
            :src="stories[0].imageLocalPath || stories[0].imageUrl"
            :alt="stories[0].title || ''"
            class="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            @error="($event.target as HTMLElement)?.style.setProperty('display', 'none')"
          />
          <div v-else class="w-full h-full flex items-center justify-center">
            <Icon name="i-heroicons-newspaper" class="w-10 h-10 text-ink-4 opacity-30" />
          </div>
          <div class="img-caption">
            <span>{{ stories[0].articleCount }} articles</span>
            <span>{{ formatTime(stories[0].lastUpdated) }}</span>
          </div>
        </div>
        <h3 class="font-serif text-xl font-bold text-ink leading-snug mb-2 group-hover:text-accent transition-colors line-clamp-3">
          {{ stories[0].title }}
        </h3>
        <div v-if="stories[0].entities?.length" class="flex flex-wrap gap-1 mb-1">
          <span
            v-for="entity in stories[0].entities.slice(0, 3)"
            :key="entity.id"
            class="intel-chip"
          >
            {{ entity.name }}
          </span>
        </div>
      </NuxtLink>

      <!-- Secondary stories — text list -->
      <div v-if="stories.length > 1" class="flex flex-col divide-y divide-rule-soft">
        <NuxtLink
          v-for="story in stories.slice(1)"
          :key="story.id"
          :to="`/stories/${story.id}`"
          class="group flex gap-3 py-3 first:pt-0"
        >
          <!-- Small thumbnail -->
          <div v-if="story.imageLocalPath || story.imageUrl" class="flex-shrink-0 w-20 h-16 overflow-hidden bg-paper-2">
            <img
              :src="story.imageLocalPath || story.imageUrl"
              :alt="story.title || ''"
              class="w-full h-full object-cover"
              @error="($event.target as HTMLElement)?.parentElement?.style.setProperty('display', 'none')"
            />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold text-ink leading-snug group-hover:text-accent transition-colors line-clamp-2 mb-1">
              {{ story.title }}
            </h4>
            <div class="flex items-center gap-2 text-[11px] text-ink-4 font-mono tracking-wider">
              <span>{{ story.articleCount }} articles</span>
              <span class="sep-dot" />
              <span>{{ formatTime(story.lastUpdated) }}</span>
            </div>
          </div>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
interface Props {
  displayName: string
  icon: string
  stories: Array<{
    id: number
    title: string | null
    status: string | null
    articleCount: number
    imageUrl: string | null
    imageLocalPath: string | null
    entities: Array<{ id: number; name: string; type: string; slug: string | null }>
    lastUpdated: string | Date | null
  }>
}

defineProps<Props>()

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
