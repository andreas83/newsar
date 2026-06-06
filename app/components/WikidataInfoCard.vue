<template>
  <div v-if="enrichment && hasContent" class="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-5">
    <div class="flex items-center gap-2 mb-4">
      <Icon name="i-heroicons-globe-alt" class="w-5 h-5 text-indigo-500" />
      <h3 class="text-lg font-bold text-gray-900 dark:text-slate-100">Quick Facts</h3>
    </div>

    <dl class="space-y-3 text-sm">
      <!-- Person fields -->
      <template v-if="entityType === 'person'">
        <div v-if="props_('birthDate')" class="info-row">
          <dt class="info-label">Born</dt>
          <dd class="info-value">{{ props_('birthDate') }}</dd>
        </div>
        <div v-if="props_('deathDate')" class="info-row">
          <dt class="info-label">Died</dt>
          <dd class="info-value">{{ props_('deathDate') }}</dd>
        </div>
        <div v-if="propsList('occupation').length" class="info-row">
          <dt class="info-label">Occupation</dt>
          <dd class="info-value">{{ propsList('occupation').join(', ') }}</dd>
        </div>
        <div v-if="propsList('nationality').length" class="info-row">
          <dt class="info-label">Nationality</dt>
          <dd class="info-value">{{ propsList('nationality').join(', ') }}</dd>
        </div>
        <div v-if="propsList('positionHeld').length" class="info-row">
          <dt class="info-label">Positions</dt>
          <dd class="info-value">{{ propsList('positionHeld').slice(0, 3).join(', ') }}</dd>
        </div>
      </template>

      <!-- Organization fields -->
      <template v-if="entityType === 'organization'">
        <div v-if="props_('founded')" class="info-row">
          <dt class="info-label">Founded</dt>
          <dd class="info-value">{{ props_('founded') }}</dd>
        </div>
        <div v-if="props_('headquarters')" class="info-row">
          <dt class="info-label">Headquarters</dt>
          <dd class="info-value">{{ props_('headquarters') }}</dd>
        </div>
        <div v-if="props_('ceo')" class="info-row">
          <dt class="info-label">CEO</dt>
          <dd class="info-value">{{ props_('ceo') }}</dd>
        </div>
        <div v-if="props_('industry')" class="info-row">
          <dt class="info-label">Industry</dt>
          <dd class="info-value">{{ props_('industry') }}</dd>
        </div>
        <div v-if="props_('website')" class="info-row">
          <dt class="info-label">Website</dt>
          <dd class="info-value">
            <a :href="props_('website')" target="_blank" rel="noopener noreferrer"
              class="text-blue-600 dark:text-blue-400 hover:underline truncate block">
              {{ formatUrl(props_('website')) }}
            </a>
          </dd>
        </div>
      </template>

      <!-- Location fields -->
      <template v-if="entityType === 'location'">
        <div v-if="props_('country')" class="info-row">
          <dt class="info-label">Country</dt>
          <dd class="info-value">{{ props_('country') }}</dd>
        </div>
        <div v-if="props_('population')" class="info-row">
          <dt class="info-label">Population</dt>
          <dd class="info-value">{{ props_('population') }}</dd>
        </div>
        <div v-if="props_('website')" class="info-row">
          <dt class="info-label">Website</dt>
          <dd class="info-value">
            <a :href="props_('website')" target="_blank" rel="noopener noreferrer"
              class="text-blue-600 dark:text-blue-400 hover:underline truncate block">
              {{ formatUrl(props_('website')) }}
            </a>
          </dd>
        </div>
      </template>

      <!-- Event fields -->
      <template v-if="entityType === 'event'">
        <div v-if="props_('startDate')" class="info-row">
          <dt class="info-label">Start</dt>
          <dd class="info-value">{{ props_('startDate') }}</dd>
        </div>
        <div v-if="props_('endDate')" class="info-row">
          <dt class="info-label">End</dt>
          <dd class="info-value">{{ props_('endDate') }}</dd>
        </div>
        <div v-if="props_('location')" class="info-row">
          <dt class="info-label">Location</dt>
          <dd class="info-value">{{ props_('location') }}</dd>
        </div>
        <div v-if="propsList('participants').length" class="info-row">
          <dt class="info-label">Participants</dt>
          <dd class="info-value">{{ propsList('participants').slice(0, 4).join(', ') }}</dd>
        </div>
      </template>
    </dl>

    <!-- Wikipedia link -->
    <div v-if="enrichment.wikipediaUrl" class="mt-4 pt-3 border-t border-gray-100 dark:border-slate-700">
      <a
        :href="enrichment.wikipediaUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
      >
        <Icon name="i-heroicons-arrow-top-right-on-square" class="w-4 h-4" />
        Read on Wikipedia
      </a>
    </div>

    <!-- Source attribution -->
    <div class="mt-3 text-xs text-gray-400 dark:text-slate-500">
      Data from Wikidata
    </div>
  </div>

  <!-- Loading skeleton -->
  <div v-else-if="loading" class="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-5">
    <div class="animate-pulse space-y-3">
      <div class="h-5 bg-gray-200 dark:bg-slate-700 rounded w-24"></div>
      <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-full"></div>
      <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4"></div>
      <div class="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  entityId: number
  entityType: string
}

const props = defineProps<Props>()

const loading = ref(true)
const enrichment = ref<{
  wikidataId: string | null
  wikipediaUrl: string | null
  imageUrl: string | null
  description: string | null
  properties: Record<string, any>
} | null>(null)

// Helper to get a single property value
function props_(key: string): string | null {
  const val = enrichment.value?.properties?.[key]
  if (!val) return null
  if (typeof val === 'string') return val
  if (typeof val === 'number') return val.toString()
  return null
}

// Helper to get a list property
function propsList(key: string): string[] {
  const val = enrichment.value?.properties?.[key]
  if (!val) return []
  if (Array.isArray(val)) return val.filter(v => typeof v === 'string')
  if (typeof val === 'string') return [val]
  return []
}

// Check if we have any content to display
const hasContent = computed(() => {
  if (!enrichment.value?.properties) return false
  return Object.keys(enrichment.value.properties).length > 0 || enrichment.value.wikipediaUrl
})

function formatUrl(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

onMounted(async () => {
  try {
    const result = await $fetch<{
      cached: boolean
      wikidataId: string | null
      wikipediaUrl: string | null
      imageUrl: string | null
      description: string | null
      properties: Record<string, any>
    }>('/api/entities/enrich', {
      query: { entityId: props.entityId },
    })
    if (result?.wikidataId) {
      enrichment.value = result
    }
  } catch {
    // Enrichment is non-critical
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.info-row {
  display: flex;
  gap: 0.5rem;
}

.info-label {
  flex-shrink: 0;
  width: 90px;
  font-weight: 500;
  color: #6b7280;
}

:root.dark .info-label {
  color: #94a3b8;
}

.info-value {
  color: #111827;
  flex: 1;
  min-width: 0;
}

:root.dark .info-value {
  color: #e2e8f0;
}
</style>
