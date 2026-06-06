<script setup lang="ts">
const route = useRoute()
const { isDark, toggle: toggleDarkMode } = useDarkMode()

const links = [
  { label: 'News', to: '/' },
  { label: 'Stories', to: '/stories' },
  { label: 'Entities', to: '/entities' },
  { label: 'Markets', to: '/stocks' },
  { label: 'Map', to: '/map' },
  { label: 'Graph', to: '/topics/graph' },
  { label: 'Sources', to: '/sources' },
  { label: 'About', to: '/about' },
]

const mobileMenuOpen = ref(false)

watch(() => route.path, () => {
  mobileMenuOpen.value = false
})
</script>

<template>
  <div class="min-h-screen flex flex-col bg-paper text-ink font-sans">

    <!-- ═══ RIBBON ═══ -->
    <div class="intel-ribbon">
      <div class="ribbon-brand">
        <span class="ribbon-dot" />
        NEWSAR
      </div>
      <div class="ribbon-ticker">
        <span>Multi-perspective news intelligence</span>
      </div>
      <div class="ribbon-meta">
        <button
          class="flex items-center gap-1.5 text-[#A7A08C] hover:text-[#F0EBDB] transition-colors"
          @click="toggleDarkMode"
        >
          <span :class="isDark ? 'i-heroicons-sun' : 'i-heroicons-moon'" class="w-3.5 h-3.5" />
          <span class="uppercase">{{ isDark ? 'Light' : 'Dark' }}</span>
        </button>
      </div>
    </div>

    <!-- ═══ NAV ═══ -->
    <header class="intel-nav">
      <div class="flex items-center gap-3">
        <!-- Mobile hamburger -->
        <button
          class="md:hidden p-1.5 -ml-1.5 text-ink-3 hover:text-ink hover:bg-paper-2 rounded-sm transition-colors"
          aria-label="Toggle menu"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <Icon
            :name="mobileMenuOpen ? 'i-heroicons-x-mark' : 'i-heroicons-bars-3'"
            class="w-6 h-6"
          />
        </button>

        <NuxtLink to="/" class="intel-logo">
          Newsar<small class="intel-logo-tag">INTEL</small>
        </NuxtLink>
      </div>

      <!-- Desktop nav tabs -->
      <nav class="hidden md:flex gap-1 nav-tabs">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="intel-tab"
          active-class="intel-tab-active"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="flex items-center gap-2">
        <NuxtLink to="/search" class="btn-nav hidden sm:inline-flex">
          <span class="i-heroicons-magnifying-glass w-3.5 h-3.5" />
          Search
        </NuxtLink>
        <NuxtLink to="/admin" class="btn-nav hidden sm:inline-flex">
          Admin
        </NuxtLink>
      </div>
    </header>

    <!-- ═══ MOBILE MENU ═══ -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="mobileMenuOpen"
        class="md:hidden fixed inset-x-0 top-[calc(32px+52px)] z-38 bg-panel border-b border-rule shadow-lg"
      >
        <nav class="px-4 py-3 space-y-1">
          <NuxtLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="flex items-center gap-3 px-3 py-2.5 rounded-sm font-mono text-xs font-medium tracking-wider uppercase text-ink-3 hover:bg-paper-2 hover:text-ink transition-colors"
            active-class="!bg-accent-tint !text-accent-ink"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>

        <div class="border-t border-rule-soft px-4 py-3 flex items-center justify-between">
          <NuxtLink to="/search" class="btn-nav">
            <span class="i-heroicons-magnifying-glass w-3.5 h-3.5" />
            Search
          </NuxtLink>
          <button class="btn-nav" @click="toggleDarkMode">
            <span :class="isDark ? 'i-heroicons-sun' : 'i-heroicons-moon'" class="w-3.5 h-3.5" />
            {{ isDark ? 'Light' : 'Dark' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- Backdrop -->
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
        class="md:hidden fixed inset-0 top-[calc(32px+52px)] z-30 bg-black/20"
        @click="mobileMenuOpen = false"
      />
    </Transition>

    <!-- ═══ MAIN ═══ -->
    <main class="flex-1">
      <slot />
    </main>

    <!-- ═══ FOOTER ═══ -->
    <footer class="bg-paper-2 border-t border-rule mt-16 py-8">
      <Container>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div class="md:col-span-2">
            <div class="flex items-center gap-2 mb-4">
              <span class="ribbon-dot" />
              <span class="font-serif font-bold text-lg text-ink">Newsar</span>
              <span class="font-mono text-[9px] font-semibold tracking-widest uppercase text-ink-3">Intel</span>
            </div>
            <p class="text-sm text-ink-3 mb-4 max-w-md">
              Multi-perspective news aggregation powered by AI. Get comprehensive coverage
              from diverse sources to form your own informed opinions.
            </p>
          </div>

          <div>
            <h4 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-2 mb-3">Platform</h4>
            <ul class="space-y-2 text-sm text-ink-3">
              <li><NuxtLink to="/" class="hover:text-accent">News Feed</NuxtLink></li>
              <li><NuxtLink to="/stories" class="hover:text-accent">Stories</NuxtLink></li>
              <li><NuxtLink to="/sources" class="hover:text-accent">Sources</NuxtLink></li>
              <li><NuxtLink to="/entities" class="hover:text-accent">Entities</NuxtLink></li>
              <li><NuxtLink to="/stocks" class="hover:text-accent">Markets</NuxtLink></li>
              <li><NuxtLink to="/map" class="hover:text-accent">Map</NuxtLink></li>
              <li><NuxtLink to="/topics/graph" class="hover:text-accent">Graph</NuxtLink></li>
            </ul>
          </div>

          <div>
            <h4 class="font-mono text-[10px] font-semibold tracking-widest uppercase text-ink-2 mb-3">Resources</h4>
            <ul class="space-y-2 text-sm text-ink-3">
              <li><NuxtLink to="/about" class="hover:text-accent">About</NuxtLink></li>
              <li><NuxtLink to="/methodology" class="hover:text-accent">Methodology</NuxtLink></li>
              <li><NuxtLink to="/privacy" class="hover:text-accent">Privacy</NuxtLink></li>
              <li><NuxtLink to="/contact" class="hover:text-accent">Contact</NuxtLink></li>
              <li><NuxtLink to="/admin" class="hover:text-accent">Admin</NuxtLink></li>
            </ul>
          </div>
        </div>

        <div class="border-t border-rule my-6" />

        <div class="flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-ink-4 font-mono tracking-wider">
          <p>&copy; 2025 Newsar. Built with Nuxt 4, Ollama, and PostgreSQL.</p>
          <div class="flex gap-4">
            <NuxtLink to="/admin" class="hover:text-accent uppercase">Dashboard</NuxtLink>
          </div>
        </div>
      </Container>
    </footer>
  </div>
</template>
