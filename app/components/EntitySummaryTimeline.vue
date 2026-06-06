<template>
  <div v-if="historyCount > 0" class="bg-panel rounded-sm border border-rule p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold text-ink">Summary Evolution</h2>
      <button
        v-if="!showTimeline"
        class="text-sm text-accent hover:text-accent-ink font-medium"
        @click="loadTimeline"
      >
        View {{ historyCount }} previous {{ historyCount === 1 ? 'version' : 'versions' }}
      </button>
      <button
        v-else
        class="text-sm text-ink-3 hover:text-ink font-medium"
        @click="showTimeline = false"
      >
        Hide
      </button>
    </div>

    <div v-if="showTimeline">
      <div v-if="loading" class="py-4">
        <div class="animate-pulse space-y-4">
          <div v-for="i in 2" :key="i" class="flex gap-3">
            <div class="w-2 h-2 bg-paper-2 rounded-full mt-2 flex-shrink-0"></div>
            <div class="flex-1">
              <div class="h-3 bg-paper-2 rounded w-24 mb-2"></div>
              <div class="h-4 bg-paper-2 rounded w-full mb-2"></div>
              <div class="h-3 bg-paper-2 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="entries.length > 0" class="relative">
        <!-- Timeline line -->
        <div class="absolute left-[5px] top-2 bottom-2 w-px bg-rule"></div>

        <div class="space-y-5">
          <div
            v-for="entry in entries"
            :key="entry.id"
            class="relative pl-6"
          >
            <!-- Timeline dot -->
            <div class="absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full border-2 border-accent bg-panel"></div>

            <!-- Date -->
            <div class="text-xs text-ink-3 mb-1">
              {{ formatDate(entry.generatedAt) }}
            </div>

            <!-- Change note -->
            <p v-if="entry.changeNote" class="text-sm text-ink-2 leading-relaxed mb-2">
              {{ entry.changeNote }}
            </p>

            <!-- Metrics at that point -->
            <div class="flex gap-4 text-xs text-ink-3 mb-2">
              <span v-if="entry.mentionCount">{{ entry.mentionCount }} mentions</span>
              <span v-if="entry.trendingScore">Trending: {{ (entry.trendingScore * 100).toFixed(0) }}%</span>
            </div>

            <!-- Expandable old summary -->
            <button
              class="text-xs text-accent hover:text-accent-ink"
              @click="entry._expanded = !entry._expanded"
            >
              {{ entry._expanded ? 'Hide full summary' : 'Show full summary' }}
            </button>

            <div v-if="entry._expanded" class="mt-2 text-sm text-ink-3 bg-paper rounded p-3 leading-relaxed">
              <p v-if="entry.shortDescription" class="font-medium text-ink-2 mb-1">
                {{ entry.shortDescription }}
              </p>
              {{ entry.summary }}

              <!-- Article context -->
              <div v-if="entry.articleContext?.articleTitles?.length" class="mt-3 pt-3 border-t border-rule-soft">
                <div class="text-xs text-ink-3 mb-1">Based on articles:</div>
                <ul class="space-y-0.5">
                  <li
                    v-for="(title, idx) in entry.articleContext.articleTitles.slice(0, 3)"
                    :key="idx"
                    class="text-xs text-ink-3"
                  >
                    <NuxtLink
                      v-if="entry.articleContext.articleIds?.[idx]"
                      :to="`/articles/${entry.articleContext.articleIds[idx]}`"
                      class="text-accent hover:text-accent-ink"
                    >
                      {{ title }}
                    </NuxtLink>
                    <span v-else>{{ title }}</span>
                  </li>
                  <li v-if="entry.articleContext.articleTitles.length > 3" class="text-xs text-ink-3">
                    +{{ entry.articleContext.articleTitles.length - 3 }} more
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- Load more -->
        <div v-if="hasMore" class="mt-4 pl-6">
          <button
            class="text-sm text-accent hover:text-accent-ink font-medium"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading...' : 'Load more' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TimelineEntry {
  id: number
  changeNote: string | null
  summary: string | null
  shortDescription: string | null
  mentionCount: number | null
  trendingScore: number | null
  articleContext: { articleIds?: number[]; articleTitles?: string[]; dateRange?: { from: string | null; to: string | null } } | null
  generatedAt: string
  archivedAt: string
  _expanded?: boolean
}

const props = defineProps<{
  entityId: number
  historyCount: number
}>()

const showTimeline = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const entries = ref<TimelineEntry[]>([])
const hasMore = ref(false)
const offset = ref(0)
const LIMIT = 10

async function loadTimeline() {
  showTimeline.value = true
  loading.value = true
  offset.value = 0
  entries.value = []

  try {
    const data = await $fetch<any>(`/api/entities/${props.entityId}/timeline`, {
      query: { limit: LIMIT, offset: 0 }
    })
    entries.value = data.entries.map((e: TimelineEntry) => ({ ...e, _expanded: false }))
    hasMore.value = data.pagination.hasMore
    offset.value = LIMIT
  } catch (err) {
    console.error('Failed to load timeline:', err)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true

  try {
    const data = await $fetch<any>(`/api/entities/${props.entityId}/timeline`, {
      query: { limit: LIMIT, offset: offset.value }
    })
    entries.value.push(...data.entries.map((e: TimelineEntry) => ({ ...e, _expanded: false })))
    hasMore.value = data.pagination.hasMore
    offset.value += LIMIT
  } catch (err) {
    console.error('Failed to load more timeline:', err)
  } finally {
    loadingMore.value = false
  }
}

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
</script>
