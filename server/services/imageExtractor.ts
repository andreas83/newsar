import puppeteer from 'puppeteer'
import { getDatabase } from '../database/db.js'
import { articles } from '../database/schema.js'
import { eq } from 'drizzle-orm'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'

interface ImageExtractionResult {
  success: boolean
  imageUrl?: string
  localPath?: string
  error?: string
}

/**
 * Extract Open Graph image from a URL using Puppeteer
 * This allows us to handle JavaScript-heavy sites and SPAs
 */
async function extractOGImage(url: string, timeout: number = 10000): Promise<string | null> {
  let browser = null

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    })

    const page = await browser.newPage()

    // Set a reasonable viewport
    await page.setViewport({ width: 1280, height: 720 })

    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

    // Navigate to the page with timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout,
    })

    // Extract Open Graph image from meta tags
    const ogImage = await page.evaluate(() => {
      // Try various meta tag patterns
      const ogImageTag = document.querySelector('meta[property="og:image"]')
      const ogImageSecure = document.querySelector('meta[property="og:image:secure_url"]')
      const twitterImage = document.querySelector('meta[name="twitter:image"]')
      const twitterImageSrc = document.querySelector('meta[name="twitter:image:src"]')

      // Return the first available image URL
      if (ogImageSecure) return (ogImageSecure as HTMLMetaElement).content
      if (ogImageTag) return (ogImageTag as HTMLMetaElement).content
      if (twitterImage) return (twitterImage as HTMLMetaElement).content
      if (twitterImageSrc) return (twitterImageSrc as HTMLMetaElement).content

      return null
    })

    return ogImage
  } catch (error: any) {
    console.error('Error extracting OG image:', error.message)
    return null
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

/**
 * Download an image from a URL and save it locally
 */
async function downloadImage(imageUrl: string, articleId: number): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsarBot/1.0; +https://newsar.app/bot)',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Generate filename from URL hash
    const hash = createHash('md5').update(imageUrl).digest('hex')
    const extension = imageUrl.split('.').pop()?.split('?')[0] || 'jpg'
    const filename = `${articleId}-${hash}.${extension}`

    // Ensure images directory exists
    const imagesDir = join(process.cwd(), 'public', 'images', 'articles')
    await mkdir(imagesDir, { recursive: true })

    // Save the file
    const localPath = join(imagesDir, filename)
    await writeFile(localPath, buffer)

    // Return public URL path
    return `/images/articles/${filename}`
  } catch (error: any) {
    console.error('Error downloading image:', error.message)
    return null
  }
}

/**
 * Extract and download OG image for an article
 */
export async function extractArticleImage(articleId: number): Promise<ImageExtractionResult> {
  const db = getDatabase()

  try {
    // Get article URL
    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
    })

    if (!article) {
      return {
        success: false,
        error: 'Article not found',
      }
    }

    // Skip if image already fetched
    if (article.imageFetchStatus === 'success') {
      return {
        success: true,
        imageUrl: article.imageUrl || undefined,
        localPath: article.imageLocalPath || undefined,
      }
    }

    console.log(`Extracting image for article ${articleId}: ${article.url}`)

    // Extract OG image URL
    const imageUrl = await extractOGImage(article.url)

    if (!imageUrl) {
      // Update status to skipped
      await db
        .update(articles)
        .set({
          imageFetchStatus: 'skipped',
          imageFetchedAt: new Date(),
        })
        .where(eq(articles.id, articleId))

      return {
        success: false,
        error: 'No OG image found',
      }
    }

    // Download and save image locally
    const localPath = await downloadImage(imageUrl, articleId)

    // Update article with image info
    await db
      .update(articles)
      .set({
        imageUrl,
        imageLocalPath: localPath || undefined,
        imageFetchStatus: localPath ? 'success' : 'failed',
        imageFetchedAt: new Date(),
      })
      .where(eq(articles.id, articleId))

    return {
      success: !!localPath,
      imageUrl,
      localPath: localPath || undefined,
      error: localPath ? undefined : 'Failed to download image',
    }
  } catch (error: any) {
    console.error(`Error extracting image for article ${articleId}:`, error)

    // Update status to failed
    await db
      .update(articles)
      .set({
        imageFetchStatus: 'failed',
        imageFetchedAt: new Date(),
      })
      .where(eq(articles.id, articleId))

    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Batch extract images for multiple articles
 */
export async function extractArticleImagesBatch(articleIds: number[], concurrency: number = 3): Promise<void> {
  console.log(`Extracting images for ${articleIds.length} articles with concurrency ${concurrency}`)

  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < articleIds.length; i += concurrency) {
    const batch = articleIds.slice(i, i + concurrency)
    const promises = batch.map(id => extractArticleImage(id))

    await Promise.all(promises)

    // Small delay between batches
    if (i + concurrency < articleIds.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  console.log('Image extraction batch completed')
}
