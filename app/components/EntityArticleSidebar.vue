<template>
  <transition name="slide">
    <div v-if="entity" class="entity-sidebar">
      <!-- Header -->
      <div class="sidebar-header">
        <div class="entity-info">
          <Badge :color="entityColor" size="sm">{{ entity.type }}</Badge>
          <h3 class="entity-name">{{ entity.name }}</h3>
        </div>
        <button @click="$emit('close')" class="close-button">
          <Icon name="i-heroicons-x-mark" class="w-5 h-5" />
        </button>
      </div>

      <!-- Stats -->
      <div class="entity-stats">
        <div class="stat-item">
          <span class="stat-label">Trending Score</span>
          <div class="stat-value">
            <Progress :value="entity.trendingScore * 100" color="red" class="h-2" />
            <span class="stat-number">{{ (entity.trendingScore * 100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="loading-state">
        <Icon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin text-gray-400 dark:text-slate-500" />
        <p class="text-sm text-gray-500 dark:text-slate-400">Loading articles...</p>
      </div>

      <!-- Articles List -->
      <div v-else-if="articles && articles.length > 0" class="articles-list">
        <div class="articles-header">
          <h4 class="articles-title">Recent Articles</h4>
          <span class="articles-count">{{ articles.length }}</span>
        </div>

        <div class="articles-scroll">
          <article
            v-for="article in articles"
            :key="article.id"
            class="article-item"
          >
            <a
              :href="`/articles/${article.id}`"
              class="article-link"
              target="_blank"
            >
              <!-- Article Image -->
              <div v-if="article.imageUrl" class="article-image">
                <img :src="article.imageUrl" :alt="article.title" />
              </div>

              <!-- Article Content -->
              <div class="article-content">
                <h5 class="article-title">{{ article.title }}</h5>

                <!-- Metadata -->
                <div class="article-meta">
                  <time class="article-date">
                    {{ formatDate(article.publishedAt) }}
                  </time>
                  <div v-if="article.sentiment" class="article-sentiment">
                    <Icon
                      :name="getSentimentIcon(article.sentiment)"
                      class="w-3 h-3"
                      :class="getSentimentColor(article.sentiment)"
                    />
                    <span>{{ formatSentiment(article.sentiment) }}</span>
                  </div>
                </div>

                <!-- Relevance Score -->
                <div v-if="article.relevanceScore" class="relevance-bar">
                  <div
                    class="relevance-fill"
                    :style="{ width: (article.relevanceScore * 100) + '%' }"
                  />
                </div>
              </div>
            </a>
          </article>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <Icon name="i-heroicons-newspaper" class="w-12 h-12 text-gray-300 dark:text-slate-600 mb-3" />
        <p class="text-sm text-gray-500 dark:text-slate-400">No articles found for this entity</p>
      </div>

      <!-- View All Button -->
      <div v-if="entity.slug" class="sidebar-footer">
        <Button
          :to="`/${entity.type}/${entity.slug}`"
          color="primary"
          class="w-full"
          label="View Full Profile"
          icon="i-heroicons-arrow-right"
        />
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
interface Entity {
  id: number
  name: string
  type: string
  slug: string | null
  trendingScore: number
}

interface Article {
  id: number
  title: string
  url: string
  publishedAt: Date | string
  imageUrl: string | null
  relevanceScore?: number
  sentiment?: number
}

const props = defineProps<{
  entity: Entity | null
}>()

const emit = defineEmits<{
  close: []
}>()

const articles = ref<Article[]>([])
const loading = ref(false)

const entityColor = computed(() => {
  const colors: Record<string, 'blue' | 'green' | 'orange' | 'purple' | 'teal'> = {
    person: 'blue',
    organization: 'green',
    location: 'orange',
    event: 'purple',
    topic: 'teal',
  }
  return colors[props.entity?.type || ''] || 'gray'
})

// Fetch articles when entity changes
watch(() => props.entity, async (newEntity) => {
  if (!newEntity) {
    articles.value = []
    return
  }

  loading.value = true
  try {
    const data = await $fetch(`/api/entities/${newEntity.type}/${newEntity.slug}`)
    articles.value = data.recentArticles || []
  } catch (error) {
    console.error('Error fetching articles:', error)
    articles.value = []
  } finally {
    loading.value = false
  }
}, { immediate: true })

function formatDate(date: Date | string): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getSentimentIcon(sentiment: number): string {
  if (sentiment > 0.2) return 'i-heroicons-arrow-trending-up'
  if (sentiment < -0.2) return 'i-heroicons-arrow-trending-down'
  return 'i-heroicons-minus'
}

function getSentimentColor(sentiment: number): string {
  if (sentiment > 0.2) return 'text-green-500'
  if (sentiment < -0.2) return 'text-red-500'
  return 'text-gray-400'
}

function formatSentiment(sentiment: number): string {
  if (sentiment > 0.2) return 'Positive'
  if (sentiment < -0.2) return 'Negative'
  return 'Neutral'
}
</script>

<style scoped>
.entity-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: white;
  border-left: 1px solid #e5e7eb;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 50;
}

:root.dark .entity-sidebar {
  background: #1e293b;
  border-left-color: #334155;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

:root.dark .sidebar-header {
  border-bottom-color: #334155;
}

.entity-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-name {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0;
  line-height: 1.3;
}

:root.dark .entity-name {
  color: #f1f5f9;
}

.close-button {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

:root.dark .close-button {
  background: #334155;
  border-color: #475569;
  color: #94a3b8;
}

.close-button:hover {
  background: #f3f4f6;
  color: #111827;
}

:root.dark .close-button:hover {
  background: #475569;
  color: #f1f5f9;
}

.entity-stats {
  padding: 16px 20px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}

:root.dark .entity-stats {
  background: #0f172a;
  border-bottom-color: #334155;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

:root.dark .stat-label {
  color: #94a3b8;
}

.stat-value {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-number {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

:root.dark .stat-number {
  color: #f1f5f9;
}

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.articles-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.articles-header {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e5e7eb;
}

:root.dark .articles-header {
  border-bottom-color: #334155;
}

.articles-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

:root.dark .articles-title {
  color: #f1f5f9;
}

.articles-count {
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  background: #f3f4f6;
  padding: 2px 8px;
  border-radius: 12px;
}

:root.dark .articles-count {
  color: #94a3b8;
  background: #334155;
}

.articles-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.article-item {
  margin-bottom: 12px;
}

.article-link {
  display: block;
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  transition: all 0.2s;
  text-decoration: none;
}

:root.dark .article-link {
  background: #0f172a;
  border-color: #334155;
}

.article-link:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
  transform: translateY(-1px);
}

.article-image {
  width: 100%;
  height: 120px;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
  background: #f3f4f6;
}

:root.dark .article-image {
  background: #334155;
}

.article-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.article-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.article-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  line-height: 1.4;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

:root.dark .article-title {
  color: #f1f5f9;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #6b7280;
}

:root.dark .article-meta {
  color: #94a3b8;
}

.article-date {
  display: flex;
  align-items: center;
  gap: 4px;
}

.article-sentiment {
  display: flex;
  align-items: center;
  gap: 4px;
}

.relevance-bar {
  height: 3px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

:root.dark .relevance-bar {
  background: #334155;
}

.relevance-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  transition: width 0.3s ease;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

:root.dark .sidebar-footer {
  border-top-color: #334155;
  background: #0f172a;
}

/* Slide transition */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from {
  transform: translateX(100%);
}

.slide-leave-to {
  transform: translateX(100%);
}

/* Responsive */
@media (max-width: 768px) {
  .entity-sidebar {
    width: 100%;
    max-width: 100vw;
  }
}
</style>
