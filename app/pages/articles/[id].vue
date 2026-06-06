<script setup lang="ts">
const route = useRoute()
const articleId = parseInt(route.params.id as string)

const { data: article } = await useFetch(`/api/articles/${articleId}`)

// Entity linking
const { linkEntities } = useEntityLinker()
const linkedContent = computed(() => {
  if (!article.value?.fullContent && !article.value?.content) return null
  if (!article.value?.entities || article.value.entities.length === 0) {
    return { html: article.value.fullContent || article.value.content, entities: [] }
  }

  const content = article.value.fullContent || article.value.content || ''
  return linkEntities(content, article.value.entities.map((e: any) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    slug: e.slug || e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    relevanceScore: e.relevance || 0
  })))
})

const contentParagraphs = computed(() => {
  if (!linkedContent.value?.html) return []
  return linkedContent.value.html.split('\n\n').filter((p: string) => p.trim())
})

// Similar articles (lazy-loaded)
const showSimilar = ref(false)
const loadingSimilar = ref(false)
const similarArticles = ref<any[]>([])

async function loadSimilarArticles() {
  if (similarArticles.value.length > 0) {
    showSimilar.value = !showSimilar.value
    return
  }
  loadingSimilar.value = true
  try {
    const data = await $fetch(`/api/articles/similar`, {
      query: { id: articleId, limit: 8, minSimilarity: 0.65 },
    })
    similarArticles.value = data as any[]
    showSimilar.value = true
  } catch (error) {
    console.error('Failed to load similar articles:', error)
  } finally {
    loadingSimilar.value = false
  }
}

// Admin check
const { data: session } = await useFetch('/api/auth/session')
const isAdmin = computed(() => !!session.value?.user)

const excluding = ref(false)
const excluded = ref(false)

async function excludeArticle() {
  if (!confirm('Exclude this article from the system?')) return
  excluding.value = true
  try {
    await $fetch('/api/admin/articles/exclude', {
      method: 'POST',
      body: { id: articleId, exclude: true },
    })
    excluded.value = true
  } catch (error) {
    console.error('Failed to exclude article:', error)
    alert('Failed to exclude article')
  } finally {
    excluding.value = false
  }
}

// Entity preview state
const showPreview = ref(false)
const previewEntityId = ref<number | null>(null)
const previewX = ref(0)
const previewY = ref(0)

function handleShowPreview(entityId: number, x: number, y: number) {
  previewEntityId.value = entityId
  previewX.value = x
  previewY.value = y
  showPreview.value = true
}

function handleHidePreview() {
  showPreview.value = false
  previewEntityId.value = null
}

// ─── Helper Functions ───

function getBiasLabel(bias: number | null | undefined) {
  if (bias === null || bias === undefined) return 'Unknown'
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
}

function getSentimentLabel(sentiment: number | null) {
  if (sentiment === null) return 'Unknown'
  if (sentiment <= -0.6) return 'Very Negative'
  if (sentiment <= -0.2) return 'Negative'
  if (sentiment < 0.2) return 'Neutral'
  if (sentiment < 0.6) return 'Positive'
  return 'Very Positive'
}

function getSentimentColor(sentiment: number | null) {
  if (sentiment === null) return ''
  if (sentiment <= -0.3) return 'neg'
  if (sentiment >= 0.3) return 'pos'
  return 'neu'
}

function getRoleLabel(role: string | null) {
  switch (role) {
    case 'protagonist': return 'Key Player'
    case 'antagonist': return 'Opposition'
    case 'context': return 'Context'
    default: return ''
  }
}

const FRAMING_DISPLAY: Record<string, string> = {
  economic_impact: 'Economic Impact',
  human_rights: 'Human Rights',
  national_security: 'National Security',
  public_health: 'Public Health',
  environmental: 'Environmental',
  political_strategy: 'Political Strategy',
  human_interest: 'Human Interest',
  legal_judicial: 'Legal & Judicial',
  technology: 'Technology',
  conflict: 'Conflict',
  diplomatic: 'Diplomatic',
  social_justice: 'Social Justice',
}

function framingDisplayName(framing: string | null): string {
  if (!framing) return 'Unclassified'
  return FRAMING_DISPLAY[framing] || framing.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function articleTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Unknown'
  const labels: Record<string, string> = {
    news_report: 'News Report',
    opinion: 'Opinion',
    analysis: 'Analysis',
    editorial: 'Editorial',
    press_release: 'Press Release',
  }
  return labels[type] || type
}

function sensationalismLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Unknown'
  if (score <= 0.3) return 'Measured'
  if (score <= 0.6) return 'Mixed Tone'
  return 'Sensational'
}

function factualityLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Unknown'
  if (score >= 0.7) return 'Factual'
  if (score >= 0.4) return 'Mixed'
  return 'Opinion-Heavy'
}

// ─── Intel-specific computed ───

const { getSubtypeLabel } = useEntitySubtypes()

function getEntityInitials(name: string): string {
  return name.split(/[\s-]+/).map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()
}

function getEntitySentimentClass(sentiment: string | null): string {
  switch (sentiment) {
    case 'positive': return 'ent-sent-pos'
    case 'negative': return 'ent-sent-neg'
    default: return 'ent-sent-neu'
  }
}

function getEntityTypeIcon(type: string): string {
  switch (type) {
    case 'person': return 'P'
    case 'organization': return 'O'
    case 'location': return 'L'
    case 'event': return 'E'
    case 'topic': return 'T'
    default: return '?'
  }
}

function getEntityTypeColor(type: string): string {
  switch (type) {
    case 'person': return 'var(--color-blue)'
    case 'organization': return 'var(--color-violet)'
    case 'location': return 'var(--color-green)'
    case 'event': return '#C2410C'
    case 'topic': return '#0D9488'
    default: return 'var(--color-ink-3)'
  }
}

function getEntityRoleClass(role: string | null): string {
  switch (role) {
    case 'protagonist': return 'key'
    case 'antagonist': return 'opp'
    default: return 'ctx'
  }
}

const standfirst = computed(() => {
  if (article.value?.analysis?.summary) {
    const text = article.value.analysis.summary
    const sentences = text.split(/(?<=[.!?])\s+/)
    return sentences.slice(0, 2).join(' ')
  }
  if (article.value?.content) {
    return article.value.content.slice(0, 300)
  }
  return ''
})

const publishedFormatted = computed(() => {
  if (!article.value?.publishedAt) return null
  const d = new Date(article.value.publishedAt)
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return {
    day: days[d.getUTCDay()],
    date: d.toISOString().split('T')[0],
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} GMT`,
    full: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  }
})

const articleRef = computed(() => {
  if (!article.value) return ''
  const d = article.value.publishedAt ? new Date(article.value.publishedAt) : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `NSR-${y}-${m}${day}-${String(articleId).padStart(3, '0')}`
})

const sortedEntities = computed(() => {
  if (!article.value?.entities) return []
  return [...article.value.entities].sort((a: any, b: any) => (b.relevance || 0) - (a.relevance || 0))
})

const entitiesByType = computed(() => {
  if (!sortedEntities.value.length) return []
  const typeOrder = ['person', 'organization', 'location', 'event', 'topic']
  const typeLabels: Record<string, string> = { person: 'People', organization: 'Organizations', location: 'Locations', event: 'Events', topic: 'Topics' }
  const grouped = new Map<string, any[]>()
  for (const e of sortedEntities.value) {
    const type = e.type || 'other'
    if (!grouped.has(type)) grouped.set(type, [])
    grouped.get(type)!.push(e)
  }
  return typeOrder
    .filter(t => grouped.has(t))
    .map(t => ({ type: t, label: typeLabels[t] || t, entities: grouped.get(t)! }))
})

const tonePosition = computed(() => {
  const score = article.value?.classification?.sensationalism
  if (score === null || score === undefined) return 50
  return Math.round(score * 80 + 10)
})

const articleImage = computed(() => {
  if (article.value?.imageLocalPath && article.value?.imageFetchStatus === 'success') {
    return article.value.imageLocalPath
  }
  return article.value?.imageUrl || null
})

// ─── SEO ───

const siteUrl = 'https://newsar.codejungle.org'
const pageUrl = `${siteUrl}/articles/${articleId}`
const pageTitle = article.value?.title ? `${article.value.title} - Newsar Intel` : 'Article - Newsar Intel'
const pageDescription = article.value?.analysis?.summary
  || article.value?.content?.slice(0, 160)
  || 'Read this article on Newsar'
const pageImage = article.value?.imageLocalPath && article.value?.imageFetchStatus === 'success'
  ? `${siteUrl}${article.value.imageLocalPath}`
  : article.value?.imageUrl || undefined

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogImage: pageImage,
  ogUrl: pageUrl,
  ogType: 'article',
  ogSiteName: 'Newsar',
  twitterCard: 'summary_large_image',
  twitterTitle: pageTitle,
  twitterDescription: pageDescription,
  twitterImage: pageImage,
  articlePublishedTime: article.value?.publishedAt || undefined,
  articleAuthor: article.value?.author || undefined,
  articleSection: article.value?.classification?.primaryFraming
    ? framingDisplayName(article.value.classification.primaryFraming)
    : undefined,
})

useHead({
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
  script: article.value ? [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.value.title,
      description: pageDescription,
      url: article.value.url,
      datePublished: article.value.publishedAt,
      ...(pageImage && { image: pageImage }),
      ...(article.value.author && { author: { '@type': 'Person', name: article.value.author } }),
      publisher: {
        '@type': 'Organization',
        name: article.value.feedName || 'Unknown',
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
      ...(article.value.keywords?.length && {
        keywords: article.value.keywords.map((kw: any) => typeof kw === 'string' ? kw : kw.keyword).join(', '),
      }),
      ...(article.value.classification?.language && {
        inLanguage: article.value.classification.language,
      }),
    }),
  }] : [],
})
</script>

<template>
  <div v-if="article">

    <!-- ═══ ARTICLE RIBBON (below site ribbon) ═══ -->
    <div class="bg-[#0C0A09] text-[#E7E2D4] px-6 h-8 flex items-center gap-6 font-mono text-[11px] tracking-wider overflow-hidden">
      <div class="ribbon-ticker flex gap-6 flex-1 overflow-hidden">
        <div v-if="article.feedName" class="whitespace-nowrap"><b class="text-[#F0EBDB] mr-1.5">SRC</b>{{ article.feedName }}</div>
        <div v-if="article.classification?.language" class="whitespace-nowrap"><b class="text-[#F0EBDB] mr-1.5">LANG</b>{{ article.classification.language.toUpperCase() }}</div>
        <div v-if="article.classification?.politicalBias !== null && article.classification?.politicalBias !== undefined" class="whitespace-nowrap"><b class="text-[#F0EBDB] mr-1.5">LEAN</b>{{ getBiasLabel(article.classification.politicalBias) }}</div>
        <div v-if="article.wordCount" class="whitespace-nowrap"><b class="text-[#F0EBDB] mr-1.5">WORDS</b>{{ article.wordCount.toLocaleString() }}</div>
        <div v-if="article.entities?.length" class="whitespace-nowrap"><b class="text-[#F0EBDB] mr-1.5">ENT</b>{{ article.entities.length }}</div>
      </div>
      <div class="flex gap-4 text-[#A7A08C] whitespace-nowrap">
        <span v-if="publishedFormatted">{{ publishedFormatted.day }} · {{ publishedFormatted.date }} · <b class="text-[#F0EBDB]">{{ publishedFormatted.time }}</b></span>
        <span>BRIEF <b class="text-[#F0EBDB]">{{ articleRef }}</b></span>
      </div>
    </div>

    <!-- ═══ ARTICLE NAV ACTIONS ═══ -->
    <div class="bg-paper border-b border-rule px-6 py-2 flex items-center justify-end gap-2">
      <a :href="article.url" target="_blank" rel="noopener" class="btn-nav">Original ↗</a>
      <button v-if="isAdmin && !excluded" class="btn-nav" :disabled="excluding" @click="excludeArticle">
        {{ excluding ? 'Excluding...' : 'Exclude' }}
      </button>
      <span v-if="excluded" class="font-mono text-[10px] px-2 py-1 bg-intel-red text-white rounded-sm tracking-wider uppercase">Excluded</span>
    </div>

    <div class="intel-wrap">

      <!-- ═══ BREADCRUMB ═══ -->
      <div class="intel-breadcrumb">
        <NuxtLink to="/" class="hover:text-accent-ink">News</NuxtLink>
        <span class="text-ink-4">/</span>
        <template v-if="article.story">
          <NuxtLink :to="`/stories/${article.story.id}`" class="hover:text-accent-ink">{{ (article.story.representativeTitle || article.story.name || '').slice(0, 40) }}</NuxtLink>
          <span class="text-ink-4">/</span>
        </template>
        <span class="text-ink">{{ article.title?.slice(0, 60) }}{{ (article.title?.length || 0) > 60 ? '…' : '' }}</span>
      </div>

      <!-- ═══ HERO ═══ -->
      <section class="hero-grid grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-10 py-6 pb-10 border-b-2 border-ink mb-10">
        <div>
          <!-- Classification strip -->
          <div class="flex items-center gap-4 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase text-ink-3 mb-4 flex-wrap">
            <span class="px-[7px] py-[3px] bg-ink text-paper rounded-sm">{{ articleRef }}</span>
            <span v-if="article.classification?.articleType" class="px-[7px] py-[3px] bg-intel-amber text-white rounded-sm">{{ articleTypeLabel(article.classification.articleType) }}</span>
            <span class="text-ink-4">·</span>
            <span v-if="article.classification?.language">{{ article.classification.language.toUpperCase() }}</span>
            <span v-if="article.classification?.primaryFraming" class="text-ink-4">·</span>
            <span v-if="article.classification?.primaryFraming">{{ framingDisplayName(article.classification.primaryFraming) }}</span>
          </div>

          <h1 class="font-serif text-[42px] font-semibold leading-[1.08] tracking-tight m-0 mb-4 text-balance">{{ article.title }}</h1>
          <p v-if="standfirst" class="standfirst font-serif text-lg leading-relaxed text-ink-2 max-w-[640px] m-0 mb-6 text-pretty">{{ standfirst }}</p>

          <!-- Byline -->
          <div class="flex items-center gap-4 flex-wrap font-mono text-[11px] text-ink-3 pt-4 border-t border-rule">
            <span v-if="article.author" class="flex items-center gap-2 text-ink font-semibold">
              <span class="byline avatar">{{ article.author.split(' ').map((w: string) => w[0]).join('').slice(0, 2) }}</span>
              {{ article.author }}
            </span>
            <span v-if="article.author" class="sep-dot" />
            <span v-if="article.feedName">{{ article.feedName }}</span>
            <span v-if="article.feedName" class="sep-dot" />
            <span v-if="publishedFormatted">Filed {{ publishedFormatted.date }} · {{ publishedFormatted.time }}</span>
            <span v-if="article.classification?.politicalBias !== null && article.classification?.politicalBias !== undefined" class="sep-dot" />
            <span v-if="article.classification?.politicalBias !== null && article.classification?.politicalBias !== undefined" class="px-[7px] py-[2px] border border-rule rounded-sm bg-panel font-semibold text-ink-2 uppercase tracking-wider">Lean · {{ getBiasLabel(article.classification.politicalBias) }}</span>
            <span v-if="article.readingTimeMinutes" class="sep-dot" />
            <span v-if="article.readingTimeMinutes">Read · {{ article.readingTimeMinutes }} min</span>
          </div>
        </div>

        <!-- Hero image -->
        <figure v-if="articleImage" class="relative aspect-[5/4] bg-[#1F1A12] rounded-sm overflow-hidden shadow-[0_2px_0_var(--color-rule),0_20px_40px_-20px_rgba(0,0,0,0.25)] m-0">
          <img :src="articleImage" :alt="article.title || ''" class="w-full h-full object-cover" @error="($event.target as HTMLElement).style.display='none'" />
          <div class="img-caption">
            <span>{{ article.feedName || 'Newsar' }}</span>
            <span>FIG 01</span>
          </div>
        </figure>
        <figure v-else class="hero-placeholder relative aspect-[5/4] bg-[#1F1A12] rounded-sm overflow-hidden m-0">
          <div class="placeholder-inner">
            <span>{{ (article.feedName || 'NEWSAR').toUpperCase() }}</span>
          </div>
        </figure>
      </section>

      <!-- ═══ TOPLINE STATS ═══ -->
      <section class="topline-grid stat-grid grid-cols-5 mb-10">
        <div class="stat-cell">
          <div class="stat-label">Reading time</div>
          <div class="stat-value">{{ article.readingTimeMinutes || '—' }}<sub class="stat-unit">min</sub></div>
        </div>
        <div class="stat-cell">
          <div class="stat-label">Word count</div>
          <div class="stat-value">{{ article.wordCount?.toLocaleString() || '—' }}<sub class="stat-unit">words</sub></div>
        </div>
        <div class="stat-cell">
          <div class="stat-label">Sources cited</div>
          <div class="stat-value">{{ article.classification?.sourceCountCited ?? '—' }}<sub class="stat-unit">cited</sub></div>
        </div>
        <div class="stat-cell">
          <div class="stat-label">Entities identified</div>
          <div class="stat-value">{{ article.entities?.length || 0 }}<sub class="stat-unit">entities</sub></div>
        </div>
        <div class="stat-cell">
          <div class="stat-label">Quality score</div>
          <div class="stat-value">{{ article.qualityScore !== undefined ? Math.round(article.qualityScore * 100) : '—' }}<sub class="stat-unit">%</sub></div>
        </div>
      </section>

      <!-- ═══ MAIN GRID ═══ -->
      <div class="intel-main grid grid-cols-[minmax(0,1fr)_380px] gap-10 items-start">
        <div>

          <!-- §01 BRIEFING SUMMARY -->
          <section v-if="article.analysis?.summary" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 01</span>
              <h2 class="sect-title">Briefing Summary</h2>
              <span class="sect-tag"><span class="w-1.5 h-1.5 rounded-full bg-accent inline-block" /> AI-generated</span>
            </div>
            <div class="intel-card p-[22px] grid grid-cols-[52px_1fr] gap-4">
              <div class="summary-mark">NEWSAR · AI</div>
              <div>
                <p class="font-serif text-[17px] leading-relaxed text-ink m-0 mb-4 text-pretty">{{ article.analysis.summary }}</p>
                <p v-if="article.analysis.longSummary && article.analysis.longSummary !== article.analysis.summary" class="font-serif text-[17px] leading-relaxed text-ink m-0 mb-4 text-pretty">
                  {{ article.analysis.longSummary }}
                </p>
                <div class="flex gap-6 items-center pt-4 mt-4 border-t border-rule-soft font-mono text-[11px] text-ink-3 flex-wrap">
                  <span v-if="article.classification?.confidence">Confidence <b class="text-ink">{{ article.classification.confidence.toFixed(2) }}</b></span>
                  <span v-if="article.classification?.sourceCountCited">Sources <b class="text-ink">{{ article.classification.sourceCountCited }}</b></span>
                  <span v-if="article.claims?.length">Claims <b class="text-ink">{{ article.claims.length }}</b></span>
                  <span v-if="article.entities?.length">Entities <b class="text-ink">{{ article.entities.length }}</b></span>
                </div>
              </div>
            </div>
          </section>

          <!-- §02 ARTICLE ANALYSIS -->
          <section v-if="article.classification?.featureExtractionDone" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 02</span>
              <h2 class="sect-title">Article analysis</h2>
              <span class="sect-tag">Model · {{ article.classification.method || 'AI' }}</span>
            </div>
            <div class="analysis-grid grid grid-cols-4 bg-panel border border-rule">
              <!-- Framing -->
              <div class="analysis-card p-[22px] border-r border-rule">
                <div class="text-kicker">Framing</div>
                <div class="font-serif text-xl font-semibold tracking-tight text-ink mb-[3px]">{{ framingDisplayName(article.classification.primaryFraming) }}</div>
                <div v-if="article.classification.secondaryFraming" class="font-mono text-[11px] text-ink-3">
                  {{ framingDisplayName(article.classification.secondaryFraming) }}
                </div>
                <div class="segmented">
                  <span :style="{ flex: article.classification.secondaryFraming ? 66 : 100, background: 'var(--color-accent)' }"></span>
                  <span v-if="article.classification.secondaryFraming" :style="{ flex: 34, background: 'var(--color-ink-3)' }"></span>
                </div>
              </div>

              <!-- Tone -->
              <div class="analysis-card p-[22px] border-r border-rule">
                <div class="text-kicker">Tone</div>
                <div class="font-serif text-xl font-semibold tracking-tight text-ink mb-[3px]">{{ sensationalismLabel(article.classification.sensationalism) }}</div>
                <div class="font-mono text-[11px] text-ink-3">{{ article.analysis?.metadata?.tone || 'AI-assessed' }}</div>
                <div class="gauge">
                  <div class="gauge-track"></div>
                  <div class="gauge-needle" :style="{ left: tonePosition + '%' }"></div>
                  <div class="gauge-ticks"><span>Calm</span><span>Neutral</span><span>Alarmist</span></div>
                </div>
              </div>

              <!-- Factuality -->
              <div class="analysis-card p-[22px] border-r border-rule">
                <div class="text-kicker">Factuality</div>
                <div class="font-serif text-xl font-semibold tracking-tight text-ink mb-[3px]">
                  {{ article.classification.factOpinionRatio != null ? article.classification.factOpinionRatio.toFixed(2) : '—' }}
                  <span class="text-xs text-ink-3 font-mono">/ 1.00</span>
                </div>
                <div class="font-mono text-[11px] text-ink-3">{{ factualityLabel(article.classification.factOpinionRatio) }}</div>
                <div class="meter-h mt-2.5">
                  <div class="meter-fill" :style="{ width: ((article.classification.factOpinionRatio || 0) * 100) + '%', background: 'var(--color-green)' }"></div>
                </div>
                <div class="flex justify-between font-mono text-[9px] font-semibold tracking-wider uppercase text-ink-4 mt-1.5"><span>Low</span><b class="text-ink">High</b></div>
              </div>

              <!-- Sources -->
              <div class="analysis-card p-[22px]">
                <div class="text-kicker">Sources cited</div>
                <div class="font-serif text-xl font-semibold tracking-tight text-ink mb-[3px]">{{ article.classification.sourceCountCited ?? '—' }}</div>
                <div class="font-mono text-[11px] text-ink-3">
                  {{ (article.classification.sourceCountCited || 0) >= 3 ? 'Well sourced' : (article.classification.sourceCountCited || 0) >= 1 ? 'Limited' : 'No named sources' }}
                </div>
                <div class="meter-h mt-2.5">
                  <div class="meter-fill" :style="{ width: Math.min(((article.classification.sourceCountCited || 0) / 10) * 100, 100) + '%' }"></div>
                </div>
                <div class="flex justify-between font-mono text-[9px] font-semibold tracking-wider uppercase text-ink-4 mt-1.5"><span>Few</span><b class="text-ink">Many</b></div>
              </div>
            </div>
          </section>

          <!-- §03 KEY CLAIMS -->
          <section v-if="article.claims?.length > 0" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 03</span>
              <h2 class="sect-title">Key claims</h2>
              <span class="sect-tag">{{ article.claims.length }} extracted</span>
            </div>
            <div class="intel-card">
              <div v-for="(claim, idx) in article.claims" :key="claim.id" class="claims-grid grid grid-cols-[40px_1fr_160px] gap-4 px-[22px] py-[18px] border-t border-rule-soft first:border-t-0">
                <div class="font-mono text-[10px] font-semibold tracking-wider text-ink-3 pt-1">{{ String(idx + 1).padStart(2, '0') }}</div>
                <div>
                  <p class="m-0 mb-2 font-serif text-[15px] leading-normal text-ink text-pretty">{{ claim.claimText }}</p>
                  <div class="flex items-center gap-2 font-mono text-[11px] text-ink-3 flex-wrap">
                    <span class="claim-type px-1.5 py-0.5 border border-rule font-semibold tracking-wider uppercase text-[9px] text-ink-2 bg-paper" :class="claim.claimType || ''">{{ claim.claimType || 'claim' }}</span>
                    <span v-if="claim.attribution" class="text-ink-2 font-semibold">{{ claim.attribution }}</span>
                  </div>
                </div>
                <div v-if="claim.confidence" class="text-right">
                  <div class="font-mono text-[9px] tracking-widest text-ink-3 uppercase mb-1">Confidence</div>
                  <div class="font-mono text-lg font-semibold text-ink tracking-tight">{{ claim.confidence.toFixed(2) }}</div>
                  <div class="conf-bar">
                    <div
                      class="conf-fill"
                      :style="{
                        width: (claim.confidence * 100) + '%',
                        background: claim.confidence >= 0.85 ? 'var(--color-green)' : claim.confidence >= 0.7 ? 'var(--color-amber)' : 'var(--color-red)'
                      }"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- §04 FULL REPORT -->
          <section v-if="contentParagraphs.length > 0" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 04</span>
              <h2 class="sect-title">Full report</h2>
              <span class="sect-tag">{{ article.readingTimeMinutes || '?' }} min read · {{ article.wordCount?.toLocaleString() || '?' }} words</span>
            </div>
            <article class="body-text intel-card p-8 article-content">
              <div
                v-for="(paragraph, index) in contentParagraphs"
                :key="index"
                class="bp font-serif text-[17px] leading-[1.65] text-ink m-0 mb-[18px] last:mb-0 text-pretty"
                :class="{ dropcap: index === 0 }"
                v-html="paragraph"
              />
            </article>
          </section>

          <!-- §05 ENTITIES -->
          <section v-if="sortedEntities.length > 0" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 05</span>
              <h2 class="sect-title">Entities</h2>
              <span class="sect-tag">{{ sortedEntities.length }} identified</span>
            </div>
            <div class="intel-card">
              <!-- Legend -->
              <div class="flex gap-6 font-mono text-[10px] tracking-wider uppercase text-ink-3 px-[22px] py-3 border-b border-rule-soft">
                <span class="inline-flex items-center gap-1.5"><i class="ent-dot-key w-2 h-2 rounded-full inline-block" />Key player</span>
                <span class="inline-flex items-center gap-1.5"><i class="ent-dot-opp w-2 h-2 rounded-full inline-block" />Opposition</span>
                <span class="inline-flex items-center gap-1.5"><i class="ent-dot-ctx w-2 h-2 rounded-full inline-block" />Context</span>
                <span class="ml-auto inline-flex items-center gap-1.5"><i class="w-2 h-2 rounded-full inline-block bg-[var(--color-green)]" />Positive</span>
                <span class="inline-flex items-center gap-1.5"><i class="w-2 h-2 rounded-full inline-block bg-[var(--color-ink-4)]" />Neutral</span>
                <span class="inline-flex items-center gap-1.5"><i class="w-2 h-2 rounded-full inline-block bg-[var(--color-red)]" />Negative</span>
              </div>

              <!-- Grouped by type -->
              <div v-for="(group, gi) in entitiesByType" :key="group.type" :class="{ 'border-t border-rule-soft': gi > 0 }">
                <!-- Type header -->
                <div class="ent-type-header flex items-center gap-2.5 px-[22px] py-2.5" :class="`ent-type-${group.type}`">
                  <span class="ent-type-icon" :style="{ background: getEntityTypeColor(group.type) }">{{ getEntityTypeIcon(group.type) }}</span>
                  <span class="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase text-ink-2">{{ group.label }}</span>
                  <span class="font-mono text-[10px] text-ink-4">{{ group.entities.length }}</span>
                </div>

                <!-- Entity rows -->
                <div class="ent-list-grid grid grid-cols-1 sm:grid-cols-2 gap-x-0">
                  <NuxtLink
                    v-for="entity in group.entities"
                    :key="entity.id"
                    :to="`/${entity.type}/${entity.slug || entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`"
                    class="ent ent-row flex items-center gap-3 px-[22px] py-3 border-b border-rule-soft last:border-b-0 sm:odd:border-r no-underline hover:bg-paper transition-colors"
                    :class="getEntityRoleClass(entity.role)"
                  >
                    <!-- Badge -->
                    <div class="ent-badge w-8 h-8 inline-flex items-center justify-center rounded-sm font-mono text-[10px] font-bold text-ink shrink-0" :style="{ background: getEntityTypeColor(entity.type) + '14', borderLeft: `2px solid ${getEntityTypeColor(entity.type)}` }">{{ getEntityInitials(entity.name) }}</div>

                    <!-- Name + meta -->
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold text-ink text-[13px] leading-tight truncate">{{ entity.name }}</div>
                      <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span v-if="entity.subtype" class="font-mono text-[9px] font-semibold tracking-wider uppercase px-1 py-px rounded-sm" :style="{ background: getEntityTypeColor(entity.type) + '18', color: getEntityTypeColor(entity.type) }">{{ getSubtypeLabel(entity.subtype) }}</span>
                        <span v-else class="font-mono text-[9px] tracking-wider uppercase text-ink-4">{{ entity.type }}</span>
                        <span v-if="entity.role && entity.role !== 'neutral'" class="font-mono text-[9px] tracking-wider uppercase text-ink-3">{{ getRoleLabel(entity.role) }}</span>
                      </div>
                    </div>

                    <!-- Stats column -->
                    <div class="flex items-center gap-3 shrink-0">
                      <!-- Sentiment dot -->
                      <span class="w-[6px] h-[6px] rounded-full shrink-0" :class="getEntitySentimentClass(entity.sentiment)" :title="`Sentiment: ${entity.sentiment || 'neutral'}`"></span>

                      <!-- Mentions -->
                      <span v-if="entity.mentions && entity.mentions > 1" class="font-mono text-[10px] text-ink-4 whitespace-nowrap" :title="`${entity.mentions} mentions in article`">{{ entity.mentions }}x</span>

                      <!-- Relevance -->
                      <div class="flex items-center gap-1.5 font-mono text-[10px] text-ink-3 whitespace-nowrap">
                        <span class="tabular-nums">{{ Math.round((entity.relevance || 0) * 100) }}</span>
                        <div class="ent-rbar w-[36px] h-[3px] bg-paper-2 overflow-hidden rounded-full">
                          <div class="ent-rbar-fill h-full transition-[width] duration-300 rounded-full" :style="{ width: ((entity.relevance || 0) * 100) + '%' }"></div>
                        </div>
                      </div>
                    </div>
                  </NuxtLink>
                </div>
              </div>
            </div>
          </section>

          <!-- §06 KEYWORDS -->
          <section v-if="article.keywords?.length > 0" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 06</span>
              <h2 class="sect-title">Keywords &amp; salience</h2>
              <span class="sect-tag">{{ article.keywords.length }} terms</span>
            </div>
            <div class="intel-card p-[22px]">
              <div class="kw-rows grid grid-cols-2 gap-x-10 gap-y-2">
                <div v-for="kw in article.keywords" :key="typeof kw === 'string' ? kw : kw.keyword" class="grid grid-cols-[1fr_100px_42px] items-center gap-3 py-2 border-b border-dotted border-rule-soft">
                  <div class="font-serif font-medium text-sm text-ink">{{ typeof kw === 'string' ? kw : kw.keyword }}</div>
                  <div class="kw-bar h-[5px] bg-paper-2 overflow-hidden">
                    <span :style="{ width: ((typeof kw === 'object' ? (kw.relevance || 0) : 0.5) * 100) + '%' }"></span>
                  </div>
                  <div class="font-mono text-[10px] text-ink-3 text-right">{{ typeof kw === 'object' && kw.relevance ? kw.relevance.toFixed(2) : '—' }}</div>
                </div>
              </div>
            </div>
          </section>

          <!-- §07 TOPIC CONNECTIONS -->
          <section v-if="article.keywords?.length > 0" class="intel-sect">
            <div class="intel-sect-head">
              <span class="sect-num">§ 07</span>
              <h2 class="sect-title">Topic connections</h2>
              <span class="sect-tag">Interactive graph</span>
            </div>
            <div class="intel-card p-[22px]">
              <TopicNetworkGraph
                :keywords="article.keywords"
                :entities="article.entities"
              />
              <div class="flex flex-wrap gap-[5px] mt-4 pt-4 border-t border-rule-soft">
                <NuxtLink
                  v-for="(keyword, idx) in article.keywords.slice(0, 10)"
                  :key="idx"
                  :to="`/topics/graph?center=${encodeURIComponent(keyword.keyword || keyword)}`"
                  class="intel-chip"
                >{{ keyword.keyword || keyword }}</NuxtLink>
              </div>
            </div>
          </section>

        </div><!-- /content -->

        <!-- ═══ RIGHT RAIL ═══ -->
        <aside class="rail sticky top-[84px] flex flex-col gap-6">

          <!-- SENTIMENT -->
          <div v-if="article.analysis?.sentiment != null" class="intel-card">
            <div class="intel-card-hd"><h3 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink m-0">Sentiment</h3><span class="font-mono text-[10px] text-ink-3 tracking-wider uppercase">Overall tone</span></div>
            <div class="intel-card-bd">
              <div class="flex items-baseline gap-3 mb-3">
                <div class="font-mono text-2xl font-semibold" :class="{ 'text-intel-red': getSentimentColor(article.analysis.sentiment) === 'neg', 'text-intel-green': getSentimentColor(article.analysis.sentiment) === 'pos', 'text-ink-3': getSentimentColor(article.analysis.sentiment) === 'neu' }">
                  {{ article.analysis.sentiment >= 0 ? '+' : '' }}{{ article.analysis.sentiment.toFixed(2) }}
                </div>
                <div class="font-mono text-[11px] text-ink-3 uppercase tracking-wider">{{ getSentimentLabel(article.analysis.sentiment) }}</div>
              </div>
              <div class="sent-gauge">
                <div class="sent-track"></div>
                <div class="sent-needle" :style="{ left: ((article.analysis.sentiment + 1) / 2 * 100) + '%' }"></div>
                <div class="sent-ticks"><span>Negative</span><span>Neutral</span><span>Positive</span></div>
              </div>
              <div v-if="article.analysis.metadata?.emotions?.length" class="flex flex-wrap gap-1 pt-2.5 border-t border-rule-soft">
                <span v-for="emotion in article.analysis.metadata.emotions" :key="emotion" class="font-mono text-[10px] px-1.5 py-0.5 bg-paper border border-rule text-ink-2">{{ emotion }}</span>
              </div>
            </div>
          </div>

          <!-- SOURCE TRANSPARENCY -->
          <div class="intel-card">
            <div class="intel-card-hd"><h3 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink m-0">Source transparency</h3></div>
            <div>
              <div class="grid grid-cols-[28px_1fr_auto] gap-2.5 items-center p-[22px] border-b border-rule-soft">
                <span class="w-7 h-7 bg-paper-2 rounded-full inline-flex items-center justify-center font-mono text-[10px] font-bold text-ink">{{ (article.feedName || '??').slice(0, 2).toUpperCase() }}</span>
                <div class="font-mono text-xs font-semibold text-ink">
                  {{ article.feedName || 'Unknown' }}
                  <small class="block text-ink-3 font-medium text-[10px] mt-0.5">{{ articleTypeLabel(article.classification?.articleType) }}</small>
                </div>
                <span v-if="article.classification?.confidence" class="font-mono text-sm font-semibold text-intel-green">
                  {{ article.classification.confidence >= 0.9 ? 'A+' : article.classification.confidence >= 0.75 ? 'A' : article.classification.confidence >= 0.6 ? 'B+' : 'B' }}
                </span>
              </div>
              <div class="px-[22px]">
                <div v-if="article.classification?.politicalBias != null" class="detail-row">
                  <span class="text-ink-3">Political lean</span>
                  <b class="text-ink font-semibold">{{ getBiasLabel(article.classification.politicalBias) }}</b>
                </div>
                <div v-if="article.classification?.confidence" class="detail-row">
                  <span class="text-ink-3">Confidence</span>
                  <b class="text-ink font-semibold">{{ (article.classification.confidence * 100).toFixed(0) }}%</b>
                </div>
                <div v-if="article.classification?.geoPov" class="detail-row">
                  <span class="text-ink-3">Geographic POV</span>
                  <b class="text-ink font-semibold">{{ article.classification.geoPov }}</b>
                </div>
                <div v-if="article.classification?.method" class="detail-row">
                  <span class="text-ink-3">Method</span>
                  <b class="text-ink font-semibold">{{ article.classification.method }}</b>
                </div>
              </div>
            </div>
          </div>

          <!-- OSINT TECHNIQUES -->
          <div v-if="article.classification?.metadata?.techniques?.length > 0" class="intel-card">
            <div class="intel-card-hd"><h3 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink m-0">OSINT signals</h3><span class="font-mono text-[10px] text-ink-3 tracking-wider uppercase">Detected</span></div>
            <div class="intel-card-bd">
              <div class="flex flex-wrap gap-1 mb-2.5">
                <span v-for="technique in article.classification.metadata.techniques" :key="technique" class="osint-tag">{{ technique }}</span>
              </div>
              <div v-if="article.classification.metadata.osintClassification" class="font-mono text-[11px] font-semibold text-ink pt-2 border-t border-rule-soft">
                {{ article.classification.metadata.osintClassification }}
              </div>
            </div>
          </div>

          <!-- RELATED COVERAGE -->
          <div v-if="article.relatedArticles?.length > 0" class="intel-card">
            <div class="intel-card-hd"><h3 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink m-0">Related coverage</h3><span class="font-mono text-[10px] text-ink-3 tracking-wider uppercase">{{ article.relatedArticles.length }} articles</span></div>
            <div>
              <NuxtLink
                v-for="related in article.relatedArticles.slice(0, 5)"
                :key="related.id"
                :to="`/articles/${related.id}`"
                class="block px-[22px] py-3 border-t border-rule-soft first:border-t-0 hover:bg-paper transition-colors"
              >
                <div class="font-mono text-[10px] tracking-wider text-ink-3 uppercase mb-1">
                  <b class="text-accent-ink">{{ related.feedName || 'Unknown' }}</b>
                  <span v-if="related.bias != null"> · {{ getBiasLabel(related.bias) }}</span>
                </div>
                <div class="font-serif text-[13px] leading-snug text-ink font-semibold text-balance">{{ related.title }}</div>
              </NuxtLink>
            </div>
          </div>

          <!-- STORY CONTEXT -->
          <div v-if="article.story" class="intel-card">
            <div class="intel-card-hd"><h3 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink m-0">Story context</h3></div>
            <div class="intel-card-bd flex flex-col gap-2.5">
              <div class="font-serif text-[15px] font-semibold text-ink leading-snug">{{ article.story.representativeTitle || article.story.name }}</div>
              <NuxtLink :to="`/stories/${article.story.id}`" class="font-mono text-[11px] text-accent font-semibold tracking-wider hover:text-accent-ink">
                View all perspectives →
              </NuxtLink>
            </div>
          </div>

          <!-- SIMILAR ARTICLES -->
          <div class="intel-card">
            <div class="intel-card-hd"><h3 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink m-0">Similar articles</h3><span class="font-mono text-[10px] text-ink-3 tracking-wider uppercase">Semantic</span></div>
            <div class="intel-card-bd">
              <button v-if="!showSimilar" class="w-full py-2.5 font-mono text-[11px] font-semibold tracking-wider uppercase border border-rule bg-paper text-ink-2 rounded-sm hover:bg-accent-tint hover:text-accent-ink transition-colors disabled:opacity-50 disabled:cursor-wait" :disabled="loadingSimilar" @click="loadSimilarArticles">
                {{ loadingSimilar ? 'Searching…' : 'Find similar articles' }}
              </button>
              <template v-else-if="similarArticles.length > 0">
                <NuxtLink
                  v-for="similar in similarArticles.slice(0, 5)"
                  :key="similar.id"
                  :to="`/articles/${similar.id}`"
                  class="block py-3 border-t border-rule-soft first:border-t-0 hover:bg-paper transition-colors -mx-[22px] px-[22px]"
                >
                  <div class="font-mono text-[10px] tracking-wider text-ink-3 uppercase mb-1">
                    <b class="text-accent-ink">{{ similar.feedName || 'Unknown' }}</b>
                    <span> · {{ (similar.similarity * 100).toFixed(0) }}% match</span>
                  </div>
                  <div class="font-serif text-[13px] leading-snug text-ink font-semibold text-balance">{{ similar.title }}</div>
                </NuxtLink>
              </template>
              <div v-else class="font-mono text-[11px] text-ink-3 text-center py-2.5">No similar articles found</div>
            </div>
          </div>

        </aside>
      </div><!-- /intel-main -->

    </div><!-- /intel-wrap -->
  </div>

  <!-- NOT FOUND -->
  <div v-else class="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
    <h1 class="font-serif text-3xl font-semibold text-ink m-0">Article not found</h1>
    <p class="font-mono text-[13px] text-ink-3">The requested brief could not be loaded.</p>
    <NuxtLink to="/" class="font-mono text-xs text-accent font-semibold">← Back to News</NuxtLink>
  </div>

  <!-- Entity Preview Card -->
  <EntityPreviewCard
    :entity-id="previewEntityId"
    :x="previewX"
    :y="previewY"
    :visible="showPreview"
    @close="handleHidePreview"
  />
</template>
