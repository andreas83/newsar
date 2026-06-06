<script setup lang="ts">
interface Props {
  jobId: string
  queue: 'feed' | 'topic'
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
}>()

const isOpen = ref(true)

// Fetch job details
const { data: jobDetails, pending, error, refresh } = useFetch(`/api/admin/jobs/${props.jobId}`, {
  query: { queue: props.queue },
  server: false,
})

// Format JSON for display
function formatJSON(obj: any): string {
  return JSON.stringify(obj, null, 2)
}

// Format timestamp
function formatTime(timestamp: number | null): string {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString()
}

// Copy to clipboard
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    alert('Copied to clipboard!')
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

// Close modal
function closeModal() {
  isOpen.value = false
  emit('close')
}

// Get state color
function getStateColor(state: string) {
  const colors: Record<string, string> = {
    active: 'blue',
    waiting: 'yellow',
    completed: 'green',
    failed: 'red',
    delayed: 'purple',
  }
  return colors[state] || 'gray'
}
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50" @click.self="closeModal">
    <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between p-6 border-b">
        <div class="flex items-center gap-3">
          <Icon name="i-heroicons-document-magnifying-glass" class="w-6 h-6 text-gray-600" />
          <div>
            <h2 class="text-xl font-bold">Job Details</h2>
            <p class="text-sm text-gray-500">ID: {{ jobId }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button
            icon="i-heroicons-arrow-path"
            size="sm"
            color="gray"
            :loading="pending"
            @click="refresh"
          >
            Refresh
          </Button>
          <button @click="closeModal" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Icon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="pending && !jobDetails" class="flex-1 flex items-center justify-center p-12">
        <div class="text-center">
          <Icon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
          <p class="text-gray-600">Loading job details...</p>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="flex-1 flex items-center justify-center p-12">
        <div class="text-center">
          <Icon name="i-heroicons-exclamation-triangle" class="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p class="text-red-600">{{ error.message || 'Failed to load job details' }}</p>
        </div>
      </div>

      <!-- Content -->
      <div v-else-if="jobDetails" class="flex-1 overflow-y-auto p-6 space-y-6">
        <!-- Status Overview -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="p-4 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-600 mb-1">State</div>
            <Badge :color="getStateColor(jobDetails.state)" variant="subtle" size="lg">
              {{ jobDetails.state }}
            </Badge>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-600 mb-1">Attempts</div>
            <div class="text-lg font-bold">{{ jobDetails.attemptsMade }} / {{ jobDetails.opts.attempts }}</div>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-600 mb-1">Progress</div>
            <div class="text-lg font-bold">{{ jobDetails.progress || 0 }}%</div>
          </div>
          <div class="p-4 bg-gray-50 rounded-lg">
            <div class="text-xs text-gray-600 mb-1">Priority</div>
            <div class="text-lg font-bold">{{ jobDetails.opts.priority || 'N/A' }}</div>
          </div>
        </div>

        <!-- Timing Information -->
        <div class="border rounded-lg p-4">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <Icon name="i-heroicons-clock" class="w-5 h-5" />
            Timing Information
          </h3>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-gray-600">Created:</span>
              <span class="ml-2 font-medium">{{ formatTime(jobDetails.timestamps.created) }}</span>
            </div>
            <div>
              <span class="text-gray-600">Started:</span>
              <span class="ml-2 font-medium">{{ formatTime(jobDetails.timestamps.processedOn) }}</span>
            </div>
            <div>
              <span class="text-gray-600">Finished:</span>
              <span class="ml-2 font-medium">{{ formatTime(jobDetails.timestamps.finishedOn) }}</span>
            </div>
            <div v-if="jobDetails.timestamps.delay">
              <span class="text-gray-600">Delayed Until:</span>
              <span class="ml-2 font-medium">{{ formatTime(jobDetails.timestamps.delay) }}</span>
            </div>
            <div class="col-span-2 pt-2 border-t">
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <span class="text-gray-600">Wait Time:</span>
                  <span class="ml-2 font-bold text-yellow-600">{{ jobDetails.timing.waitTime || 'N/A' }}</span>
                </div>
                <div>
                  <span class="text-gray-600">Processing Time:</span>
                  <span class="ml-2 font-bold text-blue-600">{{ jobDetails.timing.processingTime || 'N/A' }}</span>
                </div>
                <div>
                  <span class="text-gray-600">Total Time:</span>
                  <span class="ml-2 font-bold text-purple-600">{{ jobDetails.timing.totalTime || 'N/A' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Job Data -->
        <div class="border rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-code-bracket" class="w-5 h-5" />
              Job Data
            </h3>
            <Button
              size="xs"
              icon="i-heroicons-clipboard-document"
              color="gray"
              @click="copyToClipboard(formatJSON(jobDetails.data))"
            >
              Copy
            </Button>
          </div>
          <pre class="bg-gray-900 text-gray-100 p-4 rounded text-xs overflow-x-auto">{{ formatJSON(jobDetails.data) }}</pre>
        </div>

        <!-- Error Information (if failed) -->
        <div v-if="jobDetails.state === 'failed'" class="border border-red-200 rounded-lg p-4 bg-red-50">
          <h3 class="font-semibold mb-3 flex items-center gap-2 text-red-700">
            <Icon name="i-heroicons-exclamation-circle" class="w-5 h-5" />
            Error Information
          </h3>
          <div class="space-y-3">
            <div>
              <div class="text-xs text-red-600 mb-1">Error Message:</div>
              <div class="text-sm font-medium text-red-800">{{ jobDetails.failedReason || 'No error message' }}</div>
            </div>
            <div v-if="jobDetails.stackTrace">
              <div class="text-xs text-red-600 mb-1 flex items-center justify-between">
                <span>Stack Trace:</span>
                <Button
                  size="xs"
                  icon="i-heroicons-clipboard-document"
                  color="gray"
                  @click="copyToClipboard(jobDetails.stackTrace)"
                >
                  Copy
                </Button>
              </div>
              <pre class="bg-gray-900 text-gray-100 p-4 rounded text-xs overflow-x-auto max-h-64">{{ jobDetails.stackTrace }}</pre>
            </div>
          </div>
        </div>

        <!-- Return Value (if completed) -->
        <div v-if="jobDetails.state === 'completed' && jobDetails.returnvalue" class="border rounded-lg p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold flex items-center gap-2">
              <Icon name="i-heroicons-check-circle" class="w-5 h-5 text-green-600" />
              Return Value
            </h3>
            <Button
              size="xs"
              icon="i-heroicons-clipboard-document"
              color="gray"
              @click="copyToClipboard(formatJSON(jobDetails.returnvalue))"
            >
              Copy
            </Button>
          </div>
          <pre class="bg-gray-900 text-gray-100 p-4 rounded text-xs overflow-x-auto">{{ formatJSON(jobDetails.returnvalue) }}</pre>
        </div>

        <!-- Logs -->
        <div v-if="jobDetails.logs.count > 0" class="border rounded-lg p-4">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <Icon name="i-heroicons-document-text" class="w-5 h-5" />
            Logs ({{ jobDetails.logs.count }})
          </h3>
          <div class="space-y-1">
            <div
              v-for="(log, index) in jobDetails.logs.entries"
              :key="index"
              class="text-xs font-mono bg-gray-50 p-2 rounded"
            >
              {{ log }}
            </div>
          </div>
        </div>

        <!-- Parent Job Info -->
        <div v-if="jobDetails.parent" class="border rounded-lg p-4">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <Icon name="i-heroicons-arrow-up-tray" class="w-5 h-5" />
            Parent Job
          </h3>
          <div class="text-sm">
            <div><span class="text-gray-600">ID:</span> <span class="ml-2 font-mono">{{ jobDetails.parent.id }}</span></div>
            <div><span class="text-gray-600">Queue:</span> <span class="ml-2">{{ jobDetails.parent.queue }}</span></div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="border-t p-4 flex justify-end">
        <Button @click="closeModal" color="gray">
          Close
        </Button>
      </div>
    </div>
  </div>
</template>
