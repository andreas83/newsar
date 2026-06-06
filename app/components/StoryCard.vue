<script setup lang="ts">
interface StoryEntity {
  id: number
  name: string
  type: string
}

interface StoryClaim {
  claimText: string
  claimType: string | null
  attribution: string | null
}

interface Story {
  id: number
  name?: string | null
  representativeTitle?: string | null
  description?: string | null
  status?: string | null
  trendingScore?: number | null
  articleCount: number
  sourceCount: number
  sourceDiversityScore?: number | null
  firstSeen?: string | Date | null
  lastUpdated?: string | Date | null
  topicLabel?: string | null
  primaryRegion?: string | null
  primaryEntities?: StoryEntity[] | null
  timeSpanHours?: number | null
  entities?: StoryEntity[] | null
  imageUrl?: string | null
  imageLocalPath?: string | null
  leftCount?: number | null
  centerCount?: number | null
  rightCount?: number | null
  framingDistribution?: Record<string, number> | null
  avgSensationalism?: number | null
  avgFactuality?: number | null
  claims?: StoryClaim[] | null
}

const props = defineProps<{
  story: Story
}>()

const entityList = computed(() => {
  if (props.story.primaryEntities && props.story.primaryEntities.length > 0) {
    return props.story.primaryEntities.slice(0, 5)
  }
  return props.story.entities || []
})

function getStatusColor(status: string | null | undefined) {
  switch (status) {
    case 'emerging': return 'blue'
    case 'trending': return 'red'
    case 'active': return 'green'
    case 'declining': return 'gray'
    default: return 'gray'
  }
}

function getEntityColor(type: string) {
  switch (type) {
    case 'person': return 'blue'
    case 'organization': return 'green'
    case 'location': return 'orange'
    case 'event': return 'purple'
    case 'topic': return 'teal'
    default: return 'gray'
  }
}

function formatDate(date: string | Date | null | undefined) {
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

function formatTimeSpan(hours: number | null | undefined) {
  if (!hours || hours === 0) return null
  if (hours < 24) return `${Math.round(hours)}h span`
  const days = Math.round(hours / 24)
  return `${days}d span`
}

function claimTypeColor(type: string | null) {
  switch (type) {
    case 'factual': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    case 'quote': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
    case 'statistic': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    case 'prediction': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
  }
}
</script>

<template>
  <Card class="hover:shadow-lg transition-shadow">
    <template #header>
      <div class="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <!-- Story Image -->
        <div v-if="story.imageLocalPath || story.imageUrl" class="flex-shrink-0">
          <img
            :src="story.imageLocalPath || story.imageUrl || undefined"
            :alt="story.representativeTitle || story.name || ''"
            class="w-full h-40 sm:w-32 sm:h-24 object-cover rounded-lg"
            @error="($event.target as HTMLElement)?.parentElement?.style.setProperty('display', 'none')"
          />
        </div>

        <div class="flex-1 min-w-0 space-y-1.5 sm:space-y-2">
          <h3 class="text-base sm:text-xl font-bold text-gray-900 dark:text-slate-100 line-clamp-3 sm:line-clamp-none">
            {{ story.representativeTitle || story.name }}
          </h3>
          <p v-if="story.topicLabel && story.topicLabel !== story.representativeTitle" class="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {{ story.topicLabel }}
          </p>
          <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <Badge v-if="story.primaryRegion" color="gray" size="sm">
              {{ story.primaryRegion }}
            </Badge>
            <Badge :color="getStatusColor(story.status)" size="sm">
              {{ story.status }}
            </Badge>
          </div>
          <p v-if="story.description" class="text-xs sm:text-sm text-gray-600 dark:text-slate-400 line-clamp-2 sm:line-clamp-none">
            {{ story.description }}
          </p>
        </div>
      </div>
    </template>

    <div class="space-y-3 sm:space-y-4">
      <!-- Entities -->
      <div v-if="entityList.length > 0" class="flex flex-wrap gap-1.5 sm:gap-2">
        <Badge
          v-for="entity in entityList"
          :key="entity.id"
          :color="getEntityColor(entity.type)"
          size="sm"
        >
          {{ entity.name }}
        </Badge>
      </div>

      <!-- Coverage Stats -->
      <div class="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 text-sm">
        <div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-slate-400">Articles</div>
          <div class="text-base sm:text-lg font-semibold dark:text-slate-200">{{ story.articleCount }}</div>
        </div>
        <div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-slate-400">Sources</div>
          <div class="text-base sm:text-lg font-semibold dark:text-slate-200">{{ story.sourceCount }}</div>
        </div>
        <div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-slate-400">Diversity</div>
          <div class="text-base sm:text-lg font-semibold dark:text-slate-200">
            {{ ((story.sourceDiversityScore || 0) * 100).toFixed(0) }}%
          </div>
        </div>
        <div>
          <div class="text-xs sm:text-sm text-gray-600 dark:text-slate-400">Updated</div>
          <div class="text-base sm:text-lg font-semibold dark:text-slate-200">{{ formatDate(story.lastUpdated) }}</div>
        </div>
        <div v-if="formatTimeSpan(story.timeSpanHours)">
          <div class="text-xs sm:text-sm text-gray-600 dark:text-slate-400">Time Span</div>
          <div class="text-base sm:text-lg font-semibold dark:text-slate-200">{{ formatTimeSpan(story.timeSpanHours) }}</div>
        </div>
      </div>

      <!-- Key Claims -->
      <div v-if="story.claims && story.claims.length > 0" class="space-y-2">
        <div class="text-sm font-medium text-gray-700 dark:text-slate-300">Key Claims</div>
        <div class="space-y-1.5">
          <div
            v-for="(claim, ci) in story.claims"
            :key="ci"
            class="flex gap-2.5 items-start"
          >
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 mt-0.5"
              :class="claimTypeColor(claim.claimType)"
            >
              {{ claim.claimType || 'claim' }}
            </span>
            <p class="text-sm text-gray-700 dark:text-slate-300 leading-snug line-clamp-2">
              {{ claim.claimText }}
              <span v-if="claim.attribution" class="text-gray-400 dark:text-slate-500 text-xs ml-1">— {{ claim.attribution }}</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Framing Distribution -->
      <div v-if="story.framingDistribution && Object.keys(story.framingDistribution).length > 0" class="space-y-2">
        <div class="text-sm font-medium text-gray-700 dark:text-slate-300">Coverage Framing</div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="[framing, count] in Object.entries(story.framingDistribution as Record<string, number>).filter(([k]) => k !== 'unclassified').sort(([,a], [,b]) => (b as number) - (a as number)).slice(0, 4)"
            :key="framing"
            class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300"
          >
            {{ (framing as string).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }}
            <span class="text-gray-400 ml-1">{{ count }}</span>
          </span>
        </div>
      </div>
      <!-- Fallback to bias distribution -->
      <div v-else-if="story.leftCount || story.centerCount || story.rightCount" class="space-y-2">
        <div class="text-sm font-medium text-gray-700 dark:text-slate-300">Coverage by Political Leaning</div>
        <div class="flex gap-2">
          <div
            v-if="story.leftCount"
            class="flex-1 bg-blue-100 dark:bg-blue-900/30 rounded px-3 py-2 text-center"
          >
            <div class="text-xs text-blue-600 dark:text-blue-400">Left</div>
            <div class="font-semibold text-blue-900 dark:text-blue-200">{{ story.leftCount }}</div>
          </div>
          <div
            v-if="story.centerCount"
            class="flex-1 bg-gray-100 dark:bg-slate-700 rounded px-3 py-2 text-center"
          >
            <div class="text-xs text-gray-600 dark:text-slate-400">Center</div>
            <div class="font-semibold text-gray-900 dark:text-slate-200">{{ story.centerCount }}</div>
          </div>
          <div
            v-if="story.rightCount"
            class="flex-1 bg-red-100 dark:bg-red-900/30 rounded px-3 py-2 text-center"
          >
            <div class="text-xs text-red-600 dark:text-red-400">Right</div>
            <div class="font-semibold text-red-900 dark:text-red-200">{{ story.rightCount }}</div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button
        :to="`/stories/${story.id}`"
        color="primary"
        size="sm"
        block
        icon="i-heroicons-arrow-right"
        trailing
      >
        Compare Perspectives
      </Button>
    </template>
  </Card>
</template>
