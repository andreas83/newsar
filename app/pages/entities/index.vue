<script setup lang="ts">
interface SubtypeCount {
  subtype: string
  count: number
}

interface Category {
  type: string
  label: string
  count: number
  totalCount: number
  trendingCount: number
  totalArticles: number
  velocity: number
  imageUrl: string | null
  subtypes?: SubtypeCount[]
}

interface BrowseEntity {
  id: number
  type: string
  subtype: string | null
  name: string
  slug: string | null
  shortDescription: string | null
  imageUrl: string | null
  mentionCount: number
  trendingScore: number
}

const { getSubtypeLabel, getSubtypeClasses } = useEntitySubtypes()

const route = useRoute()
const router = useRouter()

const categoryConfig: Record<string, {
  icon: string
  color: 'blue' | 'green' | 'orange' | 'purple' | 'teal'
}> = {
  person: { icon: 'i-heroicons-user', color: 'blue' },
  organization: { icon: 'i-heroicons-building-office', color: 'green' },
  location: { icon: 'i-heroicons-map-pin', color: 'orange' },
  event: { icon: 'i-heroicons-calendar', color: 'purple' },
  topic: { icon: 'i-heroicons-light-bulb', color: 'teal' },
}

const activeTab = ref((route.query.type as string) || 'person')
const activeSubtype = ref((route.query.subtype as string) || '')
const searchQuery = ref((route.query.search as string) || '')
const sortBy = ref((route.query.sort as string) || 'mentions')
const currentPage = ref(parseInt(route.query.page as string) || 1)

let searchTimer: ReturnType<typeof setTimeout> | null = null
const debouncedSearch = ref(searchQuery.value)

watch(searchQuery, (val) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = val
    currentPage.value = 1
  }, 300)
})

watch([activeTab, activeSubtype, debouncedSearch, sortBy, currentPage], () => {
  const query: Record<string, string> = { type: activeTab.value }
  if (activeSubtype.value) query.subtype = activeSubtype.value
  if (debouncedSearch.value) query.search = debouncedSearch.value
  if (sortBy.value !== 'mentions') query.sort = sortBy.value
  if (currentPage.value > 1) query.page = String(currentPage.value)
  router.replace({ query })
}, { flush: 'post' })

const { data: categoriesData } = await useFetch('/api/entities/categories')
const categories = computed(() => categoriesData.value?.categories || [])

const { data: trendingData } = useFetch('/api/entities/trending', {
  query: computed(() => ({ type: activeTab.value, limit: 5 })),
  watch: [activeTab],
})

const { data: browseData, pending: browsePending } = useFetch('/api/entities/browse', {
  query: computed(() => ({
    type: activeTab.value,
    subtype: activeSubtype.value || undefined,
    search: debouncedSearch.value || undefined,
    sort: sortBy.value,
    page: currentPage.value,
    limit: 50,
  })),
  watch: [activeTab, activeSubtype, debouncedSearch, sortBy, currentPage],
})

const browseEntities = computed<BrowseEntity[]>(() => browseData.value?.entities || [])
const meta = computed(() => browseData.value?.meta || { total: 0, totalPages: 0, page: 1 })

function switchTab(type: string) {
  activeTab.value = type
  activeSubtype.value = ''
  searchQuery.value = ''
  debouncedSearch.value = ''
  currentPage.value = 1
}

function toggleSubtype(subtype: string) {
  activeSubtype.value = activeSubtype.value === subtype ? '' : subtype
  currentPage.value = 1
}

const activeTabSubtypes = computed<SubtypeCount[]>(() => {
  const cat = categories.value.find((c: Category) => c.type === activeTab.value)
  return cat?.subtypes || []
})

function getTabCount(type: string): number {
  const cat = categories.value.find((c: Category) => c.type === type)
  return cat?.totalCount || 0
}

function goToPage(p: number) {
  if (p >= 1 && p <= meta.value.totalPages) {
    currentPage.value = p
    window.scrollTo({ top: 400, behavior: 'smooth' })
  }
}

const pageNumbers = computed(() => {
  const total = meta.value.totalPages
  const current = meta.value.page
  const pages: (number | '...')[] = []

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('...')
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
      pages.push(i)
    }
    if (current < total - 2) pages.push('...')
    pages.push(total)
  }

  return pages
})

function formatNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return n.toString()
}

useHead({
  title: 'Entity Browser - Newsar',
  meta: [{ name: 'description', content: 'Browse people, organizations, locations, and events in the news' }],
})
</script>

<template>
  <div class="min-h-screen bg-paper pb-20">
    <!-- Hero -->
    <section class="bg-paper-2 border-b border-rule py-12">
      <Container>
        <div class="text-center">
          <h1 class="font-serif text-[42px] font-bold text-ink mb-3">Entity Browser</h1>
          <p class="text-[17px] text-ink-3">
            Explore {{ formatNumber(categories.reduce((s: number, c: Category) => s + (c.totalCount || 0), 0)) }} people, organizations, locations, and events across the news
          </p>
        </div>
      </Container>
    </section>

    <Container>
      <!-- Tab Bar -->
      <div class="flex gap-1 bg-panel border border-rule rounded-sm p-1 mt-8">
        <button
          v-for="tab in ['person', 'organization', 'location', 'event', 'topic']"
          :key="tab"
          class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-sm text-sm font-medium transition-colors"
          :class="activeTab === tab ? 'bg-ink text-paper shadow-sm' : 'text-ink-3 hover:bg-paper-2 hover:text-ink'"
          @click="switchTab(tab)"
        >
          <Icon :name="categoryConfig[tab].icon" class="w-[18px] h-[18px]" />
          <span class="hidden sm:inline">{{ tab === 'organization' ? 'Organizations' : tab.charAt(0).toUpperCase() + tab.slice(1) + 's' }}</span>
          <span class="text-xs px-[7px] py-px rounded-full font-semibold" :class="activeTab === tab ? 'bg-white/20' : 'bg-black/6 dark:bg-white/10'">{{ formatNumber(getTabCount(tab)) }}</span>
        </button>
      </div>

      <!-- Subtype Filter Chips -->
      <div v-if="activeTabSubtypes.length > 0" class="flex flex-wrap gap-2 mt-4">
        <button
          class="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
          :class="!activeSubtype ? 'bg-ink text-paper border-ink' : 'bg-panel text-ink-3 border-rule hover:border-accent hover:text-ink'"
          @click="activeSubtype = ''; currentPage = 1"
        >
          All
        </button>
        <button
          v-for="st in activeTabSubtypes"
          :key="st.subtype"
          class="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
          :class="activeSubtype === st.subtype
            ? `${getSubtypeClasses(st.subtype)} border-transparent font-semibold`
            : 'bg-panel text-ink-3 border-rule hover:border-accent hover:text-ink'"
          @click="toggleSubtype(st.subtype)"
        >
          {{ getSubtypeLabel(st.subtype) }}
          <span class="ml-1 opacity-60">{{ formatNumber(st.count) }}</span>
        </button>
      </div>

      <!-- Trending Highlights -->
      <div v-if="trendingData?.entities?.length" class="mt-8">
        <h2 class="flex items-center gap-1.5 text-sm font-semibold text-ink-2 uppercase tracking-wider mb-4">
          <Icon name="i-heroicons-fire" class="w-4 h-4 text-intel-red" />
          Trending
        </h2>
        <div class="grid grid-template-columns-[repeat(auto-fill,minmax(220px,1fr))] gap-4" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));">
          <TrendingEntityCard
            v-for="entity in trendingData.entities.slice(0, 5)"
            :key="entity.id"
            :name="entity.name"
            :type="entity.type"
            :image-url="entity.imageUrl"
            :trending-score="entity.trendingScore"
            :mention-count="entity.mentionCount"
            :badge-color="categoryConfig[entity.type]?.color || 'blue'"
            :icon="categoryConfig[entity.type]?.icon || 'i-heroicons-cube'"
            @click="navigateTo(`/${entity.type}/${entity.slug}`)"
          />
        </div>
      </div>

      <!-- Search + Sort Controls -->
      <div class="flex gap-3 mt-8 flex-col sm:flex-row">
        <div class="flex-1 relative">
          <Icon name="i-heroicons-magnifying-glass" class="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ink-4 pointer-events-none" />
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="`Search ${activeTab}s...`"
            class="w-full py-2.5 px-3.5 pl-[42px] border border-rule rounded-sm text-sm bg-panel text-ink placeholder-ink-4 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
          />
          <button
            v-if="searchQuery"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink hover:bg-paper-2 rounded-sm"
            @click="searchQuery = ''; debouncedSearch = ''"
          >
            <Icon name="i-heroicons-x-mark" class="w-4 h-4" />
          </button>
        </div>

        <select v-model="sortBy" class="py-2.5 px-3.5 border border-rule rounded-sm text-sm bg-panel text-ink cursor-pointer outline-none focus:border-accent min-w-[160px]">
          <option value="mentions">Most Mentioned</option>
          <option value="trending">Trending</option>
          <option value="name">Alphabetical</option>
        </select>
      </div>

      <!-- Results Count -->
      <div class="mt-4 text-[13px] text-ink-3">
        <span v-if="!browsePending">
          {{ meta.total.toLocaleString() }} {{ activeTab }}{{ meta.total !== 1 ? 's' : '' }}
          <template v-if="debouncedSearch"> matching "{{ debouncedSearch }}"</template>
        </span>
      </div>

      <!-- Entity List -->
      <div v-if="browsePending" class="flex justify-center py-20">
        <Icon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin text-ink-4" />
      </div>

      <div v-else-if="browseEntities.length > 0" class="flex flex-col gap-2 mt-4">
        <EntityBrowserItem
          v-for="entity in browseEntities"
          :key="entity.id"
          :entity="entity"
        />
      </div>

      <div v-else class="flex flex-col items-center py-20">
        <Icon name="i-heroicons-magnifying-glass" class="w-12 h-12 text-ink-4" />
        <p class="text-ink-3 mt-3">No entities found</p>
        <button
          v-if="debouncedSearch"
          class="text-accent hover:text-accent-ink text-sm font-medium mt-2"
          @click="searchQuery = ''; debouncedSearch = ''"
        >
          Clear search
        </button>
      </div>

      <!-- Pagination -->
      <div v-if="meta.totalPages > 1" class="flex items-center justify-center gap-1 mt-8">
        <button class="flex items-center justify-center min-w-9 h-9 px-2.5 border border-rule rounded-sm bg-panel text-sm font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors" :disabled="currentPage <= 1" @click="goToPage(1)">
          <Icon name="i-heroicons-chevron-double-left" class="w-4 h-4" />
        </button>
        <button class="flex items-center justify-center min-w-9 h-9 px-2.5 border border-rule rounded-sm bg-panel text-sm font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
          <Icon name="i-heroicons-chevron-left" class="w-4 h-4" />
        </button>

        <template v-for="(p, i) in pageNumbers" :key="i">
          <span v-if="p === '...'" class="px-1.5 text-ink-4 text-sm">...</span>
          <button
            v-else
            class="flex items-center justify-center min-w-9 h-9 px-2.5 border rounded-sm text-sm font-medium transition-colors"
            :class="p === currentPage ? 'bg-ink border-ink text-paper' : 'border-rule bg-panel text-ink-2 hover:border-accent hover:text-accent'"
            @click="goToPage(p as number)"
          >
            {{ p }}
          </button>
        </template>

        <button class="flex items-center justify-center min-w-9 h-9 px-2.5 border border-rule rounded-sm bg-panel text-sm font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors" :disabled="currentPage >= meta.totalPages" @click="goToPage(currentPage + 1)">
          <Icon name="i-heroicons-chevron-right" class="w-4 h-4" />
        </button>
        <button class="flex items-center justify-center min-w-9 h-9 px-2.5 border border-rule rounded-sm bg-panel text-sm font-medium text-ink-2 hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors" :disabled="currentPage >= meta.totalPages" @click="goToPage(meta.totalPages)">
          <Icon name="i-heroicons-chevron-double-right" class="w-4 h-4" />
        </button>
      </div>
    </Container>
  </div>
</template>
