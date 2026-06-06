export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, password } = body

  // Authentication via environment variables
  const adminUser = process.env.ADMIN_USERNAME || 'admin'
  const adminPass = process.env.ADMIN_PASSWORD || ''

  if (!adminPass) {
    throw createError({
      statusCode: 503,
      message: 'Authentication not configured',
    })
  }

  if (username === adminUser && password === adminPass) {
    await setUserSession(event, {
      user: {
        username: adminUser,
        role: 'admin',
      },
    })

    return { success: true, user: { username: adminUser } }
  }

  throw createError({
    statusCode: 401,
    message: 'Invalid credentials',
  })
})
