import { getModelPipeline, recordInference } from './transformerService.js';
import type { SummaryResult } from './summaryGenerator.js';

/**
 * Pegasus model for news summarization
 * Using smaller distilled version for faster inference on CPU
 */
const SUMMARIZATION_MODEL = 'Xenova/distilbart-cnn-6-6';

/**
 * Summary length configurations
 */
const SUMMARY_CONFIGS = {
  short: {
    minLength: 40,
    maxLength: 80,
    targetWords: '50-80 words',
  },
  medium: {
    minLength: 80,
    maxLength: 150,
    targetWords: '100-150 words',
  },
  long: {
    minLength: 150,
    maxLength: 300,
    targetWords: '200-300 words',
  },
};

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}

/**
 * Truncate text to fit model's max input length
 */
function truncateText(text: string, maxTokens: number = 1024): string {
  // Rough estimate: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {
    return text;
  }
  return text.substring(0, maxChars);
}

/**
 * Generate summary using Transformers.js BART model
 */
export async function generateSummaryWithTransformer(
  title: string,
  content: string,
  length: 'short' | 'medium' | 'long' = 'medium'
): Promise<SummaryResult> {
  try {
    const startTime = Date.now();

    // Load summarization model
    const summarizer = await getModelPipeline(
      'summarization',
      SUMMARIZATION_MODEL
    );

    // Prepare text (combine title and content)
    const fullText = `${title}\n\n${content}`;
    const truncatedText = truncateText(fullText, 1024);

    // Get config for desired length
    const config = SUMMARY_CONFIGS[length];

    // Generate summary
    const result = await summarizer(truncatedText, {
      min_length: config.minLength,
      max_length: config.maxLength,
      do_sample: false, // Use greedy decoding for consistency
    });

    // Extract summary text
    const summaryText = Array.isArray(result)
      ? result[0].summary_text
      : result.summary_text;

    const wordCount = countWords(summaryText);
    const inferenceTime = Date.now() - startTime;

    recordInference(SUMMARIZATION_MODEL, inferenceTime);

    console.log(
      `[Summary Transformer] Generated ${length} summary (${wordCount} words) in ${inferenceTime}ms`
    );

    return {
      summary: summaryText,
      wordCount,
      length,
      success: true,
    };
  } catch (error) {
    console.error('[Summary Transformer] Error generating summary:', error);

    return {
      summary: '',
      wordCount: 0,
      length,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate all three summary lengths in parallel
 */
export async function generateAllSummariesWithTransformer(
  title: string,
  content: string
): Promise<{
  short: SummaryResult;
  medium: SummaryResult;
  long: SummaryResult;
}> {
  const startTime = Date.now();

  // Generate all three lengths in parallel
  const [shortResult, mediumResult, longResult] = await Promise.all([
    generateSummaryWithTransformer(title, content, 'short'),
    generateSummaryWithTransformer(title, content, 'medium'),
    generateSummaryWithTransformer(title, content, 'long'),
  ]);

  const totalTime = Date.now() - startTime;

  console.log(
    `[Summary Transformer] Generated all 3 summaries in ${totalTime}ms`
  );

  return {
    short: shortResult,
    medium: mediumResult,
    long: longResult,
  };
}

/**
 * Compare summary generation: Transformer vs Ollama
 */
export interface SummaryComparison {
  transformer: SummaryResult;
  ollama: SummaryResult;
  transformerTime: number;
  ollamaTime: number;
  speedup: number;
  qualityMetrics: {
    transformerWordCount: number;
    ollamaWordCount: number;
    wordCountDiff: number;
  };
}

export async function compareSummaryMethods(
  title: string,
  content: string,
  length: 'short' | 'medium' | 'long',
  ollamaSummarizer: (
    title: string,
    content: string,
    length: 'short' | 'medium' | 'long'
  ) => Promise<SummaryResult>
): Promise<SummaryComparison> {
  // Run both methods in parallel
  const [transformerResult, ollamaResult] = await Promise.all([
    (async () => {
      const start = Date.now();
      const result = await generateSummaryWithTransformer(title, content, length);
      return { result, time: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const result = await ollamaSummarizer(title, content, length);
      return { result, time: Date.now() - start };
    })(),
  ]);

  const wordCountDiff = Math.abs(
    transformerResult.result.wordCount - ollamaResult.result.wordCount
  );

  return {
    transformer: transformerResult.result,
    ollama: ollamaResult.result,
    transformerTime: transformerResult.time,
    ollamaTime: ollamaResult.time,
    speedup: ollamaResult.time / transformerResult.time,
    qualityMetrics: {
      transformerWordCount: transformerResult.result.wordCount,
      ollamaWordCount: ollamaResult.result.wordCount,
      wordCountDiff,
    },
  };
}

/**
 * Batch summarization for multiple articles
 */
export async function generateSummariesBatch(
  articles: Array<{ title: string; content: string }>,
  length: 'short' | 'medium' | 'long' = 'medium'
): Promise<SummaryResult[]> {
  try {
    const startTime = Date.now();

    // Load model once
    const summarizer = await getModelPipeline(
      'summarization',
      SUMMARIZATION_MODEL
    );

    // Prepare all texts
    const texts = articles.map(({ title, content }) => {
      const fullText = `${title}\n\n${content}`;
      return truncateText(fullText, 1024);
    });

    // Get config
    const config = SUMMARY_CONFIGS[length];

    // Run batch inference
    const results = await summarizer(texts, {
      min_length: config.minLength,
      max_length: config.maxLength,
      do_sample: false,
    });

    // Process results
    const summaryResults: SummaryResult[] = results.map((result: any) => {
      const summaryText = result.summary_text;
      const wordCount = countWords(summaryText);

      return {
        summary: summaryText,
        wordCount,
        length,
        success: true,
      };
    });

    const inferenceTime = Date.now() - startTime;
    recordInference(SUMMARIZATION_MODEL, inferenceTime);

    console.log(
      `[Summary Batch] Generated ${articles.length} summaries in ${inferenceTime}ms (${(inferenceTime / articles.length).toFixed(0)}ms avg)`
    );

    return summaryResults;
  } catch (error) {
    console.error('[Summary Batch] Error:', error);

    // Return array of failed results
    return articles.map(() => ({
      summary: '',
      wordCount: 0,
      length,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}
