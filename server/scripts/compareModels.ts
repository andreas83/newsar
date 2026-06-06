/**
 * Side-by-side model comparison: Gemini 2.0 Flash vs local Ollama gemma4:e2b
 * Tests bias classification, keyword extraction, summary, and sentiment on 3 articles.
 *
 * Usage: npx tsx server/scripts/compareModels.ts
 */

import { getDatabase } from '../database/db.js'
import { articles, feeds } from '../database/schema.js'
import { eq, isNotNull, sql, desc } from 'drizzle-orm'

// ─── Config ─────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11435'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e2b'

// Article IDs to test (EN, FR, DE)
const TEST_ARTICLE_IDS = [58858, 58842, 58890]

// ─── Provider Implementations ───────────────────────────────────────────────

interface LLMResult {
  text: string
  durationMs: number
  error?: string
}

async function callGemini(
  prompt: string,
  systemPrompt?: string,
  options?: { temperature?: number; maxTokens?: number; json?: boolean }
): Promise<LLMResult> {
  const start = Date.now()
  try {
    const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }], role: 'user' }],
        ...(systemPrompt && { systemInstruction: { parts: [{ text: systemPrompt }] } }),
        generationConfig: {
          maxOutputTokens: options?.maxTokens || 2000,
          temperature: options?.temperature ?? 0.3,
          ...(options?.json && { responseMimeType: 'application/json' }),
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Gemini ${response.status}: ${err.substring(0, 200)}`)
    }

    const data = await response.json() as any
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return { text, durationMs: Date.now() - start }
  } catch (error) {
    return {
      text: '',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

async function callOllama(
  prompt: string,
  systemPrompt?: string,
  options?: { temperature?: number; maxTokens?: number; json?: boolean }
): Promise<LLMResult> {
  const start = Date.now()
  try {
    const messages: any[] = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    // gemma4:e2b is a thinking model — thinking tokens count against num_predict,
    // so we need a much larger budget (thinking can use 1000+ tokens easily)
    const thinkingBudget = 4096
    const outputBudget = options?.maxTokens || 2000
    const totalPredict = thinkingBudget + outputBudget

    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        ...(options?.json && { format: 'json' }),
        options: {
          temperature: options?.temperature ?? 0.3,
          num_predict: totalPredict,
        },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Ollama ${response.status}: ${err.substring(0, 200)}`)
    }

    const data = await response.json() as any
    const text = data.message?.content || ''
    const thinking = data.message?.thinking || ''
    const doneReason = data.done_reason || ''
    if (doneReason === 'length') {
      console.warn(`  ${YELLOW}[Ollama] Warning: response truncated (done_reason=length)${RESET}`)
    }
    if (thinking && !text) {
      // Thinking model finished thinking but produced no content
      console.warn(`  ${YELLOW}[Ollama] Warning: thinking produced ${thinking.length} chars but content is empty${RESET}`)
    }
    return { text, durationMs: Date.now() - start }
  } catch (error) {
    return {
      text: '',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ─── Prompts (identical for both providers) ─────────────────────────────────

function biasPrompt(title: string, content: string, language: string) {
  const systemPrompt = `You are an expert Media Analyst specializing in propaganda detection and political bias.
Perform a deep-scan analysis to identify underlying leanings and rhetorical strategies.
${language !== 'en' ? `The article is written in ${language}. Analyze it in its original language context.` : ''}`

  const prompt = `Analyze this news article using these criteria:

1. **Adjective & Verb Polarity:** Words with emotional weight
2. **Omission Bias:** What perspectives or context might be missing?
3. **Framing:** How are "protagonists" and "antagonists" defined?
4. **Logical Fallacies:** Any Strawman, Ad Hominem, or Slippery Slope arguments?

Title: ${title}

Content: ${content.substring(0, 2000)}

Respond with ONLY a JSON object:
{
  "bias": <-1.0 to 1.0, where -1=far left, 0=center, 1=far right>,
  "confidence": <0 to 1>,
  "classification": "<Left|Center-Left|Center|Center-Right|Right|Sensationalist>",
  "techniques": ["<detected propaganda/framing techniques>"],
  "reasoning": "<2 sentence summary of neutrality assessment>"
}

Only return JSON.`

  return { prompt, systemPrompt }
}

function keywordPrompt(title: string, content: string, language: string) {
  const langNote = language !== 'en'
    ? `\nExtract keywords in the article's original language (${language}).`
    : ''

  const prompt = `Extract the most important keywords from this news article. Focus on topics, concepts, and themes.${langNote}

Title: ${title}

Content: ${content.substring(0, 2500)}

Respond with ONLY a JSON object:
{
  "keywords": [
    { "keyword": "keyword or phrase", "relevance": <0.0 to 1.0>, "category": "topic|entity|event|general" }
  ]
}

Maximum 10 keywords, only relevance >= 0.4. Only return JSON.`

  return { prompt, systemPrompt: undefined }
}

function summaryPrompt(title: string, content: string, language: string) {
  const langNote = language !== 'en'
    ? `Write the summary in the same language as the article (${language}).`
    : ''

  const prompt = `Write a concise, informative summary of this news article.

Title: ${title}

Content: ${content.substring(0, 2500)}

Write a summary that:
- Captures the main points and key facts
- Is 100-150 words (4-6 sentences)
- Uses clear, neutral language
- Focuses on the "who, what, when, where, why"
- Avoids opinion or interpretation
${langNote}

Return ONLY the summary text.`

  return { prompt, systemPrompt: undefined }
}

function sentimentPrompt(title: string, content: string, language: string) {
  const langNote = language !== 'en'
    ? `\nNote: This article is written in ${language}. Analyze the sentiment based on the original language context.`
    : ''

  const prompt = `Analyze the sentiment and emotional tone of this news article.${langNote}

Title: ${title}

Content: ${content.substring(0, 2500)}

Respond with ONLY a JSON object:
{
  "sentiment": <-1.0 to 1.0>,
  "confidence": <0 to 1>,
  "tone": "positive|negative|neutral|mixed",
  "emotions": ["emotion1", "emotion2"],
  "reasoning": "<brief explanation>"
}

Only return JSON.`

  return { prompt, systemPrompt: undefined }
}

// ─── Parsing Helpers ────────────────────────────────────────────────────────

function parseJSON(text: string): any {
  let clean = text.trim()
  if (clean.startsWith('```json')) clean = clean.slice(7)
  else if (clean.startsWith('```')) clean = clean.slice(3)
  if (clean.endsWith('```')) clean = clean.slice(0, -3)
  clean = clean.trim()

  // Try full parse first
  try { return JSON.parse(clean) } catch {}

  // Try extracting JSON object
  const match = clean.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch {}
  }

  return null
}

function biasLabel(bias: number): string {
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
}

function sentimentLabel(s: number): string {
  if (s <= -0.6) return 'Very Negative'
  if (s <= -0.2) return 'Negative'
  if (s < 0.2) return 'Neutral'
  if (s < 0.6) return 'Positive'
  return 'Very Positive'
}

// ─── Display ────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const MAGENTA = '\x1b[35m'
const WHITE = '\x1b[37m'

function hr(char = '─', len = 90) {
  console.log(DIM + char.repeat(len) + RESET)
}

function header(text: string) {
  console.log()
  hr('═')
  console.log(`${BOLD}${CYAN}  ${text}${RESET}`)
  hr('═')
}

function subHeader(text: string) {
  console.log(`\n${BOLD}${YELLOW}  >> ${text}${RESET}`)
  hr()
}

function col(label: string, gemini: string, ollama: string) {
  const pad = 18
  console.log(
    `  ${WHITE}${label.padEnd(pad)}${RESET}` +
    `${GREEN}${gemini.padEnd(40)}${RESET}` +
    `${MAGENTA}${ollama}${RESET}`
  )
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}Model Comparison: Gemini 2.0 Flash vs Ollama ${OLLAMA_MODEL}${RESET}`)
  console.log(`${DIM}Gemini model: ${GEMINI_MODEL}`)
  console.log(`Ollama host:  ${OLLAMA_HOST}`)
  console.log(`Ollama model: ${OLLAMA_MODEL}${RESET}\n`)

  // Verify Ollama is reachable
  try {
    const healthCheck = await fetch(`${OLLAMA_HOST}/api/tags`)
    if (!healthCheck.ok) throw new Error(`Status ${healthCheck.status}`)
    console.log(`${GREEN}Ollama reachable at ${OLLAMA_HOST}${RESET}`)
  } catch (e) {
    console.error(`${RED}Cannot reach Ollama at ${OLLAMA_HOST}: ${e}${RESET}`)
    process.exit(1)
  }

  if (!GEMINI_API_KEY) {
    console.error(`${RED}GEMINI_API_KEY not set${RESET}`)
    process.exit(1)
  }

  // Fetch articles
  const db = getDatabase()
  const testArticles = await db
    .select({
      id: articles.id,
      title: articles.title,
      fullContent: articles.fullContent,
      feedId: articles.feedId,
      feedName: feeds.name,
    })
    .from(articles)
    .innerJoin(feeds, eq(articles.feedId, feeds.id))
    .where(sql`${articles.id} IN (${sql.join(TEST_ARTICLE_IDS.map(id => sql`${id}`), sql`, `)})`)

  if (testArticles.length === 0) {
    console.error(`${RED}No articles found for IDs: ${TEST_ARTICLE_IDS.join(', ')}${RESET}`)
    process.exit(1)
  }

  console.log(`\n${BOLD}Testing ${testArticles.length} articles:${RESET}`)
  for (const a of testArticles) {
    console.log(`  [${a.id}] ${a.title?.substring(0, 70)} (${a.feedName})`)
  }

  const totalTimes = { gemini: 0, ollama: 0 }

  for (const article of testArticles) {
    const title = article.title || 'Untitled'
    const content = article.fullContent || ''
    // Detect language from feed name
    const lang = article.feedName?.includes('(DE)') ? 'de'
      : article.feedName?.includes('Figaro') ? 'fr'
      : 'en'

    header(`Article #${article.id}: ${title.substring(0, 60)}`)
    console.log(`${DIM}  Source: ${article.feedName} | Language: ${lang} | Content: ${content.length} chars${RESET}`)

    // ── 1. Bias Classification ──────────────────────────────────────────
    subHeader('Bias Classification')
    const bp = biasPrompt(title, content, lang)

    const [gemBias, ollBias] = await Promise.all([
      callGemini(bp.prompt, bp.systemPrompt, { temperature: 0, maxTokens: 300, json: true }),
      callOllama(bp.prompt, bp.systemPrompt, { temperature: 0, maxTokens: 300, json: true }),
    ])
    totalTimes.gemini += gemBias.durationMs
    totalTimes.ollama += ollBias.durationMs

    const gemBiasData = parseJSON(gemBias.text)
    const ollBiasData = parseJSON(ollBias.text)

    col('', `${GREEN}${BOLD}Gemini 2.0 Flash${RESET}`, `${MAGENTA}${BOLD}Ollama ${OLLAMA_MODEL}${RESET}`)
    col('Time',
      gemBias.error ? `ERROR: ${gemBias.error.substring(0, 35)}` : `${gemBias.durationMs}ms`,
      ollBias.error ? `ERROR: ${ollBias.error.substring(0, 35)}` : `${ollBias.durationMs}ms`
    )
    col('Bias score',
      gemBiasData ? `${gemBiasData.bias} (${biasLabel(gemBiasData.bias)})` : 'parse error',
      ollBiasData ? `${ollBiasData.bias} (${biasLabel(ollBiasData.bias)})` : 'parse error'
    )
    col('Confidence',
      gemBiasData ? String(gemBiasData.confidence) : '-',
      ollBiasData ? String(ollBiasData.confidence) : '-'
    )
    col('Classification',
      gemBiasData?.classification || '-',
      ollBiasData?.classification || '-'
    )
    col('Techniques',
      gemBiasData?.techniques?.join(', ')?.substring(0, 38) || '-',
      ollBiasData?.techniques?.join(', ')?.substring(0, 38) || '-'
    )
    console.log(`${DIM}  Gemini reasoning: ${gemBiasData?.reasoning?.substring(0, 80) || '-'}${RESET}`)
    console.log(`${DIM}  Ollama reasoning: ${ollBiasData?.reasoning?.substring(0, 80) || '-'}${RESET}`)

    // ── 2. Keyword Extraction ───────────────────────────────────────────
    subHeader('Keyword Extraction')
    const kp = keywordPrompt(title, content, lang)

    const [gemKw, ollKw] = await Promise.all([
      callGemini(kp.prompt, kp.systemPrompt, { temperature: 0.2, maxTokens: 400, json: true }),
      callOllama(kp.prompt, kp.systemPrompt, { temperature: 0.2, maxTokens: 400, json: true }),
    ])
    totalTimes.gemini += gemKw.durationMs
    totalTimes.ollama += ollKw.durationMs

    const gemKwData = parseJSON(gemKw.text)
    const ollKwData = parseJSON(ollKw.text)

    col('Time',
      gemKw.error ? `ERROR` : `${gemKw.durationMs}ms`,
      ollKw.error ? `ERROR` : `${ollKw.durationMs}ms`
    )

    const gemKeywords = (gemKwData?.keywords || []).map((k: any) => k.keyword).join(', ')
    const ollKeywords = (ollKwData?.keywords || []).map((k: any) => k.keyword).join(', ')
    console.log(`  ${GREEN}Gemini: ${gemKeywords.substring(0, 85) || 'parse error'}${RESET}`)
    console.log(`  ${MAGENTA}Ollama: ${ollKeywords.substring(0, 85) || 'parse error'}${RESET}`)

    // ── 3. Summary Generation ───────────────────────────────────────────
    subHeader('Summary (medium)')
    const sp = summaryPrompt(title, content, lang)

    const [gemSum, ollSum] = await Promise.all([
      callGemini(sp.prompt, sp.systemPrompt, { temperature: 0.3, maxTokens: 350 }),
      callOllama(sp.prompt, sp.systemPrompt, { temperature: 0.3, maxTokens: 350 }),
    ])
    totalTimes.gemini += gemSum.durationMs
    totalTimes.ollama += ollSum.durationMs

    col('Time',
      gemSum.error ? `ERROR` : `${gemSum.durationMs}ms`,
      ollSum.error ? `ERROR` : `${ollSum.durationMs}ms`
    )
    col('Words',
      gemSum.text ? `${gemSum.text.split(/\s+/).length}` : '-',
      ollSum.text ? `${ollSum.text.split(/\s+/).length}` : '-'
    )
    console.log(`\n  ${GREEN}Gemini summary:${RESET}`)
    console.log(`  ${gemSum.text?.substring(0, 300) || gemSum.error || '-'}`)
    console.log(`\n  ${MAGENTA}Ollama summary:${RESET}`)
    console.log(`  ${ollSum.text?.substring(0, 300) || ollSum.error || '-'}`)

    // ── 4. Sentiment Analysis ───────────────────────────────────────────
    subHeader('Sentiment Analysis')
    const sep = sentimentPrompt(title, content, lang)

    const [gemSent, ollSent] = await Promise.all([
      callGemini(sep.prompt, sep.systemPrompt, { temperature: 0.3, maxTokens: 250, json: true }),
      callOllama(sep.prompt, sep.systemPrompt, { temperature: 0.3, maxTokens: 250, json: true }),
    ])
    totalTimes.gemini += gemSent.durationMs
    totalTimes.ollama += ollSent.durationMs

    const gemSentData = parseJSON(gemSent.text)
    const ollSentData = parseJSON(ollSent.text)

    col('Time',
      gemSent.error ? `ERROR` : `${gemSent.durationMs}ms`,
      ollSent.error ? `ERROR` : `${ollSent.durationMs}ms`
    )
    col('Sentiment',
      gemSentData ? `${gemSentData.sentiment} (${sentimentLabel(gemSentData.sentiment)})` : 'parse error',
      ollSentData ? `${ollSentData.sentiment} (${sentimentLabel(ollSentData.sentiment)})` : 'parse error'
    )
    col('Tone',
      gemSentData?.tone || '-',
      ollSentData?.tone || '-'
    )
    col('Emotions',
      (gemSentData?.emotions || []).join(', ').substring(0, 38) || '-',
      (ollSentData?.emotions || []).join(', ').substring(0, 38) || '-'
    )
    console.log(`${DIM}  Gemini: ${gemSentData?.reasoning?.substring(0, 80) || '-'}${RESET}`)
    console.log(`${DIM}  Ollama: ${ollSentData?.reasoning?.substring(0, 80) || '-'}${RESET}`)
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  header('TOTALS')
  const articles_count = testArticles.length
  const tasks_per_article = 4
  const total_tasks = articles_count * tasks_per_article

  console.log(`  Articles tested: ${articles_count}`)
  console.log(`  Tasks per article: ${tasks_per_article} (bias, keywords, summary, sentiment)`)
  console.log(`  Total LLM calls: ${total_tasks} per provider`)
  console.log()
  col('Total time',
    `${(totalTimes.gemini / 1000).toFixed(1)}s`,
    `${(totalTimes.ollama / 1000).toFixed(1)}s`
  )
  col('Avg per task',
    `${Math.round(totalTimes.gemini / total_tasks)}ms`,
    `${Math.round(totalTimes.ollama / total_tasks)}ms`
  )
  col('Speed ratio',
    '1.0x (baseline)',
    `${(totalTimes.ollama / totalTimes.gemini).toFixed(1)}x`
  )

  const geminiCostPerMonth = 0 // Free tier
  console.log(`\n  ${DIM}Gemini 2.0 Flash: free tier (15 RPM) or ~$0.10/1M input tokens`)
  console.log(`  Ollama ${OLLAMA_MODEL}: $0/mo (local hardware cost only)${RESET}`)

  console.log()
  process.exit(0)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
