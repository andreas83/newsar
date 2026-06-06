import { pipeline, env } from '@xenova/transformers';
import { join } from 'path';

// Configure Transformers.js
env.allowLocalModels = false; // Use HuggingFace Hub
env.useBrowserCache = false; // Use file system cache for Node.js

// Set cache directory to avoid re-downloading models
const CACHE_DIR = join(process.cwd(), '.cache', 'transformers');
env.cacheDir = CACHE_DIR;

/**
 * Model cache to store loaded pipelines
 */
const modelCache = new Map<string, any>();

/**
 * Model loading states to prevent duplicate loading
 */
const loadingPromises = new Map<string, Promise<any>>();

/**
 * Available model configurations
 */
export const MODELS = {
  NER: 'Xenova/bert-base-NER',
  SENTIMENT: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  SENTIMENT_MULTILINGUAL: 'Xenova/bert-base-multilingual-uncased-sentiment',
  SUMMARIZATION: 'Xenova/distilbart-cnn-6-6',
  EMBEDDINGS: 'Xenova/all-MiniLM-L6-v2', // Fallback embeddings model
} as const;

/**
 * Pipeline types for transformers.js
 */
export type PipelineType =
  | 'token-classification'  // For NER
  | 'sentiment-analysis'    // For sentiment
  | 'summarization'         // For summarization
  | 'feature-extraction'    // For embeddings
  | 'text-classification';  // For classification tasks

/**
 * Get or load a model pipeline with caching
 */
export async function getModelPipeline(
  task: PipelineType,
  modelName: string,
  options: any = {}
): Promise<any> {
  const cacheKey = `${task}:${modelName}`;

  // Return cached model if available
  if (modelCache.has(cacheKey)) {
    return modelCache.get(cacheKey);
  }

  // Wait for existing loading promise if model is being loaded
  if (loadingPromises.has(cacheKey)) {
    return loadingPromises.get(cacheKey);
  }

  // Start loading the model
  const loadingPromise = (async () => {
    try {
      console.log(`[TransformerService] Loading model: ${modelName} (${task})`);
      const startTime = Date.now();

      const modelPipeline = await pipeline(task, modelName, {
        ...options,
        cache_dir: CACHE_DIR,
      });

      const loadTime = Date.now() - startTime;
      console.log(`[TransformerService] Model loaded: ${modelName} (${loadTime}ms)`);

      // Cache the loaded model
      modelCache.set(cacheKey, modelPipeline);
      loadingPromises.delete(cacheKey);

      return modelPipeline;
    } catch (error) {
      console.error(`[TransformerService] Failed to load model ${modelName}:`, error);
      loadingPromises.delete(cacheKey);
      throw error;
    }
  })();

  loadingPromises.set(cacheKey, loadingPromise);
  return loadingPromise;
}

/**
 * Clear model cache to free memory
 */
export function clearModelCache(): void {
  console.log(`[TransformerService] Clearing model cache (${modelCache.size} models)`);
  modelCache.clear();
  loadingPromises.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    cachedModels: Array.from(modelCache.keys()),
    loadingModels: Array.from(loadingPromises.keys()),
    cacheSize: modelCache.size,
    cacheDir: CACHE_DIR,
  };
}

/**
 * Preload commonly used models for faster first request
 */
export async function preloadModels(modelNames: string[] = []) {
  console.log('[TransformerService] Preloading models:', modelNames);

  const tasks = modelNames.map(async (modelName) => {
    try {
      let task: PipelineType;

      // Determine task type based on model name
      if (modelName.includes('NER')) {
        task = 'token-classification';
      } else if (modelName.includes('sentiment')) {
        task = 'sentiment-analysis';
      } else if (modelName.includes('bart') || modelName.includes('pegasus') || modelName.includes('t5')) {
        task = 'summarization';
      } else if (modelName.includes('MiniLM') || modelName.includes('embed')) {
        task = 'feature-extraction';
      } else {
        task = 'text-classification';
      }

      await getModelPipeline(task, modelName);
    } catch (error) {
      console.error(`[TransformerService] Failed to preload ${modelName}:`, error);
    }
  });

  await Promise.allSettled(tasks);
  console.log('[TransformerService] Preloading complete');
}

/**
 * Model performance metrics
 */
interface ModelMetrics {
  modelName: string;
  totalInferences: number;
  totalTime: number;
  averageTime: number;
  lastUsed: Date;
}

const metrics = new Map<string, ModelMetrics>();

/**
 * Record model inference metrics
 */
export function recordInference(modelName: string, inferenceTime: number): void {
  const existing = metrics.get(modelName);

  if (existing) {
    existing.totalInferences++;
    existing.totalTime += inferenceTime;
    existing.averageTime = existing.totalTime / existing.totalInferences;
    existing.lastUsed = new Date();
  } else {
    metrics.set(modelName, {
      modelName,
      totalInferences: 1,
      totalTime: inferenceTime,
      averageTime: inferenceTime,
      lastUsed: new Date(),
    });
  }
}

/**
 * Get model performance metrics
 */
export function getModelMetrics(): ModelMetrics[] {
  return Array.from(metrics.values());
}

/**
 * Reset metrics
 */
export function resetMetrics(): void {
  metrics.clear();
}
