/**
 * Require an admin session for all /api/admin/* endpoints.
 * The admin pages are already guarded client-side (app/middleware/admin.ts),
 * but the API itself was reachable without logging in.
 */
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/admin/')) return

  const session = await getUserSession(event)
  if ((session.user as any)?.role !== 'admin') {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
