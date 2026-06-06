<script setup lang="ts">
const route = useRoute()
const { fetch: fetchSession } = useUserSession()

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true

  try {
    const response = await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value,
      },
    })

    if (response.success) {
      // Refresh client-side session state so middleware sees logged-in user
      await fetchSession()

      const redirect = route.query.redirect as string || '/admin'
      await navigateTo(redirect, { external: false })
    }
  } catch (e: any) {
    error.value = e.data?.message || 'Invalid credentials'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-paper py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <div>
        <div class="flex justify-center">
          <Icon name="i-heroicons-newspaper" class="w-12 h-12 text-accent" />
        </div>
        <h2 class="mt-6 text-center text-3xl font-bold text-ink">
          Sign in to Admin Panel
        </h2>
        <p class="mt-2 text-center text-sm text-ink-3">
          Enter your credentials to access the admin dashboard
        </p>
      </div>

      <Card>
        <form @submit.prevent="handleLogin" class="space-y-6">
          <div v-if="error" class="p-3 bg-red-50 border border-red-200 rounded-md">
            <p class="text-sm text-red-600">{{ error }}</p>
          </div>

          <div>
            <label for="username" class="block text-sm font-medium text-ink-2 mb-2">
              Username
            </label>
            <Input
              id="username"
              v-model="username"
              type="text"
              required
              placeholder="Enter your username"
              class="w-full"
              :disabled="loading"
            />
          </div>

          <div>
            <label for="password" class="block text-sm font-medium text-ink-2 mb-2">
              Password
            </label>
            <Input
              id="password"
              v-model="password"
              type="password"
              required
              placeholder="Enter your password"
              class="w-full"
              :disabled="loading"
            />
          </div>

          <Button
            type="submit"
            color="primary"
            size="lg"
            block
            :loading="loading"
          >
            Sign In
          </Button>
        </form>
      </Card>

      <div class="text-center">
        <Button
          to="/"
          color="gray"
          variant="ghost"
          size="sm"
          icon="i-heroicons-arrow-left"
        >
          Back to Home
        </Button>
      </div>
    </div>
  </div>
</template>
