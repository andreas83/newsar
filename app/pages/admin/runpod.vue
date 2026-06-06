<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

const autoRefresh = ref(true)
const refreshInterval = ref(10000) // 10 seconds
const actionLoading = ref(false)
const lastMessage = ref('')

// Fetch RunPod status
const { data: status, refresh: refreshStatus } = useFetch('/api/admin/runpod/status', {
  server: false,
  lazy: true,
})

// Fetch pod list
const { data: podList, refresh: refreshList } = useFetch('/api/admin/runpod/list', {
  server: false,
  lazy: true,
})

// Auto-refresh
const intervalId = ref<NodeJS.Timeout | null>(null)

watch(autoRefresh, (enabled) => {
  if (enabled) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
})

function startAutoRefresh() {
  if (intervalId.value) return
  intervalId.value = setInterval(() => {
    if (autoRefresh.value) {
      refreshStatus()
      refreshList()
    }
  }, refreshInterval.value)
}

function stopAutoRefresh() {
  if (intervalId.value) {
    clearInterval(intervalId.value)
    intervalId.value = null
  }
}

onMounted(() => {
  if (autoRefresh.value) {
    startAutoRefresh()
  }
})

onBeforeUnmount(() => {
  stopAutoRefresh()
})

// Control actions
async function controlPod(action: 'create' | 'terminate' | 'restart') {
  actionLoading.value = true
  lastMessage.value = ''

  try {
    const response = await $fetch('/api/admin/runpod/control', {
      method: 'POST',
      body: { action },
    })

    lastMessage.value = `✓ ${response.message}`

    // Refresh after action
    setTimeout(() => {
      refreshStatus()
      refreshList()
    }, 1000)
  } catch (error: any) {
    lastMessage.value = `✗ ${error?.data?.message || error.message || 'Action failed'}`
  } finally {
    actionLoading.value = false
  }
}

// Format uptime
function formatUptime(seconds?: number): string {
  if (!seconds) return 'N/A'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

// Status colors
function getStatusColor(status?: string): string {
  if (!status) return 'gray'
  switch (status.toUpperCase()) {
    case 'RUNNING':
    case 'READY':
    case 'ACTIVE':
      return 'green'
    case 'PENDING':
    case 'STARTING':
      return 'yellow'
    case 'IDLE':
      return 'blue'
    case 'TERMINATING':
      return 'orange'
    case 'STOPPED':
    case 'TERMINATED':
    case 'FAILED':
      return 'red'
    default:
      return 'gray'
  }
}
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">RunPod Management</h1>
        <p class="text-ink-3">Manage on-demand GPU pods for AI processing</p>
      </div>

      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="autoRefresh" type="checkbox" class="rounded" />
          <span class="text-sm">Auto-refresh</span>
        </label>
        <Button
          @click="() => { refreshStatus(); refreshList(); }"
          icon="i-heroicons-arrow-path"
          size="sm"
          color="gray"
        >
          Refresh
        </Button>
      </div>
    </div>

    <!-- Alert message -->
    <div v-if="lastMessage" class="mb-6">
      <div
        :class="[
          'p-4 rounded-sm border',
          lastMessage.startsWith('✓')
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800',
        ]"
      >
        {{ lastMessage }}
      </div>
    </div>

    <!-- Disabled state -->
    <Card v-if="status && !status.enabled" class="mb-6">
      <div class="text-center py-12">
        <Icon name="i-heroicons-cloud-slash" class="w-16 h-16 text-ink-4 mx-auto mb-4" />
        <h3 class="text-lg font-semibold text-ink-2 mb-2">RunPod Disabled</h3>
        <p class="text-ink-3 mb-4">
          {{ status.message || 'RunPod on-demand management is currently disabled' }}
        </p>
        <p class="text-sm text-ink-3">
          Set <code class="px-2 py-1 bg-paper-2  rounded">RUNPOD_ENABLED=true</code> to enable
        </p>
      </div>
    </Card>

    <template v-else>
      <!-- Current Pod Status -->
      <Card class="mb-6">
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-server" class="w-5 h-5" />
              Current Pod
            </h3>
            <div class="flex gap-2">
              <Button
                @click="controlPod('create')"
                :disabled="actionLoading || (status?.pod?.status === 'READY' || status?.pod?.status === 'ACTIVE')"
                icon="i-heroicons-play"
                size="sm"
                color="green"
              >
                Create
              </Button>
              <Button
                @click="controlPod('restart')"
                :disabled="actionLoading"
                icon="i-heroicons-arrow-path"
                size="sm"
                color="blue"
              >
                Restart
              </Button>
              <Button
                @click="controlPod('terminate')"
                :disabled="actionLoading || !status?.pod"
                icon="i-heroicons-stop"
                size="sm"
                color="red"
              >
                Terminate
              </Button>
            </div>
          </div>
        </template>

        <div v-if="!status?.pod" class="text-center py-8">
          <Icon name="i-heroicons-server-stack" class="w-12 h-12 text-ink-4 mx-auto mb-3" />
          <p class="text-ink-3">No active pod</p>
        </div>

        <div v-else class="space-y-4">
          <!-- Pod info grid -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div class="text-xs text-ink-3 mb-1">Status</div>
              <Badge :color="getStatusColor(status.pod.status)">
                {{ status.pod.status }}
              </Badge>
            </div>
            <div>
              <div class="text-xs text-ink-3 mb-1">Pod ID</div>
              <code class="text-xs">{{ status.pod.id }}</code>
            </div>
            <div>
              <div class="text-xs text-ink-3 mb-1">Uptime</div>
              <div class="font-mono text-sm">{{ status.pod.uptime?.formatted || 'N/A' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-3 mb-1">Jobs Processed</div>
              <div class="font-semibold">{{ status.pod.jobs?.processed || 0 }}</div>
            </div>
          </div>

          <!-- Cost and idle info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
            <div>
              <div class="text-xs text-ink-3 mb-1">Session Cost</div>
              <div class="font-semibold text-green-600">${{ status.pod.cost?.session || '0.00' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-3 mb-1">Hourly Rate</div>
              <div class="text-sm">${{ status.pod.cost?.hourly || '0.40' }}/hr</div>
            </div>
            <div>
              <div class="text-xs text-ink-3 mb-1">Idle Time</div>
              <div class="font-mono text-sm">{{ status.pod.idle?.formatted || 'N/A' }}</div>
            </div>
            <div>
              <div class="text-xs text-ink-3 mb-1">Idle Progress</div>
              <div class="flex items-center gap-2">
                <Progress :value="Number(status.pod.idle?.percentage || 0)" class="flex-1" />
                <span class="text-xs">{{ status.pod.idle?.percentage || 0 }}%</span>
              </div>
            </div>
          </div>

          <!-- Pod URL -->
          <div v-if="status.pod.url" class="pt-4 border-t">
            <div class="text-xs text-ink-3 mb-1">Ollama URL</div>
            <code class="text-xs break-all">{{ status.pod.url }}</code>
          </div>
        </div>
      </Card>

      <!-- Configuration and Costs -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- Cost tracking -->
        <Card>
          <template #header>
            <h3 class="text-lg font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-currency-dollar" class="w-5 h-5" />
              Cost Tracking
            </h3>
          </template>

          <div class="space-y-4">
            <div>
              <div class="flex justify-between text-sm mb-2">
                <span class="text-ink-3">Today's Cost</span>
                <span class="font-semibold">${{ status?.costs?.today || '0.00' }}</span>
              </div>
              <Progress
                :value="Number(status?.costs?.percentage || 0)"
                :color="Number(status?.costs?.percentage || 0) > 80 ? 'red' : 'green'"
              />
              <div class="text-xs text-ink-3 mt-1">
                Daily limit: ${{ status?.costs?.limit || 20 }}
              </div>
            </div>

            <div class="pt-4 border-t space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-ink-3">Max Pods</span>
                <span>{{ status?.config?.maxPods || 1 }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-ink-3">Idle Timeout</span>
                <span>{{ status?.config?.idleTimeoutMinutes || 15 }} minutes</span>
              </div>
            </div>
          </div>
        </Card>

        <!-- Idle Monitor -->
        <Card>
          <template #header>
            <h3 class="text-lg font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-clock" class="w-5 h-5" />
              Idle Monitor
            </h3>
          </template>

          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm text-ink-3">Status</span>
              <Badge :color="status?.idleMonitor?.running ? 'green' : 'gray'">
                {{ status?.idleMonitor?.running ? 'Running' : 'Stopped' }}
              </Badge>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-sm text-ink-3">Check Interval</span>
              <span class="text-sm">{{ status?.idleMonitor?.checkIntervalMinutes || 2 }} minutes</span>
            </div>

            <div class="pt-4 border-t">
              <p class="text-xs text-ink-3">
                The idle monitor automatically terminates pods after {{ status?.config?.idleTimeoutMinutes || 15 }}
                minutes of inactivity to save costs.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <!-- All Pods List -->
      <Card>
        <template #header>
          <h3 class="text-lg font-semibold flex items-center gap-2">
            <Icon name="i-heroicons-server-stack" class="w-5 h-5" />
            All Pods ({{ podList?.count || 0 }})
          </h3>
        </template>

        <div v-if="!podList?.pods || podList.pods.length === 0" class="text-center py-8">
          <Icon name="i-heroicons-inbox" class="w-12 h-12 text-ink-4 mx-auto mb-3" />
          <p class="text-ink-3">No pods found</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b">
              <tr class="text-left">
                <th class="pb-3 font-semibold">Pod ID</th>
                <th class="pb-3 font-semibold">Status</th>
                <th class="pb-3 font-semibold">GPU</th>
                <th class="pb-3 font-semibold">CPU / RAM</th>
                <th class="pb-3 font-semibold">Uptime</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="pod in podList.pods"
                :key="pod.id"
                class="border-b last:border-b-0"
              >
                <td class="py-3">
                  <code class="text-xs">{{ pod.id }}</code>
                </td>
                <td class="py-3">
                  <Badge :color="getStatusColor(pod.status)">
                    {{ pod.status }}
                  </Badge>
                </td>
                <td class="py-3 text-ink-3">
                  {{ pod.gpuType || 'N/A' }}
                </td>
                <td class="py-3 text-ink-3">
                  {{ pod.cpuCores || 'N/A' }} cores / {{ pod.memoryInGb || 'N/A' }} GB
                </td>
                <td class="py-3 text-ink-3">
                  {{ formatUptime(pod.uptime) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>
  </div>
</template>
