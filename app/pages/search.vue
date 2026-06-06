<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const searchQuery = ref((route.query.q as string) || '')
const searchType = ref((route.query.type as string) || 'all')
const useSemanticSearch = ref(false)
const semanticResults = ref<any>(null)
const semanticPending = ref(false)
const semanticError = ref<string | null>(null)

const { data: results, pending, refresh } = await useFetch('/api/search', {
  query: {
    q: searchQuery,
    type: searchType,
  },
})

const searchTypeOptions = [
  { label: 'All Results', value: 'all' },
  { label: 'Articles', value: 'articles' },
  { label: 'Entities', value: 'entities' },
  { label: 'Keywords', value: 'keywords' },
  { label: 'Markets', value: 'stocks' },
]

async function performSemanticSearch() {
  if (!searchQuery.value || searchQuery.value.length < 2) return
  semanticPending.value = true
  semanticError.value = null
  try {
    const data = await $fetch('/api/search/semantic', {
      query: { q: searchQuery.value, limit: 20 },
    })
    semanticResults.value = data
    if (data.error) {
      semanticError.value = data.error
    }
  } catch (error) {
    semanticError.value = 'Semantic search is temporarily unavailable.'
    console.error('Semantic search error:', error)
  } finally {
    semanticPending.value = false
  }
}

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

function performSearch() {
  router.push({
    path: '/search',
    query: {
      q: searchQuery.value,
      type: searchType.value,
    },
  })
  if (useSemanticSearch.value) {
    performSemanticSearch()
  } else {
    semanticResults.value = null
    refresh()
  }
}

watch([searchQuery, searchType], () => {
  if (searchQuery.value.length >= 2) {
    performSearch()
  }
}, { deep: true })

watch(useSemanticSearch, (val) => {
  if (val && searchQuery.value.length >= 2) {
    performSemanticSearch()
  } else {
    semanticResults.value = null
    if (searchQuery.value.length >= 2) {
      refresh()
    }
  }
})
</script>

<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-12 border-b ">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            Search News
          </h1>
          <p class="text-lg text-ink-3 mb-8">
            Search across all articles, entities, and keywords to find the information you need.
          </p>
        </div>
      </Container>
    </section>

    <!-- Search Controls -->
    <section class="bg-paper py-6 border-b  sticky top-16 z-40 backdrop-blur">
      <Container>
        <div class="flex flex-col md:flex-row gap-4 items-center">
          <div class="flex-1 w-full">
            <Input
              v-model="searchQuery"
              icon="i-heroicons-magnifying-glass"
              placeholder="Search articles, entities, keywords..."
              size="lg"
              @keyup.enter="performSearch"
            />
          </div>

          <div class="flex gap-3 w-full md:w-auto">
            <SelectMenu
              v-model="searchType"
              :options="searchTypeOptions"
              size="lg"
              class="w-full md:w-48"
            />

            <Button
              icon="i-heroicons-magnifying-glass"
              size="lg"
              :disabled="searchQuery.length < 2"
              @click="performSearch"
            >
              Search
            </Button>
          </div>
        </div>

        <!-- Semantic Search Toggle -->
        <div class="mt-4 flex items-center gap-3">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="useSemanticSearch"
              type="checkbox"
              class="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
            />
            <span class="text-sm font-medium text-ink-2">AI-powered semantic search</span>
          </label>
          <Badge v-if="useSemanticSearch" color="purple" variant="subtle" size="xs">
            Uses embeddings for meaning-based matching
          </Badge>
        </div>
      </Container>
    </section>

    <!-- Search Results -->
    <section class="py-12">
      <Container>
        <!-- Semantic Search Results -->
        <div v-if="useSemanticSearch && semanticPending" class="text-center py-12">
          <Icon name="i-heroicons-arrow-path" class="w-8 h-8 text-purple-500 animate-spin mx-auto" />
          <p class="text-ink-3 mt-4">Running semantic search...</p>
        </div>

        <div v-else-if="useSemanticSearch && semanticError" class="text-center py-12">
          <Icon name="i-heroicons-exclamation-triangle" class="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <p class="text-ink-3">{{ semanticError }}</p>
          <p class="text-sm text-ink-3 mt-2">Try switching to standard text search.</p>
        </div>

        <div v-else-if="useSemanticSearch && semanticResults?.articles?.length" class="space-y-6">
          <div class="mb-6">
            <h2 class="text-2xl font-bold text-ink">
              Semantic Results
              <span class="text-ink-3 text-lg ml-2">({{ semanticResults.articles.length }})</span>
            </h2>
            <p class="text-sm text-ink-3 mt-1">Ranked by meaning similarity using AI embeddings</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card
              v-for="article in semanticResults.articles"
              :key="article.id"
              class="hover:shadow-lg transition-shadow"
            >
              <template #header>
                <div class="space-y-2">
                  <div class="flex items-center gap-2">
                    <Badge
                      v-if="article.feedName"
                      color="gray"
                      size="xs"
                    >
                      {{ article.feedName }}
                    </Badge>
                    <Badge
                      v-if="article.bias !== null"
                      :color="getBiasColor(article.bias)"
                      size="xs"
                    >
                      {{ getBiasLabel(article.bias) }}
                    </Badge>
                    <Badge color="purple" variant="subtle" size="xs">
                      {{ (article.similarity * 100).toFixed(0) }}% match
                    </Badge>
                    <span class="text-xs text-ink-3 ml-auto">
                      {{ formatDate(article.publishedAt) }}
                    </span>
                  </div>
                  <h3 class="text-lg font-semibold text-ink">
                    {{ article.title }}
                  </h3>
                </div>
              </template>

              <p v-if="article.content" class="text-sm text-ink-3 line-clamp-3">
                {{ article.content }}
              </p>

              <template #footer>
                <div class="flex gap-2">
                  <Button
                    :to="`/articles/${article.id}`"
                    color="gray"
                    size="sm"
                    block
                  >
                    Read More
                  </Button>
                  <Button
                    :href="article.url"
                    target="_blank"
                    icon="i-heroicons-arrow-top-right-on-square"
                    color="gray"
                    variant="ghost"
                    size="sm"
                    square
                  />
                </div>
              </template>
            </Card>
          </div>
        </div>

        <div v-else-if="useSemanticSearch && semanticResults && !semanticResults.articles?.length && searchQuery.length >= 2" class="text-center py-12">
          <Icon name="i-heroicons-x-circle" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
          <p class="text-ink-3">No semantic matches found for "{{ searchQuery }}"</p>
        </div>

        <!-- Standard Search Results -->
        <div v-else-if="!useSemanticSearch && pending" class="text-center py-12">
          <Icon name="i-heroicons-arrow-path" class="w-8 h-8 text-accent animate-spin mx-auto" />
          <p class="text-ink-3 mt-4">Searching...</p>
        </div>

        <div v-else-if="searchQuery.length < 2" class="text-center py-12">
          <Icon name="i-heroicons-magnifying-glass" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
          <p class="text-ink-3">Enter at least 2 characters to search</p>
        </div>

        <div
          v-else-if="!useSemanticSearch && !results?.articles?.length && !results?.entities?.length && !results?.keywords?.length && !results?.stocks?.length"
          class="text-center py-12"
        >
          <Icon name="i-heroicons-x-circle" class="w-12 h-12 text-ink-4 mx-auto mb-4" />
          <p class="text-ink-3">No results found for "{{ searchQuery }}"</p>
        </div>

        <div v-else-if="!useSemanticSearch" class="space-y-12">
          <!-- Articles Results -->
          <div v-if="results?.articles && results.articles.length > 0">
            <div class="mb-6">
              <h2 class="text-2xl font-bold text-ink">
                Articles
                <span class="text-ink-3 text-lg ml-2">({{ results.articles.length }})</span>
              </h2>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card
                v-for="article in results.articles"
                :key="article.id"
                class="hover:shadow-lg transition-shadow"
              >
                <template #header>
                  <div class="space-y-2">
                    <div class="flex items-center gap-2">
                      <Badge
                        v-if="article.feedName"
                        color="gray"
                        size="xs"
                      >
                        {{ article.feedName }}
                      </Badge>
                      <Badge
                        v-if="article.bias !== null"
                        :color="getBiasColor(article.bias)"
                        size="xs"
                      >
                        {{ getBiasLabel(article.bias) }}
                      </Badge>
                      <span class="text-xs text-ink-3 ml-auto">
                        {{ formatDate(article.publishedAt) }}
                      </span>
                    </div>
                    <h3 class="text-lg font-semibold text-ink">
                      {{ article.title }}
                    </h3>
                  </div>
                </template>

                <p v-if="article.content" class="text-sm text-ink-3 line-clamp-3">
                  {{ article.content }}
                </p>

                <template #footer>
                  <div class="flex gap-2">
                    <Button
                      :to="`/articles/${article.id}`"
                      color="gray"
                      size="sm"
                      block
                    >
                      Read More
                    </Button>
                    <Button
                      :href="article.url"
                      target="_blank"
                      icon="i-heroicons-arrow-top-right-on-square"
                      color="gray"
                      variant="ghost"
                      size="sm"
                      square
                    />
                  </div>
                </template>
              </Card>
            </div>
          </div>

          <!-- Entities Results -->
          <div v-if="results?.entities && results.entities.length > 0">
            <div class="mb-6">
              <h2 class="text-2xl font-bold text-ink">
                Entities
                <span class="text-ink-3 text-lg ml-2">({{ results.entities.length }})</span>
              </h2>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NuxtLink
                v-for="entity in results.entities"
                :key="entity.id"
                :to="entity.slug ? `/${entity.type}/${entity.slug}` : undefined"
                class="block"
              >
                <Card class="hover:shadow-lg transition-shadow h-full">
                  <div class="flex items-start gap-3">
                    <img
                      v-if="entity.imageUrl"
                      :src="entity.imageUrl"
                      :alt="entity.name"
                      class="w-10 h-10 rounded-full object-cover flex-shrink-0 mt-0.5"
                    />
                    <div
                      v-else
                      class="w-10 h-10 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center text-white text-sm font-bold"
                      :class="
                        entity.type === 'person' ? 'bg-blue-500' :
                        entity.type === 'organization' ? 'bg-green-500' :
                        entity.type === 'location' ? 'bg-orange-500' :
                        'bg-purple-500'
                      "
                    >
                      {{ entity.type === 'person' ? 'P' : entity.type === 'organization' ? 'O' : entity.type === 'location' ? 'L' : 'E' }}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-semibold text-ink truncate">{{ entity.name }}</span>
                        <Badge
                          :color="
                            entity.type === 'person' ? 'blue' :
                            entity.type === 'organization' ? 'green' :
                            entity.type === 'location' ? 'orange' :
                            'purple'
                          "
                          size="xs"
                        >
                          {{ entity.type }}
                        </Badge>
                      </div>
                      <p v-if="entity.shortDescription" class="text-sm text-ink-3 line-clamp-2 mb-1.5">
                        {{ entity.shortDescription }}
                      </p>
                      <div class="flex items-center gap-3 text-xs text-ink-3">
                        <span>{{ entity.articleCount }} article{{ entity.articleCount !== 1 ? 's' : '' }}</span>
                        <span v-if="entity.mentionCount">{{ entity.mentionCount }} mentions</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </NuxtLink>
            </div>
          </div>

          <!-- Markets Results -->
          <div v-if="results?.stocks && results.stocks.length > 0">
            <div class="mb-6">
              <h2 class="text-2xl font-bold text-ink">
                Markets
                <span class="text-ink-3 text-lg ml-2">({{ results.stocks.length }})</span>
              </h2>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <NuxtLink
                v-for="stock in results.stocks"
                :key="stock.id"
                :to="`/stocks/${stock.ticker}`"
                class="block"
              >
                <Card class="hover:shadow-lg transition-shadow h-full">
                  <div class="flex items-start gap-3">
                    <div
                      class="w-10 h-10 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center text-white text-xs font-bold bg-amber-600"
                    >
                      {{ stock.ticker.slice(0, 2) }}
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-mono font-bold text-ink">{{ stock.ticker }}</span>
                        <Badge v-if="stock.exchange" color="gray" size="xs">
                          {{ stock.exchange }}
                        </Badge>
                      </div>
                      <p class="text-sm text-ink-3 truncate mb-1.5">
                        {{ stock.companyName }}
                      </p>
                      <div class="flex items-center gap-3 text-xs">
                        <span v-if="stock.price != null" class="font-mono font-semibold text-ink">
                          ${{ stock.price.toFixed(2) }}
                        </span>
                        <span
                          v-if="stock.changePercent != null"
                          class="font-mono font-semibold"
                          :class="stock.changePercent >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                        >
                          {{ stock.changePercent >= 0 ? '+' : '' }}{{ stock.changePercent.toFixed(2) }}%
                        </span>
                        <span v-if="stock.sector" class="text-ink-4">{{ stock.sector }}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </NuxtLink>
            </div>
          </div>

          <!-- Keywords Results -->
          <div v-if="results?.keywords && results.keywords.length > 0">
            <div class="mb-6">
              <h2 class="text-2xl font-bold text-ink">
                Keywords
                <span class="text-ink-3 text-lg ml-2">({{ results.keywords.length }})</span>
              </h2>
            </div>

            <div class="flex flex-wrap gap-2">
              <Card
                v-for="keyword in results.keywords"
                :key="keyword.keyword"
                class="hover: transition-shadow"
              >
                <div class="flex items-center gap-2">
                  <Badge color="gray" size="md">
                    {{ keyword.keyword }}
                  </Badge>
                  <span class="text-sm text-ink-3">
                    {{ keyword.articleCount }} article{{ keyword.articleCount !== 1 ? 's' : '' }}
                  </span>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </Container>
    </section>
  </div>
</template>
