<script setup lang="ts">
interface Article {
  id: number
  title: string
  url: string
  feedName: string | null
  publishedAt: string | Date | null
  summary: string | null
  sentiment: number | null
  politicalBias: number | null
  sensationalism: number | null
  factOpinionRatio: number | null
  sourceCountCited: number | null
  articleType: string | null
  similarity: number | null
  imageUrl: string | null
  imageLocalPath: string | null
}

const props = defineProps<{
  article: Article
  framing?: string
}>()

function formatRelativeDate(date: string | Date | null) {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getSentimentColor(sentiment: number | null) {
  if (sentiment === null) return 'bg-gray-300'
  if (sentiment >= 0.3) return 'bg-emerald-500'
  if (sentiment >= -0.3) return 'bg-amber-400'
  return 'bg-red-500'
}

function getSentimentLabel(sentiment: number | null) {
  if (sentiment === null) return 'No data'
  if (sentiment >= 0.3) return 'Positive'
  if (sentiment >= -0.3) return 'Neutral'
  return 'Negative'
}

function sensationalismLabel(value: number | null): { text: string; class: string } {
  if (value === null) return { text: '', class: '' }
  if (value <= 0.3) return { text: 'Measured', class: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30' }
  if (value <= 0.6) return { text: 'Mixed tone', class: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30' }
  return { text: 'Sensational', class: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30' }
}

function factualityLabel(value: number | null): { text: string; class: string } {
  if (value === null) return { text: '', class: '' }
  if (value >= 0.7) return { text: 'Factual', class: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30' }
  if (value >= 0.4) return { text: 'Mixed', class: 'text-ink-3 bg-paper-2' }
  return { text: 'Opinion', class: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/30' }
}
</script>

<template>
  <article class="group border border-rule rounded-lg p-3.5 hover:border-rule-soft hover:shadow-sm transition-all bg-panel">
    <!-- Source + Date row -->
    <div class="flex items-center justify-between text-xs mb-2">
      <span class="font-medium text-ink-2 truncate">{{ article.feedName || 'Unknown source' }}</span>
      <span class="text-ink-4 flex-shrink-0 ml-2">{{ formatRelativeDate(article.publishedAt) }}</span>
    </div>

    <!-- Title -->
    <NuxtLink :to="`/articles/${article.id}`" class="block mb-2">
      <h4 class="text-sm font-semibold text-ink leading-snug line-clamp-2 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
        {{ article.title }}
      </h4>
    </NuxtLink>

    <!-- Summary snippet -->
    <p v-if="article.summary" class="text-xs text-ink-3 leading-relaxed line-clamp-3 mb-3">
      {{ article.summary }}
    </p>

    <!-- Quality badges row -->
    <div class="flex flex-wrap gap-1.5 mb-2.5">
      <span
        v-if="article.sensationalism !== null && article.sensationalism !== undefined"
        class="px-1.5 py-0.5 rounded text-[10px] font-medium"
        :class="sensationalismLabel(article.sensationalism).class"
      >
        {{ sensationalismLabel(article.sensationalism).text }}
      </span>
      <span
        v-if="article.factOpinionRatio !== null && article.factOpinionRatio !== undefined"
        class="px-1.5 py-0.5 rounded text-[10px] font-medium"
        :class="factualityLabel(article.factOpinionRatio).class"
      >
        {{ factualityLabel(article.factOpinionRatio).text }}
      </span>
      <span
        v-if="article.sourceCountCited && article.sourceCountCited > 0"
        class="px-1.5 py-0.5 rounded text-[10px] font-medium text-ink-3 bg-paper-2"
      >
        {{ article.sourceCountCited }} {{ article.sourceCountCited === 1 ? 'source' : 'sources' }}
      </span>
    </div>

    <!-- Bottom row: sentiment + link -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <span
          class="w-2 h-2 rounded-full flex-shrink-0"
          :class="getSentimentColor(article.sentiment)"
          :title="getSentimentLabel(article.sentiment)"
        />
        <span class="text-[10px] text-ink-4 uppercase tracking-wide">
          {{ getSentimentLabel(article.sentiment) }}
        </span>
      </div>
      <a
        :href="article.url"
        target="_blank"
        rel="noopener noreferrer"
        class="text-ink-4 hover:text-ink-3 transition-colors"
        title="Read original"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  </article>
</template>
