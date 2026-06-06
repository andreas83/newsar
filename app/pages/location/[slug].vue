<template>
  <div class="min-h-screen bg-paper">
    <div v-if="pending" class="max-w-7xl mx-auto px-4 py-8">
      <div class="animate-pulse">
        <div class="h-8 bg-paper-2  rounded w-1/3 mb-4"></div>
        <div class="h-4 bg-paper-2  rounded w-2/3 mb-8"></div>
        <div class="h-64 bg-paper-2  rounded"></div>
      </div>
    </div>

    <div v-else-if="error" class="max-w-7xl mx-auto px-4 py-8">
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-sm p-6">
        <h1 class="text-xl font-bold text-red-900 dark:text-red-300 mb-2">Error Loading Location</h1>
        <p class="text-red-700 dark:text-red-400">{{ error.message }}</p>
        <NuxtLink to="/" class="mt-4 inline-block text-accent hover:text-accent-ink">
          &larr; Back to Home
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
            entity-type="location"
            :entity-id="data.entity.id"
            :existing-image-url="data.summary.imageUrl"
          />

          <!-- Entity Info -->
          <div class="flex-1 min-w-0 text-center sm:text-left">
            <div class="flex flex-col sm:flex-row items-center sm:items-center gap-2 sm:gap-3 mb-2">
              <h1 class="text-2xl sm:text-3xl font-bold text-ink">
                {{ data.entity.name }}
              </h1>
              <span class="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm font-medium rounded-full whitespace-nowrap">
                Location
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
                View on Wikipedia &rarr;
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

          <!-- Map Section -->
          <div v-if="mapReady" ref="mapSection" class="fullscreen-section bg-panel rounded-sm  border border-rule overflow-hidden">
            <div class="section-header px-6 pt-5 pb-3">
              <div class="flex items-center gap-2">
                <Icon name="i-heroicons-map-pin" class="w-5 h-5 text-orange-500" />
                <h2 class="text-xl font-bold text-ink">Map</h2>
              </div>
              <button class="fullscreen-btn" title="Toggle fullscreen" @click="toggleFullscreen">
                <Icon :name="mapFullscreen ? 'i-heroicons-arrows-pointing-in' : 'i-heroicons-arrows-pointing-out'" class="w-5 h-5" />
              </button>
            </div>
            <ClientOnly>
              <div ref="mapContainer" class="map-canvas" :style="{ height: mapFullscreen ? 'calc(100vh - 56px)' : '350px' }"></div>
            </ClientOnly>
          </div>

          <!-- Recent Articles -->
          <div class="bg-panel rounded-sm  border border-rule p-6">
            <h2 class="text-xl font-bold text-ink mb-4">News from {{ data.entity.name }}</h2>
            <div v-if="data.recentArticles.length > 0" class="space-y-4">
              <article
                v-for="article in data.recentArticles"
                :key="article.id"
                class="border-b border-rule-soft  last:border-0 pb-4 last:pb-0"
              >
                <NuxtLink
                  :to="`/articles/${article.id}`"
                  class="block hover:bg-paper dark:hover:bg-slate-700 -mx-2 px-2 py-2 rounded transition-colors"
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
                      <h3 class="font-semibold text-ink mb-2 hover:text-blue-600 line-clamp-2">
                        {{ article.title }}
                      </h3>
                      <div class="flex items-center gap-4 text-sm text-ink-3">
                        <time :datetime="article.publishedAt">
                          {{ formatRelativeTime(article.publishedAt) }}
                        </time>
                        <span v-if="article.storyStatus === 'trending'" class="text-orange-600 font-medium">
                          Trending
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

          <!-- Network Graph (below articles) -->
          <ClientOnly>
            <EntityNetworkExplorer
              :entity-id="data.entity.id"
              entity-type="location"
            />
          </ClientOnly>
        </div>

        <!-- Sidebar (Right 1/3) -->
        <div class="space-y-6">
          <!-- Wikidata Quick Facts -->
          <ClientOnly>
            <WikidataInfoCard :entity-id="data.entity.id" entity-type="location" />
          </ClientOnly>

          <!-- Related Entities -->
          <div v-if="data.relatedEntities.length > 0" class="bg-panel rounded-sm  border border-rule p-6">
            <h2 class="text-lg font-bold text-ink mb-4">Related</h2>
            <div class="space-y-3">
              <div
                v-for="entity in data.relatedEntities.slice(0, 8)"
                :key="entity.id"
                class="border-b border-rule-soft  last:border-0 pb-3 last:pb-0"
              >
                <NuxtLink
                  :to="`/${entity.type}/${entity.slug}`"
                  class="block hover:bg-paper dark:hover:bg-slate-700 -mx-2 px-2 py-1 rounded transition-colors"
                >
                  <div class="font-medium text-ink hover:text-blue-600">
                    {{ entity.name }}
                  </div>
                  <div class="text-xs text-ink-3 mt-1">
                    <span class="capitalize">{{ entity.type }}</span>
                    <span class="mx-1">&bull;</span>
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
const { data, pending, error } = await useFetch(`/api/entities/location/${slug}`)

// Map
const mapContainer = ref<HTMLElement | null>(null)
const mapSection = ref<HTMLElement | null>(null)
const mapReady = ref(false)
const mapFullscreen = ref(false)
let mapInstance: any = null

const windowWidth = ref(1200)
const windowHeight = ref(800)

// Fullscreen - invalidate map after Vue re-renders the new container height
async function refreshMap(entering: boolean) {
  if (!mapInstance) return
  if (entering) {
    mapInstance.scrollWheelZoom.enable()
  } else {
    mapInstance.scrollWheelZoom.disable()
  }
  // Wait for Vue to apply the new inline height, then let the browser
  // finish the fullscreen transition before telling Leaflet to resize
  await nextTick()
  setTimeout(() => {
    mapInstance?.invalidateSize({ animate: false })
  }, 300)
}

function toggleFullscreen() {
  if (!mapSection.value) return

  if (!document.fullscreenElement) {
    mapSection.value.requestFullscreen().then(() => {
      mapFullscreen.value = true
      refreshMap(true)
    }).catch(() => {})
  } else {
    document.exitFullscreen().catch(() => {})
  }
}

onMounted(async () => {
  // Track window size for fullscreen graph
  windowWidth.value = window.innerWidth
  windowHeight.value = window.innerHeight
  window.addEventListener('resize', () => {
    windowWidth.value = window.innerWidth
    windowHeight.value = window.innerHeight
  })

  // Listen for fullscreen change (enter or exit via Escape / button)
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      const wasMap = mapFullscreen.value
      mapFullscreen.value = false
      if (wasMap) refreshMap(false)
    }
  })

  if (!data.value) return

  // Geocode and init map
  try {
    const locationName = data.value.entity.name
    const res = await $fetch<any[]>(`https://nominatim.openstreetmap.org/search`, {
      query: { q: locationName, format: 'json', limit: 1 }
    })
    if (res && res.length > 0) {
      mapReady.value = true
      await nextTick()
      if (mapContainer.value) {
        const L = await import('leaflet')
        await import('leaflet/dist/leaflet.css')

        // Fix Leaflet default marker icon paths (broken by bundlers)
        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        const lat = parseFloat(res[0].lat)
        const lon = parseFloat(res[0].lon)

        // Determine zoom based on bounding box
        let zoom = 6
        if (res[0].boundingbox) {
          const bb = res[0].boundingbox.map(Number)
          const latSpan = Math.abs(bb[1] - bb[0])
          if (latSpan < 0.1) zoom = 12
          else if (latSpan < 0.5) zoom = 10
          else if (latSpan < 2) zoom = 8
          else if (latSpan < 10) zoom = 5
          else zoom = 4
        }

        mapInstance = L.map(mapContainer.value, { scrollWheelZoom: false }).setView([lat, lon], zoom)

        // CartoDB Voyager - modern clean theme
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: 'abcd',
          maxZoom: 19,
        }).addTo(mapInstance)

        L.marker([lat, lon]).addTo(mapInstance).bindPopup(locationName)
      }
    }
  } catch { /* map is optional */ }

})

onUnmounted(() => {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
  }
})

// SEO
const siteUrl = 'https://newsar.codejungle.org'
const pageUrl = `${siteUrl}/location/${slug}`
const locationName = data.value?.entity.name || 'Location'
const pageTitle = `${locationName} - Location - Newsar`
const pageDescription = data.value?.summary.shortDescription
  || data.value?.summary.summary?.slice(0, 160)
  || `News coverage and analysis from ${locationName}`
const pageImage = data.value?.summary.imageUrl || undefined

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogImage: pageImage,
  ogUrl: pageUrl,
  ogType: 'website',
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
      '@type': 'Place',
      name: locationName,
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

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fullscreen-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: white;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}

:root.dark .fullscreen-btn {
  background: #1e293b;
  border-color: #475569;
  color: #94a3b8;
}

.fullscreen-btn:hover {
  background: #f3f4f6;
  color: #111827;
  border-color: #d1d5db;
}

:root.dark .fullscreen-btn:hover {
  background: #334155;
  color: #e2e8f0;
  border-color: #64748b;
}

.map-canvas {
  width: 100%;
  transition: height 0.15s ease;
}
</style>
