/**
 * Rate Limiting Middleware for API Endpoints
 *
 * In-memory sliding window rate limiter with IP-based tracking.
 * - Public API endpoints (/api/*): 100 requests per minute per IP
 * - Admin API endpoints (/api/admin/*): 300 requests per minute per IP
 * - Non-API routes (page loads, static assets) are not rate limited
 *
 * Returns 429 Too Many Requests with Retry-After header when limit exceeded.
 * Expired entries are cleaned up every 60 seconds to prevent memory leaks.
 */

interface RateLimitEntry {
  timestamps: number[] // Request timestamps within the current window
}

// Separate stores for public and admin rate limits
const publicStore = new Map<string, RateLimitEntry>()
const adminStore = new Map<string, RateLimitEntry>()

const WINDOW_MS = 60 * 1000 // 1 minute sliding window
const PUBLIC_LIMIT = 100 // requests per minute for public API
const ADMIN_LIMIT = 300 // requests per minute for admin API
const CLEANUP_INTERVAL_MS = 60 * 1000 // Clean up expired entries every 60 seconds

/**
 * Remove timestamps older than the sliding window from an entry.
 * Returns the pruned array of timestamps.
 */
function pruneTimestamps(entry: RateLimitEntry, now: number): number[] {
  const cutoff = now - WINDOW_MS
  entry.timestamps = entry.timestamps.filter(ts => ts > cutoff)
  return entry.timestamps
}

/**
 * Periodically clean up expired entries from a store to prevent memory leaks.
 */
function startCleanupTimer(store: Map<string, RateLimitEntry>) {
  setInterval(() => {
    const now = Date.now()
    const cutoff = now - WINDOW_MS

    for (const [ip, entry] of store) {
      entry.timestamps = entry.timestamps.filter(ts => ts > cutoff)
      if (entry.timestamps.length === 0) {
        store.delete(ip)
      }
    }
  }, CLEANUP_INTERVAL_MS).unref() // unref() so this timer doesn't prevent process exit
}

// Start cleanup timers for both stores
startCleanupTimer(publicStore)
startCleanupTimer(adminStore)

export default defineEventHandler((event) => {
  const path = event.path || ''

  // Only rate limit API routes
  if (!path.startsWith('/api/')) {
    return
  }

  // Determine which store and limit to use
  const isAdmin = path.startsWith('/api/admin/')
  const store = isAdmin ? adminStore : publicStore
  const limit = isAdmin ? ADMIN_LIMIT : PUBLIC_LIMIT

  // Extract client IP
  const forwardedFor = getRequestHeader(event, 'x-forwarded-for')
  const ip = forwardedFor
    ? forwardedFor.split(',')[0].trim()
    : getRequestIP(event) || 'unknown'

  const now = Date.now()

  // Get or create entry for this IP
  let entry = store.get(ip)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(ip, entry)
  }

  // Prune old timestamps outside the sliding window
  pruneTimestamps(entry, now)

  // Check if limit is exceeded
  if (entry.timestamps.length >= limit) {
    // Calculate when the oldest request in the window will expire
    const oldestTimestamp = entry.timestamps[0]
    const retryAfterMs = oldestTimestamp + WINDOW_MS - now
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000)

    setResponseHeader(event, 'Retry-After', String(retryAfterSeconds))
    setResponseHeader(event, 'X-RateLimit-Limit', String(limit))
    setResponseHeader(event, 'X-RateLimit-Remaining', '0')
    setResponseHeader(event, 'X-RateLimit-Reset', String(Math.ceil((oldestTimestamp + WINDOW_MS) / 1000)))

    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: {
        error: 'Too Many Requests',
        retryAfter: retryAfterSeconds,
      },
    })
  }

  // Record this request
  entry.timestamps.push(now)

  // Set informational rate limit headers on successful requests
  setResponseHeader(event, 'X-RateLimit-Limit', String(limit))
  setResponseHeader(event, 'X-RateLimit-Remaining', String(limit - entry.timestamps.length))
  setResponseHeader(event, 'X-RateLimit-Reset', String(Math.ceil((now + WINDOW_MS) / 1000)))
})
