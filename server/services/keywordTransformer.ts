import type { Keyword, KeywordExtractionResult } from './keywordExtractor.js';

/**
 * Stop words to filter out (common words with no semantic value)
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'said', 'says', 'say',
  'also', 'new', 'one', 'two', 'three', 'get', 'make', 'go', 'know', 'take',
  'see', 'come', 'think', 'look', 'want', 'give', 'use', 'find', 'tell', 'ask',
  'work', 'seem', 'feel', 'try', 'leave', 'call', 'just', 'like', 'now', 'even',
  'back', 'any', 'good', 'woman', 'man', 'day', 'time', 'year', 'week', 'month',
  'him', 'her', 'his', 'their', 'its', 'our', 'your', 'my', 'me', 'you', 'he',
  'she', 'it', 'they', 'we', 'who', 'which', 'what', 'this', 'that', 'these', 'those',
]);

/**
 * Topic keywords for categorization
 */
const TOPIC_KEYWORDS = new Set([
  'politics', 'technology', 'science', 'health', 'business', 'economy', 'finance',
  'sports', 'entertainment', 'culture', 'environment', 'climate', 'education',
  'military', 'defense', 'security', 'energy', 'agriculture', 'transportation',
  'healthcare', 'medicine', 'law', 'justice', 'crime', 'trade', 'immigration',
  'housing', 'infrastructure', 'research', 'innovation', 'ai', 'artificial intelligence',
]);

/**
 * Event keywords for categorization
 */
const EVENT_KEYWORDS = new Set([
  'election', 'summit', 'conference', 'meeting', 'vote', 'referendum', 'protest',
  'war', 'conflict', 'attack', 'strike', 'deal', 'agreement', 'treaty', 'launch',
  'announcement', 'release', 'report', 'investigation', 'trial', 'verdict',
  'crash', 'disaster', 'emergency', 'outbreak', 'pandemic', 'crisis', 'scandal',
  'olympics', 'championship', 'tournament', 'festival', 'ceremony', 'celebration',
]);

/**
 * Tokenize text into words and phrases
 */
function tokenize(text: string): string[] {
  // Convert to lowercase and split on word boundaries
  const words = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ') // Remove punctuation except hyphens
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));

  return words;
}

/**
 * Extract n-grams (phrases) from text
 */
function extractNGrams(words: string[], n: number = 2): string[] {
  const ngrams: string[] = [];

  for (let i = 0; i <= words.length - n; i++) {
    const ngram = words.slice(i, i + n).join(' ');
    ngrams.push(ngram);
  }

  return ngrams;
}

/**
 * Calculate TF-IDF score for a term
 * For single document, we use TF (term frequency) only
 */
function calculateTermFrequency(term: string, tokens: string[]): number {
  const termCount = tokens.filter(t => t === term || t.includes(term)).length;
  return termCount / tokens.length;
}

/**
 * Categorize keyword based on content
 */
function categorizeKeyword(keyword: string): 'topic' | 'entity' | 'event' | 'general' {
  const lower = keyword.toLowerCase();

  // Check if it's a topic
  if (TOPIC_KEYWORDS.has(lower) || Array.from(TOPIC_KEYWORDS).some(t => lower.includes(t))) {
    return 'topic';
  }

  // Check if it's an event
  if (EVENT_KEYWORDS.has(lower) || Array.from(EVENT_KEYWORDS).some(e => lower.includes(e))) {
    return 'event';
  }

  // Check if it's a proper noun (entity) - starts with capital letter
  if (keyword[0] === keyword[0].toUpperCase()) {
    return 'entity';
  }

  return 'general';
}

/**
 * Boost score for certain keyword patterns
 */
function applyScoreBoosting(keyword: string, baseScore: number): number {
  let score = baseScore;

  // Boost multi-word phrases (more specific)
  if (keyword.includes(' ')) {
    score *= 1.2;
  }

  // Boost capitalized terms (likely proper nouns)
  if (keyword[0] === keyword[0].toUpperCase()) {
    score *= 1.15;
  }

  // Boost topic keywords
  if (TOPIC_KEYWORDS.has(keyword.toLowerCase())) {
    score *= 1.1;
  }

  // Boost event keywords
  if (EVENT_KEYWORDS.has(keyword.toLowerCase())) {
    score *= 1.1;
  }

  return Math.min(1, score); // Cap at 1.0
}

/**
 * Extract keywords using TF-based approach
 * This is a transformer-free statistical method
 */
export async function extractKeywordsWithTransformer(
  title: string,
  content: string,
  maxKeywords: number = 10
): Promise<KeywordExtractionResult> {
  try {
    const startTime = Date.now();

    // Combine title and content
    const fullText = `${title}\n\n${content.substring(0, 2500)}`;

    // Tokenize
    const words = tokenize(fullText);
    const titleWords = tokenize(title);

    // Extract unigrams (single words) and bigrams (2-word phrases)
    const unigrams = words;
    const bigrams = extractNGrams(words, 2);
    const trigrams = extractNGrams(words, 3);

    // Combine all candidate keywords
    const candidates = [...unigrams, ...bigrams, ...trigrams];

    // Calculate frequency for each candidate
    const freqMap = new Map<string, number>();
    for (const candidate of candidates) {
      const freq = calculateTermFrequency(candidate, words);
      // Scale frequency to 0-1 range (multiply by 10 to boost visibility)
      freqMap.set(candidate, freq * 10);
    }

    // Boost keywords that appear in title
    for (const word of titleWords) {
      if (freqMap.has(word)) {
        freqMap.set(word, freqMap.get(word)! * 2); // Double score for title words
      }
    }

    // Also check bigrams/trigrams that contain title words
    for (const [candidate, freq] of freqMap.entries()) {
      for (const titleWord of titleWords) {
        if (candidate.includes(titleWord) && candidate !== titleWord) {
          freqMap.set(candidate, freq * 1.5); // 1.5x boost for phrases containing title words
        }
      }
    }

    // Sort by frequency and get top candidates
    const sortedCandidates = Array.from(freqMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords * 3); // Get 3x more for filtering

    // Process into keywords with categories
    const keywords: Keyword[] = sortedCandidates
      .map(([keyword, score]) => {
        // Apply boosting
        const boostedScore = applyScoreBoosting(keyword, score);

        return {
          keyword: keyword.trim(),
          relevance: Math.max(0, Math.min(1, boostedScore)),
          category: categorizeKeyword(keyword),
        };
      })
      .filter(k => k.relevance >= 0.3) // Lower threshold from 0.4 to 0.3
      .slice(0, maxKeywords); // Take top N

    const inferenceTime = Date.now() - startTime;

    console.log(
      `[Keyword Transformer] Extracted ${keywords.length} keywords in ${inferenceTime}ms`
    );

    return {
      keywords,
      success: true,
    };
  } catch (error) {
    console.error('[Keyword Transformer] Error extracting keywords:', error);

    return {
      keywords: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Enhanced keyword extraction using NER entities as seed keywords
 */
export async function extractKeywordsEnhanced(
  title: string,
  content: string,
  entities: Array<{ name: string; type: string; relevance: number }>,
  maxKeywords: number = 10
): Promise<KeywordExtractionResult> {
  try {
    const startTime = Date.now();

    // Get base keywords from TF-based extraction
    const baseResult = await extractKeywordsWithTransformer(title, content, maxKeywords);

    if (!baseResult.success) {
      return baseResult;
    }

    // Add entity-based keywords
    const entityKeywords: Keyword[] = entities
      .filter(e => e.relevance >= 0.4)
      .map(e => ({
        keyword: e.name.toLowerCase(),
        relevance: e.relevance,
        category: 'entity' as const,
      }));

    // Merge and deduplicate
    const allKeywords = [...baseResult.keywords, ...entityKeywords];
    const keywordMap = new Map<string, Keyword>();

    for (const kw of allKeywords) {
      const existing = keywordMap.get(kw.keyword);
      if (!existing || kw.relevance > existing.relevance) {
        keywordMap.set(kw.keyword, kw);
      }
    }

    // Sort by relevance and take top N
    const finalKeywords = Array.from(keywordMap.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxKeywords);

    const inferenceTime = Date.now() - startTime;

    console.log(
      `[Keyword Enhanced] Extracted ${finalKeywords.length} keywords (with entities) in ${inferenceTime}ms`
    );

    return {
      keywords: finalKeywords,
      success: true,
    };
  } catch (error) {
    console.error('[Keyword Enhanced] Error:', error);

    return {
      keywords: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Compare keyword extraction results from Transformer vs Ollama
 */
export interface KeywordComparison {
  transformer: KeywordExtractionResult;
  ollama: KeywordExtractionResult;
  transformerTime: number;
  ollamaTime: number;
  speedup: number;
  keywordOverlap: number; // Percentage of keywords found by both
  uniqueToTransformer: Keyword[];
  uniqueToOllama: Keyword[];
}

export async function compareKeywordMethods(
  title: string,
  content: string,
  ollamaExtractor: (title: string, content: string) => Promise<KeywordExtractionResult>
): Promise<KeywordComparison> {
  // Run both methods in parallel
  const [transformerResult, ollamaResult] = await Promise.all([
    (async () => {
      const start = Date.now();
      const result = await extractKeywordsWithTransformer(title, content);
      return { result, time: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const result = await ollamaExtractor(title, content);
      return { result, time: Date.now() - start };
    })(),
  ]);

  // Calculate overlap
  const transformerKeywords = new Set(
    transformerResult.result.keywords.map(k => k.keyword.toLowerCase())
  );
  const ollamaKeywords = new Set(
    ollamaResult.result.keywords.map(k => k.keyword.toLowerCase())
  );

  const commonKeywords = [...transformerKeywords].filter(kw =>
    ollamaKeywords.has(kw)
  ).length;

  const totalUnique = new Set([...transformerKeywords, ...ollamaKeywords]).size;
  const overlap = totalUnique > 0 ? (commonKeywords / totalUnique) * 100 : 0;

  // Find unique keywords
  const uniqueToTransformer = transformerResult.result.keywords.filter(
    k => !ollamaKeywords.has(k.keyword.toLowerCase())
  );
  const uniqueToOllama = ollamaResult.result.keywords.filter(
    k => !transformerKeywords.has(k.keyword.toLowerCase())
  );

  return {
    transformer: transformerResult.result,
    ollama: ollamaResult.result,
    transformerTime: transformerResult.time,
    ollamaTime: ollamaResult.time,
    speedup: ollamaResult.time / transformerResult.time,
    keywordOverlap: overlap,
    uniqueToTransformer,
    uniqueToOllama,
  };
}
