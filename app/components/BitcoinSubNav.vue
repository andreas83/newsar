<script setup lang="ts">
const route = useRoute()

const links = [
  { to: '/bitcoin', label: 'Dashboard' },
  { to: '/bitcoin/predictions', label: 'Predictions' },
  { to: '/bitcoin/simulator', label: 'Simulator' },
  { to: '/bitcoin/live-trading', label: 'Live Trading' },
  { to: '/stocks', label: 'Stocks' },
]

function isActive(to: string) {
  if (to === '/bitcoin') return route.path === '/bitcoin' || route.path === '/bitcoin/'
  return route.path.startsWith(to)
}
</script>

<template>
  <nav class="flex items-center gap-1 mb-6 border-b border-rule">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="px-4 py-2.5 text-sm font-mono font-medium transition-colors relative"
      :class="isActive(link.to) ? 'text-ink' : 'text-ink-3 hover:text-ink'"
    >
      {{ link.label }}
      <div v-if="isActive(link.to)" class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
    </NuxtLink>
  </nav>
</template>
