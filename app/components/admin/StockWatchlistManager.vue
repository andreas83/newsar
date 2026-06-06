<script setup lang="ts">
const { data, refresh } = await useFetch('/api/admin/stocks/watchlist')

// Add ticker form
const newTicker = ref('')
const adding = ref(false)
const addError = ref('')

async function addTicker() {
  if (!newTicker.value.trim()) return
  adding.value = true
  addError.value = ''
  try {
    await $fetch('/api/admin/stocks/watchlist', {
      method: 'POST',
      body: { ticker: newTicker.value.trim() },
    })
    newTicker.value = ''
    await refresh()
  } catch (e: any) {
    addError.value = e.data?.message || 'Failed to add ticker'
  } finally {
    adding.value = false
  }
}

async function toggleActive(id: number, isActive: boolean) {
  await $fetch(`/api/admin/stocks/${id}`, {
    method: 'PATCH',
    body: { isActive: !isActive },
  })
  await refresh()
}

async function deleteTicker(id: number, ticker: string) {
  if (!confirm(`Remove ${ticker} from watchlist?`)) return
  await $fetch(`/api/admin/stocks/${id}`, { method: 'DELETE' })
  await refresh()
}

const autoMapping = ref(false)
async function triggerAutoMap() {
  autoMapping.value = true
  try {
    const result = await $fetch('/api/admin/stocks/auto-map', { method: 'POST' })
    alert(`Mapped ${result.mapped} of ${result.total} tickers`)
    await refresh()
  } finally {
    autoMapping.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Add Ticker -->
    <Card>
      <template #header>
        <h3 class="font-semibold">Add Ticker</h3>
      </template>
      <div class="flex gap-2">
        <input
          v-model="newTicker"
          type="text"
          placeholder="e.g. AAPL"
          class="flex-1 px-3 py-2 border border-rule rounded-sm bg-paper text-ink text-sm font-mono uppercase"
          @keyup.enter="addTicker"
        />
        <button
          class="px-4 py-2 bg-accent text-white text-sm rounded-sm hover:bg-accent/90 disabled:opacity-50"
          :disabled="adding || !newTicker.trim()"
          @click="addTicker"
        >
          {{ adding ? 'Adding...' : 'Add' }}
        </button>
        <button
          class="px-4 py-2 bg-paper-2 text-ink-2 text-sm rounded-sm hover:bg-paper-2/80 disabled:opacity-50"
          :disabled="autoMapping"
          @click="triggerAutoMap"
        >
          {{ autoMapping ? 'Mapping...' : 'Auto-Map Entities' }}
        </button>
      </div>
      <p v-if="addError" class="text-red-600 text-sm mt-2">{{ addError }}</p>
    </Card>

    <!-- Watchlist Table -->
    <Card>
      <template #header>
        <h3 class="font-semibold">Watchlist ({{ data?.items?.length || 0 }})</h3>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-rule text-left text-ink-3 font-mono text-xs uppercase tracking-wider">
              <th class="px-3 py-2">Ticker</th>
              <th class="px-3 py-2">Company</th>
              <th class="px-3 py-2">Sector</th>
              <th class="px-3 py-2">Entity Link</th>
              <th class="px-3 py-2">Method</th>
              <th class="px-3 py-2">Last Price</th>
              <th class="px-3 py-2">Active</th>
              <th class="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in data?.items"
              :key="item.id"
              class="border-b border-rule-soft hover:bg-paper-2/50"
            >
              <td class="px-3 py-2 font-mono font-bold">{{ item.ticker }}</td>
              <td class="px-3 py-2 text-ink-2">{{ item.companyName }}</td>
              <td class="px-3 py-2">
                <span v-if="item.sector" class="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-paper-2 rounded-sm">
                  {{ item.sector }}
                </span>
              </td>
              <td class="px-3 py-2">
                <NuxtLink
                  v-if="item.entitySlug"
                  :to="`/organization/${item.entitySlug}`"
                  class="text-accent hover:underline"
                >
                  {{ item.entityName }}
                </NuxtLink>
                <span v-else class="text-ink-4">—</span>
              </td>
              <td class="px-3 py-2">
                <span v-if="item.mappingMethod" class="text-xs text-ink-3">
                  {{ item.mappingMethod }}
                  <span v-if="item.mappingConfidence" class="text-ink-4">
                    ({{ Math.round(item.mappingConfidence * 100) }}%)
                  </span>
                </span>
                <span v-else class="text-ink-4">—</span>
              </td>
              <td class="px-3 py-2 text-ink-3">
                {{ item.lastPriceAt ? new Date(item.lastPriceAt).toLocaleString() : '—' }}
              </td>
              <td class="px-3 py-2">
                <button
                  class="w-8 h-5 rounded-full transition-colors relative"
                  :class="item.isActive ? 'bg-green-500' : 'bg-gray-300'"
                  @click="toggleActive(item.id, item.isActive)"
                >
                  <span
                    class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                    :class="item.isActive ? 'left-3.5' : 'left-0.5'"
                  />
                </button>
              </td>
              <td class="px-3 py-2">
                <button
                  class="text-red-500 hover:text-red-700 text-xs"
                  @click="deleteTicker(item.id, item.ticker)"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  </div>
</template>
