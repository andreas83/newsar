<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-16 border-b">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            Contact
          </h1>
          <p class="text-xl text-ink-3">
            Have a question, found a bug, or want to suggest a news source? Drop us a message.
          </p>
        </div>
      </Container>
    </section>

    <!-- Content -->
    <section class="py-16">
      <Container>
        <div class="max-w-2xl mx-auto">
          <!-- Success Message -->
          <div v-if="submitted" class="not-prose p-6 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded mb-8">
            <h3 class="text-lg font-bold text-green-900 dark:text-green-300 mb-2">Message Sent</h3>
            <p class="text-green-800 dark:text-green-400">
              Thanks for reaching out. We'll review your message.
            </p>
            <button class="mt-4 text-sm text-green-700 dark:text-green-400 underline" @click="reset">
              Send another message
            </button>
          </div>

          <!-- Contact Form -->
          <form v-else class="space-y-6" @submit.prevent="submit">
            <div>
              <label for="name" class="block text-sm font-medium text-ink-2 mb-1">Name</label>
              <input
                id="name"
                v-model="form.name"
                type="text"
                required
                maxlength="200"
                class="w-full px-4 py-2.5 bg-paper border border-paper-3 rounded text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Your name"
              />
            </div>

            <div>
              <label for="subject" class="block text-sm font-medium text-ink-2 mb-1">Subject</label>
              <select
                id="subject"
                v-model="form.subject"
                required
                class="w-full px-4 py-2.5 bg-paper border border-paper-3 rounded text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                <option value="" disabled>Select a topic</option>
                <option value="Bug Report">Bug Report</option>
                <option value="Feature Request">Feature Request</option>
                <option value="Source Suggestion">Source Suggestion</option>
                <option value="General Question">General Question</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label for="message" class="block text-sm font-medium text-ink-2 mb-1">Message</label>
              <textarea
                id="message"
                v-model="form.message"
                required
                maxlength="5000"
                rows="6"
                class="w-full px-4 py-2.5 bg-paper border border-paper-3 rounded text-ink placeholder-ink-4 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-y"
                placeholder="What's on your mind?"
              />
              <p class="text-xs text-ink-4 mt-1">{{ form.message.length }} / 5000</p>
            </div>

            <div v-if="error" class="text-red-600 dark:text-red-400 text-sm">
              {{ error }}
            </div>

            <Button
              type="submit"
              color="primary"
              size="lg"
              class="w-full"
              :disabled="sending"
            >
              {{ sending ? 'Sending...' : 'Send Message' }}
            </Button>
          </form>

          <!-- Response Note -->
          <div class="not-prose p-6 bg-paper-2 border-l-4 border-accent rounded mt-12">
            <h3 class="text-lg font-bold text-ink mb-2">A Note on Responses</h3>
            <p class="text-ink-3">
              Newsar is maintained by a small team. We read every message but may not be able to respond individually.
            </p>
          </div>

          <!-- Links -->
          <div class="text-center mt-12">
            <div class="flex gap-4 justify-center flex-wrap">
              <Button to="/about" color="primary" size="lg">
                About Newsar
              </Button>
              <Button to="/privacy" color="gray" size="lg">
                Privacy Policy
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  </div>
</template>

<script setup lang="ts">
const form = reactive({
  name: '',
  subject: '',
  message: '',
})

const sending = ref(false)
const submitted = ref(false)
const error = ref('')

async function submit() {
  sending.value = true
  error.value = ''

  try {
    await $fetch('/api/contact', {
      method: 'POST',
      body: { name: form.name, subject: form.subject, message: form.message },
    })
    submitted.value = true
  } catch (e: any) {
    error.value = e?.data?.message || 'Something went wrong. Please try again.'
  } finally {
    sending.value = false
  }
}

function reset() {
  form.name = ''
  form.subject = ''
  form.message = ''
  submitted.value = false
  error.value = ''
}
</script>
