<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Fetch RunPod status
const { data: status, refresh } = await useFetch('/api/admin/runpod/status')
const { data: costs } = await useFetch('/api/admin/runpod/cost?period=today')

const loading = ref(false)
const error = ref<string | null>(null)

// Auto-refresh every 30 seconds
let refreshInterval: NodeJS.Timeout | null = null

onMounted(() => {
  refreshInterval = setInterval(() => {
    refresh()
  }, 30000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

// Computed properties
const isEnabled = computed(() => status.value?.enabled === true)
const hasPod = computed(() => !!status.value?.pod)
const podStatus = computed(() => status.value?.pod?.status || 'STOPPED')

const statusColor = computed(() => {
  if (!isEnabled.value) return 'gray'
  if (!hasPod.value) return 'gray'

  switch (podStatus.value) {
    case 'READY':
    case 'ACTIVE':
      return 'green'
    case 'IDLE':
      return 'yellow'
    case 'PENDING':
    case 'STARTING':
      return 'blue'
    case 'TERMINATING':
      return 'orange'
    default:
      return 'gray'
  }
})

const statusText = computed(() => {
  if (!isEnabled.value) return 'Disabled'
  if (!hasPod.value) return 'No Pod'
  return podStatus.value
})

const savingsPercent = computed(() => {
  return costs.value?.savings?.vsAlwaysOn?.percentage || '0'
})

// Actions
const controlPod = async (action: 'create' | 'terminate' | 'restart') => {
  loading.value = true
  error.value = null

  try {
    await $fetch('/api/admin/runpod/control', {
      method: 'POST',
      body: { action },
    })

    // Wait a moment then refresh
    setTimeout(() => {
      refresh()
      loading.value = false
    }, 2000)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to control pod'
    loading.value = false
  }
}
</script>

<template>
  <Card>
    <div class="space-y-4">
      <!-- Header -->
      <div class="flex items-start justify-between">
        <div class="flex items-start gap-3">
          <Icon
            name="i-heroicons-cloud"
            class="w-8 h-8"
            :class="{
              'text-green-600': statusColor === 'green',
              'text-yellow-600': statusColor === 'yellow',
              'text-blue-600': statusColor === 'blue',
              'text-orange-600': statusColor === 'orange',
              'text-gray-400': statusColor === 'gray',
            }"
          />
          <div>
            <h3 class="text-sm font-medium text-gray-900">RunPod AI Processing</h3>
            <div class="flex items-center gap-2 mt-1">
              <span
                class="inline-block w-2 h-2 rounded-full"
                :class="{
                  'bg-green-500 animate-pulse': statusColor === 'green',
                  'bg-yellow-500': statusColor === 'yellow',
                  'bg-blue-500 animate-pulse': statusColor === 'blue',
                  'bg-orange-500': statusColor === 'orange',
                  'bg-gray-300': statusColor === 'gray',
                }"
              />
              <span class="text-sm font-medium" :class="{
                'text-green-600': statusColor === 'green',
                'text-yellow-600': statusColor === 'yellow',
                'text-blue-600': statusColor === 'blue',
                'text-orange-600': statusColor === 'orange',
                'text-gray-500': statusColor === 'gray',
              }">
                {{ statusText }}
              </span>
            </div>
          </div>
        </div>

        <!-- Refresh button -->
        <button
          @click="refresh()"
          class="p-1 hover:bg-gray-100 rounded"
          :disabled="loading"
        >
          <Icon name="i-heroicons-arrow-path" class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        </button>
      </div>

      <!-- Error message -->
      <div v-if="error" class="bg-red-50 border border-red-200 rounded-md p-3">
        <p class="text-sm text-red-600">{{ error }}</p>
      </div>

      <!-- Disabled state -->
      <div v-if="!isEnabled" class="text-sm text-gray-500">
        <p>On-demand pod management is currently disabled.</p>
        <p class="mt-1">Enable in configuration to save 70-80% on AI costs.</p>
      </div>

      <!-- Pod details -->
      <div v-else-if="hasPod" class="space-y-3">
        <!-- Metrics grid -->
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-gray-50 rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">Uptime</p>
            <p class="text-lg font-semibold text-gray-900">{{ status?.pod?.uptime?.formatted || '-' }}</p>
          </div>

          <div class="bg-gray-50 rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">Jobs Processed</p>
            <p class="text-lg font-semibold text-gray-900">{{ status?.pod?.jobs?.processed || 0 }}</p>
          </div>

          <div class="bg-gray-50 rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">Session Cost</p>
            <p class="text-lg font-semibold text-gray-900">${{ status?.pod?.cost?.session || '0.00' }}</p>
          </div>

          <div class="bg-gray-50 rounded-lg p-3">
            <p class="text-xs text-gray-500 mb-1">Today's Cost</p>
            <p class="text-lg font-semibold text-gray-900">${{ status?.costs?.today || '0.00' }}</p>
          </div>
        </div>

        <!-- Idle status (if idle) -->
        <div v-if="podStatus === 'IDLE'" class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <div class="flex items-start gap-2">
            <Icon name="i-heroicons-clock" class="w-4 h-4 text-yellow-600 mt-0.5" />
            <div class="flex-1">
              <p class="text-sm font-medium text-yellow-800">Pod is idle</p>
              <p class="text-xs text-yellow-600 mt-1">
                Idle for {{ status?.pod?.idle?.formatted || '-' }}
                <span v-if="status?.pod?.idle?.percentage">
                  ({{ status.pod.idle.percentage }}% of timeout)
                </span>
              </p>
            </div>
          </div>
        </div>

        <!-- Savings badge -->
        <div v-if="savingsPercent !== '0'" class="bg-green-50 border border-green-200 rounded-lg p-3">
          <div class="flex items-center gap-2">
            <Icon name="i-heroicons-arrow-trending-down" class="w-4 h-4 text-green-600" />
            <span class="text-sm font-medium text-green-800">
              Saving {{ savingsPercent }}% vs always-on
            </span>
          </div>
        </div>

        <!-- Pod info -->
        <div class="text-xs text-gray-500 space-y-1">
          <div class="flex justify-between">
            <span>Pod ID:</span>
            <span class="font-mono">{{ status?.pod?.id?.substring(0, 12) || '-' }}</span>
          </div>
          <div v-if="status?.pod?.url" class="flex justify-between">
            <span>URL:</span>
            <span class="font-mono text-xs truncate max-w-[200px]">{{ status.pod.url }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 pt-2 border-t">
          <Button
            v-if="podStatus === 'READY' || podStatus === 'ACTIVE' || podStatus === 'IDLE'"
            @click="controlPod('terminate')"
            label="Terminate"
            size="sm"
            :disabled="loading"
            class="flex-1"
          />
          <Button
            @click="controlPod('restart')"
            label="Restart"
            size="sm"
            :disabled="loading"
            class="flex-1"
          />
        </div>
      </div>

      <!-- No pod state -->
      <div v-else class="space-y-3">
        <p class="text-sm text-gray-600">
          No pod currently running. Pods will be created automatically when AI processing jobs are queued.
        </p>

        <!-- Cost info -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div class="flex items-start gap-2">
            <Icon name="i-heroicons-information-circle" class="w-4 h-4 text-blue-600 mt-0.5" />
            <div class="text-xs text-blue-800">
              <p class="font-medium">On-demand savings enabled</p>
              <p class="mt-1">Pods auto-create for AI jobs, terminate after 15 min idle</p>
            </div>
          </div>
        </div>

        <!-- Today's cost (if any) -->
        <div v-if="costs?.cost?.total && parseFloat(costs.cost.total) > 0" class="text-sm">
          <div class="flex justify-between">
            <span class="text-gray-600">Today's total cost:</span>
            <span class="font-semibold text-gray-900">${{ costs.cost.total }}</span>
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-gray-600">Savings vs always-on:</span>
            <span class="font-semibold text-green-600">${{ costs.savings?.vsAlwaysOn?.today || '0.00' }}</span>
          </div>
        </div>

        <!-- Manual create button -->
        <Button
          @click="controlPod('create')"
          label="Create Pod Now"
          size="sm"
          :disabled="loading"
          class="w-full"
        />
      </div>

      <!-- View details link -->
      <div v-if="isEnabled" class="pt-2 border-t">
        <NuxtLink
          to="/admin/runpod"
          class="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
        >
          <span>View detailed analytics</span>
          <Icon name="i-heroicons-arrow-right" class="w-4 h-4" />
        </NuxtLink>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: .5;
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
