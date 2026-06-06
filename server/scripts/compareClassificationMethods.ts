#!/usr/bin/env node

/**
 * Compare classification methods: Ollama vs Transformers.js
 *
 * This script processes N articles using both methods and generates
 * a detailed comparison report including:
 * - Performance metrics (time, memory, cost)
 * - Quality comparison (overlap, unique findings)
 * - Side-by-side results for manual review
 *
 * Usage:
 *   npm run compare:methods [numArticles] [--save]
 *   npm run compare:methods 50 --save
 */

// Load environment variables first
import { config } from 'dotenv';
config();

import { getDatabase } from '../database/db.js';
import { articles } from '../database/schema.js';
import { desc, eq, and, isNotNull, sql } from 'drizzle-orm';

// Import Ollama services
import { extractEntities } from '../services/entityExtractor.js';
import { analyzeSentiment } from '../services/sentimentAnalyzer.js';
import { extractKeywords } from '../services/keywordExtractor.js';

// Import Transformer services
import { compareNERMethods } from '../services/nerTransformer.js';
import { compareSentimentMethods } from '../services/sentimentTransformer.js';
import { compareKeywordMethods } from '../services/keywordTransformer.js';
import { preloadModels, MODELS, getModelMetrics, getCacheStats } from '../services/transformerService.js';

interface ArticleData {
  id: number;
  title: string;
  content: string;
  publishedAt: Date;
}

interface ComparisonResult {
  articleId: number;
  title: string;
  ner: any;
  sentiment: any;
  keywords: any;
}

interface AggregateMetrics {
  totalArticles: number;
  avgTransformerTime: number;
  avgOllamaTime: number;
  totalTransformerTime: number;
  totalOllamaTime: number;
  avgSpeedup: number;
  nerOverlap: number;
  sentimentAgreement: number;
  keywordOverlap: number;
}

/**
 * Fetch recent articles for testing
 */
async function fetchTestArticles(limit: number): Promise<ArticleData[]> {
  const db = getDatabase();

  const results = await db
    .select({
      id: articles.id,
      title: articles.title,
      content: articles.content,
      createdAt: articles.createdAt,
    })
    .from(articles)
    .where(
      and(
        isNotNull(articles.content),
        sql`LENGTH(${articles.content}) > 500`
      )
    )
    .orderBy(desc(articles.id))
    .limit(limit);

  return results.map(r => ({
    id: r.id,
    title: r.title || '',
    content: r.content || '',
    publishedAt: r.createdAt,
  }));
}

/**
 * Compare classification methods for a single article
 */
async function compareArticle(article: ArticleData): Promise<ComparisonResult> {
  console.log(`\n[Article ${article.id}] ${article.title.substring(0, 80)}...`);

  try {
    // Run comparisons in parallel
    const [nerResult, sentimentResult, keywordResult] = await Promise.all([
      compareNERMethods(article.title, article.content, extractEntities),
      compareSentimentMethods(article.title, article.content, analyzeSentiment),
      compareKeywordMethods(article.title, article.content, extractKeywords),
    ]);

    // Log summary
    console.log(`  NER: ${nerResult.transformerTime}ms (Transformer) vs ${nerResult.ollamaTime}ms (Ollama) = ${nerResult.speedup.toFixed(1)}x speedup`);
    console.log(`  Sentiment: ${sentimentResult.transformerTime}ms vs ${sentimentResult.ollamaTime}ms = ${sentimentResult.speedup.toFixed(1)}x speedup`);
    console.log(`  Keywords: ${keywordResult.transformerTime}ms vs ${keywordResult.ollamaTime}ms = ${keywordResult.speedup.toFixed(1)}x speedup`);
    console.log(`  Entity overlap: ${nerResult.entityOverlap.toFixed(1)}%`);
    console.log(`  Sentiment match: ${sentimentResult.toneMatch ? 'YES' : 'NO'} (diff: ${sentimentResult.sentimentDifference.toFixed(2)})`);
    console.log(`  Keyword overlap: ${keywordResult.keywordOverlap.toFixed(1)}%`);

    return {
      articleId: article.id,
      title: article.title,
      ner: nerResult,
      sentiment: sentimentResult,
      keywords: keywordResult,
    };
  } catch (error) {
    console.error(`  ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

/**
 * Calculate aggregate metrics from comparison results
 */
function calculateAggregateMetrics(results: ComparisonResult[]): AggregateMetrics {
  const totalArticles = results.length;

  // Calculate time metrics
  let totalTransformerTime = 0;
  let totalOllamaTime = 0;
  let totalSpeedup = 0;

  for (const result of results) {
    totalTransformerTime += result.ner.transformerTime + result.sentiment.transformerTime + result.keywords.transformerTime;
    totalOllamaTime += result.ner.ollamaTime + result.sentiment.ollamaTime + result.keywords.ollamaTime;
    totalSpeedup += result.ner.speedup + result.sentiment.speedup + result.keywords.speedup;
  }

  const avgTransformerTime = totalTransformerTime / totalArticles;
  const avgOllamaTime = totalOllamaTime / totalArticles;
  const avgSpeedup = totalSpeedup / (totalArticles * 3); // 3 tasks per article

  // Calculate quality metrics
  const nerOverlap = results.reduce((sum, r) => sum + r.ner.entityOverlap, 0) / totalArticles;
  const sentimentAgreement = results.filter(r => r.sentiment.toneMatch).length / totalArticles * 100;
  const keywordOverlap = results.reduce((sum, r) => sum + r.keywords.keywordOverlap, 0) / totalArticles;

  return {
    totalArticles,
    avgTransformerTime,
    avgOllamaTime,
    totalTransformerTime,
    totalOllamaTime,
    avgSpeedup,
    nerOverlap,
    sentimentAgreement,
    keywordOverlap,
  };
}

/**
 * Generate detailed comparison report
 */
function generateReport(results: ComparisonResult[], metrics: AggregateMetrics): string {
  let report = '\n' + '='.repeat(80) + '\n';
  report += 'CLASSIFICATION METHOD COMPARISON: Ollama vs Transformers.js\n';
  report += '='.repeat(80) + '\n\n';

  // Overview
  report += '## OVERVIEW\n\n';
  report += `Total Articles Analyzed: ${metrics.totalArticles}\n`;
  report += `Test Date: ${new Date().toISOString()}\n\n`;

  // Performance Metrics
  report += '## PERFORMANCE METRICS\n\n';
  report += `Average Time per Article:\n`;
  report += `  - Transformers.js: ${(metrics.avgTransformerTime / 1000).toFixed(1)}s\n`;
  report += `  - Ollama:          ${(metrics.avgOllamaTime / 1000).toFixed(1)}s\n`;
  report += `  - Speedup:         ${metrics.avgSpeedup.toFixed(1)}x faster\n\n`;

  report += `Total Time for ${metrics.totalArticles} Articles:\n`;
  report += `  - Transformers.js: ${(metrics.totalTransformerTime / 1000 / 60).toFixed(1)} minutes\n`;
  report += `  - Ollama:          ${(metrics.totalOllamaTime / 1000 / 60).toFixed(1)} minutes\n`;
  report += `  - Time Saved:      ${((metrics.totalOllamaTime - metrics.totalTransformerTime) / 1000 / 60).toFixed(1)} minutes\n\n`;

  // Cost Estimate
  const runpodCostPerHour = 0.40; // $0.40/hour for RTX 4090
  const ollamaCost = (metrics.totalOllamaTime / 1000 / 3600) * runpodCostPerHour;
  const transformerCost = 0; // CPU-based, no GPU cost
  report += `RunPod GPU Cost Estimate:\n`;
  report += `  - Ollama (GPU):    $${ollamaCost.toFixed(4)}\n`;
  report += `  - Transformers (CPU): $${transformerCost.toFixed(4)}\n`;
  report += `  - Savings:         $${ollamaCost.toFixed(4)} (${((1 - transformerCost / ollamaCost) * 100).toFixed(0)}%)\n\n`;

  // Quality Metrics
  report += '## QUALITY METRICS\n\n';
  report += `Named Entity Recognition (NER):\n`;
  report += `  - Entity Overlap:  ${metrics.nerOverlap.toFixed(1)}%\n`;
  report += `  - Interpretation:  ${metrics.nerOverlap >= 70 ? 'High agreement' : metrics.nerOverlap >= 50 ? 'Moderate agreement' : 'Low agreement'}\n\n`;

  report += `Sentiment Analysis:\n`;
  report += `  - Tone Agreement:  ${metrics.sentimentAgreement.toFixed(1)}%\n`;
  report += `  - Interpretation:  ${metrics.sentimentAgreement >= 80 ? 'High agreement' : metrics.sentimentAgreement >= 60 ? 'Moderate agreement' : 'Low agreement'}\n\n`;

  report += `Keyword Extraction:\n`;
  report += `  - Keyword Overlap: ${metrics.keywordOverlap.toFixed(1)}%\n`;
  report += `  - Interpretation:  ${metrics.keywordOverlap >= 60 ? 'High agreement' : metrics.keywordOverlap >= 40 ? 'Moderate agreement' : 'Low agreement'}\n\n`;

  // Recommendations
  report += '## RECOMMENDATIONS\n\n';

  if (metrics.avgSpeedup >= 5 && metrics.nerOverlap >= 60) {
    report += '✅ NER: RECOMMEND switching to Transformers.js\n';
    report += `   - ${metrics.avgSpeedup.toFixed(1)}x faster with ${metrics.nerOverlap.toFixed(0)}% accuracy overlap\n\n`;
  } else {
    report += '⚠️  NER: Consider keeping Ollama for now\n';
    report += `   - Review sample outputs for quality differences\n\n`;
  }

  if (metrics.avgSpeedup >= 10 && metrics.sentimentAgreement >= 70) {
    report += '✅ Sentiment: RECOMMEND switching to Transformers.js\n';
    report += `   - ${metrics.avgSpeedup.toFixed(1)}x faster with ${metrics.sentimentAgreement.toFixed(0)}% agreement\n\n`;
  } else {
    report += '⚠️  Sentiment: Consider keeping Ollama for now\n';
    report += `   - Review sentiment reasoning quality\n\n`;
  }

  if (metrics.avgSpeedup >= 5 && metrics.keywordOverlap >= 50) {
    report += '✅ Keywords: RECOMMEND switching to Transformers.js\n';
    report += `   - ${metrics.avgSpeedup.toFixed(1)}x faster with ${metrics.keywordOverlap.toFixed(0)}% overlap\n\n`;
  } else {
    report += '⚠️  Keywords: Consider keeping Ollama for now\n';
    report += `   - Review keyword relevance and categorization\n\n`;
  }

  // Model Cache Stats
  const cacheStats = getCacheStats();
  report += '## MODEL CACHE STATS\n\n';
  report += `Cached Models: ${cacheStats.cacheSize}\n`;
  report += `Models: ${cacheStats.cachedModels.join(', ')}\n`;
  report += `Cache Directory: ${cacheStats.cacheDir}\n\n`;

  // Detailed Results Sample
  report += '## SAMPLE RESULTS (First 3 Articles)\n\n';
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const result = results[i];
    report += `-`.repeat(80) + '\n';
    report += `Article ${result.articleId}: ${result.title.substring(0, 70)}...\n\n`;

    report += `NER Entities:\n`;
    report += `  Transformer: ${result.ner.transformer.entities.map((e: any) => e.name).join(', ')}\n`;
    report += `  Ollama:      ${result.ner.ollama.entities.map((e: any) => e.name).join(', ')}\n\n`;

    report += `Sentiment:\n`;
    report += `  Transformer: ${result.sentiment.transformer.sentiment.toFixed(2)} (${result.sentiment.transformer.tone})\n`;
    report += `  Ollama:      ${result.sentiment.ollama.sentiment.toFixed(2)} (${result.sentiment.ollama.tone})\n\n`;

    report += `Keywords:\n`;
    report += `  Transformer: ${result.keywords.transformer.keywords.map((k: any) => k.keyword).join(', ')}\n`;
    report += `  Ollama:      ${result.keywords.ollama.keywords.map((k: any) => k.keyword).join(', ')}\n\n`;
  }

  report += '='.repeat(80) + '\n';

  return report;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const numArticles = parseInt(args[0]) || 10;
  const saveToFile = args.includes('--save');
  const skipOllama = args.includes('--skip-ollama');

  console.log('='.repeat(80));
  console.log('CLASSIFICATION METHOD COMPARISON');
  console.log('='.repeat(80));
  console.log(`Testing ${numArticles} articles...`);
  if (skipOllama) {
    console.log(`Testing Transformers.js only (Ollama skipped)\n`);
  } else {
    console.log(`Comparing Ollama vs Transformers.js for NER, Sentiment, and Keywords\n`);
  }

  // Preload transformer models
  console.log('Preloading transformer models...');
  await preloadModels([
    MODELS.NER,
    MODELS.SENTIMENT,
  ]);
  console.log('Models loaded!\n');

  // Fetch test articles
  console.log(`Fetching ${numArticles} recent articles...`);
  const articles = await fetchTestArticles(numArticles);
  console.log(`Found ${articles.length} articles\n`);

  if (articles.length === 0) {
    console.error('No articles found for testing!');
    process.exit(1);
  }

  // Process articles
  console.log('Processing articles...');
  const results: ComparisonResult[] = [];

  for (const article of articles) {
    try {
      const result = await compareArticle(article);
      results.push(result);
    } catch (error) {
      console.error(`Failed to process article ${article.id}:`, error);
      // Continue with remaining articles
    }
  }

  // Calculate aggregate metrics
  const metrics = calculateAggregateMetrics(results);

  // Generate report
  const report = generateReport(results, metrics);

  // Print report
  console.log(report);

  // Save to file if requested
  if (saveToFile) {
    const fs = await import('fs/promises');
    const filename = `comparison-report-${Date.now()}.txt`;
    await fs.writeFile(filename, report);
    console.log(`\n📄 Report saved to: ${filename}`);
  }

  // Print model metrics
  console.log('\n## TRANSFORMER MODEL METRICS\n');
  const modelMetrics = getModelMetrics();
  for (const metric of modelMetrics) {
    console.log(`${metric.modelName}:`);
    console.log(`  - Total inferences: ${metric.totalInferences}`);
    console.log(`  - Average time: ${metric.averageTime.toFixed(0)}ms`);
    console.log(`  - Total time: ${(metric.totalTime / 1000).toFixed(1)}s`);
    console.log();
  }

  process.exit(0);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, fetchTestArticles, compareArticle, calculateAggregateMetrics };
