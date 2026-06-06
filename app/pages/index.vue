<script setup lang="ts">
const { selectedLanguage } = useLanguage()

const { data: frontpage, refresh } = await useFetch('/api/frontpage', {
  query: { language: selectedLanguage },
})

watch(selectedLanguage, () => refresh())

function getStatusColor(status: string) {
  switch (status) {
    case 'emerging': return 'blue'
    case 'trending': return 'red'
    case 'active': return 'green'
    case 'declining': return 'gray'
    default: return 'gray'
  }
}

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

function getBiasLabel(bias: number | null) {
  if (bias === null) return null
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
}

function getBiasColor(bias: number | null) {
  if (bias === null) return 'gray'
  if (bias <= -0.6) return 'blue'
  if (bias <= -0.2) return 'sky'
  if (bias < 0.2) return 'gray'
  if (bias < 0.6) return 'orange'
  return 'red'
}

const now = new Date()
const dateStr = now.toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
</script>

<template>
  <div>
    <!-- ═══ DATE LINE ═══ -->
    <div class="border-b border-rule">
      <Container>
        <div class="flex items-center justify-between py-2">
          <span class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-4">
            {{ dateStr }}
          </span>
          <span class="font-mono text-[10px] tracking-widest text-ink-4 uppercase hidden sm:block">
            Multi-Perspective Intelligence
          </span>
        </div>
      </Container>
    </div>

    <!-- ═══ LEAD STORY ═══ -->
    <section class="py-6">
      <Container>
        <FeaturedStoryHero v-if="frontpage?.heroStory" :story="frontpage.heroStory" />

        <!-- Fallback when no hero story -->
        <div v-else class="border border-rule bg-[#0C0A09] px-8 py-12 lg:px-14">
          <div class="text-kicker text-[#A7A08C] mb-3">Intelligence Brief</div>
          <h1 class="font-serif text-3xl lg:text-4xl font-bold text-[#F0EBDB] mb-3">News from Multiple Perspectives</h1>
          <p class="text-[15px] text-[#8A8475] mb-6 max-w-xl">AI-powered news aggregation showing different viewpoints on the same stories.</p>
          <div class="flex gap-3">
            <Button to="/stories" size="lg" label="Explore Stories" icon="i-heroicons-rectangle-group" />
            <Button to="/about" size="lg" color="gray" label="Learn More" icon="i-heroicons-information-circle" />
          </div>
        </div>
      </Container>
    </section>

    <!-- ═══ SITUATION ROOM: Categories + Trending Wire ═══ -->
    <section class="pb-8">
      <Container>
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          <!-- Category columns -->
          <div class="space-y-10">
            <CategorySection
              v-for="cat in frontpage?.categoryStories"
              :key="cat.category"
              :display-name="cat.displayName"
              :icon="cat.icon"
              :stories="cat.stories"
            />

            <!-- Fallback when no categories -->
            <div v-if="!frontpage?.categoryStories?.length" class="text-center py-16 text-ink-3">
              <Icon name="i-heroicons-newspaper" class="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p class="font-serif text-lg">Stories are being processed</p>
              <p class="text-sm text-ink-4 mt-1">Check back soon for categorized coverage.</p>
            </div>
          </div>

          <!-- Trending Wire sidebar -->
          <div class="hidden lg:block">
            <div v-if="frontpage?.trendingStories?.length" class="sticky top-[84px]">
              <!-- Wire header -->
              <div class="flex items-center gap-2 pb-2.5 border-b border-ink mb-0">
                <Icon name="i-heroicons-bolt" class="w-3.5 h-3.5 text-intel-red" />
                <span class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-2">Wire</span>
              </div>

              <!-- Wire items -->
              <div class="divide-y divide-rule-soft">
                <NuxtLink
                  v-for="(story, i) in frontpage.trendingStories"
                  :key="story.id"
                  :to="`/stories/${story.id}`"
                  class="group block py-3"
                >
                  <div class="flex gap-2.5">
                    <span class="font-mono text-[11px] font-bold text-ink-4 leading-snug mt-0.5 shrink-0">{{ String(i + 1).padStart(2, '0') }}</span>
                    <div class="min-w-0">
                      <h4 class="text-[13px] font-semibold text-ink leading-snug group-hover:text-accent transition-colors line-clamp-2 mb-1">
                        {{ story.title }}
                      </h4>
                      <div class="flex items-center gap-2 text-[10px] text-ink-4 font-mono tracking-wider">
                        <span>{{ story.articleCount }} art</span>
                        <span class="sep-dot" />
                        <span>{{ formatTime(story.lastUpdated) }}</span>
                        <Badge v-if="story.status === 'trending'" color="red" size="xs">live</Badge>
                      </div>
                    </div>
                  </div>
                </NuxtLink>
              </div>

              <!-- View all -->
              <NuxtLink
                to="/stories"
                class="flex items-center justify-center gap-1.5 py-3 mt-1 border-t border-rule font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-3 hover:text-accent transition-colors"
              >
                All Stories
                <Icon name="i-heroicons-arrow-right" class="w-3 h-3" />
              </NuxtLink>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- ═══ LATEST INTEL ═══ -->
    <section v-if="frontpage?.recentArticles?.length" class="pb-8">
      <Container>
        <div class="intel-sect-head">
          <Icon name="i-heroicons-clock" class="w-4 h-4 text-ink-3" />
          <h2 class="sect-title">Latest Intel</h2>
          <span class="sect-tag">{{ frontpage.recentArticles.length }} articles</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-rule border border-rule">
          <NuxtLink
            v-for="article in frontpage.recentArticles"
            :key="article.id"
            :to="`/articles/${article.id}`"
            class="group flex gap-3 p-4 bg-panel hover:bg-paper-2 transition-colors"
          >
            <!-- Thumbnail -->
            <div v-if="article.imageLocalPath || article.imageUrl" class="flex-shrink-0">
              <img
                :src="article.imageLocalPath || article.imageUrl"
                :alt="article.title"
                class="w-20 h-16 object-cover"
                @error="($event.target as HTMLElement)?.style.setProperty('display', 'none')"
              />
            </div>

            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-[13px] text-ink leading-snug line-clamp-2 group-hover:text-accent transition-colors mb-1.5">
                {{ article.title }}
              </h3>
              <div class="flex items-center gap-2 text-[10px] text-ink-4 font-mono tracking-wider">
                <span class="truncate">{{ article.feedName }}</span>
                <Badge
                  v-if="getBiasLabel(article.politicalBias ?? article.feedBias)"
                  :color="getBiasColor(article.politicalBias ?? article.feedBias)"
                  size="xs"
                >
                  {{ getBiasLabel(article.politicalBias ?? article.feedBias) }}
                </Badge>
              </div>
              <div class="text-[10px] text-ink-4 font-mono tracking-wider mt-1">
                {{ formatTime(article.publishedAt) }}
              </div>
            </div>
          </NuxtLink>
        </div>
      </Container>
    </section>

    <!-- ═══ PERSPECTIVE ANALYSIS ═══ -->
    <section v-if="frontpage?.perspectiveStory" class="pb-8">
      <Container>
        <PerspectiveShowcase :story="frontpage.perspectiveStory" />
      </Container>
    </section>

    <!-- ═══ TRENDING ENTITIES ═══ -->
    <section v-if="frontpage?.trendingEntities?.length" class="pb-8">
      <Container>
        <TrendingEntitiesRail :entities="frontpage.trendingEntities" />
      </Container>
    </section>

    <!-- ═══ MOBILE TRENDING (hidden on desktop, shows below categories) ═══ -->
    <section v-if="frontpage?.trendingStories?.length" class="pb-8 lg:hidden">
      <Container>
        <div class="intel-sect-head">
          <Icon name="i-heroicons-bolt" class="w-4 h-4 text-intel-red" />
          <h2 class="sect-title">Trending</h2>
        </div>
        <div class="divide-y divide-rule-soft border border-rule bg-panel">
          <NuxtLink
            v-for="story in frontpage.trendingStories"
            :key="story.id"
            :to="`/stories/${story.id}`"
            class="group flex items-center gap-3 px-4 py-3 hover:bg-paper-2 transition-colors"
          >
            <div class="min-w-0 flex-1">
              <h4 class="text-sm font-semibold text-ink group-hover:text-accent transition-colors line-clamp-1">
                {{ story.title }}
              </h4>
              <div class="flex items-center gap-2 text-[10px] text-ink-4 font-mono tracking-wider mt-0.5">
                <span>{{ story.articleCount }} articles</span>
                <span class="sep-dot" />
                <span>{{ formatTime(story.lastUpdated) }}</span>
              </div>
            </div>
            <Icon name="i-heroicons-chevron-right" class="w-4 h-4 text-ink-4 shrink-0" />
          </NuxtLink>
        </div>
      </Container>
    </section>
  </div>
</template>
