import { generateEmbedding } from '../utils/ollama.js'
import { getDatabase } from '../database/db.js'
import { articles, articleEmbeddings, classifications } from '../database/schema.js'
import { eq, isNull, desc, sql } from 'drizzle-orm'

export interface EmbeddingResult {
  success: boolean
  articleId: number
  dimension?: number
  error?: string
}

/**
 * Generate embedding for a single article
 */
export async function generateArticleEmbedding(articleId: number): Promise<EmbeddingResult> {
  const db = getDatabase()

  try {
    // 1. Get article content
    const [article] = await db
      .select({
        id: articles.id,
        title: articles.title,
        content: articles.content,
        fullContent: articles.fullContent,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!article) {
      throw new Error(`Article ${articleId} not found`)
    }

    // Use full content if available, otherwise snippet
    const textToEmbed = article.fullContent || article.content || ''

    if (textToEmbed.length < 50) {
      throw new Error('Article content too short for embedding')
    }

    // 2. Create text for embedding (title + content, truncated to reasonable length)
    // nomic-embed-text context varies by deployment, be conservative
    // Use ~3500 chars total to stay well within token limits
    // Title can be up to 500 chars, so leave 3000 for content
    const maxTitleLength = 500
    const maxContentLength = 3000
    const truncatedTitle = article.title.substring(0, maxTitleLength)
    const truncatedContent = textToEmbed.substring(0, maxContentLength)
    const embeddingText = `${truncatedTitle}\n\n${truncatedContent}`

    console.log(`Generating embedding for article ${articleId}: ${article.title.substring(0, 50)}...`)

    // 3. Generate embedding using Ollama
    const embedding = await generateEmbedding(embeddingText)

    if (!embedding || embedding.length === 0) {
      throw new Error('Empty embedding returned from Ollama')
    }

    console.log(`  Embedding generated: ${embedding.length} dimensions`)

    // 4. Check if embedding already exists
    const [existing] = await db
      .select()
      .from(articleEmbeddings)
      .where(eq(articleEmbeddings.articleId, articleId))
      .limit(1)

    if (existing) {
      // Update existing embedding
      await db
        .update(articleEmbeddings)
        .set({
          embedding: embedding as any, // Drizzle will handle vector type conversion
          model: 'nomic-embed-text',
          updatedAt: new Date(),
        })
        .where(eq(articleEmbeddings.articleId, articleId))

      console.log(`  ✅ Embedding updated`)
    } else {
      // Insert new embedding
      await db.insert(articleEmbeddings).values({
        articleId: article.id,
        embedding: embedding as any, // Drizzle will handle vector type conversion
        model: 'nomic-embed-text',
      })

      console.log(`  ✅ Embedding created`)
    }

    return {
      success: true,
      articleId: article.id,
      dimension: embedding.length,
    }
  } catch (error) {
    console.error(`Failed to generate embedding for article ${articleId}:`, error)

    return {
      success: false,
      articleId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get articles that need embeddings
 * Uses LEFT JOIN to efficiently filter at database level
 */
export async function getArticlesPendingEmbedding(limit: number = 10) {
  const db = getDatabase()

  // Use LEFT JOIN to get grouped articles without embeddings directly in SQL
  // Order by ID descending to prioritize newer articles
  // Exclude disabled languages (fr, de, es) to save tokens
  const pending = await db
    .select({
      id: articles.id,
      title: articles.title,
      contentExtracted: articles.contentExtracted,
      processingStatus: articles.processingStatus,
    })
    .from(articles)
    .leftJoin(articleEmbeddings, eq(articles.id, articleEmbeddings.articleId))
    .leftJoin(classifications, eq(articles.id, classifications.articleId))
    .where(sql`${articles.processingStatus} = 'grouped'
      AND ${articleEmbeddings.articleId} IS NULL
      AND (${classifications.language} IS NULL OR ${classifications.language} NOT IN ('fr', 'de', 'es'))`)
    .orderBy(desc(articles.id))
    .limit(limit)

  return pending
}

/**
 * Find similar articles using cosine similarity
 * Returns article IDs and similarity scores
 */
export async function findSimilarArticles(
  articleId: number,
  limit: number = 10,
  minSimilarity: number = 0.7
): Promise<Array<{ articleId: number; similarity: number; title: string }>> {
  const db = getDatabase()

  try {
    // Get the target article's embedding
    const [targetEmbedding] = await db
      .select()
      .from(articleEmbeddings)
      .where(eq(articleEmbeddings.articleId, articleId))
      .limit(1)

    if (!targetEmbedding) {
      throw new Error(`No embedding found for article ${articleId}`)
    }

    // Parse vector (could be array or string depending on Drizzle's handling)
    const targetVector = Array.isArray(targetEmbedding.embedding)
      ? targetEmbedding.embedding
      : JSON.parse(targetEmbedding.embedding as string)

    // Get all other embeddings (we'll optimize this with pgvector later)
    const allEmbeddings = await db
      .select({
        articleId: articleEmbeddings.articleId,
        embedding: articleEmbeddings.embedding,
      })
      .from(articleEmbeddings)

    // Calculate cosine similarity for each
    const similarities = allEmbeddings
      .filter((e) => e.articleId !== articleId)
      .map((e) => {
        const vector = Array.isArray(e.embedding)
          ? e.embedding
          : JSON.parse(e.embedding as string)
        const similarity = cosineSimilarity(targetVector as number[], vector as number[])
        return {
          articleId: e.articleId,
          similarity,
        }
      })
      .filter((s) => s.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)

    // Get article titles
    const results = await Promise.all(
      similarities.map(async (s) => {
        const [article] = await db
          .select({ title: articles.title })
          .from(articles)
          .where(eq(articles.id, s.articleId))
          .limit(1)

        return {
          articleId: s.articleId,
          similarity: s.similarity,
          title: article?.title || 'Unknown',
        }
      })
    )

    return results
  } catch (error) {
    console.error(`Failed to find similar articles for ${articleId}:`, error)
    return []
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (normA * normB)
}
