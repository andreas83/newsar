<template>
  <div class="min-h-screen bg-paper">
    <div v-if="pending" class="max-w-7xl mx-auto px-4 py-8">
      <div class="animate-pulse">
        <div class="h-8 bg-paper-2 rounded w-1/3 mb-4"></div>
        <div class="h-4 bg-paper-2 rounded w-2/3 mb-8"></div>
        <div class="h-64 bg-paper-2 rounded"></div>
      </div>
    </div>

    <div v-else-if="error" class="max-w-7xl mx-auto px-4 py-8">
      <div class="bg-red-50 border border-red-200 rounded-sm p-6">
        <h1 class="text-xl font-bold text-red-900 mb-2">Error Loading Person</h1>
        <p class="text-red-700">{{ error.message }}</p>
        <NuxtLink to="/" class="mt-4 inline-block text-accent hover:text-accent-ink">
          ← Back to Home
        </NuxtLink>
      </div>
    </div>

    <div v-else-if="data" class="max-w-7xl mx-auto px-4 py-8">
      <!-- Header Section -->
      <div class="bg-panel rounded-sm  border border-rule p-4 sm:p-6 mb-6">
        <div class="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
          <!-- Entity Portrait -->
          <EntityPortrait
            :name="data.entity.name"
            entity-type="person"
            :entity-id="data.entity.id"
            :existing-image-url="data.summary.imageUrl"
          />

          <!-- Entity Info -->
          <div class="flex-1 min-w-0 text-center sm:text-left">
            <div class="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 mb-2">
              <h1 class="text-2xl sm:text-3xl font-bold text-ink">
                {{ data.entity.name }}
              </h1>
              <span class="px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-sm font-medium rounded-full whitespace-nowrap">
                Person
              </span>
              <span
                v-if="data.entity.subtype"
                class="px-3 py-1 text-sm font-medium rounded-full whitespace-nowrap"
                :class="getSubtypeClasses(data.entity.subtype)"
              >
                {{ getSubtypeLabel(data.entity.subtype) }}
              </span>
            </div>

            <p v-if="data.summary.shortDescription" class="text-base sm:text-lg text-ink-3 mb-4">
              {{ data.summary.shortDescription }}
            </p>

            <!-- Stats Row -->
            <div class="flex flex-wrap justify-center sm:justify-start gap-x-5 gap-y-1 text-sm">
              <div>
                <span class="text-ink-3">Mentions:</span>
                <span class="ml-1 font-semibold text-ink">{{ data.stats.totalMentions }}</span>
              </div>
              <div>
                <span class="text-ink-3">7 Days:</span>
                <span class="ml-1 font-semibold text-ink">{{ data.stats.mentionsLast7Days }}</span>
              </div>
              <div v-if="data.stats.velocityChangePercent !== 0">
                <span class="text-ink-3">Velocity:</span>
                <span
                  class="ml-1 font-semibold"
                  :class="data.stats.velocityChangePercent > 0 ? 'text-green-600' : 'text-red-600'"
                >
                  {{ data.stats.velocityChangePercent > 0 ? '+' : '' }}{{ data.stats.velocityChangePercent.toFixed(1) }}%
                </span>
              </div>
              <div v-if="data.stats.trendingScore > 0.1">
                <span class="text-ink-3">Trending:</span>
                <span class="ml-1 font-semibold text-orange-600">
                  {{ (data.stats.trendingScore * 100).toFixed(0) }}%
                </span>
              </div>
            </div>

            <!-- External Links -->
            <div v-if="data.summary.wikiUrl" class="mt-4">
              <a
                :href="data.summary.wikiUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-accent hover:text-accent-ink text-sm font-medium"
              >
                View on Wikipedia →
              </a>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Main Content (Left 2/3) -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Summary Section -->
          <div v-if="data.summary.summary" class="bg-panel rounded-sm  border border-rule p-6">
            <h2 class="text-xl font-bold text-ink mb-4">About</h2>
            <div class="prose prose-gray max-w-none text-ink-2 leading-relaxed">
              {{ data.summary.summary }}
            </div>
            <div v-if="data.summary.lastUpdated" class="mt-4 text-xs text-ink-3">
              Last updated: {{ formatDate(data.summary.lastUpdated) }}
            </div>
          </div>

          <!-- Summary Timeline -->
          <EntitySummaryTimeline
            v-if="data.summary.historyCount > 0"
            :entity-id="data.entity.id"
            :history-count="data.summary.historyCount"
          />

          <!-- Network Graph -->
          <ClientOnly>
            <EntityNetworkExplorer
              :entity-id="data.entity.id"
              entity-type="person"
            />
          </ClientOnly>

          <!-- Associated Organizations -->
          <ClientOnly>
            <AssociatedEntities
              v-if="data"
              :entity-id="data.entity.id"
              related-type="organization"
              :limit="10"
            />
          </ClientOnly>

          <!-- Recent Articles -->
          <div class="bg-panel rounded-sm  border border-rule p-6">
            <h2 class="text-xl font-bold text-ink mb-4">Recent News</h2>
            <div v-if="data.recentArticles.length > 0" class="space-y-4">
              <article
                v-for="article in data.recentArticles"
                :key="article.id"
                class="border-b border-rule-soft last:border-0 pb-4 last:pb-0"
              >
                <NuxtLink
                  :to="`/articles/${article.id}`"
                  class="block hover:bg-paper -mx-2 px-2 py-2 rounded transition-colors"
                >
                  <div class="flex gap-3">
                    <!-- Article Thumbnail -->
                    <div v-if="article.imageLocalPath || article.imageUrl" class="flex-shrink-0">
                      <img
                        :src="article.imageLocalPath || article.imageUrl"
                        :alt="article.title"
                        class="w-20 h-20 object-cover rounded"
                        @error="$event.target.parentElement.style.display='none'"
                      />
                    </div>

                    <div class="flex-1 min-w-0">
                      <h3 class="font-semibold text-ink mb-2 hover:text-blue-600  line-clamp-2">
                        {{ article.title }}
                      </h3>
                      <div class="flex items-center gap-4 text-sm text-ink-3">
                        <time :datetime="article.publishedAt">
                          {{ formatRelativeTime(article.publishedAt) }}
                        </time>
                        <span v-if="article.storyStatus === 'trending'" class="text-orange-600 font-medium">
                          🔥 Trending
                        </span>
                      </div>
                    </div>
                  </div>
                </NuxtLink>
              </article>
            </div>
            <div v-else class="text-ink-3 text-center py-4">
              No recent articles found
            </div>
          </div>
        </div>

        <!-- Sidebar (Right 1/3) -->
        <div class="space-y-6">
          <!-- Wikidata Quick Facts -->
          <ClientOnly>
            <WikidataInfoCard :entity-id="data.entity.id" entity-type="person" />
          </ClientOnly>

          <!-- Related Entities -->
          <div v-if="data.relatedEntities.length > 0" class="bg-panel rounded-sm  border border-rule p-6">
            <h2 class="text-lg font-bold text-ink mb-4">Related</h2>
            <div class="space-y-3">
              <div
                v-for="entity in data.relatedEntities.slice(0, 8)"
                :key="entity.id"
                class="border-b border-rule-soft last:border-0 pb-3 last:pb-0"
              >
                <NuxtLink
                  :to="`/${entity.type}/${entity.slug}`"
                  class="block hover:bg-paper -mx-2 px-2 py-1 rounded transition-colors"
                >
                  <div class="font-medium text-ink hover:text-blue-600 ">
                    {{ entity.name }}
                  </div>
                  <div class="text-xs text-ink-3 mt-1">
                    <span class="capitalize">{{ entity.type }}</span>
                    <span class="mx-1">•</span>
                    <span>{{ entity.coOccurrenceCount }} co-mentions</span>
                  </div>
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { getSubtypeLabel, getSubtypeClasses } = useEntitySubtypes()
const route = useRoute()
const slug = route.params.slug as string

// Fetch entity data
const { data, pending, error } = await useFetch(`/api/entities/person/${slug}`)

// SEO
const siteUrl = 'https://newsar.codejungle.org'
const pageUrl = `${siteUrl}/person/${slug}`
const personName = data.value?.entity.name || 'Person'
const pageTitle = `${personName} - Person - Newsar`
const pageDescription = data.value?.summary.shortDescription
  || data.value?.summary.summary?.slice(0, 160)
  || `News coverage and analysis of ${personName}`
const pageImage = data.value?.summary.imageUrl || undefined

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogImage: pageImage,
  ogUrl: pageUrl,
  ogType: 'profile',
  ogSiteName: 'Newsar',
  twitterCard: pageImage ? 'summary_large_image' : 'summary',
  twitterTitle: pageTitle,
  twitterDescription: pageDescription,
  twitterImage: pageImage,
})

useHead({
  link: [{ rel: 'canonical', href: pageUrl }],
  script: data.value ? [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: personName,
      url: pageUrl,
      description: pageDescription,
      ...(pageImage && { image: pageImage }),
      ...(data.value.summary.wikiUrl && { sameAs: [data.value.summary.wikiUrl] }),
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    }),
  }] : [],
})

// Helper functions
function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

function formatRelativeTime(date: string | Date) {
  const now = new Date()
  const published = new Date(date)
  const diffMs = now.getTime() - published.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return formatDate(date)
}
</script>

