// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@unocss/nuxt',
    'nuxt-auth-utils',
  ],

  css: [
    '@unocss/reset/tailwind.css',
    '~/assets/css/main.css',
  ],

  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700&display=swap' },
      ],
    },
  },

  // TypeScript configuration
  typescript: {
    strict: false,
    typeCheck: false,
  },

  // Nitro configuration for API routes
  nitro: {
    experimental: {
      database: true,
    },
    alias: {
      '~/server': fileURLToPath(new URL('./server', import.meta.url)),
    },
  },

  // Resolve aliases properly
  alias: {
    '~/server': fileURLToPath(new URL('./server', import.meta.url)),
  },
})
