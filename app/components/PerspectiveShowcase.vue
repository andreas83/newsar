<template>
  <section v-if="story && (story.leftArticle || story.centerArticle || story.rightArticle)">
    <!-- Section header -->
    <div class="intel-sect-head">
      <Icon name="i-heroicons-scale" class="w-4 h-4 text-ink-3" />
      <h2 class="sect-title">Perspective Analysis</h2>
      <span class="sect-tag">L / C / R</span>
    </div>

    <!-- Story context -->
    <p class="text-sm text-ink-3 mb-4">
      {{ story.title }}
    </p>

    <!-- Three columns -->
    <div class="grid grid-cols-1 md:grid-cols-3 border border-rule bg-panel">
      <!-- Left perspective -->
      <div class="p-5 border-b md:border-b-0 md:border-r border-rule">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-2.5 h-2.5 bg-blue-500" />
          <span class="font-mono text-[10px] font-semibold tracking-widest uppercase text-blue-600">Left</span>
          <span class="font-mono text-[10px] text-ink-4">({{ story.leftCount }})</span>
        </div>
        <div v-if="story.leftArticle" class="space-y-2">
          <NuxtLink :to="`/articles/${story.leftArticle.id}`" class="block">
            <h4 class="font-semibold text-ink text-sm leading-snug hover:text-accent transition-colors line-clamp-3">
              {{ story.leftArticle.title }}
            </h4>
          </NuxtLink>
          <p class="font-mono text-[10px] text-ink-4 tracking-wider uppercase">{{ story.leftArticle.feedName }}</p>
          <p v-if="story.leftArticle.excerpt" class="text-xs text-ink-3 line-clamp-4 leading-relaxed">
            {{ story.leftArticle.excerpt }}
          </p>
        </div>
        <div v-else class="text-xs text-ink-4 italic">No article available</div>
      </div>

      <!-- Center perspective -->
      <div class="p-5 border-b md:border-b-0 md:border-r border-rule">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-2.5 h-2.5 bg-ink-4" />
          <span class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-3">Center</span>
          <span class="font-mono text-[10px] text-ink-4">({{ story.centerCount }})</span>
        </div>
        <div v-if="story.centerArticle" class="space-y-2">
          <NuxtLink :to="`/articles/${story.centerArticle.id}`" class="block">
            <h4 class="font-semibold text-ink text-sm leading-snug hover:text-accent transition-colors line-clamp-3">
              {{ story.centerArticle.title }}
            </h4>
          </NuxtLink>
          <p class="font-mono text-[10px] text-ink-4 tracking-wider uppercase">{{ story.centerArticle.feedName }}</p>
          <p v-if="story.centerArticle.excerpt" class="text-xs text-ink-3 line-clamp-4 leading-relaxed">
            {{ story.centerArticle.excerpt }}
          </p>
        </div>
        <div v-else class="text-xs text-ink-4 italic">No article available</div>
      </div>

      <!-- Right perspective -->
      <div class="p-5">
        <div class="flex items-center gap-2 mb-3">
          <div class="w-2.5 h-2.5 bg-red-500" />
          <span class="font-mono text-[10px] font-semibold tracking-widest uppercase text-red-600">Right</span>
          <span class="font-mono text-[10px] text-ink-4">({{ story.rightCount }})</span>
        </div>
        <div v-if="story.rightArticle" class="space-y-2">
          <NuxtLink :to="`/articles/${story.rightArticle.id}`" class="block">
            <h4 class="font-semibold text-ink text-sm leading-snug hover:text-accent transition-colors line-clamp-3">
              {{ story.rightArticle.title }}
            </h4>
          </NuxtLink>
          <p class="font-mono text-[10px] text-ink-4 tracking-wider uppercase">{{ story.rightArticle.feedName }}</p>
          <p v-if="story.rightArticle.excerpt" class="text-xs text-ink-3 line-clamp-4 leading-relaxed">
            {{ story.rightArticle.excerpt }}
          </p>
        </div>
        <div v-else class="text-xs text-ink-4 italic">No article available</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="border border-t-0 border-rule bg-paper-2 px-5 py-3 flex items-center justify-between">
      <span class="font-mono text-[10px] text-ink-4 tracking-wider uppercase">
        {{ story.leftCount + story.centerCount + story.rightCount }} articles across the spectrum
      </span>
      <NuxtLink
        :to="`/stories/${story.id}`"
        class="font-mono text-[11px] font-semibold tracking-wider uppercase text-accent hover:text-accent-ink transition-colors flex items-center gap-1.5"
      >
        Compare Full Coverage
        <Icon name="i-heroicons-arrow-right" class="w-3.5 h-3.5" />
      </NuxtLink>
    </div>
  </section>
</template>

<script setup lang="ts">
interface PerspectiveArticle {
  id: number
  title: string
  feedName: string
  excerpt: string
  politicalBias: number
}

interface Props {
  story: {
    id: number
    title: string | null
    description: string | null
    leftArticle: PerspectiveArticle | null
    centerArticle: PerspectiveArticle | null
    rightArticle: PerspectiveArticle | null
    leftCount: number
    centerCount: number
    rightCount: number
  }
}

defineProps<Props>()
</script>
