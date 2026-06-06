/**
 * Advanced content cleaning utilities
 * Removes ads, artifacts, and improves extraction quality
 */

/**
 * Common ad/artifact patterns to remove
 */
const AD_PATTERNS = [
  // Advertisement indicators
  /advertisement/gi,
  /\[ad\]/gi,
  /\(ad\)/gi,
  /-- advertisement --/gi,
  /skip advertisement/gi,

  // Newsletter/subscription prompts
  /subscribe to our newsletter/gi,
  /sign up for (?:our|the) newsletter/gi,
  /get our free newsletter/gi,
  /join our mailing list/gi,

  // Social media/sharing prompts
  /follow us on (?:twitter|facebook|instagram)/gi,
  /share this (?:article|story)/gi,
  /tweet this/gi,

  // Cookie/privacy banners
  /we use cookies/gi,
  /cookie policy/gi,
  /accept cookies/gi,
  /privacy policy/gi,

  // Related content
  /related (?:articles|stories|topics)/gi,
  /you may also (?:like|enjoy)/gi,
  /recommended for you/gi,
  /more from (?:this|our)/gi,

  // Copyright/attribution (at end of articles)
  /©\s*\d{4}.*?all rights reserved/gi,
  /copyright\s*©?\s*\d{4}/gi,

  // Comments sections
  /\d+ comments?/gi,
  /leave a comment/gi,
  /join the (?:discussion|conversation)/gi,
]

/**
 * Patterns that indicate low-quality or non-article text
 */
const LOW_QUALITY_INDICATORS = [
  'click here',
  'read more',
  'learn more',
  'find out more',
  'subscribe now',
  'sign up',
  'download now',
  'buy now',
  'shop now',
  'sponsored content',
  'promoted by',
  'paid partnership',
]

/**
 * HTML elements/classes that commonly contain ads or artifacts
 */
const AD_SELECTORS = [
  '[class*="ad-"]',
  '[class*="advertisement"]',
  '[class*="sponsor"]',
  '[id*="ad-"]',
  '[id*="advertisement"]',
  '.ad',
  '.ads',
  '.advert',
  '.social-share',
  '.share-buttons',
  '.newsletter',
  '.subscribe',
  '.related-articles',
  '.recommended',
  '.comments',
  '.cookie-banner',
  '[data-ad]',
  '[data-advertisement]',
]

/**
 * Remove ads and artifacts from HTML before Readability parsing
 */
export function preCleanHTML(html: string): string {
  // This is a basic cleanup - in production, you'd use a proper HTML parser
  let cleaned = html

  // Remove script tags
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

  // Remove style tags
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Remove iframe tags (often ads)
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')

  // Remove common ad containers by class/id patterns
  for (const pattern of [
    /<[^>]*class="[^"]*\b(?:ad|advertisement|sponsor|promo)[^"]*"[^>]*>.*?<\/[^>]+>/gis,
    /<[^>]*id="[^"]*\b(?:ad|advertisement|sponsor|promo)[^"]*"[^>]*>.*?<\/[^>]+>/gis,
  ]) {
    cleaned = cleaned.replace(pattern, '')
  }

  return cleaned
}

/**
 * Detect if a paragraph is predominantly JavaScript or CSS code
 */
function isCodeParagraph(text: string): boolean {
  const trimmed = text.trim()

  // Freestar ad SDK (most common pattern in AP News)
  if (/freestar/i.test(trimmed)) return true

  // Common ad/tracking SDKs
  if (/\b(dataLayer|gtag|googletag|pbjs|apstag|__tcfapi)\b/.test(trimmed)) return true

  // IIFE patterns: (function () { ... })(); or !function() { ... }()
  if (/^[\s!;]*\(?\s*function\s*\(/.test(trimmed)) return true

  // Variable declarations followed by code-like content
  if (/^\s*(var|let|const)\s+\w+\s*=/.test(trimmed) && /[{};]/.test(trimmed)) return true

  // DOM API calls
  if (/\b(document\.(querySelector|getElementById|getElementsBy|createElement|addEventListener)|window\.(matchMedia|addEventListener|location)|\.innerHTML|\.appendChild|\.removeChild|\.setAttribute)\b/.test(trimmed)) return true

  // CSS blocks: selectors with braces
  if (/[.#@]\w[\w-]*\s*\{[^}]*\}/.test(trimmed) && !/\b(said|told|reported|according)\b/i.test(trimmed)) return true

  // CSS at-rules
  if (/^\s*@(media|keyframes|font-face|import|supports)\b/.test(trimmed)) return true

  // CSS comments followed by rules
  if (/^\s*\/\*[\s\S]*?\*\/\s*[.#\w@]/.test(trimmed) && /\{[^}]*\}/.test(trimmed)) return true

  // High density of code characters (semicolons, braces, arrows)
  const codeChars = (trimmed.match(/[{};=>()\[\]]/g) || []).length
  const codeRatio = codeChars / trimmed.length
  if (codeRatio > 0.1 && trimmed.length > 60) {
    // Additional check: must also have code keywords to avoid false positives on normal text with parentheses
    if (/\b(function|return|var|let|const|if|else|for|while|new|this|typeof|null|undefined|true|false)\b/.test(trimmed)) return true
  }

  // IntersectionObserver / MutationObserver (ad tracking)
  if (/\b(IntersectionObserver|MutationObserver|ResizeObserver)\b/.test(trimmed)) return true

  // console.log, setTimeout, setInterval
  if (/\b(console\.(log|warn|error)|setTimeout|setInterval|requestAnimationFrame)\b/.test(trimmed)) return true

  return false
}

/**
 * Clean extracted text content after Readability
 */
export function postCleanText(text: string): string {
  let cleaned = text

  // Remove ad patterns
  for (const pattern of AD_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Strip inline freestar.queue.push blocks (can span multiple lines within a paragraph)
  cleaned = cleaned.replace(/freestar\.queue\.push\s*\(\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\)\s*;?/g, '')

  // Strip generic IIFE blocks
  cleaned = cleaned.replace(/\(\s*function\s*\([^)]*\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;?/g, '')

  // Strip CSS blocks (selectors with property declarations)
  // Matches: #id { ... } .class { ... } @media (...) { ... { ... } }
  cleaned = cleaned.replace(/@media\s*\([^)]*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '')
  cleaned = cleaned.replace(/[#.]\w[\w-]*\s*(?:[#.>\s,+~\w[\]=":*-]*)\{[^}]*\}/g, '')

  // Strip function declarations and blocks embedded in text
  cleaned = cleaned.replace(/function\s+\w+\s*\([^)]*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '')

  // Strip var/let/const with function assignments
  cleaned = cleaned.replace(/(?:var|let|const)\s+\w+\s*=\s*(?:function\s*\([^)]*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}|(?:\([^)]*\)|[\w]+)\s*=>\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\})\s*;?/g, '')

  // Strip remaining code-like statements: var x = [...]; var x = {...};
  cleaned = cleaned.replace(/(?:var|let|const)\s+\w+\s*=\s*(?:\[[^\]]*\]|\{[^}]*\})\s*;/g, '')

  // Strip lines with DOM API calls (these appear inline in AP News content)
  cleaned = cleaned.replace(/\b(?:document\.(?:querySelector|getElementById|getElementsBy|createElement|addEventListener)|window\.(?:matchMedia|addEventListener))\b[^.]*?(?:;|\n)/g, '')

  // Strip IntersectionObserver/dataLayer blocks
  cleaned = cleaned.replace(/(?:new\s+IntersectionObserver|window\.dataLayer)\s*[=(][^;]*;?/g, '')

  // Strip "Read More" widget remnants (AP News pattern — inline and end-of-line)
  cleaned = cleaned.replace(/\bRead More\b/g, '')

  // Strip CSS comments that may remain
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')

  // Clean up isolated stray braces left after code removal (not inside words)
  cleaned = cleaned.replace(/\s+[{}]+\s+/g, ' ')

  // Collapse excessive whitespace left by removals
  cleaned = cleaned.replace(/\s{3,}/g, ' ')

  // Split into paragraphs (double newline) or, for single-block content,
  // try to split at code boundaries to separate article text from embedded JS/CSS
  let paragraphs = cleaned.split(/\n\n+/)

  // For very long single-paragraph blocks (common in RSS content that has no
  // newlines), split at code boundaries so article text isn't lost
  if (paragraphs.length === 1 && paragraphs[0].length > 500) {
    const block = paragraphs[0]
    // Split at points where code likely begins: before CSS comments, @media,
    // function keywords preceded by whitespace, or #/. selectors with braces
    const segments = block.split(/(?=\/\*)|(?=@media\b)|(?=\bfunction\s*\()|(?=\bfunction\s+\w+\s*\()|(?=(?:var|let|const)\s+\w+\s*=\s*(?:function|\[|\{|new))|(?=[#.]\w[\w-]*\s*\{)/)
    if (segments.length > 1) {
      paragraphs = segments
    }
  }

  // Filter out low-quality paragraphs and code paragraphs
  const qualityParagraphs = paragraphs.filter(para => {
    const trimmed = para.trim()

    // Remove empty paragraphs
    if (trimmed.length === 0) return false

    // Remove very short paragraphs (likely artifacts)
    if (trimmed.length < 50) return false

    // Remove paragraphs that are JavaScript or CSS code
    if (isCodeParagraph(trimmed)) return false

    // Remove paragraphs with too many links (likely navigation/related articles)
    const linkDensity = (trimmed.match(/https?:\/\//g) || []).length / trimmed.length
    if (linkDensity > 0.05) return false

    // Remove paragraphs with low-quality indicators
    const lowerPara = trimmed.toLowerCase()
    const hasLowQualityIndicators = LOW_QUALITY_INDICATORS.some(indicator =>
      lowerPara.includes(indicator.toLowerCase())
    )
    if (hasLowQualityIndicators) return false

    return true
  })

  // Rejoin paragraphs
  cleaned = qualityParagraphs.join('\n\n')

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  // Remove multiple consecutive spaces
  cleaned = cleaned.replace(/  +/g, ' ')

  // Normalize line breaks
  cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n')

  return cleaned
}

/**
 * Calculate quality score for extracted content (0-1, higher is better)
 */
export function calculateContentQuality(text: string, url: string): {
  score: number
  issues: string[]
} {
  const issues: string[] = []
  let score = 1.0

  // Check content length
  if (text.length < 500) {
    score -= 0.3
    issues.push('Content too short')
  }

  // Check for excessive URLs (might be navigation/ads)
  const urlCount = (text.match(/https?:\/\//g) || []).length
  const urlDensity = urlCount / text.length
  if (urlDensity > 0.02) {
    score -= 0.2
    issues.push('Too many URLs in content')
  }

  // Check for low-quality indicators
  const lowerText = text.toLowerCase()
  let lowQualityCount = 0
  for (const indicator of LOW_QUALITY_INDICATORS) {
    if (lowerText.includes(indicator.toLowerCase())) {
      lowQualityCount++
    }
  }
  if (lowQualityCount > 3) {
    score -= 0.2
    issues.push(`Contains ${lowQualityCount} low-quality indicators`)
  }

  // Check for excessive repetition (might be boilerplate)
  const words = text.split(/\s+/)
  const uniqueWords = new Set(words.map(w => w.toLowerCase()))
  const vocabularyRichness = uniqueWords.size / words.length
  if (vocabularyRichness < 0.3) {
    score -= 0.15
    issues.push('Low vocabulary richness (repetitive text)')
  }

  // Check average sentence length (very short = might be lists/navigation)
  const sentences = text.split(/[.!?]+/)
  const avgSentenceLength = words.length / sentences.length
  if (avgSentenceLength < 8) {
    score -= 0.15
    issues.push('Very short sentences (might not be article text)')
  }

  // Ensure score is between 0 and 1
  score = Math.max(0, Math.min(1, score))

  return { score, issues }
}

/**
 * Resolve Google News redirect URL to actual article URL
 */
export async function resolveGoogleNewsUrl(googleNewsUrl: string): Promise<string | null> {
  try {
    // Google News URLs look like:
    // https://news.google.com/rss/articles/CBMi...

    // Try to follow the redirect
    const response = await fetch(googleNewsUrl, {
      method: 'HEAD', // Just get headers, not full content
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })

    // Get the final URL after redirects
    const finalUrl = response.url

    // Check if we got a real article URL (not still on google.com)
    if (finalUrl && !finalUrl.includes('google.com')) {
      return finalUrl
    }

    return null
  } catch (error) {
    console.error('Failed to resolve Google News URL:', error)
    return null
  }
}

/**
 * Extract actual URL from Google News redirect URL
 * Alternative method: parse the URL parameters
 */
export function parseGoogleNewsUrl(googleNewsUrl: string): string | null {
  try {
    const url = new URL(googleNewsUrl)

    // Check if it's a Google News URL
    if (!url.hostname.includes('google.com')) {
      return null
    }

    // Try to extract the actual URL from the 'url' parameter
    const urlParam = url.searchParams.get('url')
    if (urlParam) {
      return urlParam
    }

    // Google News sometimes encodes the URL in the path
    // The path looks like: /rss/articles/CBMi{base64}
    // The actual URL is encoded in the base64 part
    // This is complex and may require decoding - for now, return null

    return null
  } catch (error) {
    return null
  }
}

/**
 * Check if URL is a Google News redirect
 */
export function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com/rss/articles/') ||
         url.includes('news.google.com/articles/')
}

/**
 * Full cleaning pipeline: pre-clean HTML, extract with Readability, post-clean text
 */
export function cleanArticleContent(rawHtml: string, extractedText: string): {
  cleanedHtml: string
  cleanedText: string
  qualityScore: number
  qualityIssues: string[]
} {
  // Pre-clean HTML
  const cleanedHtml = preCleanHTML(rawHtml)

  // Post-clean extracted text
  const cleanedText = postCleanText(extractedText)

  // Calculate quality
  const { score, issues } = calculateContentQuality(cleanedText, '')

  return {
    cleanedHtml,
    cleanedText,
    qualityScore: score,
    qualityIssues: issues,
  }
}
