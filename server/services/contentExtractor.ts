import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { getDatabase } from '../database/db.js'
import { articles, feeds } from '../database/schema.js'
import { eq } from 'drizzle-orm'
import {
  preCleanHTML,
  postCleanText,
  calculateContentQuality,
} from '../utils/contentCleaner.js'
import {
  resolveGoogleNewsArticle,
  isGoogleNewsUrl,
  getBrowser,
} from '../utils/googleNewsResolver.js'

// Browser-like User-Agent (matches Puppeteer's UA in googleNewsResolver.ts)
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// URL patterns for non-article content (video, podcasts, galleries)
const NON_ARTICLE_URL_PATTERNS = [
  /\/video\//i,
  /\/videos\//i,
  /\/live\//i,
  /\/podcast\//i,
  /\/podcasts\//i,
  /\/gallery\//i,
  /\/photo-gallery\//i,
  /\/audio\//i,
]

/**
 * Fetch HTML content from a URL with timeout and redirect following
 * Uses browser-like headers to avoid bot detection (403s)
 */
async function fetchHTML(url: string, timeout: number = 10000): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8,de;q=0.7,fr;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()
    const finalUrl = response.url // This gives us the final URL after all redirects

    return { html, finalUrl }
  } catch (error: any) {
    clearTimeout(timeoutId)

    if (error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw error
  }
}

/**
 * Extract article content using Mozilla Readability with advanced cleaning
 */
function extractArticleContent(html: string, url: string): {
  title: string
  content: string
  textContent: string
  cleanedText: string
  excerpt: string
  byline: string | null
  siteName: string | null
  qualityScore: number
  qualityIssues: string[]
} | null {
  try {
    // Step 1: Pre-clean HTML (remove ads, scripts, etc.)
    const cleanedHtml = preCleanHTML(html)

    // Step 2: Parse with Readability
    const { document } = parseHTML(cleanedHtml)
    const reader = new Readability(document, {
      debug: false,
      charThreshold: 300, // Lowered threshold to give more chances
    })

    const article = reader.parse()

    if (!article) {
      return null
    }

    // Step 3: Post-clean the extracted text
    const cleanedText = postCleanText(article.textContent)

    // Step 4: Calculate quality score
    const { score, issues } = calculateContentQuality(cleanedText, url)

    return {
      title: article.title,
      content: article.content, // HTML content (from Readability)
      textContent: article.textContent, // Plain text (from Readability)
      cleanedText, // Post-cleaned text (best quality)
      excerpt: article.excerpt,
      byline: article.byline,
      siteName: article.siteName,
      qualityScore: score,
      qualityIssues: issues,
    }
  } catch (error) {
    console.error('Readability parsing error:', error)
    return null
  }
}

/**
 * Extract content using Puppeteer for JS-rendered pages
 * Reuses the browser instance from googleNewsResolver.ts
 */
async function extractWithPuppeteer(url: string, timeout: number = 15000): Promise<{
  cleanedText: string
  title: string
  byline: string | null
  qualityScore: number
  qualityIssues: string[]
} | null> {
  let page = null
  try {
    const browser = await getBrowser()
    page = await browser.newPage()

    await page.setUserAgent(BROWSER_USER_AGENT)
    page.setDefaultNavigationTimeout(timeout)
    page.setDefaultTimeout(timeout)

    // Block images, fonts, media to speed up loading
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const type = req.resourceType()
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort()
      } else {
        req.continue()
      }
    })

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    })

    // Wait for content to render
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get the rendered HTML and extract with Readability
    const html = await page.content()
    const extracted = extractArticleContent(html, url)

    if (extracted && extracted.cleanedText.length > 100) {
      return {
        cleanedText: extracted.cleanedText,
        title: extracted.title,
        byline: extracted.byline,
        qualityScore: extracted.qualityScore,
        qualityIssues: extracted.qualityIssues,
      }
    }

    // Fallback: extract body text directly from the page
    const bodyText = await page.evaluate(() => {
      // Remove script, style, nav, footer, header elements
      const remove = document.querySelectorAll('script, style, nav, footer, header, aside, [role="navigation"], [role="banner"], [role="contentinfo"]')
      remove.forEach(el => el.remove())

      const article = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main') || document.body
      return article?.innerText || ''
    })

    if (bodyText.length > 200) {
      const cleanedText = postCleanText(bodyText)
      const { score, issues } = calculateContentQuality(cleanedText, url)
      return {
        cleanedText,
        title: await page.title(),
        byline: null,
        qualityScore: score,
        qualityIssues: issues,
      }
    }

    return null
  } catch (error) {
    console.error('Puppeteer extraction error:', error instanceof Error ? error.message : error)
    return null
  } finally {
    if (page) {
      await page.close()
    }
  }
}

/**
 * Check if a URL points to non-article content (video, podcast, gallery)
 */
function isNonArticleUrl(url: string): boolean {
  return NON_ARTICLE_URL_PATTERNS.some(p => p.test(url))
}

/**
 * Extract and store full article content for a given article ID
 */
export async function extractArticleById(articleId: number) {
  const db = getDatabase()

  try {
    // Get article details with feed extraction method
    const result = await db
      .select({
        article: articles,
        feedExtractionMethod: feeds.extractionMethod,
      })
      .from(articles)
      .leftJoin(feeds, eq(articles.feedId, feeds.id))
      .where(eq(articles.id, articleId))
      .limit(1)

    if (!result[0]) {
      throw new Error(`Article ${articleId} not found`)
    }

    const article = result[0].article
    const feedExtractionMethod = result[0].feedExtractionMethod || 'readability'

    // Skip if already extracted
    if (article.contentExtracted) {
      console.log(`Article ${articleId} already extracted, skipping`)
      return {
        success: true,
        skipped: true,
        articleId,
      }
    }

    // Handle Google News redirect URLs
    let targetUrl = article.url
    let resolutionMethod = 'direct'

    if (isGoogleNewsUrl(article.url)) {
      console.log(`Article ${articleId} is a Google News redirect, attempting to resolve...`)

      const resolution = await resolveGoogleNewsArticle(
        article.url,
        article.title,
        {
          usePuppeteer: true,
          useTitleSearch: true,
          timeout: 15000,
        }
      )

      if (resolution.success && resolution.url) {
        targetUrl = resolution.url
        resolutionMethod = resolution.method
        console.log(`  Resolved via ${resolution.method}: ${targetUrl.substring(0, 80)}...`)
      } else {
        console.log(`  Failed to resolve, will use RSS content as fallback`)
      }
    }

    // Skip non-article URLs (video, podcast, gallery)
    if (isNonArticleUrl(targetUrl)) {
      console.log(`  Skipping non-article URL: ${targetUrl.substring(0, 80)}...`)

      const fallbackContent = article.content || null
      await db
        .update(articles)
        .set({
          fullContent: fallbackContent,
          contentExtracted: true,
          extractionStatus: fallbackContent ? 'fallback' : 'skipped',
          extractionError: 'Non-article URL (video/podcast/gallery)',
          extractedAt: new Date(),
        })
        .where(eq(articles.id, articleId))

      return {
        success: true,
        articleId,
        contentLength: fallbackContent?.length || 0,
        skipped: true,
        reason: 'non-article-url',
      }
    }

    console.log(`Extracting content from: ${targetUrl.substring(0, 80)}...`)

    // Determine extraction order based on feed method
    const usePuppeteerFirst = feedExtractionMethod === 'puppeteer'

    let extracted: ReturnType<typeof extractArticleContent> = null
    let puppeteerResult: Awaited<ReturnType<typeof extractWithPuppeteer>> = null
    let urlChanged = false
    let finalUrl = targetUrl

    if (usePuppeteerFirst) {
      // Puppeteer-first strategy for feeds that need JS rendering
      console.log(`  Using Puppeteer-first strategy (feed method: puppeteer)`)
      puppeteerResult = await extractWithPuppeteer(targetUrl, 15000)

      if (!puppeteerResult || puppeteerResult.cleanedText.length < 500) {
        // Fallback to HTTP + Readability
        try {
          const fetchResult = await fetchHTML(targetUrl, 15000)
          finalUrl = fetchResult.finalUrl
          urlChanged = finalUrl !== article.url
          extracted = extractArticleContent(fetchResult.html, finalUrl)
        } catch (fetchErr) {
          // HTTP fetch failed, stick with Puppeteer result (even if short)
        }
      }
    } else {
      // Default: HTTP + Readability first
      try {
        const fetchResult = await fetchHTML(targetUrl, 15000)
        finalUrl = fetchResult.finalUrl
        urlChanged = finalUrl !== article.url
        if (urlChanged) {
          console.log(`  Redirected to: ${finalUrl}`)
        }
        extracted = extractArticleContent(fetchResult.html, finalUrl)
      } catch (fetchErr: any) {
        console.log(`  HTTP fetch failed: ${fetchErr.message}`)
        // Will try Puppeteer fallback below
      }

      // Puppeteer fallback if HTTP extraction yielded <500 chars
      const extractedLen = extracted?.cleanedText?.length || 0
      if (extractedLen < 500) {
        console.log(`  HTTP extraction short (${extractedLen} chars), trying Puppeteer fallback...`)
        puppeteerResult = await extractWithPuppeteer(targetUrl, 15000)
      }
    }

    // Pick the best result between HTTP extraction, Puppeteer, and RSS content
    const httpText = extracted?.cleanedText || ''
    const puppeteerText = puppeteerResult?.cleanedText || ''
    const rssText = postCleanText(article.content || '')

    // Find the longest content source
    let bestText = httpText
    let bestSource = 'http'
    let bestExtracted = extracted

    if (puppeteerText.length > bestText.length) {
      bestText = puppeteerText
      bestSource = 'puppeteer'
    }
    if (rssText.length > bestText.length) {
      bestText = rssText
      bestSource = 'rss'
    }

    // If no content at all, use RSS fallback
    if (bestText.length === 0) {
      console.log(`  No content extracted, using RSS content as fallback`)

      await db
        .update(articles)
        .set({
          fullContent: article.content,
          contentExtracted: true,
          extractionStatus: article.content ? 'fallback' : 'failed',
          extractionError: 'No content extracted from any source',
          extractedAt: new Date(),
        })
        .where(eq(articles.id, articleId))

      return {
        success: !!article.content,
        articleId,
        contentLength: article.content?.length || 0,
        fallback: true,
      }
    }

    // Determine quality and extraction status
    const qualityScore = bestSource === 'http'
      ? (extracted?.qualityScore ?? 0)
      : bestSource === 'puppeteer'
        ? (puppeteerResult?.qualityScore ?? 0)
        : 0.5 // RSS gets a neutral quality score

    const qualityThreshold = 0.4
    const isLowQuality = bestSource !== 'rss' && qualityScore < qualityThreshold

    // If best extraction is low quality but RSS is decent, prefer RSS
    if (isLowQuality && rssText.length > 200 && rssText.length >= bestText.length * 0.8) {
      bestText = rssText
      bestSource = 'rss'
    }

    // Classify extraction status based on final content
    let extractionStatus: string
    if (bestSource === 'rss' && (httpText.length < 100 && puppeteerText.length < 100)) {
      extractionStatus = 'fallback'
    } else if (bestText.length < 500) {
      extractionStatus = 'partial'
    } else {
      extractionStatus = 'success'
    }

    const byline = bestSource === 'http'
      ? (extracted?.byline || null)
      : bestSource === 'puppeteer'
        ? (puppeteerResult?.byline || null)
        : null

    // Log which source won
    if (bestSource !== 'http') {
      console.log(`  Best content from ${bestSource} (${bestText.length} chars vs http:${httpText.length}, puppeteer:${puppeteerText.length}, rss:${rssText.length})`)
    }

    // Update article with extracted content
    await db
      .update(articles)
      .set({
        fullContent: bestText,
        contentExtracted: true,
        extractionStatus,
        extractedAt: new Date(),
        rawData: {
          ...(article.rawData as any || {}),
          ...(urlChanged ? { finalUrl, originalUrl: article.url } : {}),
          ...(resolutionMethod !== 'direct' ? { resolutionMethod, resolvedUrl: targetUrl } : {}),
          qualityScore,
          extractedLength: httpText.length,
          puppeteerLength: puppeteerText.length,
          rssLength: rssText.length,
          bestSource,
          feedExtractionMethod,
        },
        ...(byline && !article.author ? { author: byline } : {}),
      })
      .where(eq(articles.id, articleId))

    const statusIcon = extractionStatus === 'success' ? '✅' : extractionStatus === 'partial' ? '⚠️' : '📄'
    console.log(`${statusIcon} Extracted ${bestText.length} chars [${bestSource}] (status: ${extractionStatus})`)

    return {
      success: true,
      articleId,
      contentLength: bestText.length,
      title: bestExtracted?.title || puppeteerResult?.title || article.title,
      qualityScore,
      usedFallback: bestSource === 'rss',
      bestSource,
    }
  } catch (error: any) {
    console.error(`Failed to extract article ${articleId}:`, error)

    // Try to use RSS content as fallback even on error
    try {
      const [articleForFallback] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1)

      if (articleForFallback?.content) {
        console.log(`  Using RSS content as fallback after error`)

        await db
          .update(articles)
          .set({
            fullContent: articleForFallback.content,
            contentExtracted: true,
            extractionStatus: 'fallback',
            extractionError: `Extraction error: ${error.message}, using RSS content`,
            extractedAt: new Date(),
          })
          .where(eq(articles.id, articleId))

        return {
          success: true,
          articleId,
          contentLength: articleForFallback.content.length,
          fallback: true,
          error: error.message,
        }
      }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError)
    }

    // Update status to failed if no fallback available
    await db
      .update(articles)
      .set({
        extractionStatus: 'failed',
        extractionError: error.message,
        extractedAt: new Date(),
      })
      .where(eq(articles.id, articleId))

    return {
      success: false,
      articleId,
      error: error.message,
    }
  }
}

/**
 * Get articles pending extraction
 */
export async function getPendingExtractionArticles(limit: number = 10) {
  const db = getDatabase()

  return await db
    .select()
    .from(articles)
    .where(eq(articles.extractionStatus, 'pending'))
    .limit(limit)
}
