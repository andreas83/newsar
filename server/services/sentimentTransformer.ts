import { getModelPipeline, MODELS, recordInference } from './transformerService.js';
import type { SentimentResult } from './sentimentAnalyzer.js';

/**
 * Emotion keywords for emotion detection
 * Maps sentiment ranges to likely emotions
 */
const EMOTION_MAP = {
  veryNegative: ['devastated', 'outraged', 'fearful', 'horrified', 'despairing'],
  negative: ['concerned', 'worried', 'disappointed', 'frustrated', 'anxious'],
  neutral: ['informative', 'factual', 'analytical'],
  positive: ['hopeful', 'optimistic', 'satisfied', 'encouraged', 'pleased'],
  veryPositive: ['excited', 'jubilant', 'celebratory', 'thrilled', 'overjoyed'],
};

/**
 * Emotion detection keywords in text
 */
const EMOTION_KEYWORDS: Record<string, string[]> = {
  'angry': ['angry', 'outrage', 'furious', 'rage', 'infuriated'],
  'fearful': ['fear', 'afraid', 'scared', 'terror', 'panic', 'anxious', 'worried'],
  'sad': ['sad', 'tragic', 'heartbreaking', 'devastating', 'grief', 'mourning'],
  'hopeful': ['hope', 'optimistic', 'promising', 'potential', 'opportunity'],
  'concerned': ['concern', 'worry', 'uncertain', 'troubling', 'alarming'],
  'excited': ['excited', 'thrilled', 'enthusiastic', 'eager', 'anticipation'],
  'disappointed': ['disappointed', 'let down', 'frustrating', 'setback'],
  'relieved': ['relief', 'reassuring', 'comforting', 'calming'],
  'confused': ['confused', 'uncertain', 'unclear', 'puzzling', 'ambiguous'],
  'surprised': ['surprised', 'shocking', 'unexpected', 'stunning', 'astonishing'],
};

/**
 * Detect emotions from text content
 */
function detectEmotions(text: string, sentiment: number): string[] {
  const emotions: Set<string> = new Set();
  const lowerText = text.toLowerCase();

  // Check for emotion keywords in text
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    if (keywords.some(keyword => lowerText.includes(keyword))) {
      emotions.add(emotion);
    }
  }

  // If no emotions detected from text, infer from sentiment
  if (emotions.size === 0) {
    if (sentiment <= -0.6) {
      emotions.add(EMOTION_MAP.veryNegative[0]);
    } else if (sentiment <= -0.2) {
      emotions.add(EMOTION_MAP.negative[0]);
    } else if (sentiment < 0.2) {
      emotions.add(EMOTION_MAP.neutral[0]);
    } else if (sentiment < 0.6) {
      emotions.add(EMOTION_MAP.positive[0]);
    } else {
      emotions.add(EMOTION_MAP.veryPositive[0]);
    }
  }

  // Return up to 3 emotions
  return Array.from(emotions).slice(0, 3);
}

/**
 * Convert model output to sentiment score (-1 to 1)
 */
function calculateSentimentScore(label: string, score: number): number {
  // DistilBERT outputs: POSITIVE, NEGATIVE, or NEUTRAL (some models)
  // Score is the confidence (0-1)

  let sentiment = 0;

  if (label.includes('POSITIVE') || label.includes('POS')) {
    // Map positive score to 0 to 1 range
    // Higher confidence = more positive
    sentiment = score * 0.7; // Scale to max 0.7 (rarely "very positive" in news)
  } else if (label.includes('NEGATIVE') || label.includes('NEG')) {
    // Map negative score to -1 to 0 range
    sentiment = -score * 0.7; // Scale to min -0.7
  } else {
    // Neutral or unknown
    sentiment = 0;
  }

  // Clamp to -1 to 1
  return Math.max(-1, Math.min(1, sentiment));
}

/**
 * Determine tone from sentiment score
 */
function determineTone(sentiment: number, confidence: number): string {
  // If confidence is low, likely mixed
  if (confidence < 0.6) {
    return 'mixed';
  }

  if (sentiment <= -0.2) {
    return 'negative';
  } else if (sentiment >= 0.2) {
    return 'positive';
  } else {
    return 'neutral';
  }
}

/**
 * Analyze sentiment using Transformers.js DistilBERT model
 */
export async function analyzeSentimentWithTransformer(
  title: string,
  content: string
): Promise<SentimentResult> {
  try {
    const startTime = Date.now();

    // Load sentiment model
    const sentiment = await getModelPipeline(
      'sentiment-analysis',
      MODELS.SENTIMENT
    );

    // Combine title and content (limit to 2500 chars like Ollama version)
    const text = `${title}\n\n${content.substring(0, 2500)}`;

    // Run sentiment analysis
    const result = await sentiment(text);

    // Extract first result (should only be one for the whole text)
    const prediction = Array.isArray(result) ? result[0] : result;

    // Calculate sentiment score
    const sentimentScore = calculateSentimentScore(
      prediction.label,
      prediction.score
    );

    // Determine confidence (use model's score)
    const confidence = Math.max(0, Math.min(1, prediction.score));

    // Determine tone
    const tone = determineTone(sentimentScore, confidence);

    // Detect emotions
    const emotions = detectEmotions(text, sentimentScore);

    const inferenceTime = Date.now() - startTime;
    recordInference(MODELS.SENTIMENT, inferenceTime);

    console.log(
      `[Sentiment Transformer] Analyzed sentiment: ${sentimentScore.toFixed(2)} (${tone}) in ${inferenceTime}ms`
    );

    return {
      sentiment: sentimentScore,
      confidence,
      tone,
      emotions,
      success: true,
    };
  } catch (error) {
    console.error('[Sentiment Transformer] Error analyzing sentiment:', error);

    return {
      sentiment: 0,
      confidence: 0,
      tone: 'neutral',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Enhanced sentiment analysis using multiple models
 * Combines basic sentiment with emotion detection
 */
export async function analyzeSentimentEnhanced(
  title: string,
  content: string
): Promise<SentimentResult> {
  try {
    const startTime = Date.now();

    // Run basic sentiment analysis
    const basicSentiment = await analyzeSentimentWithTransformer(title, content);

    // For now, return basic sentiment
    // In the future, we could add a separate emotion detection model here
    // like 'Xenova/bert-base-multilingual-uncased-sentiment'

    const inferenceTime = Date.now() - startTime;
    console.log(
      `[Sentiment Enhanced] Analysis complete in ${inferenceTime}ms`
    );

    return basicSentiment;
  } catch (error) {
    console.error('[Sentiment Enhanced] Error:', error);

    return {
      sentiment: 0,
      confidence: 0,
      tone: 'neutral',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Compare sentiment results from Transformer vs Ollama
 */
export interface SentimentComparison {
  transformer: SentimentResult;
  ollama: SentimentResult;
  transformerTime: number;
  ollamaTime: number;
  speedup: number;
  sentimentDifference: number; // Absolute difference in sentiment scores
  toneMatch: boolean; // Whether both methods agree on tone
}

export async function compareSentimentMethods(
  title: string,
  content: string,
  ollamaAnalyzer: (title: string, content: string) => Promise<SentimentResult>
): Promise<SentimentComparison> {
  // Run both methods in parallel
  const [transformerResult, ollamaResult] = await Promise.all([
    (async () => {
      const start = Date.now();
      const result = await analyzeSentimentWithTransformer(title, content);
      return { result, time: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const result = await ollamaAnalyzer(title, content);
      return { result, time: Date.now() - start };
    })(),
  ]);

  // Calculate difference
  const sentimentDifference = Math.abs(
    transformerResult.result.sentiment - ollamaResult.result.sentiment
  );

  const toneMatch = transformerResult.result.tone === ollamaResult.result.tone;

  return {
    transformer: transformerResult.result,
    ollama: ollamaResult.result,
    transformerTime: transformerResult.time,
    ollamaTime: ollamaResult.time,
    speedup: ollamaResult.time / transformerResult.time,
    sentimentDifference,
    toneMatch,
  };
}

/**
 * Analyze sentiment of multiple texts in batch (more efficient)
 */
export async function analyzeSentimentBatch(
  texts: Array<{ title: string; content: string }>
): Promise<SentimentResult[]> {
  try {
    const startTime = Date.now();

    // Load model once
    const sentiment = await getModelPipeline(
      'sentiment-analysis',
      MODELS.SENTIMENT
    );

    // Prepare all texts
    const fullTexts = texts.map(
      ({ title, content }) => `${title}\n\n${content.substring(0, 2500)}`
    );

    // Run batch inference
    const results = await sentiment(fullTexts);

    // Process results
    const sentimentResults: SentimentResult[] = results.map((prediction: any, idx: number) => {
      const sentimentScore = calculateSentimentScore(
        prediction.label,
        prediction.score
      );
      const confidence = Math.max(0, Math.min(1, prediction.score));
      const tone = determineTone(sentimentScore, confidence);
      const emotions = detectEmotions(fullTexts[idx], sentimentScore);

      return {
        sentiment: sentimentScore,
        confidence,
        tone,
        emotions,
        success: true,
      };
    });

    const inferenceTime = Date.now() - startTime;
    recordInference(MODELS.SENTIMENT, inferenceTime);

    console.log(
      `[Sentiment Batch] Analyzed ${texts.length} texts in ${inferenceTime}ms (${(inferenceTime / texts.length).toFixed(0)}ms avg)`
    );

    return sentimentResults;
  } catch (error) {
    console.error('[Sentiment Batch] Error:', error);

    // Return array of failed results
    return texts.map(() => ({
      sentiment: 0,
      confidence: 0,
      tone: 'neutral',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}
