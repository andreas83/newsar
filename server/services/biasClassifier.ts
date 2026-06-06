import { generateChatCompletion } from '../utils/ollama.js'

/**
 * Political bias classification
 * Returns a score from -1 (left) to 1 (right)
 */

export interface BiasResult {
  bias: number // -1 (left) to 1 (right), 0 = center
  confidence: number // 0 to 1
  method: 'rule-based' | 'ollama' | 'hybrid'
  reasoning?: string
  techniques?: string[] // OSINT: detected propaganda/framing techniques
  classification?: string // OSINT: Left|Center-Left|Center|Center-Right|Right|Sensationalist
}

/**
 * Get region-appropriate political spectrum framework for bias analysis
 */
function getBiasFrameworkForLanguage(language: string): string {
  switch (language) {
    case 'de':
      return `Bias Scale (German political spectrum):
- Far left (-1.0 to -0.6): Die Linke positions, anti-capitalist, radical social reform
- Center-left (-0.5 to -0.2): SPD/Gruene positions, social democracy, progressive policies
- Center (-0.1 to 0.1): Balanced, neutral, fact-focused reporting
- Center-right (0.2 to 0.5): CDU/CSU positions, ordoliberalism, conservative values
- Far right (0.6 to 1.0): AfD positions, nationalist, anti-immigration framing`

    case 'es':
      return `Bias Scale (Spanish/Latin American political spectrum):
- Far left (-1.0 to -0.6): Podemos/radical left positions, anti-austerity, bolivarianismo
- Center-left (-0.5 to -0.2): PSOE/social democratic positions, progressive social policies
- Center (-0.1 to 0.1): Balanced, neutral, fact-focused reporting
- Center-right (0.2 to 0.5): PP/liberal-conservative positions, pro-market, traditional values
- Far right (0.6 to 1.0): Vox positions, nationalist, strong conservative framing`

    case 'fr':
      return `Bias Scale (French political spectrum):
- Far left (-1.0 to -0.6): LFI/NPA positions, anti-capitalist, radical social reform
- Center-left (-0.5 to -0.2): PS/EELV positions, social democratic, progressive
- Center (-0.1 to 0.1): Renaissance/centrist, balanced, fact-focused reporting
- Center-right (0.2 to 0.5): LR positions, pro-business, traditional values
- Far right (0.6 to 1.0): RN/Reconquete positions, nationalist, anti-immigration framing`

    default: // English / fallback
      return `Bias Scale:
- Far left (-1.0 to -0.6): Anti-capitalist, strong progressive framing
- Center-left (-0.5 to -0.2): Liberal, progressive social policies
- Center (-0.1 to 0.1): Balanced, neutral, fact-focused
- Center-right (0.2 to 0.5): Pro-market, traditional values
- Far right (0.6 to 1.0): Nationalist, strong conservative framing`
  }
}

/**
 * Get bias from known source (rule-based)
 */
export function getSourceBias(knownBias: number | null): BiasResult | null {
  if (knownBias === null || knownBias === undefined) {
    return null
  }

  return {
    bias: knownBias,
    confidence: 0.9, // High confidence for known sources
    method: 'rule-based',
  }
}

/**
 * Analyze content bias using Ollama (for unknown sources)
 */
export async function analyzeContentBias(
  title: string,
  content: string,
  useOllama: boolean = true,
  language: string = 'en'
): Promise<BiasResult> {
  if (!useOllama) {
    // Default to center if Ollama not available
    return {
      bias: 0,
      confidence: 0.3,
      method: 'rule-based',
      reasoning: 'No Ollama analysis, defaulting to center',
    }
  }

  try {
    // OSINT-grade deep bias analysis prompt
    const languageInstruction = language !== 'en'
      ? `The article is written in ${language}. Analyze it in its original language context.`
      : ''

    const systemPrompt = `You are an expert Media Analyst specializing in propaganda detection and political bias.
Perform a deep-scan analysis to identify underlying leanings and rhetorical strategies.
${languageInstruction}`

    const biasFramework = getBiasFrameworkForLanguage(language)

    const prompt = `Analyze this news article using these criteria:

1. **Adjective & Verb Polarity:** Words with emotional weight (e.g., "scathing" vs "critical")
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

${biasFramework}

Only return JSON.`

    const response = await generateChatCompletion(prompt, systemPrompt, {
      temperature: 0, // Zero for consistent, objective analysis
      maxTokens: 300,
      format: 'json',
    })

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Ollama bias response does not contain JSON:', response.substring(0, 300))
      throw new Error('Invalid JSON response from Ollama')
    }

    let result
    try {
      result = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('Failed to parse bias JSON:', jsonMatch[0].substring(0, 300))
      throw new Error('Malformed JSON response from Ollama')
    }

    // Validate and clamp values
    const bias = Math.max(-1, Math.min(1, result.bias || 0))
    const confidence = Math.max(0, Math.min(1, result.confidence || 0.5))

    return {
      bias,
      confidence,
      method: 'ollama',
      reasoning: result.reasoning || 'No reasoning provided',
      techniques: Array.isArray(result.techniques) ? result.techniques : [],
      classification: result.classification || undefined,
    }
  } catch (error) {
    console.error('Error analyzing content bias with Ollama:', error)

    // Fallback to center
    return {
      bias: 0,
      confidence: 0.2,
      method: 'ollama',
      reasoning: `Ollama analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Classify article bias using hybrid approach
 */
export async function classifyBias(
  title: string,
  content: string,
  knownBias: number | null,
  useOllama: boolean = true,
  language: string = 'en'
): Promise<BiasResult> {
  // 1. Try rule-based first (if known source)
  const sourceBias = getSourceBias(knownBias)
  if (sourceBias) {
    return sourceBias
  }

  // 2. Fall back to content analysis with Ollama
  const contentBias = await analyzeContentBias(title, content, useOllama, language)

  return {
    ...contentBias,
    method: 'hybrid',
  }
}

/**
 * Get bias label for display
 */
export function getBiasLabel(bias: number): string {
  if (bias <= -0.6) return 'Far Left'
  if (bias <= -0.2) return 'Center-Left'
  if (bias < 0.2) return 'Center'
  if (bias < 0.6) return 'Center-Right'
  return 'Far Right'
}

/**
 * Get bias color for visualization
 */
export function getBiasColor(bias: number): string {
  if (bias <= -0.6) return '#0066CC' // Blue
  if (bias <= -0.2) return '#4D94FF' // Light Blue
  if (bias < 0.2) return '#999999' // Gray
  if (bias < 0.6) return '#FF6B6B' // Light Red
  return '#CC0000' // Red
}
