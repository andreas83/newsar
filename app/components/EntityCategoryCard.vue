<template>
  <div
    class="entity-category-card group cursor-pointer"
    @click="$emit('click')"
  >
    <div class="card-content">
      <!-- Image/Icon Header -->
      <div class="card-header" :style="{ background: gradientColor }">
        <Icon :name="icon" class="card-icon" />
        <div v-if="velocity !== undefined" class="velocity-badge">
          <Icon
            :name="velocity > 0 ? 'i-heroicons-arrow-trending-up' : velocity < 0 ? 'i-heroicons-arrow-trending-down' : 'i-heroicons-minus'"
            class="w-3 h-3"
          />
          <span>{{ formatVelocity(velocity) }}</span>
        </div>
      </div>

      <!-- Content -->
      <div class="card-body">
        <div class="card-title">
          <h3>{{ title }}</h3>
          <Badge :color="badgeColor" size="lg">
            {{ count }}
          </Badge>
        </div>

        <p class="card-description">{{ description }}</p>

        <!-- Stats -->
        <div class="card-stats">
          <div class="stat">
            <Icon name="i-heroicons-newspaper" class="w-4 h-4 text-gray-500 dark:text-slate-400" />
            <span>{{ totalArticles }} articles</span>
          </div>
          <div v-if="trendingCount" class="stat">
            <Icon name="i-heroicons-fire" class="w-4 h-4 text-red-500" />
            <span>{{ trendingCount }} trending</span>
          </div>
        </div>

        <!-- Action -->
        <div class="card-action">
          <span class="action-text">Explore Network</span>
          <Icon name="i-heroicons-arrow-right" class="w-4 h-4 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description: string
  count: number
  icon: string
  badgeColor: 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'gray'
  gradientColor: string
  velocity?: number
  totalArticles?: number
  trendingCount?: number
}>()

defineEmits<{
  click: []
}>()

function formatVelocity(velocity: number): string {
  const abs = Math.abs(velocity)
  if (abs < 1) return '—'
  return velocity > 0 ? `+${abs.toFixed(0)}%` : `${velocity.toFixed(0)}%`
}
</script>

<style scoped>
.entity-category-card {
  background: white;
  border-radius: 12px;
  border: 2px solid #e5e7eb;
  overflow: hidden;
  transition: all 0.3s ease;
}

:root.dark .entity-category-card {
  background: #1e293b;
  border-color: #334155;
}

.entity-category-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.1), 0 8px 10px -6px rgba(59, 130, 246, 0.1);
  transform: translateY(-2px);
}

.card-content {
  display: flex;
  flex-direction: column;
}

.card-header {
  position: relative;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.group:hover .card-header {
  transform: scale(1.02);
}

.card-icon {
  width: 48px;
  height: 48px;
  color: white;
  opacity: 0.9;
}

.velocity-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  padding: 4px 12px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #1f2937;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

:root.dark .velocity-badge {
  background: rgba(30, 41, 59, 0.95);
  color: #f1f5f9;
}

.card-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title h3 {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

:root.dark .card-title h3 {
  color: #f1f5f9;
}

.card-description {
  font-size: 14px;
  color: #6b7280;
  line-height: 1.5;
  margin: 0;
}

:root.dark .card-description {
  color: #94a3b8;
}

.card-stats {
  display: flex;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid #f3f4f6;
}

:root.dark .card-stats {
  border-top-color: #334155;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
}

:root.dark .stat {
  color: #94a3b8;
}

.card-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  margin-top: 4px;
  border-top: 1px solid #f3f4f6;
}

:root.dark .card-action {
  border-top-color: #334155;
}

.action-text {
  font-size: 14px;
  font-weight: 600;
  color: #3b82f6;
}
</style>
