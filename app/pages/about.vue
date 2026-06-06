<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-16 border-b ">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            About Newsar
          </h1>
          <p class="text-xl text-ink-3">
            AI-powered news aggregation platform that shows you multiple perspectives on the same stories
          </p>
        </div>
      </Container>
    </section>

    <!-- Mission Section -->
    <section class="py-16">
      <Container>
        <div class="max-w-4xl mx-auto space-y-12">
          <div>
            <h2 class="text-3xl font-bold mb-6 ">Our Mission</h2>
            <p class="text-lg text-ink-2 leading-relaxed mb-4">
              In an era of increasing media polarization, Newsar aims to break down echo chambers by presenting
              news from multiple political perspectives. We believe that understanding different viewpoints is
              essential to forming well-informed opinions.
            </p>
            <p class="text-lg text-ink-2 leading-relaxed">
              By using AI to automatically classify, cluster, and analyze news articles, we make it easy to see
              how the same story is covered across the political spectrum—from far left to far right.
            </p>
          </div>

          <!-- Features -->
          <div>
            <h2 class="text-3xl font-bold mb-6 ">What We Do</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <template #header>
                  <div class="flex items-center gap-3">
                    <Icon name="i-heroicons-newspaper" class="w-6 h-6 text-accent" />
                    <h3 class="font-semibold text-lg">Multi-Source Aggregation</h3>
                  </div>
                </template>
                <p class="text-ink-3">
                  We collect news from dozens of sources across the political spectrum, giving you access
                  to diverse perspectives in one place.
                </p>
              </Card>

              <Card>
                <template #header>
                  <div class="flex items-center gap-3">
                    <Icon name="i-heroicons-cpu-chip" class="w-6 h-6 text-accent" />
                    <h3 class="font-semibold text-lg">AI Classification</h3>
                  </div>
                </template>
                <p class="text-ink-3">
                  Using local AI models (Ollama), we automatically detect language, political bias,
                  key entities, and sentiment for every article.
                </p>
              </Card>

              <Card>
                <template #header>
                  <div class="flex items-center gap-3">
                    <Icon name="i-heroicons-link" class="w-6 h-6 text-accent" />
                    <h3 class="font-semibold text-lg">Story Clustering</h3>
                  </div>
                </template>
                <p class="text-ink-3">
                  Articles about the same events are automatically grouped together using vector embeddings
                  and semantic similarity analysis.
                </p>
              </Card>

              <Card>
                <template #header>
                  <div class="flex items-center gap-3">
                    <Icon name="i-heroicons-eye" class="w-6 h-6 text-accent" />
                    <h3 class="font-semibold text-lg">Source Transparency</h3>
                  </div>
                </template>
                <p class="text-ink-3">
                  Every article shows its source's political bias rating, confidence scores, and
                  classification method—full transparency, always.
                </p>
              </Card>
            </div>
          </div>

          <!-- Technology Stack -->
          <div>
            <h2 class="text-3xl font-bold mb-6 ">Technology</h2>
            <p class="text-lg text-ink-2 mb-6">
              Newsar is built with modern, open-source technologies that prioritize privacy and performance:
            </p>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <h4 class="font-semibold mb-2">Frontend</h4>
                <ul class="text-sm text-ink-3 space-y-1">
                  <li>• Nuxt 4</li>
                  <li>• Vue 3</li>
                  <li>• Nuxt UI</li>
                  <li>• UnoCSS</li>
                </ul>
              </Card>

              <Card>
                <h4 class="font-semibold mb-2">Backend</h4>
                <ul class="text-sm text-ink-3 space-y-1">
                  <li>• Nuxt Server API</li>
                  <li>• PostgreSQL 16</li>
                  <li>• Drizzle ORM</li>
                  <li>• pgvector</li>
                </ul>
              </Card>

              <Card>
                <h4 class="font-semibold mb-2">AI/ML</h4>
                <ul class="text-sm text-ink-3 space-y-1">
                  <li>• Ollama</li>
                  <li>• llama3.2:3b</li>
                  <li>• nomic-embed-text</li>
                  <li>• Local processing</li>
                </ul>
              </Card>
            </div>
          </div>

          <!-- Privacy & Open Source -->
          <div class="bg-paper-2 rounded-sm p-8">
            <h2 class="text-2xl font-bold mb-4 ">Privacy First</h2>
            <p class="text-ink-2 leading-relaxed mb-4">
              All AI processing happens locally using Ollama—your reading habits and preferences never
              leave your device. We don't track you, sell your data, or use external AI services.
            </p>
            <p class="text-ink-2 leading-relaxed">
              Newsar is designed to be self-hosted, giving you complete control over your news consumption
              and data privacy.
            </p>
          </div>

          <!-- Contact/Support -->
          <div class="text-center">
            <h2 class="text-2xl font-bold mb-4">Questions or Feedback?</h2>
            <p class="text-ink-3 mb-6">
              We're always looking to improve. If you have suggestions, found a bug, or just want to
              learn more about how Newsar works, we'd love to hear from you.
            </p>
            <div class="flex gap-4 justify-center">
              <Button
                to="/methodology"
                color="primary"
                variant="outline"
                size="lg"
              >
                Read Our Methodology
              </Button>
              <Button
                to="/sources"
                color="gray"
                size="lg"
              >
                View All Sources
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  </div>
</template>
