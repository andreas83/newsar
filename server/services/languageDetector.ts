import { franc } from 'franc'

/**
 * Detect language of text using franc
 * Returns ISO 639-3 language codes
 */
export function detectLanguage(text: string): {
  language: string
  confidence: number
  method: 'franc'
} {
  // franc requires at least 10 characters
  if (!text || text.length < 10) {
    return {
      language: 'und', // undefined
      confidence: 0,
      method: 'franc',
    }
  }

  // Get language code from franc
  const langCode = franc(text)

  // franc returns 'und' for undefined/unknown
  if (langCode === 'und') {
    return {
      language: 'und',
      confidence: 0,
      method: 'franc',
    }
  }

  // Estimate confidence based on text length and result
  // franc is very accurate for texts > 100 chars
  let confidence = 0.5
  if (text.length > 100) confidence = 0.7
  if (text.length > 500) confidence = 0.85
  if (text.length > 1000) confidence = 0.95

  return {
    language: langCode,
    confidence,
    method: 'franc',
  }
}

/**
 * Convert ISO 639-3 to ISO 639-1 (2-letter codes)
 * Common mappings for news articles
 */
export function iso3ToIso1(iso3: string): string {
  const mapping: Record<string, string> = {
    'eng': 'en',
    'spa': 'es',
    'fra': 'fr',
    'deu': 'de',
    'ita': 'it',
    'por': 'pt',
    'rus': 'ru',
    'jpn': 'ja',
    'kor': 'ko',
    'zho': 'zh',
    'ara': 'ar',
    'hin': 'hi',
    'ben': 'bn',
    'urd': 'ur',
    'nld': 'nl',
    'pol': 'pl',
    'tur': 'tr',
    'vie': 'vi',
    'tha': 'th',
    'ind': 'id',
    'und': 'und',
  }

  return mapping[iso3] || iso3
}

/**
 * Get language name from ISO code
 */
export function getLanguageName(iso3: string): string {
  const names: Record<string, string> = {
    'eng': 'English',
    'spa': 'Spanish',
    'fra': 'French',
    'deu': 'German',
    'ita': 'Italian',
    'por': 'Portuguese',
    'rus': 'Russian',
    'jpn': 'Japanese',
    'kor': 'Korean',
    'zho': 'Chinese',
    'ara': 'Arabic',
    'hin': 'Hindi',
    'ben': 'Bengali',
    'urd': 'Urdu',
    'nld': 'Dutch',
    'pol': 'Polish',
    'tur': 'Turkish',
    'vie': 'Vietnamese',
    'tha': 'Thai',
    'ind': 'Indonesian',
    'und': 'Unknown',
  }

  return names[iso3] || 'Unknown'
}
