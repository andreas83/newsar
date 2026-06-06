<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

const { data: stats, refresh: refreshStats } = await useFetch('/api/admin/entities/stats')

const isGenerating = ref(false)
const generationLimit = ref(20)
const forceRegenerate = ref(false)
const generationResult = ref<any>(null)

// Manual entity selection
const selectedEntityIds = ref<Set<number>>(new Set())
const isGeneratingManual = ref(false)
const manualGenerationResult = ref<any>(null)

async function generateSummaries() {
  if (isGenerating.value) return

  isGenerating.value = true
  generationResult.value = null

  try {
    const response = await $fetch('/api/admin/entities/summarize', {
      method: 'POST',
      body: {
        limit: generationLimit.value,
        force: forceRegenerate.value
      }
    })

    generationResult.value = response
    await refreshStats()
  } catch (error: any) {
    generationResult.value = {
      success: false,
      message: error.data?.message || 'Failed to generate summaries'
    }
  } finally {
    isGenerating.value = false
  }
}

function getEntityColor(type: string): string {
  const colors: Record<string, string> = {
    person: 'blue',
    organization: 'green',
    location: 'orange',
    event: 'purple',
    topic: 'teal',
  }
  return colors[type] || 'gray'
}

function toggleEntitySelection(entityId: number) {
  if (selectedEntityIds.value.has(entityId)) {
    selectedEntityIds.value.delete(entityId)
  } else {
    selectedEntityIds.value.add(entityId)
  }
}

function selectAllEntities() {
  if (stats.value?.topTrending) {
    stats.value.topTrending.forEach((entity: any) => {
      selectedEntityIds.value.add(entity.id)
    })
  }
}

function clearSelection() {
  selectedEntityIds.value.clear()
}

async function generateManualSummaries() {
  if (isGeneratingManual.value || selectedEntityIds.value.size === 0) return

  isGeneratingManual.value = true
  manualGenerationResult.value = null

  try {
    const response = await $fetch('/api/admin/entities/summarize-manual', {
      method: 'POST',
      body: {
        entityIds: Array.from(selectedEntityIds.value)
      }
    })

    manualGenerationResult.value = response
    await refreshStats()
    clearSelection()
  } catch (error: any) {
    manualGenerationResult.value = {
      success: false,
      message: error.data?.message || 'Failed to generate summaries'
    }
  } finally {
    isGeneratingManual.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Entity Management</h1>
      <p class="text-ink-3">Manage AI-generated entity summaries and statistics</p>
    </div>

    <!-- Summary Statistics -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-user-group" class="w-8 h-8 text-accent" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Total Entities</h3>
            <p class="text-2xl font-bold">
              {{ (stats?.entityCounts?.person || 0) +
                 (stats?.entityCounts?.organization || 0) +
                 (stats?.entityCounts?.location || 0) +
                 (stats?.entityCounts?.event || 0) }}
            </p>
            <p class="text-sm text-ink-3 mt-1">All types</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-document-text" class="w-8 h-8 text-green-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">With Summaries</h3>
            <p class="text-2xl font-bold">{{ stats?.summaryStats?.total || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">AI-generated</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-exclamation-triangle" class="w-8 h-8 text-orange-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Need Summary</h3>
            <p class="text-2xl font-bold">{{ stats?.needSummary || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">Entities without summaries</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-chart-bar" class="w-8 h-8 text-blue-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Avg Mentions</h3>
            <p class="text-2xl font-bold">{{ stats?.summaryStats?.avgMentions || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">Per entity</p>
          </div>
        </div>
      </Card>
    </div>

    <!-- Entity Counts by Type -->
    <Card class="mb-6">
      <template #header>
        <h3 class="text-lg font-semibold">Entity Distribution</h3>
      </template>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-sm border border-blue-200 dark:border-blue-800">
          <div class="text-xs text-blue-700 mb-1">Persons</div>
          <div class="text-2xl font-bold text-blue-900">{{ stats?.entityCounts?.person || 0 }}</div>
          <div class="text-xs text-blue-600 mt-1">People</div>
        </div>

        <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-sm border border-green-200 dark:border-green-800">
          <div class="text-xs text-green-700 mb-1">Organizations</div>
          <div class="text-2xl font-bold text-green-900">{{ stats?.entityCounts?.organization || 0 }}</div>
          <div class="text-xs text-green-600 mt-1">Companies, agencies</div>
        </div>

        <div class="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-sm border border-orange-200 dark:border-orange-800">
          <div class="text-xs text-orange-700 mb-1">Locations</div>
          <div class="text-2xl font-bold text-orange-900">{{ stats?.entityCounts?.location || 0 }}</div>
          <div class="text-xs text-orange-600 mt-1">Countries, cities</div>
        </div>

        <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-sm border border-purple-200 dark:border-purple-800">
          <div class="text-xs text-purple-700 mb-1">Events</div>
          <div class="text-2xl font-bold text-purple-900">{{ stats?.entityCounts?.event || 0 }}</div>
          <div class="text-xs text-purple-600 mt-1">Named events</div>
        </div>
      </div>
    </Card>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Generate Summaries -->
      <Card>
        <template #header>
          <h3 class="text-lg font-semibold flex items-center gap-2">
            <Icon name="i-heroicons-sparkles" class="w-5 h-5" />
            Generate Entity Summaries
          </h3>
        </template>

        <div class="space-y-4">
          <p class="text-sm text-ink-3">
            Generate AI summaries for the top entities by mention count and trending score.
            This process uses the RunPod Ollama instance and takes approximately 10-15 seconds per entity.
          </p>

          <div>
            <label class="block text-sm font-medium text-ink-2 mb-2">
              Number of Entities
            </label>
            <Input
              v-model="generationLimit"
              type="number"
              min="1"
              max="500"
              :disabled="isGenerating"
              placeholder="20"
            />
            <p class="text-xs text-ink-3 mt-1">
              Generate summaries for top {{ generationLimit }} entities (max 500)
            </p>
          </div>

          <div class="flex items-center gap-2">
            <input
              id="force-regenerate"
              v-model="forceRegenerate"
              type="checkbox"
              :disabled="isGenerating"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label for="force-regenerate" class="text-sm text-ink-2 cursor-pointer">
              Force regenerate (include entities with recent summaries)
            </label>
          </div>

          <Button
            @click="generateSummaries"
            :disabled="isGenerating"
            block
            color="primary"
          >
            <Icon
              :name="isGenerating ? 'i-heroicons-arrow-path' : 'i-heroicons-sparkles'"
              :class="{ 'animate-spin': isGenerating }"
              class="w-4 h-4 mr-2"
            />
            {{ isGenerating ? 'Generating...' : 'Generate Summaries' }}
          </Button>

          <!-- Result Message -->
          <div
            v-if="generationResult"
            :class="[
              'p-4 rounded-sm',
              generationResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
            ]"
          >
            <div class="flex items-start gap-2">
              <Icon
                :name="generationResult.success ? 'i-heroicons-check-circle' : 'i-heroicons-x-circle'"
                :class="generationResult.success ? 'text-green-600' : 'text-red-600'"
                class="w-5 h-5 mt-0.5"
              />
              <div class="flex-1">
                <p :class="generationResult.success ? 'text-green-900' : 'text-red-900'" class="font-medium text-sm">
                  {{ generationResult.message }}
                </p>
                <div v-if="generationResult.success" class="text-xs text-green-700 mt-1 space-y-1">
                  <div>Processed: {{ generationResult.processed }} / {{ generationResult.total }}</div>
                  <div v-if="generationResult.failed > 0" class="text-orange-700">
                    Failed: {{ generationResult.failed }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="text-xs text-ink-3 space-y-1">
            <div>• Entities are prioritized by trending score and mention count</div>
            <div>• Summaries are generated using qwen2.5:14b-instruct-q5_K_M</div>
            <div>• Expected time: ~{{ generationLimit * 12 }} seconds ({{ Math.round(generationLimit * 12 / 60) }} min)</div>
          </div>
        </div>
      </Card>

      <!-- Top Trending Entities -->
      <Card>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-fire" class="w-5 h-5" />
              Top Trending Entities
            </h3>
            <div class="flex items-center gap-2 text-xs">
              <button
                @click="selectAllEntities"
                class="text-blue-600 hover:text-blue-700 font-medium"
              >
                Select All
              </button>
              <span class="text-ink-4">|</span>
              <button
                @click="clearSelection"
                class="text-ink-3 hover:text-ink-2 font-medium"
              >
                Clear
              </button>
            </div>
          </div>
        </template>

        <div class="space-y-2">
          <div
            v-for="entity in stats?.topTrending"
            :key="entity.id"
            class="p-3 rounded-sm border transition-colors"
            :class="selectedEntityIds.has(entity.id) ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-rule-soft hover:bg-paper-2 '"
          >
            <div class="flex items-start gap-3">
              <input
                type="checkbox"
                :checked="selectedEntityIds.has(entity.id)"
                @change="toggleEntitySelection(entity.id)"
                class="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <Badge :color="getEntityColor(entity.type)" size="sm">
                    {{ entity.type }}
                  </Badge>
                  <NuxtLink
                    :to="`/${entity.type}/${entity.slug}`"
                    class="font-semibold text-ink hover:text-blue-600 truncate"
                  >
                    {{ entity.name }}
                  </NuxtLink>
                </div>
                <div class="flex items-center gap-3 text-xs text-ink-3">
                  <span>{{ entity.mentionCount }} mentions</span>
                  <span v-if="entity.trendingScore > 0">
                    Trending: {{ Math.round(entity.trendingScore * 100) }}%
                  </span>
                  <span v-if="entity.hasSummary" class="text-green-600 flex items-center gap-1">
                    <Icon name="i-heroicons-check-circle" class="w-3 h-3" />
                    Has summary
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Manual Generation Button -->
          <div v-if="selectedEntityIds.size > 0" class="pt-3 border-t border-rule">
            <Button
              @click="generateManualSummaries"
              :disabled="isGeneratingManual"
              block
              color="primary"
            >
              <Icon
                :name="isGeneratingManual ? 'i-heroicons-arrow-path' : 'i-heroicons-sparkles'"
                :class="{ 'animate-spin': isGeneratingManual }"
                class="w-4 h-4 mr-2"
              />
              {{ isGeneratingManual ? 'Generating...' : `Generate Summaries for ${selectedEntityIds.size} Selected` }}
            </Button>

            <!-- Manual Generation Result -->
            <div
              v-if="manualGenerationResult"
              :class="[
                'mt-3 p-3 rounded-sm text-sm',
                manualGenerationResult.success ? 'bg-green-50 border border-green-200 text-green-900' : 'bg-red-50 border border-red-200 text-red-900'
              ]"
            >
              <div class="flex items-start gap-2">
                <Icon
                  :name="manualGenerationResult.success ? 'i-heroicons-check-circle' : 'i-heroicons-x-circle'"
                  class="w-4 h-4 mt-0.5"
                />
                <div class="flex-1">
                  <p class="font-medium">{{ manualGenerationResult.message }}</p>
                  <div v-if="manualGenerationResult.success" class="text-xs mt-1 opacity-80">
                    Processed: {{ manualGenerationResult.processed }} / {{ manualGenerationResult.total }}
                    <span v-if="manualGenerationResult.failed > 0"> | Failed: {{ manualGenerationResult.failed }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Button
            to="/topics"
            block
            color="gray"
            variant="outline"
            size="sm"
          >
            View All Trending Entities
          </Button>
        </div>
      </Card>
    </div>
  </div>
</template>
