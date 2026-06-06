const STORAGE_KEY = 'newsar-theme'

// Global reactive state shared across all component instances
const isDark = ref(false)
const isInitialized = ref(false)

export function useDarkMode() {
  function applyTheme(dark: boolean, animate = false) {
    if (!import.meta.client) return

    const html = document.documentElement
    if (animate) {
      html.classList.add('dark-transition')
      // Remove transition class after animation completes
      setTimeout(() => html.classList.remove('dark-transition'), 300)
    }

    if (dark) {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }

    isDark.value = dark
  }

  function toggle() {
    const newValue = !isDark.value
    applyTheme(newValue, true)
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, newValue ? 'dark' : 'light')
      } catch {
        // localStorage may not be available
      }
    }
  }

  function initDarkMode() {
    if (!import.meta.client || isInitialized.value) return

    isInitialized.value = true

    let preference: string | null = null

    // 1. Check localStorage
    try {
      preference = localStorage.getItem(STORAGE_KEY)
    } catch {
      // localStorage may not be available
    }

    if (preference === 'dark') {
      applyTheme(true)
    } else if (preference === 'light') {
      applyTheme(false)
    } else {
      // 2. Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      applyTheme(prefersDark)
    }

    // Listen for system preference changes (only if no manual preference)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      try {
        const storedPref = localStorage.getItem(STORAGE_KEY)
        if (!storedPref) {
          applyTheme(e.matches, true)
        }
      } catch {
        applyTheme(e.matches, true)
      }
    })
  }

  // Initialize on client side when composable is first used
  if (import.meta.client) {
    initDarkMode()
  }

  return {
    isDark: readonly(isDark),
    toggle,
  }
}
