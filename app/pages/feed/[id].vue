<script setup lang="ts">
const route = useRoute()
const feedId = parseInt(route.params.id as string)

const { data: feed } = await useFetch(`/api/sources/${feedId}`)
const { data: articles } = await useFetch('/api/articles', {
  query: {
    feed: feedId,
    limit: 50,
  },
})

function getBiasLabel(bias: number | null) {
  if (bias === null) return 'Unknown'
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

function formatDate(date: string | Date | null) {
  if (!date) return 'Never'
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))

  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return d.toLocaleDateString()
}
</script>

<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-12 border-b ">
      <Container>
        <div class="max-w-4xl mx-auto">
          <Button
            to="/sources"
            icon="i-heroicons-arrow-left"
            color="gray"
            variant="ghost"
            class="mb-6"
          >
            Back to Sources
          </Button>

          <div v-if="feed">
            <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
              {{ feed.name }}
            </h1>

            <div class="flex items-center gap-4 mb-6">
              <Badge
                :color="getBiasColor(feed.knownBias)"
                size="lg"
              >
                {{ getBiasLabel(feed.knownBias) }}
              </Badge>
              <span v-if="feed.category" class="text-ink-3">{{ feed.category }}</span>
              <span v-if="feed.region" class="text-ink-3">{{ feed.region }}</span>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center bg-panel rounded-sm p-6 ">
              <div>
                <div class="text-3xl font-bold text-accent">{{ feed.articleCount || 0 }}</div>
                <div class="text-sm text-ink-3">Total Articles</div>
              </div>
              <div v-if="feed.knownBias !== null">
                <div class="text-2xl font-bold" :class="{
                  'text-blue-700': feed.knownBias <= -0.6,
                  'text-sky-600': feed.knownBias > -0.6 && feed.knownBias <= -0.2,
                  'text-ink-2': feed.knownBias > -0.2 && feed.knownBias < 0.2,
                  'text-orange-600': feed.knownBias >= 0.2 && feed.knownBias < 0.6,
                  'text-red-700': feed.knownBias >= 0.6,
                }">{{ getBiasLabel(feed.knownBias) }}</div>
                <div class="text-sm text-ink-3">Bias ({{ feed.knownBias.toFixed(1) }})</div>
              </div>
              <div>
                <div class="text-3xl font-bold text-ink">{{ articles?.length || 0 }}</div>
                <div class="text-sm text-ink-3">Recent Articles</div>
              </div>
              <div>
                <div class="text-sm font-medium text-ink">{{ formatDate(feed.lastFetchedAt) }}</div>
                <div class="text-sm text-ink-3">Last Updated</div>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- Articles List -->
    <section class="py-12">
      <Container>
        <div class="max-w-6xl mx-auto">
          <h2 class="text-2xl font-bold mb-6 ">Recent Articles</h2>

          <div v-if="articles && articles.length > 0" class="grid grid-cols-1 gap-6">
            <Card
              v-for="article in articles"
              :key="article.id"
              class=" transition-shadow"
            >
              <div class="flex gap-6">
                <!-- Article Image -->
                <div v-if="article.imageLocalPath || article.imageUrl" class="flex-shrink-0">
                  <img
                    :src="article.imageLocalPath || article.imageUrl"
                    :alt="article.title"
                    class="w-48 h-32 object-cover rounded-sm"
                    @error="$event.target.parentElement.style.display='none'"
                  />
                </div>

                <!-- Article Content -->
                <div class="flex-1 min-w-0">
                  <NuxtLink
                    :to="`/articles/${article.id}`"
                    class="block mb-2"
                  >
                    <h3 class="font-semibold text-xl hover:text-accent transition-colors line-clamp-2">
                      {{ article.title }}
                    </h3>
                  </NuxtLink>

                  <p v-if="article.content" class="text-ink-3 line-clamp-3 mb-3">
                    {{ article.content }}
                  </p>

                  <div class="flex items-center gap-4 text-sm text-ink-3 mb-3">
                    <span v-if="article.publishedAt">
                      {{ formatDate(article.publishedAt) }}
                    </span>
                    <span v-if="article.author" class="truncate">
                      by {{ article.author }}
                    </span>
                    <Badge v-if="article.language" color="gray" size="xs">
                      {{ article.language }}
                    </Badge>
                    <Badge v-if="article.bias !== null" :color="getBiasColor(article.bias)" size="xs">
                      Bias: {{ article.bias.toFixed(2) }}
                    </Badge>
                  </div>

                  <div v-if="article.keywords && article.keywords.length > 0" class="flex flex-wrap gap-2">
                    <Badge
                      v-for="(keyword, idx) in article.keywords.slice(0, 5)"
                      :key="idx"
                      color="blue"
                      variant="subtle"
                      size="xs"
                    >
                      {{ keyword }}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div v-else-if="articles && articles.length === 0" class="text-center py-12">
            <p class="text-ink-3">No articles found from this source yet.</p>
          </div>

          <div v-else class="text-center py-12">
            <p class="text-ink-3">Loading articles...</p>
          </div>
        </div>
      </Container>
    </section>
  </div>
</template>
