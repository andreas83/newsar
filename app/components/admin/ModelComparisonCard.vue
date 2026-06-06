<template>
  <Card>
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">AI Model Comparison</h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        Compare Transformers.js (CPU) vs Ollama (GPU) performance and quality
      </p>

      <!-- Configuration -->
      <div class="mb-6 space-y-4">
        <div>
          <label class="block text-sm font-medium mb-2">Number of Articles</label>
          <input
            v-model.number="numArticles"
            type="number"
            min="1"
            max="50"
            class="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
          />
        </div>

        <div>
          <label class="block text-sm font-medium mb-2">Tasks to Compare</label>
          <div class="flex gap-4">
            <label class="flex items-center">
              <input v-model="selectedTasks" type="checkbox" value="ner" class="mr-2" />
              Named Entity Recognition
            </label>
            <label class="flex items-center">
              <input v-model="selectedTasks" type="checkbox" value="sentiment" class="mr-2" />
              Sentiment Analysis
            </label>
            <label class="flex items-center">
              <input v-model="selectedTasks" type="checkbox" value="keywords" class="mr-2" />
              Keyword Extraction
            </label>
          </div>
        </div>

        <Button
          @click="runComparison"
          :disabled="loading || selectedTasks.length === 0"
          class="w-full"
        >
          {{ loading ? 'Running Comparison...' : 'Run Comparison' }}
        </Button>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="text-center py-8">
        <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p class="mt-4 text-gray-600 dark:text-gray-400">
          Processing {{ numArticles }} articles... This may take a few minutes.
        </p>
      </div>

      <!-- Results -->
      <div v-if="results && !loading" class="space-y-6">
        <!-- Summary Stats -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <div class="text-sm text-gray-600 dark:text-gray-400">Average Speedup</div>
            <div class="text-3xl font-bold text-blue-600">
              {{ results.aggregateMetrics.avgSpeedup.toFixed(1) }}x
            </div>
            <div class="text-xs text-gray-500 mt-1">Faster with Transformers.js</div>
          </div>

          <div class="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
            <div class="text-sm text-gray-600 dark:text-gray-400">Avg Time (Transformer)</div>
            <div class="text-3xl font-bold text-green-600">
              {{ (results.aggregateMetrics.avgTransformerTime / 1000).toFixed(1) }}s
            </div>
            <div class="text-xs text-gray-500 mt-1">Per article (CPU)</div>
          </div>

          <div class="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
            <div class="text-sm text-gray-600 dark:text-gray-400">Avg Time (Ollama)</div>
            <div class="text-3xl font-bold text-orange-600">
              {{ (results.aggregateMetrics.avgOllamaTime / 1000).toFixed(1) }}s
            </div>
            <div class="text-xs text-gray-500 mt-1">Per article (GPU)</div>
          </div>
        </div>

        <!-- Task-Specific Metrics -->
        <div v-if="results.taskMetrics" class="space-y-4">
          <h3 class="text-lg font-semibold">Task Performance</h3>

          <div v-for="(metrics, task) in results.taskMetrics" :key="task" class="border rounded-lg p-4 dark:border-gray-700">
            <div class="flex items-center justify-between mb-3">
              <h4 class="font-medium capitalize">{{ formatTaskName(task) }}</h4>
              <Badge :color="getSpeedupColor(metrics.avgSpeedup)">
                {{ metrics.avgSpeedup.toFixed(1) }}x faster
              </Badge>
            </div>

            <div class="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div class="text-gray-600 dark:text-gray-400">Transformer</div>
                <div class="font-medium">{{ (metrics.avgTransformerTime / 1000).toFixed(2) }}s</div>
              </div>
              <div>
                <div class="text-gray-600 dark:text-gray-400">Ollama</div>
                <div class="font-medium">{{ (metrics.avgOllamaTime / 1000).toFixed(2) }}s</div>
              </div>

              <!-- Quality Metrics -->
              <div v-if="task === 'ner' && metrics.avgEntityOverlap !== undefined" class="col-span-2 mt-2 pt-2 border-t dark:border-gray-700">
                <div class="text-gray-600 dark:text-gray-400">Entity Overlap</div>
                <div class="font-medium">{{ metrics.avgEntityOverlap.toFixed(1) }}%</div>
              </div>

              <div v-if="task === 'sentiment' && metrics.toneAgreementPercent !== undefined" class="col-span-2 mt-2 pt-2 border-t dark:border-gray-700">
                <div class="text-gray-600 dark:text-gray-400">Tone Agreement</div>
                <div class="font-medium">{{ metrics.toneAgreementPercent.toFixed(1) }}%</div>
              </div>

              <div v-if="task === 'keywords' && metrics.avgKeywordOverlap !== undefined" class="col-span-2 mt-2 pt-2 border-t dark:border-gray-700">
                <div class="text-gray-600 dark:text-gray-400">Keyword Overlap</div>
                <div class="font-medium">{{ metrics.avgKeywordOverlap.toFixed(1) }}%</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sample Results -->
        <div>
          <h3 class="text-lg font-semibold mb-3">Sample Results (First 3 Articles)</h3>
          <div class="space-y-4">
            <div
              v-for="result in results.results.slice(0, 3)"
              :key="result.articleId"
              class="border rounded-lg p-4 dark:border-gray-700"
            >
              <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                  <h4 class="font-medium text-sm">{{ result.title.substring(0, 100) }}...</h4>
                  <div class="text-xs text-gray-500 mt-1">Article #{{ result.articleId }}</div>
                </div>
                <Badge color="blue">
                  {{ result.totalSpeedup.toFixed(1) }}x
                </Badge>
              </div>

              <div class="space-y-2 text-sm">
                <div v-for="task in result.tasks" :key="task.task">
                  <div class="flex justify-between">
                    <span class="text-gray-600 dark:text-gray-400 capitalize">{{ formatTaskName(task.task) }}</span>
                    <span class="font-medium">
                      {{ task.transformerTime }}ms vs {{ task.ollamaTime }}ms
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Cost Estimate -->
        <div class="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
          <h3 class="font-semibold mb-2">Cost Estimate (RunPod GPU)</h3>
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div class="text-gray-600 dark:text-gray-400">Ollama (GPU)</div>
              <div class="text-lg font-bold text-purple-600">
                ${{ calculateCost(results.aggregateMetrics.totalOllamaTime) }}
              </div>
            </div>
            <div>
              <div class="text-gray-600 dark:text-gray-400">Transformers (CPU)</div>
              <div class="text-lg font-bold text-green-600">$0.00</div>
            </div>
          </div>
          <div class="mt-2 text-xs text-gray-500">
            Based on $0.40/hour for RTX 4090
          </div>
        </div>

        <!-- Recommendations -->
        <div class="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
          <h3 class="font-semibold mb-2">Recommendations</h3>
          <ul class="space-y-2 text-sm">
            <li v-if="shouldRecommend('ner')" class="flex items-start">
              <span class="text-green-600 mr-2">✅</span>
              <span>NER: Switch to Transformers.js ({{ results.taskMetrics.ner?.avgSpeedup.toFixed(1) }}x faster)</span>
            </li>
            <li v-if="shouldRecommend('sentiment')" class="flex items-start">
              <span class="text-green-600 mr-2">✅</span>
              <span>Sentiment: Switch to Transformers.js ({{ results.taskMetrics.sentiment?.avgSpeedup.toFixed(1) }}x faster)</span>
            </li>
            <li v-if="shouldRecommend('keywords')" class="flex items-start">
              <span class="text-green-600 mr-2">✅</span>
              <span>Keywords: Switch to Transformers.js ({{ results.taskMetrics.keywords?.avgSpeedup.toFixed(1) }}x faster)</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Error State -->
      <div v-if="error" class="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
        <div class="text-red-600 font-medium">Error</div>
        <div class="text-sm mt-1">{{ error }}</div>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const numArticles = ref(10);
const selectedTasks = ref(['ner', 'sentiment', 'keywords']);
const loading = ref(false);
const results = ref<any>(null);
const error = ref('');

const runComparison = async () => {
  loading.value = true;
  error.value = '';
  results.value = null;

  try {
    const response = await $fetch('/api/admin/compare-models', {
      method: 'POST',
      body: {
        numArticles: numArticles.value,
        tasks: selectedTasks.value,
      },
    });

    if (response.success) {
      results.value = response;
    } else {
      error.value = response.error || 'Comparison failed';
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to run comparison';
    console.error('Comparison error:', err);
  } finally {
    loading.value = false;
  }
};

const formatTaskName = (task: string) => {
  const names: Record<string, string> = {
    ner: 'Named Entity Recognition',
    sentiment: 'Sentiment Analysis',
    keywords: 'Keyword Extraction',
  };
  return names[task] || task;
};

const getSpeedupColor = (speedup: number) => {
  if (speedup >= 10) return 'green';
  if (speedup >= 5) return 'blue';
  if (speedup >= 2) return 'yellow';
  return 'gray';
};

const calculateCost = (timeMs: number) => {
  const hours = timeMs / 1000 / 3600;
  const costPerHour = 0.40; // RTX 4090
  return (hours * costPerHour).toFixed(4);
};

const shouldRecommend = (task: string) => {
  if (!results.value?.taskMetrics?.[task]) return false;

  const metrics = results.value.taskMetrics[task];

  // Recommend if speedup >= 5x and quality overlap >= 60%
  if (task === 'ner') {
    return metrics.avgSpeedup >= 5 && metrics.avgEntityOverlap >= 60;
  } else if (task === 'sentiment') {
    return metrics.avgSpeedup >= 5 && metrics.toneAgreementPercent >= 70;
  } else if (task === 'keywords') {
    return metrics.avgSpeedup >= 5 && metrics.avgKeywordOverlap >= 50;
  }

  return false;
};
</script>
