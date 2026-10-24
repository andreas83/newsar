/**
 * Cookieless page view beacon for the admin visitor stats (server/api/ping.post.ts).
 *
 * Nothing is stored in the browser. Each page view gets a random id; a second
 * beacon marks it "engaged" on the first real interaction or after 15 seconds
 * visible, which is what separates readers from headless crawlers that run
 * JavaScript with a normal Chrome user agent.
 */

const ENGAGED_AFTER_MS = 15_000

function newId(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function send(data: Record<string, unknown>) {
  const body = JSON.stringify(data)
  try {
    if (navigator.sendBeacon?.('/api/ping', body)) return
  } catch {}
  fetch('/api/ping', { method: 'POST', body, keepalive: true }).catch(() => {})
}

function looksHeadless(): boolean {
  return navigator.webdriver === true
    || /HeadlessChrome|PhantomJS/.test(navigator.userAgent)
    || (window.outerWidth === 0 && window.outerHeight === 0)
    || !navigator.languages?.length
}

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const headless = looksHeadless()

  let current: { id: string, path: string, engaged: boolean, visibleMs: number, visibleSince: number | null } | null = null
  let engageTimer: ReturnType<typeof setTimeout> | null = null
  let firstView = true

  function engage() {
    if (!current || current.engaged) return
    current.engaged = true
    send({ t: 'e', id: current.id })
  }

  function scheduleEngage() {
    if (engageTimer) clearTimeout(engageTimer)
    engageTimer = null
    if (!current || current.engaged || document.visibilityState !== 'visible') return
    engageTimer = setTimeout(engage, Math.max(0, ENGAGED_AFTER_MS - current.visibleMs))
  }

  function pauseClock() {
    if (current?.visibleSince != null) {
      current.visibleMs += performance.now() - current.visibleSince
      current.visibleSince = null
    }
  }

  function endView() {
    if (!current) return
    pauseClock()
    send({ t: 'end', id: current.id, d: Math.round(current.visibleMs) })
  }

  function startView() {
    const route = router.currentRoute.value
    if (route.path.startsWith('/admin') || route.path === '/login') {
      current = null
      return
    }

    current = {
      id: newId(),
      path: route.path,
      engaged: false,
      visibleMs: 0,
      visibleSince: document.visibilityState === 'visible' ? performance.now() : null,
    }
    const utm = route.query.utm_source ?? route.query.ref
    send({
      t: 'pv',
      id: current.id,
      p: route.path,
      r: firstView ? document.referrer : undefined,
      u: typeof utm === 'string' ? utm : undefined,
      h: headless || undefined,
    })
    firstView = false
    scheduleEngage()
  }

  nuxtApp.hook('page:finish', () => {
    const path = router.currentRoute.value.path
    // page:finish also fires for nested pages and query-only changes
    if (current?.path === path) return
    endView()
    startView()
  })

  const onInteract = (e: Event) => {
    if (e.isTrusted) engage()
  }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']) {
    window.addEventListener(type, onInteract, { passive: true, capture: true })
  }

  document.addEventListener('visibilitychange', () => {
    if (!current) return
    if (document.visibilityState === 'hidden') {
      endView()
      if (engageTimer) clearTimeout(engageTimer)
    } else {
      current.visibleSince = performance.now()
      scheduleEngage()
    }
  })
})
