<script setup lang="ts">
const { selectedLanguage } = useLanguage()

const sortBy = ref('trending')
const dateRange = ref('all')
const region = ref('all')
const entityFilter = ref('')
const entityFilterName = ref('')
const keywordFilter = ref('')
const viewMode = ref<'list' | 'regions' | 'persons' | 'organizations' | 'keywords'>('list')
const showFilters = ref(false)

const { data: stories, refresh } = await useFetch('/api/stories', {
  query: { sortBy, language: selectedLanguage, dateRange, region, entity: entityFilter, keyword: keywordFilter, limit: 50 },
})

const { data: trendingStories } = await useFetch('/api/stories', {
  query: { sortBy: 'trending', limit: 5 },
})

const { data: regionData } = await useFetch('/api/stories', {
  query: { view: 'regions' },
})

const { data: personsData } = await useFetch('/api/stories', {
  query: { view: 'persons' },
})

const { data: orgsData } = await useFetch('/api/stories', {
  query: { view: 'organizations' },
})

const { data: keywordsData } = await useFetch('/api/stories', {
  query: { view: 'keywords' },
})

const sortOptions = [
  { label: 'Trending', value: 'trending' },
  { label: 'Most Recent', value: 'recent' },
  { label: 'Most Diverse', value: 'diverse' },
  { label: 'Largest', value: 'largest' },
]

const dateRangeOptions = [
  { label: 'All Time', value: 'all' },
  { label: 'Last 24h', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
]

const regionOptions = computed(() => {
  const options = [{ label: 'All Regions', value: 'all' }]
  if (regionData.value && 'groups' in regionData.value) {
    const groups = (regionData.value as any).groups as Array<{ region: string; storyCount: number }>
    for (const g of groups) {
      if (g.region && g.region !== 'Unknown') {
        options.push({ label: `${g.region} (${g.storyCount})`, value: g.region })
      }
    }
  }
  return options
})

const activeFilterCount = computed(() => {
  let count = 0
  if (dateRange.value !== 'all') count++
  if (region.value !== 'all') count++
  if (sortBy.value !== 'trending') count++
  return count
})

const hasActiveEntityFilter = computed(() => !!entityFilter.value || !!keywordFilter.value)

const activeFilterLabel = computed(() => {
  if (entityFilterName.value) return entityFilterName.value
  if (keywordFilter.value) return keywordFilter.value
  return ''
})

const storyList = computed(() => {
  if (!stories.value) return []
  if (Array.isArray(stories.value)) return stories.value
  if ('stories' in stories.value) return (stories.value as any).stories || []
  return []
})

const fallbackArticles = computed(() => {
  if (!stories.value || Array.isArray(stories.value)) return []
  if ('fallbackArticles' in stories.value) return (stories.value as any).fallbackArticles || []
  return []
})

const trendingList = computed(() => {
  if (!trendingStories.value) return []
  if (Array.isArray(trendingStories.value)) return trendingStories.value.slice(0, 5)
  return []
})

const personsList = computed(() => {
  if (!personsData.value || !('groups' in personsData.value)) return []
  return (personsData.value as any).groups || []
})

const orgsList = computed(() => {
  if (!orgsData.value || !('groups' in orgsData.value)) return []
  return (orgsData.value as any).groups || []
})

const keywordsList = computed(() => {
  if (!keywordsData.value || !('groups' in keywordsData.value)) return []
  return (keywordsData.value as any).groups || []
})

const viewTabs = [
  { key: 'list' as const, label: 'List', icon: 'i-heroicons-list-bullet' },
  { key: 'regions' as const, label: 'Regions', icon: 'i-heroicons-globe-alt' },
  { key: 'persons' as const, label: 'People', icon: 'i-heroicons-user-group' },
  { key: 'organizations' as const, label: 'Orgs', icon: 'i-heroicons-building-office-2' },
  { key: 'keywords' as const, label: 'Keywords', icon: 'i-heroicons-tag' },
]

function selectEntity(id: number, name: string) {
  entityFilter.value = String(id)
  entityFilterName.value = name
  keywordFilter.value = ''
  viewMode.value = 'list'
}

function selectKeyword(kw: string) {
  keywordFilter.value = kw
  entityFilter.value = ''
  entityFilterName.value = ''
  viewMode.value = 'list'
}

function clearEntityFilter() {
  entityFilter.value = ''
  entityFilterName.value = ''
  keywordFilter.value = ''
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
    case 'emerging': return 'text-blue-600 bg-blue-100'
    case 'trending': return 'text-red-600 bg-red-100'
    case 'active': return 'text-green-600 bg-green-100'
    case 'declining': return 'text-ink-3 bg-paper-2'
    default: return 'text-ink-3 bg-paper-2'
  }
}

watch([sortBy, selectedLanguage, dateRange, region, entityFilter, keywordFilter], () => refresh())
</script>

<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-6 md:py-12 border-b ">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-3xl md:text-5xl font-bold text-ink mb-2 md:mb-4">
            Story Coverage
          </h1>
          <p class="text-sm md:text-lg text-ink-3 mb-4 md:mb-8 px-2">
            See how the same news stories are covered across different sources and political perspectives.
            Compare narratives, discover bias patterns, and get the full picture.
          </p>
        </div>
      </Container>
    </section>

    <!-- Trending Stories Row -->
    <section v-if="trendingList.length > 0" class="py-5 md:py-8 bg-paper-2 border-b ">
      <Container>
        <h2 class="text-base md:text-lg font-semibold text-ink mb-3 md:mb-4">Trending Now</h2>
        <div class="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:-mx-2 md:px-2 snap-x snap-mandatory">
          <NuxtLink
            v-for="story in trendingList"
            :key="story.id"
            :to="`/stories/${story.id}`"
            class="flex-shrink-0 w-60 md:w-72 bg-panel rounded-sm  border border-rule p-3 md:p-4 hover: transition-shadow snap-start"
          >
            <div class="flex items-start gap-2.5 md:gap-3">
              <img
                v-if="story.imageLocalPath || story.imageUrl"
                :src="story.imageLocalPath || story.imageUrl"
                :alt="story.representativeTitle || ''"
                class="w-14 h-14 md:w-16 md:h-16 object-cover rounded-sm flex-shrink-0"
                @error="($event.target as HTMLElement)?.parentElement?.style.setProperty('display', 'none')"
              />
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-ink line-clamp-2">
                  {{ story.representativeTitle || story.name }}
                </h3>
                <p v-if="story.topicLabel" class="text-xs text-ink-3 mt-1 truncate">
                  {{ story.topicLabel }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2 md:gap-3 mt-2 md:mt-3 text-xs text-ink-3">
              <span>{{ story.articleCount }} articles</span>
              <span>{{ story.sourceCount }} sources</span>
              <span v-if="story.primaryRegion" class="px-1.5 py-0.5 bg-paper-2  rounded text-ink-3 hidden sm:inline">
                {{ story.primaryRegion }}
              </span>
            </div>
          </NuxtLink>
        </div>
      </Container>
    </section>

    <!-- Filter Bar -->
    <section class="bg-panel border-b sticky top-[84px] z-30 backdrop-blur">
      <Container>
        <!-- Compact bar: always visible -->
        <div class="flex items-center justify-between gap-2 md:gap-3 py-2 md:py-2.5">
          <div class="flex items-center gap-2 md:gap-3 min-w-0">
            <h2 class="text-base md:text-xl font-semibold text-ink shrink-0">
              {{ storyList.length }} Stories
            </h2>

            <!-- Active entity/keyword filter badge -->
            <button
              v-if="hasActiveEntityFilter"
              class="flex items-center gap-1 px-2 py-0.5 md:px-2.5 md:py-1 rounded-sm bg-primary-100 dark:bg-primary-900/30 text-accent-700 dark:text-accent-300 text-xs md:text-sm font-medium hover:bg-primary-200 dark:hover:bg-primary-900/50 transition-colors min-w-0"
              @click="clearEntityFilter"
            >
              <span class="truncate max-w-24 md:max-w-none">{{ activeFilterLabel }}</span>
              <Icon name="i-heroicons-x-mark" class="w-3 h-3 md:w-3.5 md:h-3.5 shrink-0" />
            </button>
          </div>

          <div class="flex items-center gap-2 md:gap-3">
            <!-- Desktop filters (inline) -->
            <div class="hidden md:flex gap-3">
              <SelectMenu
                v-model="dateRange"
                :options="dateRangeOptions"
                size="sm"
                class="w-36"
              />
              <SelectMenu
                v-model="region"
                :options="regionOptions"
                size="sm"
                class="w-44"
              />
              <SelectMenu
                v-model="sortBy"
                :options="sortOptions"
                size="sm"
                class="w-36"
              />
            </div>

            <!-- Mobile filter toggle -->
            <button
              class="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-rule text-sm font-medium text-ink-2 hover:bg-paper-2  transition-colors shrink-0"
              @click="showFilters = !showFilters"
            >
              <Icon name="i-heroicons-adjustments-horizontal" class="w-4 h-4" />
              <span class="hidden xs:inline">Filters</span>
              <span
                v-if="activeFilterCount > 0"
                class="w-5 h-5 flex items-center justify-center rounded-sm bg-accent text-white text-xs"
              >
                {{ activeFilterCount }}
              </span>
            </button>
          </div>
        </div>

        <!-- View tabs: always visible as a scrollable row -->
        <div class="flex gap-1 pb-2 md:pb-2.5 overflow-x-auto -mx-1 px-1">
          <button
            v-for="tab in viewTabs"
            :key="tab.key"
            :class="[
              'px-3 py-1.5 text-xs md:text-sm font-medium rounded-sm transition-colors flex items-center gap-1.5 shrink-0',
              viewMode === tab.key ? 'bg-accent text-white ' : 'bg-paper-2  text-ink-3 hover:bg-paper-2 '
            ]"
            @click="viewMode = tab.key"
          >
            <Icon :name="tab.icon" class="w-3.5 h-3.5 md:w-4 md:h-4" />
            {{ tab.label }}
          </button>
        </div>

        <!-- Mobile filters (expandable) -->
        <div
          v-if="showFilters"
          class="md:hidden pb-3 space-y-2 border-t border-rule-soft pt-3"
        >
          <div class="grid grid-cols-2 gap-2">
            <SelectMenu
              v-model="dateRange"
              :options="dateRangeOptions"
              size="sm"
            />
            <SelectMenu
              v-model="sortBy"
              :options="sortOptions"
              size="sm"
            />
          </div>
          <SelectMenu
            v-model="region"
            :options="regionOptions"
            size="sm"
          />
        </div>
      </Container>
    </section>

    <!-- Main Content -->
    <section class="py-6 md:py-12">
      <Container>
        <!-- Region View -->
        <div v-if="viewMode === 'regions' && regionData && 'groups' in regionData">
          <p class="text-sm md:text-base text-ink-3 mb-4 md:mb-6">
            Browse stories by geographic region. Click a region to see all related stories.
          </p>
          <div class="space-y-2 md:space-y-3">
            <div
              v-for="group in (regionData as any).groups"
              :key="group.region"
              class="bg-panel rounded-sm md:rounded-sm border border-rule overflow-hidden"
            >
              <button
                class="w-full flex items-center justify-between px-4 py-3 md:px-6 md:py-4 hover:bg-paper-2 /50 transition-colors"
                @click="region = group.region === region ? 'all' : group.region; viewMode = 'list'"
              >
                <div class="flex items-center gap-2 md:gap-3 min-w-0">
                  <Icon name="i-heroicons-globe-alt" class="w-5 h-5 text-orange-500 shrink-0" />
                  <h3 class="text-base md:text-lg font-semibold text-ink truncate">{{ group.region }}</h3>
                  <span class="text-xs md:text-sm text-ink-3 shrink-0">{{ group.storyCount }} stories</span>
                  <span class="hidden sm:inline text-sm text-ink-4 shrink-0">{{ group.totalArticles }} articles</span>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-5 h-5 text-ink-4 shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <!-- Persons View -->
        <div v-else-if="viewMode === 'persons'">
          <p class="text-sm md:text-base text-ink-3 mb-4 md:mb-6">
            Key people in the news. Click a person to see all stories they appear in.
          </p>
          <div v-if="personsList.length > 0" class="space-y-2 md:space-y-3">
            <button
              v-for="person in personsList"
              :key="person.entityId"
              class="w-full bg-panel rounded-sm md:rounded-sm border border-rule overflow-hidden hover: transition-shadow text-left"
              @click="selectEntity(person.entityId, person.name)"
            >
              <div class="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
                <div class="flex items-center gap-2.5 md:gap-3 min-w-0">
                  <div class="w-9 h-9 md:w-10 md:h-10 rounded-sm bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <Icon name="i-heroicons-user" class="w-4 h-4 md:w-5 md:h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base md:text-lg font-semibold text-ink truncate">{{ person.name }}</h3>
                    <div class="flex items-center gap-2 md:gap-3 text-xs md:text-sm text-ink-3">
                      <span>{{ person.storyCount }} stories</span>
                      <span>{{ person.totalArticles }} articles</span>
                    </div>
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-5 h-5 text-ink-4 shrink-0" />
              </div>
            </button>
          </div>
          <div v-else class="text-center py-8 md:py-12">
            <Icon name="i-heroicons-user-group" class="w-10 h-10 md:w-12 md:h-12 text-ink-4 mx-auto mb-3 md:mb-4" />
            <p class="text-sm md:text-base text-ink-3">No people found linked to stories.</p>
          </div>
        </div>

        <!-- Organizations View -->
        <div v-else-if="viewMode === 'organizations'">
          <p class="text-sm md:text-base text-ink-3 mb-4 md:mb-6">
            Organizations featured in the news. Click to see all stories involving that organization.
          </p>
          <div v-if="orgsList.length > 0" class="space-y-2 md:space-y-3">
            <button
              v-for="org in orgsList"
              :key="org.entityId"
              class="w-full bg-panel rounded-sm md:rounded-sm border border-rule overflow-hidden hover: transition-shadow text-left"
              @click="selectEntity(org.entityId, org.name)"
            >
              <div class="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
                <div class="flex items-center gap-2.5 md:gap-3 min-w-0">
                  <div class="w-9 h-9 md:w-10 md:h-10 rounded-sm bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                    <Icon name="i-heroicons-building-office-2" class="w-4 h-4 md:w-5 md:h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base md:text-lg font-semibold text-ink truncate">{{ org.name }}</h3>
                    <div class="flex items-center gap-2 md:gap-3 text-xs md:text-sm text-ink-3">
                      <span>{{ org.storyCount }} stories</span>
                      <span>{{ org.totalArticles }} articles</span>
                    </div>
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-5 h-5 text-ink-4 shrink-0" />
              </div>
            </button>
          </div>
          <div v-else class="text-center py-8 md:py-12">
            <Icon name="i-heroicons-building-office-2" class="w-10 h-10 md:w-12 md:h-12 text-ink-4 mx-auto mb-3 md:mb-4" />
            <p class="text-sm md:text-base text-ink-3">No organizations found linked to stories.</p>
          </div>
        </div>

        <!-- Keywords View -->
        <div v-else-if="viewMode === 'keywords'">
          <p class="text-sm md:text-base text-ink-3 mb-4 md:mb-6">
            Trending topics and keywords across news stories. Click a keyword to see related stories.
          </p>
          <div v-if="keywordsList.length > 0" class="space-y-2 md:space-y-3">
            <button
              v-for="kw in keywordsList"
              :key="kw.keyword"
              class="w-full bg-panel rounded-sm md:rounded-sm border border-rule overflow-hidden hover: transition-shadow text-left"
              @click="selectKeyword(kw.keyword)"
            >
              <div class="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
                <div class="flex items-center gap-2.5 md:gap-3 min-w-0">
                  <div class="w-9 h-9 md:w-10 md:h-10 rounded-sm bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
                    <Icon name="i-heroicons-tag" class="w-4 h-4 md:w-5 md:h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div class="min-w-0">
                    <h3 class="text-base md:text-lg font-semibold text-ink capitalize truncate">{{ kw.keyword }}</h3>
                    <div class="flex items-center gap-2 md:gap-3 text-xs md:text-sm text-ink-3">
                      <span>{{ kw.storyCount }} stories</span>
                      <span>{{ kw.articleCount }} articles</span>
                    </div>
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-5 h-5 text-ink-4 shrink-0" />
              </div>
            </button>
          </div>
          <div v-else class="text-center py-8 md:py-12">
            <Icon name="i-heroicons-tag" class="w-10 h-10 md:w-12 md:h-12 text-ink-4 mx-auto mb-3 md:mb-4" />
            <p class="text-sm md:text-base text-ink-3">No keywords found linked to stories.</p>
          </div>
        </div>

        <!-- List View (stories) -->
        <div v-else-if="storyList.length > 0">
          <div class="grid grid-cols-1 gap-6">
            <StoryCard
              v-for="story in storyList"
              :key="story.id"
              :story="story"
            />
          </div>
        </div>

        <!-- Fallback: articles when no stories match -->
        <div v-else-if="fallbackArticles.length > 0">
          <div class="mb-4 md:mb-6 p-3 md:p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-sm">
            <p class="text-xs md:text-sm text-amber-800 dark:text-amber-300">
              No grouped stories found for <strong>{{ activeFilterLabel }}</strong>. Showing individual articles instead.
            </p>
          </div>
          <div class="space-y-3 md:space-y-4">
            <NuxtLink
              v-for="article in fallbackArticles"
              :key="article.id"
              :to="`/articles/${article.id}`"
              class="block bg-panel rounded-sm md:rounded-sm border border-rule p-3.5 md:p-5 hover: transition-shadow"
            >
              <div class="flex items-start gap-3 md:gap-4">
                <img
                  v-if="article.imageLocalPath || article.imageUrl"
                  :src="article.imageLocalPath || article.imageUrl"
                  :alt="article.title"
                  class="w-16 h-16 md:w-20 md:h-20 object-cover rounded-sm shrink-0"
                  @error="($event.target as HTMLElement)?.style.setProperty('display', 'none')"
                />
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm md:text-base font-semibold text-ink line-clamp-2">{{ article.title }}</h3>
                  <div class="flex items-center gap-2 md:gap-3 mt-1.5 md:mt-2 text-xs md:text-sm text-ink-3">
                    <span class="truncate">{{ article.feedName }}</span>
                    <span v-if="article.publishedAt" class="shrink-0">{{ formatDate(article.publishedAt) }}</span>
                  </div>
                </div>
              </div>
            </NuxtLink>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="text-center py-8 md:py-12">
          <Icon name="i-heroicons-rectangle-group" class="w-10 h-10 md:w-12 md:h-12 text-ink-4 mx-auto mb-3 md:mb-4" />
          <p class="text-sm md:text-base text-ink-3 px-4">No stories found. Stories are created when similar articles are clustered together.</p>
        </div>
      </Container>
    </section>
  </div>
</template>
