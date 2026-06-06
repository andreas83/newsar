<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

const { data: stats, refresh } = await useFetch('/api/admin/stats')
</script>

<template>
  <div class="p-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">Dashboard</h1>
      <p class="text-ink-3">Overview of your news aggregation system</p>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-newspaper" class="w-8 h-8 text-accent" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Total Articles</h3>
            <p class="text-2xl font-bold">{{ stats?.totalArticles || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">{{ stats?.extractedArticles || 0 }} with full content</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-tag" class="w-8 h-8 text-green-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Classified</h3>
            <p class="text-2xl font-bold">{{ stats?.classifiedArticles || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">{{ stats?.pendingClassification || 0 }} pending</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-rectangle-group" class="w-8 h-8 text-purple-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Stories</h3>
            <p class="text-2xl font-bold">{{ stats?.totalStories || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">{{ stats?.trendingStories || 0 }} trending</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-rss" class="w-8 h-8 text-orange-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Active Feeds</h3>
            <p class="text-2xl font-bold">{{ stats?.activeFeeds || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">{{ stats?.totalFeeds || 0 }} total</p>
          </div>
        </div>
      </Card>
    </div>

    <!-- Entity Summaries Stats -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-user-group" class="w-8 h-8 text-blue-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Total Entities</h3>
            <p class="text-2xl font-bold">{{ stats?.totalEntities || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">All types extracted</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-sparkles" class="w-8 h-8 text-green-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">AI Summaries</h3>
            <p class="text-2xl font-bold">{{ stats?.entitiesWithSummaries || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">{{ stats?.entitySummaryCoverage || 0 }}% coverage</p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-exclamation-triangle" class="w-8 h-8 text-orange-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Need Summary</h3>
            <p class="text-2xl font-bold">{{ stats?.entitiesNeedingSummaries || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">
              <NuxtLink to="/admin/entities" class="text-accent-600 hover:underline">Generate now →</NuxtLink>
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div class="flex items-start gap-4">
          <Icon name="i-heroicons-cube" class="w-8 h-8 text-indigo-600" />
          <div class="flex-1">
            <h3 class="text-sm font-medium text-ink-3">Embeddings</h3>
            <p class="text-2xl font-bold">{{ stats?.embeddingsGenerated || 0 }}</p>
            <p class="text-sm text-ink-3 mt-1">768 dimensions</p>
          </div>
        </div>
      </Card>
    </div>

    <Card class="mb-6">
      <template #header>
        <h3 class="text-lg font-semibold">Processing Pipeline Status</h3>
      </template>

            <div class="space-y-4">
              <div>
                <div class="flex justify-between mb-1">
                  <span class="text-sm">Content Extraction</span>
                  <span class="text-sm font-medium">
                    {{
                      stats?.totalArticles > 0
                        ? Math.round((stats?.extractedArticles / stats?.totalArticles) * 100)
                        : 0
                    }}%
                  </span>
                </div>
                <Progress
                  :value="stats?.totalArticles > 0 ? (stats?.extractedArticles / stats?.totalArticles) * 100 : 0"
                />
              </div>

              <div>
                <div class="flex justify-between mb-1">
                  <span class="text-sm">Classification</span>
                  <span class="text-sm font-medium">
                    {{
                      stats?.totalArticles > 0
                        ? Math.round((stats?.classifiedArticles / stats?.totalArticles) * 100)
                        : 0
                    }}%
                  </span>
                </div>
                <Progress
                  :value="stats?.totalArticles > 0 ? (stats?.classifiedArticles / stats?.totalArticles) * 100 : 0"
                  color="green"
                />
              </div>

              <div>
                <div class="flex justify-between mb-1">
                  <span class="text-sm">Embeddings</span>
                  <span class="text-sm font-medium">
                    {{
                      stats?.totalArticles > 0
                        ? Math.round((stats?.embeddingsGenerated / stats?.totalArticles) * 100)
                        : 0
                    }}%
                  </span>
                </div>
                <Progress
                  :value="stats?.totalArticles > 0 ? (stats?.embeddingsGenerated / stats?.totalArticles) * 100 : 0"
                  color="blue"
                />
              </div>

              <div>
                <div class="flex justify-between mb-1">
                  <span class="text-sm">Analysis</span>
                  <span class="text-sm font-medium">
                    {{
                      stats?.totalArticles > 0
                        ? Math.round((stats?.analyzedArticles / stats?.totalArticles) * 100)
                        : 0
                    }}%
                  </span>
                </div>
                <Progress
                  :value="stats?.totalArticles > 0 ? (stats?.analyzedArticles / stats?.totalArticles) * 100 : 0"
                  color="purple"
                />
              </div>
      </div>
    </Card>

    <!-- Stock Market Tracking -->
    <AdminStockCollectionStatusCard class="mb-6" />

    <!-- RunPod AI Processing Status -->
    <AdminRunPodStatusCard class="mb-6" />

    <!-- Model Comparison -->
    <AdminModelComparisonCard class="mb-6" />

    <!-- Topics & Entities Stats -->
    <Card>
      <template #header>
        <h3 class="text-lg font-semibold flex items-center gap-2">
          <Icon name="i-heroicons-squares-plus" class="w-5 h-5" />
          Topics & Entities
        </h3>
      </template>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-sm border border-purple-200 dark:border-purple-800">
          <div class="text-xs text-purple-700 mb-1">Keywords</div>
          <div class="text-2xl font-bold text-purple-900">{{ stats?.totalKeywords || 0 }}</div>
          <div class="text-xs text-purple-600 mt-1">{{ stats?.uniqueKeywords || 0 }} unique</div>
        </div>

        <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-sm border border-blue-200 dark:border-blue-800">
          <div class="text-xs text-blue-700 mb-1">Persons</div>
          <div class="text-2xl font-bold text-blue-900">{{ stats?.entityCounts?.person || 0 }}</div>
          <div class="text-xs text-blue-600 mt-1">Named entities</div>
        </div>

        <div class="p-4 bg-green-50 dark:bg-green-900/20 rounded-sm border border-green-200 dark:border-green-800">
          <div class="text-xs text-green-700 mb-1">Organizations</div>
          <div class="text-2xl font-bold text-green-900">{{ stats?.entityCounts?.organization || 0 }}</div>
          <div class="text-xs text-green-600 mt-1">Named entities</div>
        </div>

        <div class="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-sm border border-orange-200 dark:border-orange-800">
          <div class="text-xs text-orange-700 mb-1">Locations</div>
          <div class="text-2xl font-bold text-orange-900">{{ stats?.entityCounts?.location || 0 }}</div>
          <div class="text-xs text-orange-600 mt-1">Geographic</div>
        </div>

        <div class="p-4 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800">
          <div class="text-xs text-red-700 mb-1">Events</div>
          <div class="text-2xl font-bold text-red-900">{{ stats?.entityCounts?.event || 0 }}</div>
          <div class="text-xs text-red-600 mt-1">Named entities</div>
        </div>

        <div class="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-sm border border-indigo-200 dark:border-indigo-800">
          <div class="text-xs text-indigo-700 mb-1">Relationships</div>
          <div class="text-2xl font-bold text-indigo-900">{{ (stats?.entityRelationshipsCount || 0).toLocaleString() }}</div>
          <div class="text-xs text-indigo-600 mt-1">Entity links</div>
        </div>

        <div class="p-4 bg-paper-2/50 rounded-sm border border-rule">
          <div class="text-xs text-ink-2 mb-1">Total Entities</div>
          <div class="text-2xl font-bold text-ink">{{ stats?.totalEntities || 0 }}</div>
          <div class="text-xs text-ink-3 mt-1">All types</div>
        </div>

        <div class="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-sm border border-teal-200 dark:border-teal-800">
          <div class="text-xs text-teal-700 mb-1">Coverage</div>
          <div class="text-2xl font-bold text-teal-900">
            {{ stats?.totalArticles > 0 ? Math.round((stats?.totalEntities / stats?.totalArticles) * 100) : 0 }}%
          </div>
          <div class="text-xs text-teal-600 mt-1">Entities per article</div>
        </div>
      </div>
    </Card>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <template #header>
              <h3 class="text-lg font-semibold">Recent Activity</h3>
            </template>
            <div class="text-sm text-ink-3">
              Coming soon: Activity feed
            </div>
          </Card>

          <Card>
            <template #header>
              <h3 class="text-lg font-semibold">Quick Actions</h3>
            </template>
            <div class="space-y-2">
              <Button
                to="/admin/feeds"
                block
                icon="i-heroicons-rss"
                label="Manage Feeds"
              />
              <Button
                to="/admin/entities"
                block
                icon="i-heroicons-sparkles"
                label="Generate Entity Summaries"
                color="primary"
              />
              <Button
                to="/admin/classifications"
                block
                icon="i-heroicons-tag"
                label="Review Classifications"
                color="gray"
              />
              <Button
                @click="refresh"
                block
                icon="i-heroicons-arrow-path"
                label="Refresh Stats"
                color="gray"
              />
        </div>
      </Card>
    </div>
  </div>
</template>
