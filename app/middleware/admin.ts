export default defineNuxtRouteMiddleware(async (to, from) => {
  const { loggedIn, fetch: fetchSession } = useUserSession()

  // Ensure session is loaded (fetches once, then cached)
  if (!loggedIn.value) {
    await fetchSession()
  }

  if (!loggedIn.value) {
    return navigateTo('/login?redirect=' + to.path)
  }
})
