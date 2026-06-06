<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const loggingOut = ref(false)
const mobileMenuOpen = ref(false)

watch(() => route.path, () => {
  mobileMenuOpen.value = false
})

const links = [
  { label: 'Dashboard', icon: 'i-heroicons-chart-bar', to: '/admin' },
  { label: 'Feeds', icon: 'i-heroicons-rss', to: '/admin/feeds' },
  { label: 'Entities', icon: 'i-heroicons-user-group', to: '/admin/entities' },
  { label: 'Network', icon: 'i-heroicons-squares-plus', to: '/admin/network' },
  { label: 'Stocks', icon: 'i-heroicons-chart-bar', to: '/admin/stocks' },
  { label: 'Jobs', icon: 'i-heroicons-queue-list', to: '/admin/jobs' },
  { label: 'RunPod', icon: 'i-heroicons-cloud', to: '/admin/runpod' },
]

async function handleLogout() {
  loggingOut.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await router.push('/login')
  } catch (e) {
    console.error('Logout failed:', e)
  } finally {
    loggingOut.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex flex-col md:flex-row bg-paper text-ink font-sans">
    <!-- Mobile Header -->
    <div class="sticky top-0 z-40 md:hidden flex items-center gap-3 px-4 h-14 border-b border-rule bg-panel">
      <button
        class="p-1.5 -ml-1.5 rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink transition-colors"
        aria-label="Toggle menu"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <Icon
          :name="mobileMenuOpen ? 'i-heroicons-x-mark' : 'i-heroicons-bars-3'"
          class="w-6 h-6"
        />
      </button>
      <span class="ribbon-dot" />
      <span class="font-mono font-semibold text-lg text-ink">Newsar Admin</span>
    </div>

    <!-- Mobile Overlay -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="mobileMenuOpen"
        class="md:hidden fixed inset-0 z-50 bg-black/30"
        @click="mobileMenuOpen = false"
      />
    </Transition>

    <!-- Mobile Sidebar -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-x-0"
      leave-to-class="-translate-x-full"
    >
      <aside
        v-if="mobileMenuOpen"
        class="md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-paper-2 border-r border-rule flex flex-col"
      >
        <div class="p-4 border-b border-rule flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="ribbon-dot" />
            <span class="font-mono font-semibold text-lg text-ink">Newsar Admin</span>
          </div>
          <button
            class="p-1.5 rounded-sm text-ink-3 hover:bg-paper hover:text-ink transition-colors"
            @click="mobileMenuOpen = false"
          >
            <Icon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>

        <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors text-ink-3 hover:bg-paper hover:text-ink"
            active-class="bg-accent-tint text-accent-ink"
          >
            <Icon :name="link.icon" class="w-5 h-5" />
            {{ link.label }}
          </NuxtLink>
        </nav>

        <div class="p-4 border-t border-rule space-y-2">
          <Button to="/" color="gray" variant="ghost" size="sm" class="w-full" icon="i-heroicons-arrow-left">
            Back to Site
          </Button>
          <Button color="red" variant="ghost" size="sm" class="w-full" icon="i-heroicons-arrow-right-on-rectangle" :loading="loggingOut" @click="handleLogout">
            Logout
          </Button>
        </div>
      </aside>
    </Transition>

    <!-- Desktop Sidebar -->
    <aside class="hidden md:block w-64 flex-shrink-0 border-r border-rule bg-paper-2">
      <div class="sticky top-0 flex flex-col h-screen">
        <div class="p-4 border-b border-rule">
          <div class="flex items-center gap-2">
            <span class="ribbon-dot" />
            <span class="font-mono font-semibold text-lg text-ink">Newsar Admin</span>
          </div>
        </div>

        <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors text-ink-3 hover:bg-paper hover:text-ink"
            active-class="bg-accent-tint text-accent-ink"
          >
            <Icon :name="link.icon" class="w-5 h-5" />
            {{ link.label }}
          </NuxtLink>
        </nav>

        <div class="p-4 border-t border-rule space-y-2">
          <div class="flex items-center gap-2 text-sm text-ink-3">
            <Icon name="i-heroicons-server" class="w-4 h-4 text-intel-green" />
            <span>System Online</span>
          </div>
          <Button to="/" color="gray" variant="ghost" size="sm" class="w-full" icon="i-heroicons-arrow-left">
            Back to Site
          </Button>
          <Button color="red" variant="ghost" size="sm" class="w-full" icon="i-heroicons-arrow-right-on-rectangle" :loading="loggingOut" @click="handleLogout">
            Logout
          </Button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
