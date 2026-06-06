<template>
  <div class="entity-portrait flex-shrink-0" :class="{ 'portrait-fill': fill }">
    <!-- Loading state -->
    <div v-if="loading" class="portrait-frame animate-pulse bg-gray-200 dark:bg-slate-700" />

    <!-- Image loaded -->
    <img
      v-else-if="resolvedImageUrl"
      :src="resolvedImageUrl"
      :alt="name"
      class="portrait-frame object-cover"
      @error="handleImageError"
    />

    <!-- Initials avatar fallback -->
    <div
      v-else
      class="portrait-frame initials-avatar"
      :style="{ background: avatarGradient }"
    >
      <span class="initials-text">{{ initials }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  name: string
  entityType: string
  entityId?: number
  existingImageUrl?: string | null
  fill?: boolean
}

const props = defineProps<Props>()

const loading = ref(false)
const fetchedImageUrl = ref<string | null>(null)
const imageFailed = ref(false)

// Use the existing image URL from the database if available, otherwise fetch from Wikidata
const resolvedImageUrl = computed(() => {
  if (imageFailed.value) return null
  if (props.existingImageUrl) return props.existingImageUrl
  return fetchedImageUrl.value
})

// Generate initials from entity name
const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return (props.name[0] || '?').toUpperCase()
})

// Generate a deterministic gradient based on entity name
const avatarGradient = computed(() => {
  let hash = 0
  for (let i = 0; i < props.name.length; i++) {
    const char = props.name.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  // Generate two hue values from the hash for a gradient
  const hue1 = Math.abs(hash % 360)
  const hue2 = (hue1 + 40) % 360

  return `linear-gradient(135deg, hsl(${hue1}, 55%, 45%) 0%, hsl(${hue2}, 55%, 35%) 100%)`
})

function handleImageError() {
  imageFailed.value = true
}

// Fetch image from Wikidata API only if no existing image
onMounted(async () => {
  if (props.existingImageUrl) return
  // Only fetch for persons and organizations (best coverage on Wikidata)
  if (props.entityType !== 'person' && props.entityType !== 'organization') return

  loading.value = true
  try {
    const response = await $fetch<{ imageUrl: string | null }>('/api/entities/image', {
      query: {
        name: props.name,
        type: props.entityType,
        entityId: props.entityId,
      },
    })
    if (response.imageUrl) {
      fetchedImageUrl.value = response.imageUrl
    }
  } catch {
    // Image fetch is non-critical, fail silently
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.entity-portrait {
  width: 120px;
  height: 120px;
}

.entity-portrait.portrait-fill {
  width: 100%;
  height: 100%;
}

.entity-portrait.portrait-fill .portrait-frame {
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.portrait-frame {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  border: 2px solid #e5e7eb;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

:root.dark .portrait-frame {
  border-color: #475569;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.initials-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
}

.initials-text {
  font-size: 40px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1;
  user-select: none;
}
</style>
