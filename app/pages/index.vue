<script setup lang="ts">
const { selectedLanguage } = useLanguage()

const { data: frontpage, refresh } = await useFetch('/api/frontpage', {
  query: { language: selectedLanguage },
})

watch(selectedLanguage, () => refresh())

const dateStr = new Date().toLocaleDateString('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

const outletById = computed(() => new Map((frontpage.value?.coverageMatrix.outlets || []).map(o => [o.id, o])))

// Max mentions in the "In the news" list, for bar lengths
const newsMax = computed(() => Math.max(1, ...(frontpage.value?.inTheNews || []).map(e => e.recent)))

function entityPath(e: { type: string; slug: string | null }) {
  return `/${e.type}/${e.slug}`
}

function initials(name: string) {
  return name.split(/\s+/).filter(w => /^\p{Lu}/u.test(w)).slice(0, 2).map(w => w[0]).join('')
}

function trendWord(recent: number, previous: number) {
  if (previous === 0) return 'new'
  const change = (recent - previous) / previous
  if (change >= 0.25) return 'up'
  if (change <= -0.25) return 'down'
  return null
}

// "5h ago" / "Oct 22" for story meta lines
function updatedText(date: string | Date | null) {
  const t = formatTime(date)
  if (t === 'now') return 'just now'
  return t.endsWith('h') ? `${t} ago` : `on ${t}`
}

function formatTime(date: string | Date | null) {
  if (!date) return ''
  const d = new Date(date)
  // Hour granularity so server and client render the same text
  const hours = Math.floor((Date.now() - d.getTime()) / 3600000)
  if (hours < 1) return 'now'
  if (hours < 24) return `${hours}h`
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div>
    <Container>
      <!-- Edition line: what the page is built from, in one sentence -->
      <p v-if="frontpage?.stats" class="text-[13px] text-ink-3 pt-5 pb-6 border-b border-rule">
        <span class="font-semibold text-ink">{{ dateStr }}.</span>
        In the last 24 hours {{ frontpage.stats.outlets24h }} of {{ frontpage.stats.outletsTotal }} tracked outlets
        published {{ frontpage.stats.articles24h }} articles, grouped into {{ frontpage.stats.activeStories }} running stories.
        <NuxtLink to="/methodology" class="underline underline-offset-2 hover:text-accent">How this works</NuxtLink>
      </p>

      <!-- ═══ LEAD STORY ═══ -->
      <section class="py-8 lg:py-10 border-b border-rule">
        <FeaturedStoryHero
          v-if="frontpage?.heroStory"
          :story="frontpage.heroStory"
          :outlets="frontpage.coverageMatrix.outlets"
          :days="frontpage.coverageMatrix.days"
        />
        <div v-else class="py-12 max-w-xl">
          <h1 class="font-serif text-3xl font-bold text-ink mb-3">No stories yet</h1>
          <p class="text-[15px] text-ink-3 mb-6">Articles are grouped into stories every four hours. Browse the latest articles in the meantime.</p>
          <Button to="/stories" label="Browse stories" />
        </div>
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-x-12 gap-y-12 py-10">
        <!-- ═══ MAIN ═══ -->
        <div class="min-w-0 space-y-14">
          <section v-if="frontpage?.coverageMatrix.stories.length" aria-labelledby="who-covers-what">
            <div class="mb-5">
              <h2 id="who-covers-what" class="font-serif text-[26px] font-bold text-ink leading-tight">Who covers what</h2>
              <p class="text-[14px] text-ink-3 mt-1 max-w-[64ch]">
                The next {{ frontpage.coverageMatrix.stories.length }} biggest stories, and how much each outlet has written about them. Gaps show what an outlet's readers are not hearing about.
              </p>
            </div>
            <CoverageMatrix
              :outlets="frontpage.coverageMatrix.outlets"
              :stories="frontpage.coverageMatrix.stories"
              :days="frontpage.coverageMatrix.days"
            />
          </section>

          <section v-if="frontpage?.categoryStories?.length" aria-labelledby="more-stories">
            <h2 id="more-stories" class="font-serif text-[26px] font-bold text-ink leading-tight mb-5">More stories</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-10">
              <div v-for="cat in frontpage.categoryStories" :key="cat.category">
                <h3 class="font-serif text-[18px] font-semibold text-ink pb-2 border-b border-ink">{{ cat.displayName }}</h3>
                <ul class="divide-y divide-rule-soft">
                  <li v-for="(story, i) in cat.stories" :key="story.id">
                    <NuxtLink :to="`/stories/${story.id}`" class="group flex gap-4 py-3">
                      <span class="min-w-0 flex-1">
                        <span
                          class="block leading-snug text-ink group-hover:text-accent transition-colors line-clamp-3"
                          :class="i === 0 ? 'font-serif text-[17px] font-semibold' : 'text-[14px] font-medium'"
                        >{{ story.title }}</span>
                        <span class="block text-[12px] text-ink-3 mt-1">{{ story.articleCount }} articles, updated {{ updatedText(story.lastUpdated) }}</span>
                      </span>
                      <span v-if="i === 0 && (story.imageLocalPath || story.imageUrl)" class="w-24 h-[72px] shrink-0 overflow-hidden bg-paper-2">
                        <img
                          :src="story.imageLocalPath || story.imageUrl || ''"
                          alt=""
                          loading="lazy"
                          class="w-full h-full object-cover"
                          @error="($event.target as HTMLElement)?.parentElement?.style.setProperty('display', 'none')"
                        >
                      </span>
                    </NuxtLink>
                  </li>
                </ul>
              </div>
            </div>
            <NuxtLink to="/stories" class="inline-block mt-8 text-[14px] font-semibold text-accent-ink hover:text-accent underline underline-offset-4 decoration-1">
              All {{ frontpage.stats.activeStories }} running stories
            </NuxtLink>
          </section>
        </div>

        <!-- ═══ SIDEBAR ═══ -->
        <aside class="space-y-12 min-w-0">
          <!-- Just in -->
          <section v-if="frontpage?.recentArticles?.length" aria-labelledby="just-in">
            <h2 id="just-in" class="font-serif text-[19px] font-bold text-ink pb-2 border-b border-ink">Just in</h2>
            <ol class="divide-y divide-rule-soft">
              <li v-for="a in frontpage.recentArticles.slice(0, 8)" :key="a.id">
                <NuxtLink :to="`/articles/${a.id}`" class="group grid grid-cols-[34px_minmax(0,1fr)] gap-2 py-3">
                  <time :datetime="String(a.publishedAt)" class="text-[12px] tabular-nums text-ink-4 pt-px">{{ formatTime(a.publishedAt) }}</time>
                  <span>
                    <span class="block text-[14px] font-medium leading-snug text-ink group-hover:text-accent transition-colors line-clamp-3">{{ a.title }}</span>
                    <span class="block text-[12px] text-ink-3 mt-1">{{ outletById.get(a.feedId)?.shortName || a.feedName }}</span>
                  </span>
                </NuxtLink>
              </li>
            </ol>
          </section>

          <!-- In the news -->
          <section v-if="frontpage?.inTheNews?.length" aria-labelledby="in-the-news">
            <h2 id="in-the-news" class="font-serif text-[19px] font-bold text-ink pb-2 border-b border-ink">In the news</h2>
            <p class="text-[12px] text-ink-3 mt-2 mb-2">People and organisations by articles in the last 48 hours</p>
            <ol>
              <li v-for="e in frontpage.inTheNews" :key="e.id">
                <NuxtLink :to="entityPath(e)" class="group grid grid-cols-[32px_minmax(0,1fr)] gap-3 items-center py-2">
                  <span class="relative w-8 h-8 rounded-full overflow-hidden bg-paper-2 flex items-center justify-center text-[11px] font-semibold text-ink-3" aria-hidden="true">
                    {{ initials(e.name) }}
                    <img v-if="e.imageUrl" :src="e.imageUrl" alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" @error="($event.target as HTMLElement)?.style.setProperty('display', 'none')">
                  </span>
                  <span class="min-w-0">
                    <span class="flex items-baseline justify-between gap-2">
                      <span class="text-[14px] font-medium text-ink group-hover:text-accent transition-colors truncate">{{ e.name }}</span>
                      <span class="text-[12px] tabular-nums text-ink-3 shrink-0">
                        {{ e.recent }}
                        <span v-if="trendWord(e.recent, e.previous) === 'up'" class="text-intel-green" :title="`Up from ${e.previous} in the 48 hours before`">▲</span>
                        <span v-else-if="trendWord(e.recent, e.previous) === 'down'" class="text-ink-4" :title="`Down from ${e.previous} in the 48 hours before`">▼</span>
                        <span v-else-if="trendWord(e.recent, e.previous) === 'new'" class="text-accent-ink font-semibold" title="No articles in the 48 hours before">new</span>
                      </span>
                    </span>
                    <span class="block h-[3px] bg-paper-2 mt-1.5" aria-hidden="true">
                      <span class="block h-full bg-ink-3" :style="{ width: `${(e.recent / newsMax) * 100}%` }" />
                    </span>
                  </span>
                </NuxtLink>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </Container>
  </div>
</template>
