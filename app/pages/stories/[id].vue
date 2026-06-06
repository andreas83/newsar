<script setup lang="ts">
const route = useRoute()
const storyId = parseInt(route.params.id as string)

const { data: story } = await useFetch(`/api/stories/${storyId}`) as { data: Ref<any> }

// Track expanded sections and lazy-loaded periods
const expandedOtherFramings = ref<Set<string>>(new Set())
const expandedPeriods = ref<Map<string, any[]>>(new Map())
const loadingPeriods = ref<Set<string>>(new Set())

function toggleOtherFramings(periodKey: string) {
  if (expandedOtherFramings.value.has(periodKey)) {
    expandedOtherFramings.value.delete(periodKey)
  } else {
    expandedOtherFramings.value.add(periodKey)
  }
}

async function loadAllArticles(periodStart: string, periodEnd: string) {
  const key = periodStart
  if (expandedPeriods.value.has(key) || loadingPeriods.value.has(key)) return

  loadingPeriods.value.add(key)
  try {
    const result = await $fetch(`/api/stories/${storyId}`, {
      params: { periodStart, periodEnd },
    }) as any
    expandedPeriods.value.set(key, result.periodArticles || [])
  } catch (e) {
    console.error('Failed to load period articles:', e)
  } finally {
    loadingPeriods.value.delete(key)
  }
}

function formatDate(date: string | Date | null) {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return d.toLocaleDateString()
}

function formatPeriodLabel(periodStart: string, periodEnd: string, bucketType: string) {
  const start = new Date(periodStart)
  const end = new Date(periodEnd)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const optsWithYear: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

  if (bucketType === '12h') {
    const hour = start.getHours()
    const label = hour < 12 ? 'Morning' : 'Evening'
    return `${start.toLocaleDateString('en-US', opts)} ${label}`
  }
  if (bucketType === 'day') {
    return start.toLocaleDateString('en-US', optsWithYear)
  }
  if (bucketType === 'week') {
    const endDisplay = new Date(end.getTime() - 1)
    return `${start.toLocaleDateString('en-US', opts)} – ${endDisplay.toLocaleDateString('en-US', opts)}`
  }
  return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function framingDisplayName(framing: string): string {
  return story.value?.framingDisplay?.[framing]
    || framing.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
}

const FRAMING_COLOR_CLASSES: Record<string, { bg: string; text: string; bar: string; border: string }> = {
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500', border: 'border-emerald-200 dark:border-emerald-800' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-400', bar: 'bg-purple-500', border: 'border-purple-200 dark:border-purple-800' },
  red: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', bar: 'bg-red-500', border: 'border-red-200 dark:border-red-800' },
  teal: { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-400', bar: 'bg-teal-500', border: 'border-teal-200 dark:border-teal-800' },
  green: { bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-700 dark:text-green-400', bar: 'bg-green-500', border: 'border-green-200 dark:border-green-800' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-400', bar: 'bg-orange-500', border: 'border-orange-200 dark:border-orange-800' },
  pink: { bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-700 dark:text-pink-400', bar: 'bg-pink-500', border: 'border-pink-200 dark:border-pink-800' },
  indigo: { bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-700 dark:text-indigo-400', bar: 'bg-indigo-500', border: 'border-indigo-200 dark:border-indigo-800' },
  cyan: { bg: 'bg-cyan-50 dark:bg-cyan-950/30', text: 'text-cyan-700 dark:text-cyan-400', bar: 'bg-cyan-500', border: 'border-cyan-200 dark:border-cyan-800' },
  rose: { bg: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-400', bar: 'bg-rose-500', border: 'border-rose-200 dark:border-rose-800' },
  blue: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', bar: 'bg-blue-500', border: 'border-blue-200 dark:border-blue-800' },
  violet: { bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-700 dark:text-violet-400', bar: 'bg-violet-500', border: 'border-violet-200 dark:border-violet-800' },
  gray: { bg: 'bg-paper-2', text: 'text-ink-2', bar: 'bg-gray-400', border: 'border-rule' },
}

function framingColor(framing: string): typeof FRAMING_COLOR_CLASSES.gray {
  const colorName = story.value?.framingColors?.[framing] || 'gray'
  return FRAMING_COLOR_CLASSES[colorName] || FRAMING_COLOR_CLASSES.gray
}

function sensationalismLabel(value: number | null): string {
  if (value === null) return 'N/A'
  if (value <= 0.3) return 'Low'
  if (value <= 0.6) return 'Moderate'
  return 'High'
}

function claimTypeColor(type: string | null): string {
  switch (type) {
    case 'factual': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    case 'quote': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
    case 'statistic': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    case 'prediction': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    default: return 'bg-paper-2 text-ink-3  '
  }
}

const totalAll = computed(() => story.value?.totalArticleCounts?.total || 0)

const framingEntries = computed(() => {
  if (!story.value?.framingSummary) return []
  return Object.entries(story.value.framingSummary as Record<string, number>)
    .filter(([k]) => k !== 'unclassified')
    .sort(([, a], [, b]) => (b as number) - (a as number))
})

function barPercent(count: number) {
  if (!totalAll.value) return 0
  return (count / totalAll.value) * 100
}

// SEO
const siteUrl = 'https://newsar.codejungle.org'
const pageUrl = `${siteUrl}/stories/${storyId}`
const storyTitle = story.value?.representativeTitle || story.value?.name || 'Story'
const pageTitle = `${storyTitle} - Newsar`
const pageDescription = story.value?.summary
  || `Multi-perspective coverage of "${storyTitle}" from ${story.value?.sourceCount || 0} sources with ${totalAll.value} articles.`

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogUrl: pageUrl,
  ogType: 'article',
  ogSiteName: 'Newsar',
  twitterCard: 'summary',
  twitterTitle: pageTitle,
  twitterDescription: pageDescription,
})

useHead({
  link: [{ rel: 'canonical', href: pageUrl }],
  script: story.value ? [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: storyTitle,
      description: pageDescription,
      url: pageUrl,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: totalAll.value,
        ...(story.value.entities?.length && {
          about: story.value.entities.map((e: any) => ({
            '@type': e.type === 'person' ? 'Person' : e.type === 'organization' ? 'Organization' : 'Thing',
            name: e.name,
          })),
        }),
      },
      ...(story.value.lastUpdated && { dateModified: story.value.lastUpdated }),
      publisher: { '@type': 'Organization', name: 'Newsar' },
    }),
  }] : [],
})
</script>

<template>
  <div v-if="story">
    <!-- Story Header -->
    <section class="bg-paper-2 py-12 border-b ">
      <Container>
        <div class="max-w-5xl mx-auto">
          <div class="mb-4">
            <Button
              to="/stories"
              icon="i-heroicons-arrow-left"
              color="gray"
              variant="ghost"
              label="Back to Stories"
            />
          </div>

          <h1 class="text-3xl md:text-4xl font-bold text-ink mb-4">
            {{ story.representativeTitle || story.name }}
          </h1>

          <p v-if="story.summary" class="text-lg text-ink-3 mb-6">
            {{ story.summary }}
          </p>

          <!-- Story Metadata -->
          <div class="flex flex-wrap gap-4 text-sm">
            <div class="flex items-center gap-2">
              <Icon name="i-heroicons-newspaper" class="w-4 h-4 text-ink-4" />
              <span class="text-ink-3">{{ totalAll }} articles</span>
            </div>
            <div class="flex items-center gap-2">
              <Icon name="i-heroicons-building-library" class="w-4 h-4 text-ink-4" />
              <span class="text-ink-3">{{ story.sourceCount }} sources</span>
            </div>
            <div class="flex items-center gap-2">
              <Icon name="i-heroicons-chart-bar" class="w-4 h-4 text-ink-4" />
              <span class="text-ink-3">
                {{ ((story.sourceDiversityScore || 0) * 100).toFixed(0) }}% diversity
              </span>
            </div>
            <div class="flex items-center gap-2">
              <Icon name="i-heroicons-clock" class="w-4 h-4 text-ink-4" />
              <span class="text-ink-3">Updated {{ formatDate(story.lastUpdated) }}</span>
            </div>
          </div>

          <!-- Story Entities -->
          <div v-if="story.entities && story.entities.length > 0" class="mt-6">
            <div class="text-sm font-medium text-ink-2 mb-2">Key Topics & People</div>
            <div class="flex flex-wrap gap-2">
              <Badge
                v-for="entity in story.entities"
                :key="entity.id"
                :color="
                  entity.type === 'person' ? 'blue' :
                  entity.type === 'organization' ? 'green' :
                  entity.type === 'location' ? 'orange' :
                  'purple'
                "
                size="lg"
              >
                {{ entity.name }}
                <span v-if="entity.isPrimary" class="ml-1">*</span>
              </Badge>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- Framing Distribution Bar + Quality Indicators -->
    <section v-if="totalAll > 0 && framingEntries.length > 0" class="bg-paper py-6 border-b ">
      <Container>
        <div class="max-w-5xl mx-auto">
          <div class="flex items-center gap-3 mb-3">
            <h2 class="text-sm font-semibold text-ink-2 uppercase tracking-wide">Coverage Framing</h2>
          </div>

          <!-- Multi-segment framing bar -->
          <div class="flex rounded-sm overflow-hidden h-8 bg-paper-2 ">
            <div
              v-for="[framing, count] in framingEntries"
              :key="framing"
              class="flex items-center justify-center text-white text-xs font-semibold transition-all"
              :class="framingColor(framing).bar"
              :style="{ width: barPercent(count as number) + '%', minWidth: (count as number) > 0 ? '32px' : '0' }"
              :title="`${framingDisplayName(framing)}: ${count}`"
            >
              {{ count }}
            </div>
          </div>

          <!-- Legend -->
          <div class="flex flex-wrap gap-3 mt-3">
            <div
              v-for="[framing, count] in framingEntries"
              :key="framing"
              class="flex items-center gap-1.5 text-xs"
            >
              <span
                class="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                :class="framingColor(framing).bar"
              />
              <span class="text-ink-3">{{ framingDisplayName(framing) }}</span>
              <span class="text-ink-4">({{ count }})</span>
            </div>
          </div>

          <!-- Quality indicators -->
          <div class="flex gap-6 mt-4 pt-3 border-t border-rule-soft">
            <div v-if="story.avgFactuality !== null" class="text-sm">
              <span class="text-ink-3">Avg Factuality:</span>
              <span class="ml-1 font-semibold" :class="story.avgFactuality >= 0.7 ? 'text-blue-600 dark:text-blue-400' : story.avgFactuality >= 0.4 ? 'text-ink-2' : 'text-orange-600 dark:text-orange-400'">
                {{ (story.avgFactuality * 100).toFixed(0) }}%
              </span>
            </div>
            <div v-if="story.avgSensationalism !== null" class="text-sm">
              <span class="text-ink-3">Avg Sensationalism:</span>
              <span class="ml-1 font-semibold" :class="story.avgSensationalism <= 0.3 ? 'text-emerald-600 dark:text-emerald-400' : story.avgSensationalism <= 0.6 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'">
                {{ sensationalismLabel(story.avgSensationalism) }}
              </span>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- Timeline -->
    <section class="py-8 bg-paper-2 min-h-[50vh]">
      <Container>
        <div class="max-w-5xl mx-auto">
          <h2 class="text-xl font-bold text-ink mb-6">Story Timeline</h2>

          <div
            v-if="story.timeline && story.timeline.periods && story.timeline.periods.length > 0"
            class="space-y-6"
          >
            <!-- Period -->
            <div
              v-for="(period, idx) in story.timeline.periods"
              :key="period.periodStart"
              class="relative"
            >
              <!-- Timeline connector -->
              <div
                v-if="idx < story.timeline.periods.length - 1"
                class="absolute left-6 top-full w-0.5 h-6 bg-paper-2 hidden sm:block"
              />

              <div class="bg-panel rounded-sm border border-rule  overflow-hidden">
                <!-- Period Header -->
                <div class="px-5 py-4 border-b border-rule-soft bg-gradient-to-r from-gray-50 to-white dark:from-transparent dark:to-transparent">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex items-center gap-3">
                      <div class="w-3 h-3 rounded-sm bg-ink-3 flex-shrink-0 ring-4 ring-paper-2" />
                      <h3 class="text-base font-bold text-ink">
                        {{ formatPeriodLabel(period.periodStart, period.periodEnd, story.timeline.bucketType) }}
                      </h3>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-ink-3">
                      <span>{{ period.totalArticles }} articles</span>
                      <span class="text-ink-4">|</span>
                      <span>{{ period.sourceCount }} sources</span>
                    </div>
                  </div>

                  <!-- Keywords -->
                  <div v-if="period.topKeywords && period.topKeywords.length > 0" class="flex flex-wrap gap-1.5 mt-3 ml-6">
                    <span
                      v-for="kw in period.topKeywords"
                      :key="kw.keyword"
                      class="px-2 py-0.5 bg-paper-2  text-ink-3 rounded text-xs font-medium"
                    >
                      {{ kw.keyword }}
                    </span>
                  </div>
                </div>

                <!-- Framing Groups Grid -->
                <div class="p-5">
                  <div v-if="period.framingGroups && period.framingGroups.length > 0">
                    <!-- Top 3 framing groups as columns -->
                    <div
                      class="grid gap-6"
                      :class="period.framingGroups.length === 1 ? 'grid-cols-1' : period.framingGroups.length === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 lg:grid-cols-3'"
                    >
                      <div
                        v-for="group in period.framingGroups.slice(0, 3)"
                        :key="group.framing"
                      >
                        <!-- Group Header -->
                        <div class="flex items-center gap-2 mb-3">
                          <div class="h-0.5 w-6 rounded" :class="framingColor(group.framing).bar" />
                          <span class="text-xs font-semibold uppercase tracking-wide" :class="framingColor(group.framing).text">
                            {{ group.displayName }}
                          </span>
                          <span class="text-xs text-ink-4">({{ group.totalCount }})</span>
                        </div>

                        <div v-if="group.articles.length > 0" class="space-y-2.5">
                          <PeriodArticleCard
                            v-for="article in group.articles"
                            :key="article.id"
                            :article="article"
                            :framing="group.framing"
                          />
                        </div>
                        <div v-else class="text-sm text-ink-4 italic py-4 text-center border border-dashed border-rule rounded-sm">
                          No articles in this framing
                        </div>
                      </div>
                    </div>

                    <!-- Remaining framings (collapsible) -->
                    <div
                      v-if="period.framingGroups.length > 3"
                      class="mt-4 pt-4 border-t border-rule-soft"
                    >
                      <button
                        class="flex items-center gap-2 text-sm text-ink-3 hover:text-ink-2 transition-colors w-full"
                        @click="toggleOtherFramings(period.periodStart)"
                      >
                        <svg
                          class="w-4 h-4 transition-transform"
                          :class="{ 'rotate-90': expandedOtherFramings.has(period.periodStart) }"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                        <span class="font-medium">
                          {{ period.framingGroups.length - 3 }} more framing{{ period.framingGroups.length - 3 > 1 ? 's' : '' }}
                        </span>
                      </button>

                      <div
                        v-if="expandedOtherFramings.has(period.periodStart)"
                        class="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-6"
                      >
                        <div
                          v-for="group in period.framingGroups.slice(3)"
                          :key="group.framing"
                        >
                          <div class="flex items-center gap-2 mb-3">
                            <div class="h-0.5 w-6 rounded" :class="framingColor(group.framing).bar" />
                            <span class="text-xs font-semibold uppercase tracking-wide" :class="framingColor(group.framing).text">
                              {{ group.displayName }}
                            </span>
                            <span class="text-xs text-ink-4">({{ group.totalCount }})</span>
                          </div>
                          <div class="space-y-2.5">
                            <PeriodArticleCard
                              v-for="article in group.articles"
                              :key="article.id"
                              :article="article"
                              :framing="group.framing"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Claims section -->
                  <div
                    v-if="period.claims && period.claims.length > 0"
                    class="mt-5 pt-4 border-t border-rule-soft"
                  >
                    <h4 class="text-xs font-semibold text-ink-2 uppercase tracking-wide mb-3">Key Claims</h4>
                    <div class="space-y-2">
                      <div
                        v-for="(claim, ci) in period.claims"
                        :key="ci"
                        class="flex gap-3 p-2.5 bg-paper-2 /50 rounded-sm border border-rule-soft"
                      >
                        <span
                          class="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 self-start mt-0.5"
                          :class="claimTypeColor(claim.claimType)"
                        >
                          {{ claim.claimType || 'claim' }}
                        </span>
                        <div class="flex-1 min-w-0">
                          <p class="text-xs text-ink leading-relaxed">{{ claim.claimText }}</p>
                          <p v-if="claim.attribution" class="text-[10px] text-ink-4 mt-1">
                            — {{ claim.attribution }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Show all articles (lazy-load) -->
                  <div v-if="period.totalArticles > 9" class="mt-4 pt-4 border-t border-rule-soft">
                    <div v-if="expandedPeriods.has(period.periodStart)">
                      <div class="flex items-center gap-2 mb-3">
                        <span class="text-xs font-semibold text-ink-3 uppercase tracking-wide">All Articles This Period</span>
                      </div>
                      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        <PeriodArticleCard
                          v-for="article in expandedPeriods.get(period.periodStart)"
                          :key="article.id"
                          :article="article"
                          :framing="article.primaryFraming || 'unclassified'"
                        />
                      </div>
                    </div>
                    <button
                      v-else
                      class="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
                      :disabled="loadingPeriods.has(period.periodStart)"
                      @click="loadAllArticles(period.periodStart, period.periodEnd)"
                    >
                      <svg v-if="loadingPeriods.has(period.periodStart)" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                      <span>
                        {{ loadingPeriods.has(period.periodStart) ? 'Loading...' : `Show all ${period.totalArticles} articles from this period` }}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="text-center py-16">
            <Icon name="i-heroicons-newspaper" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
            <p class="text-ink-3">No timeline data available for this story.</p>
          </div>
        </div>
      </Container>
    </section>
  </div>

  <div v-else class="min-h-screen flex items-center justify-center">
    <div class="text-center">
      <Icon name="i-heroicons-newspaper" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
      <p class="text-ink-3">Story not found</p>
    </div>
  </div>
</template>
