import { getDatabase } from '../../database/db.js';
import { articles } from '../../database/schema.js';
import { desc, isNotNull, sql, and } from 'drizzle-orm';

// Import comparison functions
import { compareNERMethods } from '../../services/nerTransformer.js';
import { compareSentimentMethods } from '../../services/sentimentTransformer.js';
import { compareKeywordMethods } from '../../services/keywordTransformer.js';

// Import Ollama services
import { extractEntities } from '../../services/entityExtractor.js';
import { analyzeSentiment } from '../../services/sentimentAnalyzer.js';
import { extractKeywords } from '../../services/keywordExtractor.js';

// Import transformer utilities
import { preloadModels, MODELS } from '../../services/transformerService.js';

interface ComparisonRequest {
  numArticles?: number;
  articleIds?: number[];
  tasks?: Array<'ner' | 'sentiment' | 'keywords'>;
}

interface TaskComparison {
  task: string;
  transformerTime: number;
  ollamaTime: number;
  speedup: number;
  qualityMetrics: any;
}

interface ArticleComparison {
  articleId: number;
  title: string;
  tasks: TaskComparison[];
  totalTransformerTime: number;
  totalOllamaTime: number;
  totalSpeedup: number;
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<ComparisonRequest>(event);

    const numArticles = body.numArticles || 5;
    const articleIds = body.articleIds || [];
    const tasks = body.tasks || ['ner', 'sentiment', 'keywords'];

    console.log(`[Compare Models API] Starting comparison for ${numArticles} articles...`);

    // Preload transformer models
    console.log('[Compare Models API] Preloading transformer models...');
    await preloadModels([MODELS.NER, MODELS.SENTIMENT]);

    // Fetch articles
    const db = getDatabase();
    let testArticles;

    if (articleIds.length > 0) {
      // Fetch specific articles
      testArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          content: articles.content,
        })
        .from(articles)
        .where(sql`${articles.id} IN (${sql.join(articleIds.map(id => sql`${id}`), sql`, `)})`)
        .limit(50); // Safety limit
    } else {
      // Fetch recent articles
      testArticles = await db
        .select({
          id: articles.id,
          title: articles.title,
          content: articles.content,
        })
        .from(articles)
        .where(
          and(
            isNotNull(articles.content),
            sql`LENGTH(${articles.content}) > 500`
          )
        )
        .orderBy(desc(articles.id))
        .limit(Math.min(numArticles, 50)); // Max 50 articles
    }

    if (testArticles.length === 0) {
      return {
        success: false,
        error: 'No articles found for comparison',
      };
    }

    console.log(`[Compare Models API] Comparing ${testArticles.length} articles...`);

    // Process each article
    const results: ArticleComparison[] = [];

    for (const article of testArticles) {
      const title = article.title || '';
      const content = article.content || '';

      console.log(`[Compare Models API] Processing article ${article.id}...`);

      const taskResults: TaskComparison[] = [];
      let totalTransformerTime = 0;
      let totalOllamaTime = 0;

      // Run NER comparison
      if (tasks.includes('ner')) {
        try {
          const nerResult = await compareNERMethods(title, content, extractEntities);

          taskResults.push({
            task: 'ner',
            transformerTime: nerResult.transformerTime,
            ollamaTime: nerResult.ollamaTime,
            speedup: nerResult.speedup,
            qualityMetrics: {
              entityOverlap: nerResult.entityOverlap,
              transformerEntities: nerResult.transformer.entities,
              ollamaEntities: nerResult.ollama.entities,
              uniqueToTransformer: nerResult.uniqueToTransformer,
              uniqueToOllama: nerResult.uniqueToOllama,
            },
          });

          totalTransformerTime += nerResult.transformerTime;
          totalOllamaTime += nerResult.ollamaTime;
        } catch (error) {
          console.error(`[Compare Models API] NER comparison failed for article ${article.id}:`, error);
        }
      }

      // Run sentiment comparison
      if (tasks.includes('sentiment')) {
        try {
          const sentimentResult = await compareSentimentMethods(title, content, analyzeSentiment);

          taskResults.push({
            task: 'sentiment',
            transformerTime: sentimentResult.transformerTime,
            ollamaTime: sentimentResult.ollamaTime,
            speedup: sentimentResult.speedup,
            qualityMetrics: {
              toneMatch: sentimentResult.toneMatch,
              sentimentDifference: sentimentResult.sentimentDifference,
              transformerSentiment: sentimentResult.transformer,
              ollamaSentiment: sentimentResult.ollama,
            },
          });

          totalTransformerTime += sentimentResult.transformerTime;
          totalOllamaTime += sentimentResult.ollamaTime;
        } catch (error) {
          console.error(`[Compare Models API] Sentiment comparison failed for article ${article.id}:`, error);
        }
      }

      // Run keyword comparison
      if (tasks.includes('keywords')) {
        try {
          const keywordResult = await compareKeywordMethods(title, content, extractKeywords);

          taskResults.push({
            task: 'keywords',
            transformerTime: keywordResult.transformerTime,
            ollamaTime: keywordResult.ollamaTime,
            speedup: keywordResult.speedup,
            qualityMetrics: {
              keywordOverlap: keywordResult.keywordOverlap,
              transformerKeywords: keywordResult.transformer.keywords,
              ollamaKeywords: keywordResult.ollama.keywords,
              uniqueToTransformer: keywordResult.uniqueToTransformer,
              uniqueToOllama: keywordResult.uniqueToOllama,
            },
          });

          totalTransformerTime += keywordResult.transformerTime;
          totalOllamaTime += keywordResult.ollamaTime;
        } catch (error) {
          console.error(`[Compare Models API] Keyword comparison failed for article ${article.id}:`, error);
        }
      }

      results.push({
        articleId: article.id,
        title,
        tasks: taskResults,
        totalTransformerTime,
        totalOllamaTime,
        totalSpeedup: totalOllamaTime / totalTransformerTime,
      });
    }

    // Calculate aggregate metrics
    const aggregateMetrics = {
      totalArticles: results.length,
      avgTransformerTime: results.reduce((sum, r) => sum + r.totalTransformerTime, 0) / results.length,
      avgOllamaTime: results.reduce((sum, r) => sum + r.totalOllamaTime, 0) / results.length,
      avgSpeedup: results.reduce((sum, r) => sum + r.totalSpeedup, 0) / results.length,
      totalTransformerTime: results.reduce((sum, r) => sum + r.totalTransformerTime, 0),
      totalOllamaTime: results.reduce((sum, r) => sum + r.totalOllamaTime, 0),
    };

    // Calculate task-specific metrics
    const taskMetrics: Record<string, any> = {};

    for (const task of tasks) {
      const taskResults = results.flatMap(r => r.tasks.filter(t => t.task === task));

      if (taskResults.length > 0) {
        const avgSpeedup = taskResults.reduce((sum, t) => sum + t.speedup, 0) / taskResults.length;
        const avgTransformerTime = taskResults.reduce((sum, t) => sum + t.transformerTime, 0) / taskResults.length;
        const avgOllamaTime = taskResults.reduce((sum, t) => sum + t.ollamaTime, 0) / taskResults.length;

        taskMetrics[task] = {
          avgSpeedup,
          avgTransformerTime,
          avgOllamaTime,
        };

        // Add task-specific quality metrics
        if (task === 'ner') {
          const avgEntityOverlap = taskResults.reduce((sum, t) => sum + (t.qualityMetrics.entityOverlap || 0), 0) / taskResults.length;
          taskMetrics[task].avgEntityOverlap = avgEntityOverlap;
        } else if (task === 'sentiment') {
          const toneMatchCount = taskResults.filter(t => t.qualityMetrics.toneMatch).length;
          taskMetrics[task].toneAgreementPercent = (toneMatchCount / taskResults.length) * 100;
          const avgSentimentDiff = taskResults.reduce((sum, t) => sum + (t.qualityMetrics.sentimentDifference || 0), 0) / taskResults.length;
          taskMetrics[task].avgSentimentDifference = avgSentimentDiff;
        } else if (task === 'keywords') {
          const avgKeywordOverlap = taskResults.reduce((sum, t) => sum + (t.qualityMetrics.keywordOverlap || 0), 0) / taskResults.length;
          taskMetrics[task].avgKeywordOverlap = avgKeywordOverlap;
        }
      }
    }

    console.log(`[Compare Models API] Comparison complete!`);

    return {
      success: true,
      results,
      aggregateMetrics,
      taskMetrics,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Compare Models API] Error:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});
