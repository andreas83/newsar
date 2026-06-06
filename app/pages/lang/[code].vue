<script setup lang="ts">
const route = useRoute()
const { setLanguage } = useLanguage()
const langCode = route.params.code as string

const languageConfig: Record<string, { name: string; nativeName: string; heroTitle: string; heroSubtitle: string }> = {
  en: {
    name: 'English',
    nativeName: 'English',
    heroTitle: 'News from Multiple Perspectives',
    heroSubtitle: 'AI-powered news aggregation showing different viewpoints on the same stories.',
  },
  de: {
    name: 'German',
    nativeName: 'Deutsche Nachrichten',
    heroTitle: 'Nachrichten aus verschiedenen Perspektiven',
    heroSubtitle: 'KI-gesteuerte Nachrichtenaggregation mit verschiedenen Blickwinkeln auf dieselben Geschichten.',
  },
  es: {
    name: 'Spanish',
    nativeName: 'Noticias en Espanol',
    heroTitle: 'Noticias desde multiples perspectivas',
    heroSubtitle: 'Agregacion de noticias impulsada por IA que muestra diferentes puntos de vista sobre las mismas historias.',
  },
  fr: {
    name: 'French',
    nativeName: 'Actualites en Francais',
    heroTitle: 'Actualites sous plusieurs angles',
    heroSubtitle: 'Agregation de nouvelles alimentee par l\'IA montrant differents points de vue sur les memes sujets.',
  },
}

// Validate language code
const config = languageConfig[langCode]
if (!config) {
  throw createError({
    statusCode: 404,
    statusMessage: `Language "${langCode}" is not supported. Available: en, de, es, fr`,
  })
}

const { data: dashboardData } = await useFetch('/api/dashboard', {
  query: { language: langCode },
})

function getBiasColor(bias: number | null) {
  if (bias === null) return 'gray'
  if (bias <= -0.6) return 'blue'
  if (bias <= -0.2) return 'sky'
  if (bias < 0.2) return 'gray'
  if (bias < 0.6) return 'orange'
  return 'red'
}

function getBiasLabel(bias: number | null) {
  if (bias === null) return 'Unknown'
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
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

function getStatusColor(status: string) {
  switch (status) {
    case 'emerging': return 'blue'
    case 'trending': return 'red'
    case 'active': return 'green'
    case 'declining': return 'gray'
    default: return 'gray'
  }
}

// Sync global language state when visiting this page (client only)
onMounted(() => {
  setLanguage(langCode)
})

useHead({
  title: `${config.nativeName} - Newsar`,
})
</script>

<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-12 border-b ">
      <Container>
        <div class="flex-1">
          <div class="flex items-center gap-3 mb-4">
            <Badge color="primary" size="lg">{{ config.nativeName }}</Badge>
          </div>
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            {{ config.heroTitle }}
          </h1>
          <p class="text-lg text-ink-3 mb-6">
            {{ config.heroSubtitle }}
          </p>
          <div class="flex flex-col sm:flex-row gap-3">
            <Button
              :to="`/stories?language=${langCode}`"
              size="lg"
              icon="i-heroicons-rectangle-group"
              label="Explore Stories"
            />
            <Button
              to="/"
              size="lg"
              color="gray"
              icon="i-heroicons-globe-alt"
              label="All Languages"
            />
          </div>
        </div>
      </Container>
    </section>

    <!-- Main Content Grid -->
    <section class="py-8">
      <Container>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Main Content -->
          <div class="lg:col-span-2 space-y-12">
            <!-- Hero Story -->
            <div v-if="dashboardData?.heroStory" class="space-y-4">
              <div class="flex items-center justify-between">
                <h2 class="text-2xl font-bold text-ink flex items-center gap-2">
                  <Icon name="i-heroicons-fire" class="w-6 h-6 text-red-500" />
                  Top Trending Story
                </h2>
                <Badge :color="getStatusColor(dashboardData.heroStory.status)" size="lg">
                  {{ dashboardData.heroStory.status }}
                </Badge>
              </div>

              <Card class="hover:shadow-xl transition-shadow">
                <template #header>
                  <div class="space-y-3">
                    <h3 class="text-2xl font-bold text-ink">
                      {{ dashboardData.heroStory.title || dashboardData.heroStory.name }}
                    </h3>
                    <p v-if="dashboardData.heroStory.description" class="text-ink-3">
                      {{ dashboardData.heroStory.description }}
                    </p>
                  </div>
                </template>

                <div class="space-y-4">
                  <div v-if="dashboardData.heroStory.entities?.length" class="flex flex-wrap gap-2">
                    <Badge
                      v-for="entity in dashboardData.heroStory.entities"
                      :key="entity.id"
                      :color="
                        entity.type === 'person' ? 'blue' :
                        entity.type === 'organization' ? 'green' :
                        entity.type === 'location' ? 'orange' :
                        'purple'
                      "
                      size="sm"
                    >
                      {{ entity.name }}
                    </Badge>
                  </div>

                  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <div class="text-ink-3">Articles</div>
                      <div class="text-lg font-semibold">{{ dashboardData.heroStory.articleCount }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Sources</div>
                      <div class="text-lg font-semibold">{{ dashboardData.heroStory.sourceCount }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Diversity</div>
                      <div class="text-lg font-semibold">
                        {{ ((dashboardData.heroStory.sourceDiversityScore || 0) * 100).toFixed(0) }}%
                      </div>
                    </div>
                    <div>
                      <div class="text-ink-3">Updated</div>
                      <div class="text-lg font-semibold">{{ formatDate(dashboardData.heroStory.lastUpdated) }}</div>
                    </div>
                  </div>

                  <div v-if="dashboardData.heroStory.leftCount || dashboardData.heroStory.centerCount || dashboardData.heroStory.rightCount" class="space-y-2">
                    <div class="text-sm font-medium text-ink-2">Coverage by Political Leaning</div>
                    <div class="flex gap-2">
                      <div v-if="dashboardData.heroStory.leftCount" class="flex-1 bg-blue-100 dark:bg-blue-900/30 rounded px-3 py-2 text-center">
                        <div class="text-xs text-blue-600">Left</div>
                        <div class="font-semibold text-blue-900">{{ dashboardData.heroStory.leftCount }}</div>
                      </div>
                      <div v-if="dashboardData.heroStory.centerCount" class="flex-1 bg-paper-2  rounded px-3 py-2 text-center">
                        <div class="text-xs text-ink-3">Center</div>
                        <div class="font-semibold text-ink">{{ dashboardData.heroStory.centerCount }}</div>
                      </div>
                      <div v-if="dashboardData.heroStory.rightCount" class="flex-1 bg-red-100 dark:bg-red-900/30 rounded px-3 py-2 text-center">
                        <div class="text-xs text-red-600">Right</div>
                        <div class="font-semibold text-red-900">{{ dashboardData.heroStory.rightCount }}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <template #footer>
                  <Button
                    :to="`/stories/${dashboardData.heroStory.id}`"
                    color="primary"
                    size="lg"
                    block
                    icon="i-heroicons-arrow-right"
                    trailing
                  >
                    Compare All Perspectives
                  </Button>
                </template>
              </Card>
            </div>

            <!-- Articles by Source -->
            <div v-if="dashboardData?.articlesBySource?.length" class="space-y-8">
              <h2 class="text-2xl font-bold text-ink">
                Latest from Each Source
              </h2>

              <div
                v-for="source in dashboardData.articlesBySource"
                :key="source.feed.id"
                class="space-y-4"
              >
                <div class="flex items-center justify-between pb-2 border-b">
                  <div class="flex items-center gap-3">
                    <h3 class="text-xl font-semibold text-ink">
                      {{ source.feed.name }}
                    </h3>
                    <Badge
                      v-if="source.feed.knownBias !== null"
                      :color="getBiasColor(source.feed.knownBias)"
                      size="sm"
                    >
                      {{ getBiasLabel(source.feed.knownBias) }}
                    </Badge>
                  </div>
                  <div v-if="source.feed.region" class="text-sm text-ink-3">
                    {{ source.feed.region }}
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <Card
                    v-for="article in source.articles"
                    :key="article.id"
                    class="hover: transition-shadow"
                  >
                    <template #header>
                      <div class="space-y-2">
                        <div class="flex items-center gap-2">
                          <span class="text-xs text-ink-3">
                            {{ formatDate(article.publishedAt) }}
                          </span>
                        </div>
                        <h4 class="text-base font-semibold text-ink line-clamp-2">
                          {{ article.title }}
                        </h4>
                      </div>
                    </template>

                    <div class="space-y-3">
                      <p class="text-sm text-ink-3 line-clamp-2">
                        {{ article.content || 'No description available.' }}
                      </p>

                      <div v-if="article.keywords?.length" class="flex flex-wrap gap-1">
                        <Badge
                          v-for="keyword in article.keywords"
                          :key="keyword"
                          color="gray"
                          variant="subtle"
                          size="xs"
                        >
                          {{ keyword }}
                        </Badge>
                      </div>
                    </div>

                    <template #footer>
                      <div class="flex gap-2">
                        <Button
                          :to="`/articles/${article.id}`"
                          color="primary"
                          size="sm"
                          class="flex-1"
                        >
                          Read Article
                        </Button>
                        <Button
                          :href="article.url"
                          target="_blank"
                          icon="i-heroicons-arrow-top-right-on-square"
                          color="gray"
                          variant="ghost"
                          size="sm"
                          square
                          title="Read from source"
                        />
                      </div>
                    </template>
                  </Card>
                </div>

                <div class="flex justify-center pt-2">
                  <Button
                    :to="`/feed/${source.feed.id}`"
                    color="gray"
                    variant="ghost"
                    size="sm"
                    icon="i-heroicons-arrow-right"
                    trailing
                  >
                    View more from {{ source.feed.name }}
                  </Button>
                </div>
              </div>
            </div>

            <!-- Empty State -->
            <div v-if="!dashboardData?.heroStory && !dashboardData?.articlesBySource?.length" class="text-center py-12">
              <Icon name="i-heroicons-newspaper" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
              <p class="text-ink-3 mb-4">
                No {{ config.name }} articles have been processed yet.
              </p>
              <p class="text-sm text-ink-3">
                Check back soon as multilingual feeds are being collected and analyzed.
              </p>
            </div>
          </div>

          <!-- Sidebar -->
          <div class="lg:col-span-1 space-y-6">
            <div v-if="dashboardData?.trendingStories?.length" class="sticky top-20">
              <Card>
                <template #header>
                  <h3 class="text-lg font-bold text-ink flex items-center gap-2">
                    <Icon name="i-heroicons-chart-bar" class="w-5 h-5 text-accent" />
                    Trending Stories
                  </h3>
                </template>

                <div class="space-y-4">
                  <NuxtLink
                    v-for="story in dashboardData.trendingStories"
                    :key="story.id"
                    :to="`/stories/${story.id}`"
                    class="block p-3 rounded-sm hover:bg-paper-2  transition-colors"
                  >
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <h4 class="text-sm font-semibold text-ink line-clamp-2">
                        {{ story.title || story.name }}
                      </h4>
                      <Badge :color="getStatusColor(story.status)" size="xs">
                        {{ story.status }}
                      </Badge>
                    </div>
                    <div class="flex items-center gap-3 text-xs text-ink-3">
                      <span>{{ story.articleCount }} articles</span>
                      <span>{{ story.sourceCount }} sources</span>
                      <span>{{ formatDate(story.lastUpdated) }}</span>
                    </div>
                  </NuxtLink>
                </div>

                <template #footer>
                  <Button
                    :to="`/stories?language=${langCode}`"
                    color="gray"
                    variant="ghost"
                    size="sm"
                    block
                    icon="i-heroicons-arrow-right"
                    trailing
                  >
                    View All Stories
                  </Button>
                </template>
              </Card>
            </div>
          </div>
        </div>
      </Container>
    </section>
  </div>
</template>
