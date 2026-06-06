<script setup lang="ts">
const { data: sources } = await useFetch('/api/sources')

function getBiasLabel(bias: number | null) {
  if (bias === null) return 'Unknown'
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
}

function getBiasColor(bias: number | null) {
  if (bias === null) return 'gray'
  if (bias <= -0.6) return 'blue'
  if (bias <= -0.2) return 'sky'
  if (bias < 0.2) return 'gray'
  if (bias < 0.6) return 'orange'
  return 'red'
}

function formatDate(date: string | Date | null) {
  if (!date) return 'Never'
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))

  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return d.toLocaleDateString()
}

const activeSources = computed(() => sources.value?.filter(s => s.isActive === 1) || [])
const inactiveSources = computed(() => sources.value?.filter(s => s.isActive === 0) || [])

// Group by bias
const sourcesByBias = computed(() => {
  const grouped: Record<string, any[]> = {
    left: [],
    centerLeft: [],
    center: [],
    centerRight: [],
    right: [],
    unknown: [],
  }

  activeSources.value.forEach(source => {
    if (source.knownBias === null) {
      grouped.unknown.push(source)
    } else if (source.knownBias <= -0.6) {
      grouped.left.push(source)
    } else if (source.knownBias <= -0.2) {
      grouped.centerLeft.push(source)
    } else if (source.knownBias < 0.2) {
      grouped.center.push(source)
    } else if (source.knownBias < 0.6) {
      grouped.centerRight.push(source)
    } else {
      grouped.right.push(source)
    }
  })

  return grouped
})
</script>

<template>
  <div>
    <!-- Hero Section -->
    <section class="bg-paper-2 py-12 border-b ">
      <Container>
        <div class="text-center max-w-3xl mx-auto">
          <h1 class="text-4xl md:text-5xl font-bold text-ink mb-4">
            News Sources
          </h1>
          <p class="text-lg text-ink-3 mb-8">
            Transparency is key to understanding bias. Here are all the news sources we track,
            along with their political leanings and article counts.
          </p>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div class="text-3xl font-bold text-accent">{{ activeSources.length }}</div>
              <div class="text-sm text-ink-3">Active Sources</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-blue-600">{{ sourcesByBias.left.length + sourcesByBias.centerLeft.length }}</div>
              <div class="text-sm text-ink-3">Left-Leaning</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-ink-3">{{ sourcesByBias.center.length }}</div>
              <div class="text-sm text-ink-3">Center</div>
            </div>
            <div>
              <div class="text-3xl font-bold text-red-600">{{ sourcesByBias.centerRight.length + sourcesByBias.right.length }}</div>
              <div class="text-sm text-ink-3">Right-Leaning</div>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- Bias Scale Explanation -->
    <section class="bg-panel py-8 border-b ">
      <Container>
        <div class="max-w-4xl mx-auto">
          <h2 class="text-xl font-semibold mb-4 text-center ">Understanding Our Bias Scale</h2>
          <div class="flex items-center gap-2 mb-4">
            <div class="flex-1 h-8 bg-gradient-to-r from-blue-600 via-gray-400 to-red-600 rounded"></div>
          </div>
          <div class="grid grid-cols-5 gap-2 text-center text-sm">
            <div>
              <div class="font-medium text-blue-600">Far Left</div>
              <div class="text-ink-3">-1.0 to -0.6</div>
            </div>
            <div>
              <div class="font-medium text-sky-600">Center-Left</div>
              <div class="text-ink-3">-0.6 to -0.2</div>
            </div>
            <div>
              <div class="font-medium text-ink-3">Center</div>
              <div class="text-ink-3">-0.2 to +0.2</div>
            </div>
            <div>
              <div class="font-medium text-orange-600">Center-Right</div>
              <div class="text-ink-3">+0.2 to +0.6</div>
            </div>
            <div>
              <div class="font-medium text-red-600">Far Right</div>
              <div class="text-ink-3">+0.6 to +1.0</div>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- Sources List -->
    <section class="py-12">
      <Container>
        <div class="max-w-6xl mx-auto space-y-12">
          <!-- Left Sources -->
          <div v-if="sourcesByBias.left.length > 0 || sourcesByBias.centerLeft.length > 0">
            <div class="flex items-center gap-3 mb-6">
              <div class="h-1 w-12 bg-blue-500 rounded"></div>
              <h2 class="text-2xl font-bold text-ink">Left-Leaning Sources</h2>
              <Badge color="blue" size="lg">{{ sourcesByBias.left.length + sourcesByBias.centerLeft.length }}</Badge>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                v-for="source in [...sourcesByBias.left, ...sourcesByBias.centerLeft]"
                :key="source.id"
                class="hover: transition-shadow"
              >
                <div class="space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1">
                      <h3 class="font-semibold text-lg text-ink">{{ source.name }}</h3>
                      <p class="text-sm text-ink-3">{{ source.category || 'General News' }}</p>
                    </div>
                    <Badge
                      :color="getBiasColor(source.knownBias)"
                      size="sm"
                    >
                      {{ getBiasLabel(source.knownBias) }}
                    </Badge>
                  </div>

                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div class="text-ink-3">Articles</div>
                      <div class="font-medium">{{ source.articleCount }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Last Updated</div>
                      <div class="font-medium">{{ formatDate(source.lastFetchedAt) }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Bias Score</div>
                      <div class="font-medium">{{ source.knownBias?.toFixed(2) || 'N/A' }}</div>
                    </div>
                    <div v-if="source.region">
                      <div class="text-ink-3">Region</div>
                      <div class="font-medium">{{ source.region }}</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <!-- Center Sources -->
          <div v-if="sourcesByBias.center.length > 0">
            <div class="flex items-center gap-3 mb-6">
              <div class="h-1 w-12 bg-paper-20 rounded"></div>
              <h2 class="text-2xl font-bold text-ink">Center Sources</h2>
              <Badge color="gray" size="lg">{{ sourcesByBias.center.length }}</Badge>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                v-for="source in sourcesByBias.center"
                :key="source.id"
                class="hover: transition-shadow"
              >
                <div class="space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1">
                      <h3 class="font-semibold text-lg text-ink">{{ source.name }}</h3>
                      <p class="text-sm text-ink-3">{{ source.category || 'General News' }}</p>
                    </div>
                    <Badge
                      :color="getBiasColor(source.knownBias)"
                      size="sm"
                    >
                      {{ getBiasLabel(source.knownBias) }}
                    </Badge>
                  </div>

                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div class="text-ink-3">Articles</div>
                      <div class="font-medium">{{ source.articleCount }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Last Updated</div>
                      <div class="font-medium">{{ formatDate(source.lastFetchedAt) }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Bias Score</div>
                      <div class="font-medium">{{ source.knownBias?.toFixed(2) || 'N/A' }}</div>
                    </div>
                    <div v-if="source.region">
                      <div class="text-ink-3">Region</div>
                      <div class="font-medium">{{ source.region }}</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <!-- Right Sources -->
          <div v-if="sourcesByBias.right.length > 0 || sourcesByBias.centerRight.length > 0">
            <div class="flex items-center gap-3 mb-6">
              <div class="h-1 w-12 bg-red-500 rounded"></div>
              <h2 class="text-2xl font-bold text-ink">Right-Leaning Sources</h2>
              <Badge color="red" size="lg">{{ sourcesByBias.centerRight.length + sourcesByBias.right.length }}</Badge>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                v-for="source in [...sourcesByBias.centerRight, ...sourcesByBias.right]"
                :key="source.id"
                class="hover: transition-shadow"
              >
                <div class="space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1">
                      <h3 class="font-semibold text-lg text-ink">{{ source.name }}</h3>
                      <p class="text-sm text-ink-3">{{ source.category || 'General News' }}</p>
                    </div>
                    <Badge
                      :color="getBiasColor(source.knownBias)"
                      size="sm"
                    >
                      {{ getBiasLabel(source.knownBias) }}
                    </Badge>
                  </div>

                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div class="text-ink-3">Articles</div>
                      <div class="font-medium">{{ source.articleCount }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Last Updated</div>
                      <div class="font-medium">{{ formatDate(source.lastFetchedAt) }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Bias Score</div>
                      <div class="font-medium">{{ source.knownBias?.toFixed(2) || 'N/A' }}</div>
                    </div>
                    <div v-if="source.region">
                      <div class="text-ink-3">Region</div>
                      <div class="font-medium">{{ source.region }}</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <!-- Unknown Bias Sources -->
          <div v-if="sourcesByBias.unknown.length > 0">
            <div class="flex items-center gap-3 mb-6">
              <h2 class="text-xl font-semibold text-ink-3">Other Sources</h2>
              <Badge color="gray" size="sm">{{ sourcesByBias.unknown.length }}</Badge>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                v-for="source in sourcesByBias.unknown"
                :key="source.id"
                class="hover: transition-shadow"
              >
                <div class="space-y-3">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1">
                      <h3 class="font-semibold text-lg text-ink">{{ source.name }}</h3>
                      <p class="text-sm text-ink-3">{{ source.category || 'General News' }}</p>
                    </div>
                    <Badge color="gray" size="sm">Unknown</Badge>
                  </div>

                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div class="text-ink-3">Articles</div>
                      <div class="font-medium">{{ source.articleCount }}</div>
                    </div>
                    <div>
                      <div class="text-ink-3">Last Updated</div>
                      <div class="font-medium">{{ formatDate(source.lastFetchedAt) }}</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </Container>
    </section>

    <!-- Methodology Link -->
    <section class="bg-paper py-12 border-t ">
      <Container>
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl font-bold mb-4 ">How We Classify Sources</h2>
          <p class="text-ink-3 mb-6">
            Our bias classification combines established media bias ratings with AI-powered content analysis.
            Learn more about our methodology and how we maintain accuracy and fairness.
          </p>
          <Button
            to="/methodology"
            color="primary"
            size="lg"
          >
            Read Our Methodology
          </Button>
        </div>
      </Container>
    </section>
  </div>
</template>
