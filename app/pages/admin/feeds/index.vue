<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

const { data: response, refresh } = await useFetch('/api/feeds')
const feeds = computed(() => response.value?.data || [])

// Modal state
const isModalOpen = ref(false)
const isEditing = ref(false)
const currentFeed = ref<any>(null)

// Form data
const feedForm = ref({
  name: '',
  url: '',
  category: 'world',
  region: 'global',
  knownBias: 0,
  isActive: true,
})

function openAddModal() {
  isEditing.value = false
  feedForm.value = {
    name: '',
    url: '',
    category: 'world',
    region: 'global',
    knownBias: 0,
    isActive: true,
  }
  isModalOpen.value = true
}

function openEditModal(feed: any) {
  isEditing.value = true
  currentFeed.value = feed
  feedForm.value = {
    name: feed.name,
    url: feed.url,
    category: feed.category || 'world',
    region: feed.region || 'global',
    knownBias: feed.knownBias || 0,
    isActive: feed.isActive === 1,
  }
  isModalOpen.value = true
}

async function saveFeed() {
  const endpoint = isEditing.value
    ? `/api/feeds/${currentFeed.value.id}`
    : '/api/feeds'

  const method = isEditing.value ? 'PUT' : 'POST'

  try {
    await $fetch(endpoint, {
      method,
      body: {
        ...feedForm.value,
        isActive: feedForm.value.isActive ? 1 : 0,
      },
    })

    isModalOpen.value = false
    await refresh()
  } catch (error) {
    console.error('Failed to save feed:', error)
    alert('Failed to save feed')
  }
}

async function toggleActive(feed: any) {
  try {
    await $fetch(`/api/feeds/${feed.id}`, {
      method: 'PUT',
      body: {
        ...feed,
        isActive: feed.isActive ? 0 : 1,
      },
    })
    await refresh()
  } catch (error) {
    console.error('Failed to toggle feed:', error)
  }
}

async function deleteFeed(feed: any) {
  if (!confirm(`Delete feed "${feed.name}"?`)) return

  try {
    await $fetch(`/api/feeds/${feed.id}`, {
      method: 'DELETE',
    })
    await refresh()
  } catch (error) {
    console.error('Failed to delete feed:', error)
    alert('Failed to delete feed')
  }
}

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'url', label: 'URL' },
  { key: 'knownBias', label: 'Bias' },
  { key: 'stats', label: 'Articles' },
  { key: 'avgLength', label: 'Avg Length' },
  { key: 'errors', label: 'Errors' },
  { key: 'lastFetchedAt', label: 'Last Fetch' },
  { key: 'isActive', label: 'Status' },
  { key: 'actions', label: 'Actions' },
]

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

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i)) + ' ' + sizes[i]
}

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
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Feed Management</h1>
        <p class="text-ink-3">Manage RSS news feeds</p>
      </div>
      <div class="flex gap-2">
        <Button icon="i-heroicons-plus" color="primary" @click="openAddModal">
          Add Feed
        </Button>
        <Button icon="i-heroicons-arrow-path" color="gray" variant="outline" @click="refresh">
          Refresh
        </Button>
      </div>
    </div>

    <Card>
      <Table :columns="columns" :rows="feeds">
        <template #name-data="{ row }">
          <div>
            <div class="font-medium">{{ row.name }}</div>
            <div class="text-xs text-ink-3">{{ row.category || 'General' }}</div>
          </div>
        </template>

        <template #url-data="{ row }">
          <a :href="row.url" target="_blank" class="text-accent-600 hover:underline text-sm">
            {{ row.url.substring(0, 50) }}...
          </a>
        </template>

        <template #knownBias-data="{ row }">
          <Badge :color="getBiasColor(row.knownBias)" variant="subtle" size="sm">
            {{ getBiasLabel(row.knownBias) }}
          </Badge>
        </template>

        <template #stats-data="{ row }">
          <div class="text-sm">
            <div class="font-medium">{{ row.stats?.totalArticles || 0 }}</div>
            <div class="text-xs text-ink-3">
              {{ row.stats?.extractedArticles || 0 }} extracted
            </div>
          </div>
        </template>

        <template #avgLength-data="{ row }">
          <div class="text-sm">
            {{ formatBytes(row.stats?.avgContentLength || 0) }}
          </div>
        </template>

        <template #errors-data="{ row }">
          <Badge
            :color="row.stats?.failedExtractions > 0 ? 'red' : 'green'"
            size="sm"
          >
            {{ row.stats?.failedExtractions || 0 }}
          </Badge>
        </template>

        <template #lastFetchedAt-data="{ row }">
          <div class="text-sm text-ink-3">
            {{ formatDate(row.lastFetchedAt) }}
          </div>
        </template>

        <template #isActive-data="{ row }">
          <Badge :color="row.isActive ? 'green' : 'gray'" size="sm">
            {{ row.isActive ? 'Active' : 'Inactive' }}
          </Badge>
        </template>

        <template #actions-data="{ row }">
          <div class="flex gap-2">
            <Button
              size="sm"
              :color="row.isActive ? 'gray' : 'green'"
              variant="ghost"
              :icon="row.isActive ? 'i-heroicons-pause' : 'i-heroicons-play'"
              @click="toggleActive(row)"
            >
              {{ row.isActive ? 'Deactivate' : 'Activate' }}
            </Button>
            <Button
              size="sm"
              color="blue"
              variant="ghost"
              icon="i-heroicons-pencil"
              @click="openEditModal(row)"
            >
              Edit
            </Button>
            <Button
              size="sm"
              color="red"
              variant="ghost"
              icon="i-heroicons-trash"
              @click="deleteFeed(row)"
            >
              Delete
            </Button>
          </div>
        </template>
      </Table>
    </Card>

    <!-- Add/Edit Modal -->
    <div
      v-if="isModalOpen"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      @click.self="isModalOpen = false"
    >
      <Card class="w-full max-w-2xl">
        <template #header>
          <h2 class="text-xl font-bold">{{ isEditing ? 'Edit Feed' : 'Add New Feed' }}</h2>
        </template>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Name *</label>
            <Input v-model="feedForm.name" placeholder="BBC News - World" />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">RSS URL *</label>
            <Input v-model="feedForm.url" placeholder="https://feeds.bbci.co.uk/news/world/rss.xml" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">Category</label>
              <SelectMenu
                v-model="feedForm.category"
                :options="[
                  { label: 'World News', value: 'world' },
                  { label: 'Politics', value: 'politics' },
                  { label: 'Business', value: 'business' },
                  { label: 'Technology', value: 'technology' },
                  { label: 'Science', value: 'science' },
                  { label: 'General', value: 'general' },
                ]"
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-1">Region</label>
              <SelectMenu
                v-model="feedForm.region"
                :options="[
                  { label: 'Global', value: 'global' },
                  { label: 'North America', value: 'north-america' },
                  { label: 'Europe', value: 'europe' },
                  { label: 'Asia', value: 'asia' },
                  { label: 'Middle East', value: 'middle-east' },
                  { label: 'Africa', value: 'africa' },
                  { label: 'Latin America', value: 'latin-america' },
                ]"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">
              Political Bias (-1 = Far Left, 0 = Center, 1 = Far Right)
            </label>
            <Input
              v-model.number="feedForm.knownBias"
              type="number"
              step="0.1"
              min="-1"
              max="1"
              placeholder="0"
            />
          </div>

          <div class="flex items-center gap-2">
            <input
              id="isActive"
              v-model="feedForm.isActive"
              type="checkbox"
              class="w-4 h-4 text-accent-600 rounded"
            />
            <label for="isActive" class="text-sm font-medium">Active</label>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <Button color="gray" variant="outline" @click="isModalOpen = false">
              Cancel
            </Button>
            <Button color="primary" @click="saveFeed">
              {{ isEditing ? 'Save Changes' : 'Add Feed' }}
            </Button>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>
