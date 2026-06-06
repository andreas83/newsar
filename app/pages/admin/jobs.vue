<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: 'admin',
})

const refreshInterval = ref(5000) // 5 seconds
const autoRefresh = ref(true)
const lastMessage = ref('')
const isInitialLoad = ref(true)

const { data: jobStatus, refresh: refreshJobs, pending } = useFetch('/api/admin/jobs/status', {
  server: false,
  lazy: true,
  dedupe: 'defer',
})

const { data: pipelineStatus, refresh: refreshPipeline } = useFetch('/api/admin/auto-pipeline/status', {
  server: false,
  lazy: true,
  dedupe: 'defer',
})

// Fetch job statistics
const { data: jobStats, refresh: refreshStats } = useFetch('/api/admin/jobs/stats', {
  server: false,
  lazy: true,
  dedupe: 'defer',
})

// Job details modal
const selectedJob = ref<{ id: string; queue: 'feed' | 'topic' } | null>(null)

function openJobDetails(jobId: string, queue: 'feed' | 'topic') {
  selectedJob.value = { id: jobId, queue }
}

function closeJobDetails() {
  selectedJob.value = null
}

// Mark as loaded after first successful fetch
watch(jobStatus, (value) => {
  if (value && isInitialLoad.value) {
    isInitialLoad.value = false
  }
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
      refreshJobs()
      refreshPipeline()
      refreshStats()
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

// Queue a job
const queueing = ref(false)
async function queueJob(action: string, options?: any) {
  queueing.value = true
  try {
    const response = await $fetch('/api/admin/jobs/queue', {
      method: 'POST',
      body: { action, options },
    })
    const jobCount = response.queuedJobs || 0
    const limit = options?.limit || ''
    const limitText = limit ? ` (requested: ${limit})` : ''
    lastMessage.value = `✓ Queued ${jobCount} job${jobCount !== 1 ? 's' : ''}${limitText}`
    await refreshJobs()
    setTimeout(() => { lastMessage.value = '' }, 5000)
  } catch (error: any) {
    lastMessage.value = `✗ ${error.data?.statusMessage || 'Failed to queue job'}`
    setTimeout(() => { lastMessage.value = '' }, 5000)
  } finally {
    queueing.value = false
  }
}

// Control queue
const controlling = ref(false)
async function controlQueue(queue: string, action: string, jobId?: string) {
  controlling.value = true
  try {
    const response = await $fetch('/api/admin/jobs/control', {
      method: 'POST',
      body: { queue, action, jobId },
    })
    lastMessage.value = `✓ ${response.message}`
    await refreshJobs()
    setTimeout(() => { lastMessage.value = '' }, 3000)
  } catch (error: any) {
    lastMessage.value = `✗ ${error.data?.statusMessage || 'Failed to perform action'}`
    setTimeout(() => { lastMessage.value = '' }, 5000)
  } finally {
    controlling.value = false
  }
}

// Confirm dangerous actions
async function confirmAndExecute(message: string, callback: () => Promise<void>) {
  if (confirm(message)) {
    await callback()
  }
}

// Format timestamp
function formatTime(timestamp: number | undefined) {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString()
}

// Calculate duration
function calculateDuration(start: number | undefined, end: number | undefined) {
  if (!start || !end) return 'N/A'
  const duration = end - start
  if (duration < 1000) return `${duration}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`
  return `${(duration / 60000).toFixed(1)}m`
}

// Format duration from milliseconds
function formatDuration(ms: number | null) {
  if (!ms) return 'N/A'
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

// Get processing time color
function getProcessingTimeColor(ms: number | null) {
  if (!ms) return 'gray'
  if (ms < 5000) return 'green'
  if (ms < 30000) return 'yellow'
  return 'red'
}

// Format percentage
function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

// Format jobs per time
function formatRate(rate: number) {
  return rate < 1 ? rate.toFixed(2) : rate.toFixed(0)
}

// Control auto-pipeline
const pipelineControlling = ref(false)
async function controlPipeline(action: string) {
  pipelineControlling.value = true
  try {
    const response = await $fetch('/api/admin/auto-pipeline/control', {
      method: 'POST',
      body: { action },
    })
    lastMessage.value = `✓ ${response.message}`
    await refreshPipeline()
    setTimeout(() => { lastMessage.value = '' }, 3000)
  } catch (error: any) {
    lastMessage.value = `✗ ${error.data?.statusMessage || 'Failed to control pipeline'}`
    setTimeout(() => { lastMessage.value = '' }, 5000)
  } finally {
    pipelineControlling.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <!-- Header -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Job Management</h1>
        <p class="text-ink-3">Monitor and control background job processing</p>
        <div v-if="lastMessage" class="mt-2 text-sm" :class="lastMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'">
          {{ lastMessage }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" v-model="autoRefresh" class="w-4 h-4" />
          <span>Auto-refresh ({{ refreshInterval / 1000 }}s)</span>
        </label>
        <Button
          icon="i-heroicons-arrow-path"
          :loading="pending"
          @click="refreshJobs"
        >
          Refresh
        </Button>
      </div>
    </div>

    <!-- Auto-Pipeline Status -->
    <Card v-if="pipelineStatus" class="mb-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon name="i-heroicons-bolt" class="w-5 h-5 text-purple-600" />
            <h3 class="font-semibold">Automatic Pipeline</h3>
          </div>
          <Badge
            :color="pipelineStatus.running ? 'green' : 'gray'"
            variant="subtle"
            size="lg"
          >
            {{ pipelineStatus.running ? 'Running' : 'Stopped' }}
          </Badge>
        </div>
      </template>

      <div class="space-y-4">
        <!-- Description -->
        <p class="text-sm text-ink-2">
          The automatic pipeline monitors system load and automatically queues jobs based on pipeline status.
          It runs every {{ pipelineStatus.config?.checkIntervalMinutes || 5 }} minutes.
        </p>

        <!-- System Load with Thresholds -->
        <div v-if="pipelineStatus.systemLoad" class="bg-panel rounded-sm border  p-4 mb-4">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold">System Load Monitoring</h4>
            <Badge
              :color="pipelineStatus.systemLoad.isOverloaded ? 'red' : 'green'"
              size="sm"
            >
              {{ pipelineStatus.systemLoad.isOverloaded ? '⚠️ Overloaded' : '✓ Healthy' }}
            </Badge>
          </div>

          <div class="grid grid-cols-3 gap-4">
            <!-- CPU Load -->
            <div class="p-3 bg-paper-2/50 rounded-sm">
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs text-ink-3">CPU Load</div>
                <Badge
                  :color="(pipelineStatus.systemLoad.cpu || 0) > (pipelineStatus.config?.loadThresholds?.cpu || 0.6) ? 'red' : (pipelineStatus.systemLoad.cpu || 0) > 0.5 ? 'yellow' : 'green'"
                  size="xs"
                  variant="subtle"
                >
                  {{ pipelineStatus.systemLoad.cpuPercent || '0%' }}
                </Badge>
              </div>
              <Progress
                :value="(pipelineStatus.systemLoad.cpu || 0) * 100"
                :color="(pipelineStatus.systemLoad.cpu || 0) > (pipelineStatus.config?.loadThresholds?.cpu || 0.6) ? 'red' : (pipelineStatus.systemLoad.cpu || 0) > 0.5 ? 'yellow' : 'green'"
                class="mb-1"
              />
              <div class="text-xs text-ink-3">
                Threshold: {{ ((pipelineStatus.config?.loadThresholds?.cpu || 0.6) * 100).toFixed(0) }}%
              </div>
            </div>

            <!-- Memory Usage -->
            <div class="p-3 bg-paper-2/50 rounded-sm">
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs text-ink-3">Memory Usage</div>
                <Badge
                  :color="(pipelineStatus.systemLoad.memory || 0) > (pipelineStatus.config?.loadThresholds?.memory || 0.75) ? 'red' : (pipelineStatus.systemLoad.memory || 0) > 0.65 ? 'yellow' : 'green'"
                  size="xs"
                  variant="subtle"
                >
                  {{ pipelineStatus.systemLoad.memoryPercent || '0%' }}
                </Badge>
              </div>
              <Progress
                :value="(pipelineStatus.systemLoad.memory || 0) * 100"
                :color="(pipelineStatus.systemLoad.memory || 0) > (pipelineStatus.config?.loadThresholds?.memory || 0.75) ? 'red' : (pipelineStatus.systemLoad.memory || 0) > 0.65 ? 'yellow' : 'green'"
                class="mb-1"
              />
              <div class="text-xs text-ink-3">
                Threshold: {{ ((pipelineStatus.config?.loadThresholds?.memory || 0.75) * 100).toFixed(0) }}%
              </div>
            </div>

            <!-- CPU Temperature -->
            <div class="p-3 bg-paper-2/50 rounded-sm">
              <div class="flex items-center justify-between mb-2">
                <div class="text-xs text-ink-3">CPU Temperature</div>
                <Badge
                  v-if="pipelineStatus.systemLoad.temperature !== null"
                  :color="pipelineStatus.systemLoad.isTooHot ? 'red' : (pipelineStatus.systemLoad.temperature || 0) > 65 ? 'yellow' : 'green'"
                  size="xs"
                  variant="subtle"
                >
                  {{ pipelineStatus.systemLoad.temperatureC || 'N/A' }}
                </Badge>
                <span v-else class="text-xs text-ink-4">N/A</span>
              </div>
              <Progress
                v-if="pipelineStatus.systemLoad.temperature !== null"
                :value="((pipelineStatus.systemLoad.temperature || 0) / 100) * 100"
                :color="pipelineStatus.systemLoad.isTooHot ? 'red' : (pipelineStatus.systemLoad.temperature || 0) > 65 ? 'yellow' : 'green'"
                class="mb-1"
              />
              <div v-else class="h-2 bg-paper-2 rounded mb-1"></div>
              <div class="text-xs text-ink-3">
                Threshold: 75°C
              </div>
            </div>
          </div>

          <!-- Overload Warning -->
          <div v-if="pipelineStatus.systemLoad.isOverloaded" class="mt-3 p-3 bg-red-50 border border-red-200 rounded-sm flex items-start gap-2">
            <Icon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div class="text-sm text-red-800">
              <strong>System Overloaded:</strong> Auto-pipeline is paused to prevent overheating.
              <span v-if="pipelineStatus.systemLoad.isTooHot">
                CPU temperature ({{ pipelineStatus.systemLoad.temperatureC }}) exceeds safe threshold.
              </span>
              <span v-else-if="(pipelineStatus.systemLoad.cpu || 0) > (pipelineStatus.config?.loadThresholds?.cpu || 0.6)">
                CPU load exceeds {{ ((pipelineStatus.config?.loadThresholds?.cpu || 0.6) * 100).toFixed(0) }}% threshold.
              </span>
              <span v-else>
                Memory usage exceeds {{ ((pipelineStatus.config?.loadThresholds?.memory || 0.75) * 100).toFixed(0) }}% threshold.
              </span>
            </div>
          </div>
        </div>

        <!-- Fallback: Old System Load Display (if systemLoad not available) -->
        <div v-else class="grid grid-cols-2 gap-4">
          <div class="p-3 bg-panel rounded-sm border ">
            <div class="text-xs text-ink-3 mb-1">CPU Load</div>
            <div class="flex items-center gap-2">
              <Progress
                :value="(pipelineStatus.load?.cpu || 0) * 100"
                :color="(pipelineStatus.load?.cpu || 0) > 0.8 ? 'red' : (pipelineStatus.load?.cpu || 0) > 0.6 ? 'yellow' : 'green'"
                class="flex-1"
              />
              <span class="text-sm font-medium">{{ ((pipelineStatus.load?.cpu || 0) * 100).toFixed(0) }}%</span>
            </div>
          </div>
          <div class="p-3 bg-panel rounded-sm border ">
            <div class="text-xs text-ink-3 mb-1">Memory Usage</div>
            <div class="flex items-center gap-2">
              <Progress
                :value="(pipelineStatus.load?.memory || 0) * 100"
                :color="(pipelineStatus.load?.memory || 0) > 0.85 ? 'red' : (pipelineStatus.load?.memory || 0) > 0.7 ? 'yellow' : 'green'"
                class="flex-1"
              />
              <span class="text-sm font-medium">{{ ((pipelineStatus.load?.memory || 0) * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>

        <!-- Pipeline Stats -->
        <div class="grid grid-cols-5 gap-2">
          <div class="text-center p-2 bg-panel rounded border ">
            <div class="text-lg font-bold text-ink">{{ pipelineStatus.stats?.needsExtraction || 0 }}</div>
            <div class="text-xs text-ink-3">Extraction</div>
          </div>
          <div class="text-center p-2 bg-panel rounded border ">
            <div class="text-lg font-bold text-ink">{{ pipelineStatus.stats?.needsImages || 0 }}</div>
            <div class="text-xs text-ink-3">Images</div>
          </div>
          <div class="text-center p-2 bg-panel rounded border ">
            <div class="text-lg font-bold text-ink">{{ pipelineStatus.stats?.needsClassification || 0 }}</div>
            <div class="text-xs text-ink-3">Classification</div>
          </div>
          <div class="text-center p-2 bg-panel rounded border ">
            <div class="text-lg font-bold text-ink">{{ pipelineStatus.stats?.needsEmbeddings || 0 }}</div>
            <div class="text-xs text-ink-3">Embeddings</div>
          </div>
          <div class="text-center p-2 bg-panel rounded border ">
            <div class="text-lg font-bold text-ink">{{ pipelineStatus.stats?.needsAnalysis || 0 }}</div>
            <div class="text-xs text-ink-3">Analysis</div>
          </div>
        </div>

        <!-- Controls -->
        <div class="flex gap-2">
          <Button
            v-if="!pipelineStatus.running"
            icon="i-heroicons-play"
            color="green"
            :loading="pipelineControlling"
            @click="controlPipeline('start')"
          >
            Start Auto Pipeline
          </Button>
          <Button
            v-else
            icon="i-heroicons-stop"
            color="red"
            :loading="pipelineControlling"
            @click="controlPipeline('stop')"
          >
            Stop Auto Pipeline
          </Button>
        </div>
      </div>
    </Card>

    <!-- Job Details Modal -->
    <AdminJobDetailsModal
      v-if="selectedJob"
      :job-id="selectedJob.id"
      :queue="selectedJob.queue"
      @close="closeJobDetails"
    />

    <!-- Loading State (only on initial load) -->
    <div v-if="isInitialLoad && pending" class="text-center py-12">
      <Icon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin text-accent mx-auto mb-2" />
      <p class="text-ink-3">Loading job status...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="!jobStatus && !pending" class="text-center py-12">
      <Icon name="i-heroicons-exclamation-triangle" class="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p class="text-ink-3">Failed to load job status</p>
      <Button @click="refreshJobs" class="mt-4" size="sm">
        Retry
      </Button>
    </div>

    <!-- Content -->
    <div v-else-if="jobStatus">
      <!-- Queue Status Cards -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
      <!-- Feed Queue -->
      <Card v-if="jobStatus?.queues.feed">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Icon name="i-heroicons-queue-list" class="w-5 h-5" />
              <h3 class="font-semibold">{{ jobStatus.queues.feed.name }}</h3>
            </div>
            <div class="flex items-center gap-2">
              <Badge
                v-if="jobStatus.queues.feed.health?.status"
                :color="jobStatus.queues.feed.health.status === 'error' ? 'red' : jobStatus.queues.feed.health.status === 'warning' ? 'yellow' : 'green'"
                variant="subtle"
                size="sm"
              >
                {{ jobStatus.queues.feed.health.status === 'healthy' ? 'Healthy' : jobStatus.queues.feed.health.status === 'warning' ? 'Warning' : 'Error' }}
              </Badge>
              <Badge
                :color="jobStatus.queues.feed.paused ? 'orange' : 'green'"
                variant="subtle"
              >
                {{ jobStatus.queues.feed.paused ? 'Paused' : 'Running' }}
              </Badge>
            </div>
          </div>
        </template>

        <div class="space-y-4">
          <!-- Health Alerts -->
          <div v-if="jobStatus.queues.feed.health?.alerts" class="space-y-2">
            <div
              v-for="(alert, idx) in jobStatus.queues.feed.health.alerts"
              :key="idx"
              class="flex items-start gap-2 p-3 rounded-sm border"
              :class="{
                'bg-red-50 border-red-200': alert.level === 'error',
                'bg-yellow-50 border-yellow-200': alert.level === 'warning',
                'bg-green-50 border-green-200': alert.level === 'info'
              }"
            >
              <Icon
                :name="alert.level === 'error' ? 'i-heroicons-exclamation-circle' : alert.level === 'warning' ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-check-circle'"
                class="w-5 h-5 mt-0.5"
                :class="{
                  'text-red-600': alert.level === 'error',
                  'text-yellow-600': alert.level === 'warning',
                  'text-green-600': alert.level === 'info'
                }"
              />
              <div class="flex-1">
                <p class="text-sm font-medium" :class="{
                  'text-red-900': alert.level === 'error',
                  'text-yellow-900': alert.level === 'warning',
                  'text-green-900': alert.level === 'info'
                }">
                  {{ alert.message }}
                </p>
                <p v-if="alert.level !== 'info' && jobStatus.queues.feed.health.timeSinceActivity" class="text-xs mt-1" :class="{
                  'text-red-700': alert.level === 'error',
                  'text-yellow-700': alert.level === 'warning'
                }">
                  Last activity: {{ formatDuration(jobStatus.queues.feed.health.timeSinceActivity) }} ago
                </p>
              </div>
            </div>
          </div>

          <!-- Stats -->
          <div class="grid grid-cols-3 gap-2">
            <div class="text-center p-2 bg-blue-50 rounded">
              <div class="text-2xl font-bold text-blue-600">
                {{ jobStatus.queues.feed.counts.active }}
              </div>
              <div class="text-xs text-ink-3">Active</div>
            </div>
            <div class="text-center p-2 bg-yellow-50 rounded">
              <div class="text-2xl font-bold text-yellow-600">
                {{ jobStatus.queues.feed.counts.waiting }}
              </div>
              <div class="text-xs text-ink-3">Waiting</div>
            </div>
            <div class="text-center p-2 bg-red-50 rounded">
              <div class="text-2xl font-bold text-red-600">
                {{ jobStatus.queues.feed.counts.failed }}
              </div>
              <div class="text-xs text-ink-3">Failed</div>
            </div>
          </div>

          <!-- Controls -->
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="jobStatus.queues.feed.paused"
              size="xs"
              icon="i-heroicons-play"
              :loading="controlling"
              @click="controlQueue('feed', 'resume')"
              label="Resume"
            />
            <Button
              v-else
              size="xs"
              icon="i-heroicons-pause"
              color="orange"
              :loading="controlling"
              @click="controlQueue('feed', 'pause')"
              label="Pause"
            />

            <Button
              size="xs"
              icon="i-heroicons-arrow-path"
              color="gray"
              :loading="controlling"
              :disabled="jobStatus.queues.feed.counts.failed === 0"
              @click="controlQueue('feed', 'retry-failed')"
            >
              Retry Failed ({{ jobStatus.queues.feed.counts.failed }})
            </Button>

            <Button
              size="xs"
              icon="i-heroicons-trash"
              color="gray"
              :loading="controlling"
              :disabled="jobStatus.queues.feed.counts.completed === 0"
              @click="controlQueue('feed', 'clean-completed')"
            >
              Clean Completed ({{ jobStatus.queues.feed.counts.completed }})
            </Button>
          </div>

          <!-- Quick Actions -->
          <div class="border-t pt-3">
            <div class="text-sm font-medium mb-2">Quick Queue Actions:</div>
            <div class="flex flex-wrap gap-2">
              <Button
                size="xs"
                :loading="queueing"
                @click="queueJob('fetch-all-feeds')"
              >
                Fetch All Feeds
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('extract-content', { limit: 100 })"
              >
                Extract Content (100)
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('classify-articles', { limit: 50 })"
              >
                Classify (50)
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('analyze-articles', { limit: 30 })"
              >
                Analyze (30)
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('generate-embeddings', { limit: 20 })"
              >
                Embeddings (20)
              </Button>
              <Button
                size="xs"
                color="purple"
                :loading="queueing"
                @click="queueJob('cluster-articles')"
              >
                Cluster Articles
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <!-- Topic Queue -->
      <Card v-if="jobStatus?.queues.topic">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Icon name="i-heroicons-arrows-right-left" class="w-5 h-5" />
              <h3 class="font-semibold">{{ jobStatus.queues.topic.name }}</h3>
            </div>
            <div class="flex items-center gap-2">
              <Badge
                v-if="jobStatus.queues.topic.health?.status"
                :color="jobStatus.queues.topic.health.status === 'error' ? 'red' : jobStatus.queues.topic.health.status === 'warning' ? 'yellow' : 'green'"
                variant="subtle"
                size="sm"
              >
                {{ jobStatus.queues.topic.health.status === 'healthy' ? 'Healthy' : jobStatus.queues.topic.health.status === 'warning' ? 'Warning' : 'Error' }}
              </Badge>
              <Badge
                :color="jobStatus.queues.topic.paused ? 'orange' : 'green'"
                variant="subtle"
              >
                {{ jobStatus.queues.topic.paused ? 'Paused' : 'Running' }}
              </Badge>
            </div>
          </div>
        </template>

        <div class="space-y-4">
          <!-- Health Alerts -->
          <div v-if="jobStatus.queues.topic.health?.alerts" class="space-y-2">
            <div
              v-for="(alert, idx) in jobStatus.queues.topic.health.alerts"
              :key="idx"
              class="flex items-start gap-2 p-3 rounded-sm border"
              :class="{
                'bg-red-50 border-red-200': alert.level === 'error',
                'bg-yellow-50 border-yellow-200': alert.level === 'warning',
                'bg-green-50 border-green-200': alert.level === 'info'
              }"
            >
              <Icon
                :name="alert.level === 'error' ? 'i-heroicons-exclamation-circle' : alert.level === 'warning' ? 'i-heroicons-exclamation-triangle' : 'i-heroicons-check-circle'"
                class="w-5 h-5 mt-0.5"
                :class="{
                  'text-red-600': alert.level === 'error',
                  'text-yellow-600': alert.level === 'warning',
                  'text-green-600': alert.level === 'info'
                }"
              />
              <div class="flex-1">
                <p class="text-sm font-medium" :class="{
                  'text-red-900': alert.level === 'error',
                  'text-yellow-900': alert.level === 'warning',
                  'text-green-900': alert.level === 'info'
                }">
                  {{ alert.message }}
                </p>
                <p v-if="alert.level !== 'info' && jobStatus.queues.topic.health.timeSinceActivity" class="text-xs mt-1" :class="{
                  'text-red-700': alert.level === 'error',
                  'text-yellow-700': alert.level === 'warning'
                }">
                  Last activity: {{ formatDuration(jobStatus.queues.topic.health.timeSinceActivity) }} ago
                </p>
              </div>
            </div>
          </div>

          <!-- Stats -->
          <div class="grid grid-cols-3 gap-2">
            <div class="text-center p-2 bg-blue-50 rounded">
              <div class="text-2xl font-bold text-blue-600">
                {{ jobStatus.queues.topic.counts.active }}
              </div>
              <div class="text-xs text-ink-3">Active</div>
            </div>
            <div class="text-center p-2 bg-yellow-50 rounded">
              <div class="text-2xl font-bold text-yellow-600">
                {{ jobStatus.queues.topic.counts.waiting }}
              </div>
              <div class="text-xs text-ink-3">Waiting</div>
            </div>
            <div class="text-center p-2 bg-red-50 rounded">
              <div class="text-2xl font-bold text-red-600">
                {{ jobStatus.queues.topic.counts.failed }}
              </div>
              <div class="text-xs text-ink-3">Failed</div>
            </div>
          </div>

          <!-- Controls -->
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="jobStatus.queues.topic.paused"
              size="xs"
              icon="i-heroicons-play"
              :loading="controlling"
              @click="controlQueue('topic', 'resume')"
              label="Resume"
            />
            <Button
              v-else
              size="xs"
              icon="i-heroicons-pause"
              color="orange"
              :loading="controlling"
              @click="controlQueue('topic', 'pause')"
              label="Pause"
            />

            <Button
              size="xs"
              icon="i-heroicons-arrow-path"
              color="gray"
              :loading="controlling"
              :disabled="jobStatus.queues.topic.counts.failed === 0"
              @click="controlQueue('topic', 'retry-failed')"
            >
              Retry Failed ({{ jobStatus.queues.topic.counts.failed }})
            </Button>

            <Button
              size="xs"
              icon="i-heroicons-trash"
              color="gray"
              :loading="controlling"
              :disabled="jobStatus.queues.topic.counts.completed === 0"
              @click="controlQueue('topic', 'clean-completed')"
            >
              Clean Completed ({{ jobStatus.queues.topic.counts.completed }})
            </Button>
          </div>

          <!-- Quick Actions -->
          <div class="border-t pt-3">
            <div class="text-sm font-medium mb-2">Quick Queue Actions:</div>
            <div class="flex flex-wrap gap-2">
              <Button
                size="xs"
                icon="i-heroicons-sparkles"
                :loading="queueing"
                @click="queueJob('compute-topics', { limit: 500 })"
              >
                Compute Topics (500)
              </Button>
              <Button
                size="xs"
                icon="i-heroicons-bolt"
                color="primary"
                :loading="queueing"
                @click="queueJob('compute-topics', { limit: 10000 })"
              >
                Compute All Topics
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('analyze-cooccurrence')"
              >
                Co-occurrence
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('detect-synonyms')"
              >
                Detect Synonyms
              </Button>
              <Button
                size="xs"
                color="gray"
                :loading="queueing"
                @click="queueJob('link-entities-keywords')"
              >
                Link Entities
              </Button>
            </div>
          </div>
        </div>
      </Card>
      </div>

      <!-- Performance Statistics -->
      <div v-if="jobStats" class="mb-6">
        <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <Icon name="i-heroicons-chart-bar" class="w-5 h-5" />
          Performance Metrics
        </h2>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Feed Queue Stats -->
          <Card>
            <template #header>
              <h3 class="font-semibold">Feed Queue Statistics</h3>
            </template>
            <div class="space-y-4">
              <!-- Processing Time -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Processing Time</div>
                <div class="grid grid-cols-3 gap-2 text-sm">
                  <div class="p-2 bg-green-50 rounded text-center">
                    <div class="text-xs text-ink-3">Avg</div>
                    <div class="font-bold text-green-700">{{ formatDuration(jobStats.feed.processingTime.overall.avg) }}</div>
                  </div>
                  <div class="p-2 bg-blue-50 rounded text-center">
                    <div class="text-xs text-ink-3">Min</div>
                    <div class="font-bold text-blue-700">{{ formatDuration(jobStats.feed.processingTime.overall.min) }}</div>
                  </div>
                  <div class="p-2 bg-red-50 rounded text-center">
                    <div class="text-xs text-ink-3">Max</div>
                    <div class="font-bold text-red-700">{{ formatDuration(jobStats.feed.processingTime.overall.max) }}</div>
                  </div>
                </div>
              </div>

              <!-- Throughput -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Throughput (Last Hour)</div>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div class="p-2 bg-purple-50 rounded">
                    <div class="text-xs text-ink-3">Jobs/Hour</div>
                    <div class="font-bold text-purple-700">{{ formatRate(jobStats.feed.throughput.jobsPerHour) }}</div>
                  </div>
                  <div class="p-2 bg-indigo-50 rounded">
                    <div class="text-xs text-ink-3">Jobs/Minute</div>
                    <div class="font-bold text-indigo-700">{{ formatRate(jobStats.feed.throughput.jobsPerMinute) }}</div>
                  </div>
                </div>
              </div>

              <!-- Success/Failure Rates -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Success Rate (Last Hour)</div>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div class="p-2 bg-green-50 rounded">
                    <div class="text-xs text-ink-3">Completed</div>
                    <div class="font-bold text-green-700">{{ formatPercent(jobStats.feed.throughput.completionRate) }}</div>
                  </div>
                  <div class="p-2 bg-red-50 rounded">
                    <div class="text-xs text-ink-3">Failed</div>
                    <div class="font-bold text-red-700">{{ formatPercent(jobStats.feed.throughput.failureRate) }}</div>
                  </div>
                </div>
              </div>

              <!-- Queue Health -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Queue Health</div>
                <div class="space-y-1 text-sm">
                  <div class="flex justify-between">
                    <span>Backlog Size:</span>
                    <span class="font-bold">{{ jobStats.feed.health.backlogSize }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span>Stalled Jobs:</span>
                    <span class="font-bold" :class="jobStats.feed.health.stalledJobsCount > 0 ? 'text-red-600' : 'text-green-600'">
                      {{ jobStats.feed.health.stalledJobsCount }}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span>Avg Wait Time:</span>
                    <span class="font-bold">{{ formatDuration(jobStats.feed.health.avgWaitTime) }}</span>
                  </div>
                  <div v-if="jobStats.feed.health.oldestWaitingJobAge" class="flex justify-between">
                    <span>Oldest Waiting:</span>
                    <span class="font-bold text-orange-600">{{ formatDuration(jobStats.feed.health.oldestWaitingJobAge) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <!-- Topic Queue Stats -->
          <Card>
            <template #header>
              <h3 class="font-semibold">Topic Queue Statistics</h3>
            </template>
            <div class="space-y-4">
              <!-- Processing Time -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Processing Time</div>
                <div class="grid grid-cols-3 gap-2 text-sm">
                  <div class="p-2 bg-green-50 rounded text-center">
                    <div class="text-xs text-ink-3">Avg</div>
                    <div class="font-bold text-green-700">{{ formatDuration(jobStats.topic.processingTime.overall.avg) }}</div>
                  </div>
                  <div class="p-2 bg-blue-50 rounded text-center">
                    <div class="text-xs text-ink-3">Min</div>
                    <div class="font-bold text-blue-700">{{ formatDuration(jobStats.topic.processingTime.overall.min) }}</div>
                  </div>
                  <div class="p-2 bg-red-50 rounded text-center">
                    <div class="text-xs text-ink-3">Max</div>
                    <div class="font-bold text-red-700">{{ formatDuration(jobStats.topic.processingTime.overall.max) }}</div>
                  </div>
                </div>
              </div>

              <!-- Throughput -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Throughput (Last Hour)</div>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div class="p-2 bg-purple-50 rounded">
                    <div class="text-xs text-ink-3">Jobs/Hour</div>
                    <div class="font-bold text-purple-700">{{ formatRate(jobStats.topic.throughput.jobsPerHour) }}</div>
                  </div>
                  <div class="p-2 bg-indigo-50 rounded">
                    <div class="text-xs text-ink-3">Jobs/Minute</div>
                    <div class="font-bold text-indigo-700">{{ formatRate(jobStats.topic.throughput.jobsPerMinute) }}</div>
                  </div>
                </div>
              </div>

              <!-- Success/Failure Rates -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Success Rate (Last Hour)</div>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <div class="p-2 bg-green-50 rounded">
                    <div class="text-xs text-ink-3">Completed</div>
                    <div class="font-bold text-green-700">{{ formatPercent(jobStats.topic.throughput.completionRate) }}</div>
                  </div>
                  <div class="p-2 bg-red-50 rounded">
                    <div class="text-xs text-ink-3">Failed</div>
                    <div class="font-bold text-red-700">{{ formatPercent(jobStats.topic.throughput.failureRate) }}</div>
                  </div>
                </div>
              </div>

              <!-- Queue Health -->
              <div>
                <div class="text-xs text-ink-3 mb-2">Queue Health</div>
                <div class="space-y-1 text-sm">
                  <div class="flex justify-between">
                    <span>Backlog Size:</span>
                    <span class="font-bold">{{ jobStats.topic.health.backlogSize }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span>Stalled Jobs:</span>
                    <span class="font-bold" :class="jobStats.topic.health.stalledJobsCount > 0 ? 'text-red-600' : 'text-green-600'">
                      {{ jobStats.topic.health.stalledJobsCount }}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span>Avg Wait Time:</span>
                    <span class="font-bold">{{ formatDuration(jobStats.topic.health.avgWaitTime) }}</span>
                  </div>
                  <div v-if="jobStats.topic.health.oldestWaitingJobAge" class="flex justify-between">
                    <span>Oldest Waiting:</span>
                    <span class="font-bold text-orange-600">{{ formatDuration(jobStats.topic.health.oldestWaitingJobAge) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <!-- Active Jobs -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
      <!-- Feed Active Jobs -->
      <Card v-if="jobStatus?.queues.feed.recentJobs.active.length">
        <template #header>
          <h3 class="font-semibold">Active Jobs - Feed Queue</h3>
        </template>
        <div class="space-y-2">
          <div
            v-for="job in jobStatus.queues.feed.recentJobs.active"
            :key="job.id"
            class="p-2 bg-blue-50 rounded text-sm cursor-pointer hover:bg-blue-100 transition-colors"
            @click="openJobDetails(job.id, 'feed')"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="font-medium">{{ job.name }}</div>
                <div class="text-xs text-ink-3">
                  ID: {{ job.id }} | Started: {{ formatTime(job.processedOn) }}
                </div>
                <div v-if="job.data.articleId" class="text-xs text-ink-3">
                  Article ID: {{ job.data.articleId }}
                </div>
                <div v-if="job.data.feedId" class="text-xs text-ink-3">
                  Feed ID: {{ job.data.feedId }}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <Icon name="i-heroicons-arrow-path" class="w-4 h-4 animate-spin text-blue-600" />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <!-- Topic Active Jobs -->
      <Card v-if="jobStatus?.queues.topic.recentJobs.active.length">
        <template #header>
          <h3 class="font-semibold">Active Jobs - Topic Queue</h3>
        </template>
        <div class="space-y-2">
          <div
            v-for="job in jobStatus.queues.topic.recentJobs.active"
            :key="job.id"
            class="p-2 bg-blue-50 rounded text-sm cursor-pointer hover:bg-blue-100 transition-colors"
            @click="openJobDetails(job.id, 'topic')"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="font-medium">{{ job.name }}</div>
                <div class="text-xs text-ink-3">
                  ID: {{ job.id }} | Started: {{ formatTime(job.processedOn) }}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <Icon name="i-heroicons-arrow-path" class="w-4 h-4 animate-spin text-blue-600" />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>

    <!-- Failed Jobs -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Feed Failed Jobs -->
      <Card v-if="jobStatus?.queues.feed.recentJobs.failed.length">
        <template #header>
          <h3 class="font-semibold">Failed Jobs - Feed Queue</h3>
        </template>
        <div class="space-y-2">
          <div
            v-for="job in jobStatus.queues.feed.recentJobs.failed"
            :key="job.id"
            class="p-2 bg-red-50 rounded text-sm cursor-pointer hover:bg-red-100 transition-colors"
            @click="openJobDetails(job.id, 'feed')"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="font-medium">{{ job.name }}</div>
                <div class="text-xs text-ink-3">
                  ID: {{ job.id }} | Failed: {{ formatTime(job.finishedOn) }}
                </div>
                <div v-if="job.failedReason" class="text-xs text-red-600 mt-1">
                  {{ job.failedReason }}
                </div>
                <div class="text-xs text-ink-3 mt-1">
                  Attempts: {{ job.attempts }} / {{ job.maxAttempts }}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <Button
                  size="xs"
                  icon="i-heroicons-arrow-path"
                  color="gray"
                  :loading="controlling"
                  @click="controlQueue('feed', 'retry-job', job.id)"
                  label="Retry"
                />
                <Button
                  size="xs"
                  icon="i-heroicons-trash"
                  color="red"
                  :loading="controlling"
                  @click="controlQueue('feed', 'remove-job', job.id)"
                  label="Remove"
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <!-- Topic Failed Jobs -->
      <Card v-if="jobStatus?.queues.topic.recentJobs.failed.length">
        <template #header>
          <h3 class="font-semibold">Failed Jobs - Topic Queue</h3>
        </template>
        <div class="space-y-2">
          <div
            v-for="job in jobStatus.queues.topic.recentJobs.failed"
            :key="job.id"
            class="p-2 bg-red-50 rounded text-sm cursor-pointer hover:bg-red-100 transition-colors"
            @click="openJobDetails(job.id, 'topic')"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="font-medium">{{ job.name }}</div>
                <div class="text-xs text-ink-3">
                  ID: {{ job.id }} | Failed: {{ formatTime(job.finishedOn) }}
                </div>
                <div v-if="job.failedReason" class="text-xs text-red-600 mt-1">
                  {{ job.failedReason }}
                </div>
                <div class="text-xs text-ink-3 mt-1">
                  Attempts: {{ job.attempts }} / {{ job.maxAttempts }}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <Button
                  size="xs"
                  icon="i-heroicons-arrow-path"
                  color="gray"
                  :loading="controlling"
                  @click="controlQueue('topic', 'retry-job', job.id)"
                  label="Retry"
                />
                <Button
                  size="xs"
                  icon="i-heroicons-trash"
                  color="red"
                  :loading="controlling"
                  @click="controlQueue('topic', 'remove-job', job.id)"
                  label="Remove"
                />
              </div>
            </div>
          </div>
        </div>
      </Card>
      </div>

      <!-- Completed Jobs -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
        <!-- Feed Completed Jobs -->
        <Card v-if="jobStatus?.queues.feed.recentJobs.completed?.length">
          <template #header>
            <h3 class="font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-check-circle" class="w-5 h-5 text-green-600" />
              Completed Jobs - Feed Queue (Last 20)
            </h3>
          </template>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            <div
              v-for="job in jobStatus.queues.feed.recentJobs.completed"
              :key="job.id"
              class="p-2 bg-green-50 rounded text-sm cursor-pointer hover:bg-green-100 transition-colors"
              @click="openJobDetails(job.id, 'feed')"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="font-medium">{{ job.name }}</div>
                  <div class="text-xs text-ink-3">
                    ID: {{ job.id }} | Finished: {{ formatTime(job.finishedOn) }}
                  </div>
                  <div class="text-xs mt-1">
                    <Badge :color="getProcessingTimeColor(job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null)" size="sm" variant="subtle">
                      {{ calculateDuration(job.processedOn, job.finishedOn) }}
                    </Badge>
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-4 h-4 text-ink-4" />
              </div>
            </div>
          </div>
        </Card>

        <!-- Topic Completed Jobs -->
        <Card v-if="jobStatus?.queues.topic.recentJobs.completed?.length">
          <template #header>
            <h3 class="font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-check-circle" class="w-5 h-5 text-green-600" />
              Completed Jobs - Topic Queue (Last 20)
            </h3>
          </template>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            <div
              v-for="job in jobStatus.queues.topic.recentJobs.completed"
              :key="job.id"
              class="p-2 bg-green-50 rounded text-sm cursor-pointer hover:bg-green-100 transition-colors"
              @click="openJobDetails(job.id, 'topic')"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="font-medium">{{ job.name }}</div>
                  <div class="text-xs text-ink-3">
                    ID: {{ job.id }} | Finished: {{ formatTime(job.finishedOn) }}
                  </div>
                  <div class="text-xs mt-1">
                    <Badge :color="getProcessingTimeColor(job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null)" size="sm" variant="subtle">
                      {{ calculateDuration(job.processedOn, job.finishedOn) }}
                    </Badge>
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-4 h-4 text-ink-4" />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <!-- Delayed Jobs -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
        <!-- Feed Delayed Jobs -->
        <Card v-if="jobStatus?.queues.feed.recentJobs.delayed?.length">
          <template #header>
            <h3 class="font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-clock" class="w-5 h-5 text-purple-600" />
              Delayed Jobs - Feed Queue
            </h3>
          </template>
          <div class="space-y-2">
            <div
              v-for="job in jobStatus.queues.feed.recentJobs.delayed"
              :key="job.id"
              class="p-2 bg-purple-50 rounded text-sm cursor-pointer hover:bg-purple-100 transition-colors"
              @click="openJobDetails(job.id, 'feed')"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="font-medium">{{ job.name }}</div>
                  <div class="text-xs text-ink-3">
                    ID: {{ job.id }}
                  </div>
                  <div v-if="job.data.articleId" class="text-xs text-ink-3">
                    Article ID: {{ job.data.articleId }}
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-4 h-4 text-ink-4" />
              </div>
            </div>
          </div>
        </Card>

        <!-- Topic Delayed Jobs -->
        <Card v-if="jobStatus?.queues.topic.recentJobs.delayed?.length">
          <template #header>
            <h3 class="font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-clock" class="w-5 h-5 text-purple-600" />
              Delayed Jobs - Topic Queue
            </h3>
          </template>
          <div class="space-y-2">
            <div
              v-for="job in jobStatus.queues.topic.recentJobs.delayed"
              :key="job.id"
              class="p-2 bg-purple-50 rounded text-sm cursor-pointer hover:bg-purple-100 transition-colors"
              @click="openJobDetails(job.id, 'topic')"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="font-medium">{{ job.name }}</div>
                  <div class="text-xs text-ink-3">
                    ID: {{ job.id }}
                  </div>
                </div>
                <Icon name="i-heroicons-chevron-right" class="w-4 h-4 text-ink-4" />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <!-- Danger Zone -->
      <Card class="mt-6 border-red-200">
      <template #header>
        <div class="flex items-center gap-2">
          <Icon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-600" />
          <h3 class="font-semibold text-red-600">Danger Zone</h3>
        </div>
      </template>
      <div class="space-y-2">
        <p class="text-sm text-ink-3 mb-3">
          These actions are destructive and cannot be undone. Use with caution.
        </p>
        <div class="flex gap-2">
          <Button
            size="sm"
            color="red"
            icon="i-heroicons-trash"
            :loading="controlling"
            label="Obliterate Feed Queue"
            @click="confirmAndExecute('Are you sure you want to remove ALL jobs from the feed queue? This cannot be undone!', () => controlQueue('feed', 'obliterate'))"
          />
          <Button
            size="sm"
            color="red"
            icon="i-heroicons-trash"
            :loading="controlling"
            label="Obliterate Topic Queue"
            @click="confirmAndExecute('Are you sure you want to remove ALL jobs from the topic queue? This cannot be undone!', () => controlQueue('topic', 'obliterate'))"
          />
        </div>
      </div>
    </Card>
    </div>
  </div>
</template>
