import { generateChatCompletion } from '../utils/ollama.js'
import { classifySubtype, normalizeSubtype } from '../utils/entitySubtypes.js'

export interface Entity {
  name: string
  type: 'person' | 'organization' | 'location' | 'event' | 'topic'
  subtype?: string // Fine-grained classification (e.g., 'company', 'politician', 'country')
  relevance: number // 0-1, how important to the story
  mentions: number // How many times mentioned
  role?: 'protagonist' | 'antagonist' | 'neutral' | 'context' // OSINT role classification
}

export interface EntityExtractionResult {
  entities: Entity[]
  success: boolean
  error?: string
}

const VALID_ENTITY_TYPES = ['person', 'organization', 'location', 'event', 'topic'] as const

/**
 * Normalize entity type to one of the 4 standard types
 */
function normalizeEntityType(type: string): 'person' | 'organization' | 'location' | 'event' | 'topic' {
  const lower = type.toLowerCase().trim()

  // Direct matches
  if (VALID_ENTITY_TYPES.includes(lower as any)) return lower as any

  // Map non-standard types to standard ones
  const typeMap: Record<string, 'person' | 'organization' | 'location' | 'event' | 'topic'> = {
    'group': 'organization',
    'company': 'organization',
    'government': 'organization',
    'militant group': 'organization',
    'country': 'location',
    'city': 'location',
    'region': 'location',
    'position': 'person',
    'concept': 'topic',
    'disease': 'topic',
    'technology': 'topic',
    'chemical': 'topic',
    'material/chemical': 'topic',
    'phenomenon': 'topic',
    'ideology': 'topic',
    'policy': 'topic',
    'document': 'event',
    'object': 'event',
    'term': 'topic',
    'album': 'event',
    'animal': 'event',
  }

  return typeMap[lower] || 'event'
}

/**
 * Build the prompt and config for entity extraction (used by both real-time and batch)
 */
export function buildEntityPrompt(title: string, content: string): { prompt: string, systemPrompt: string, options: { temperature: number, maxTokens: number, jsonMode: boolean } } {
  const systemPrompt = `You are an OSINT Intelligence Analyst extracting entities for a knowledge graph.
Focus on accurate identification, relationship mapping, and geopolitical context.`

  const prompt = `Extract named entities from this news article for intelligence analysis.

Title: ${title}

Content: ${content.substring(0, 2500)}

Entity Types and Subtypes:
- PERSON: Key individuals. Subtypes: politician, executive, military_leader, journalist, athlete, academic, entertainer, activist
- ORGANIZATION: Governments, agencies, companies, militant groups. Subtypes: company, political_party, government, military, law_enforcement, armed_group, media, intergovernmental, sports, ngo, educational, religious
- LOCATION: Countries, cities, regions. Subtypes: country, city, region, strategic, territory
- EVENT: Specific time-bound incidents, named operations, scheduled occurrences. Subtypes: conflict, election, sports_event, diplomatic, cultural, disaster
- TOPIC: Ongoing abstract concepts, technologies, diseases, ideologies, policies, economic phenomena. Subtypes: technology, health, science, ideology, policy, economic. Use TOPIC (not EVENT) for things like "Artificial Intelligence", "COVID-19", "Climate Change", "Immigration".

Respond with ONLY JSON:
{
  "entities": [
    {
      "name": "Full Entity Name",
      "type": "person|organization|location|event|topic",
      "subtype": "<subtype from list above>",
      "relevance": <0.0-1.0>,
      "mentions": <count>,
      "role": "<protagonist|antagonist|neutral|context>"
    }
  ],
  "geoPov": "<primary geographic perspective of the article>"
}

Guidelines:
- Use canonical names (e.g., "United States" not "US", "European Union" not "EU")
- Include aliases in name if notable (e.g., "Nicolás Maduro (Maduro)")
- Maximum 12 entities, minimum relevance 0.3
- geoPov = country/region from which the story is primarily framed
- Always provide a subtype from the valid list for each entity type

Only return JSON.`

  return { prompt, systemPrompt, options: { temperature: 0, maxTokens: 1500, jsonMode: true } }
}

/**
 * Parse the raw LLM response text into structured entity extraction results
 */
export function parseEntityResponse(responseText: string): EntityExtractionResult {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { entities: [], success: false, error: 'Response does not contain JSON' }
  }

  let result: any
  try {
    result = JSON.parse(jsonMatch[0])
  } catch {
    return { entities: [], success: false, error: 'Malformed JSON response' }
  }

  const entities: Entity[] = (result.entities || [])
    .filter((e: any) => e.name && e.type && e.relevance >= 0.3)
    .map((e: any) => {
      const type = normalizeEntityType(e.type)
      const name = e.name.trim()
      // Normalize LLM subtype, fall back to rule-based classification
      const subtype = normalizeSubtype(type, e.subtype) || classifySubtype(type, name)
      return {
        name,
        type,
        subtype,
        relevance: Math.max(0, Math.min(1, e.relevance || 0.5)),
        mentions: Math.max(1, e.mentions || 1),
        role: e.role || 'neutral',
      }
    })
    .slice(0, 12)

  return { entities, success: true }
}

/**
 * Extract named entities from article using Ollama
 */
export async function extractEntities(
  title: string,
  content: string
): Promise<EntityExtractionResult> {
  try {
    const { prompt, systemPrompt, options } = buildEntityPrompt(title, content)

    const response = await generateChatCompletion(prompt, systemPrompt, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      format: 'json',
    })

    const result = parseEntityResponse(response)
    if (!result.success) {
      throw new Error(result.error || 'Failed to parse entity response')
    }
    return result
  } catch (error) {
    console.error('Error extracting entities with Ollama:', error)

    return {
      entities: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Extract geographic POV from entities
 * Returns the primary geographic perspective of the article
 */
export function extractGeoPOV(entities: Entity[]): string | null {
  const locations = entities
    .filter((e) => e.type === 'location')
    .sort((a, b) => b.relevance - a.relevance)

  if (locations.length === 0) {
    return null
  }

  // Return the most relevant location
  return locations[0].name
}

/**
 * Group similar entity names (for deduplication)
 * e.g., "US", "USA", "United States" → "United States"
 */
export function normalizeEntityName(name: string, type: string): string {
  // Common normalizations (exact match)
  const normalizations: Record<string, string> = {
    // Countries
    'US': 'United States',
    'USA': 'United States',
    'U.S.': 'United States',
    'U.S.A.': 'United States',
    'America': 'United States',
    'UK': 'United Kingdom',
    'U.K.': 'United Kingdom',
    'Britain': 'United Kingdom',
    'England': 'United Kingdom',
    'UAE': 'United Arab Emirates',
    'U.A.E.': 'United Arab Emirates',
    'Gaza': 'Gaza Strip',
    'PRC': 'China',
    'DPRK': 'North Korea',
    'ROK': 'South Korea',

    // Organizations
    'UN': 'United Nations',
    'U.N.': 'United Nations',
    'WHO': 'World Health Organization',
    'NATO': 'NATO',
    'EU': 'European Union',
    'E.U.': 'European Union',
    'FBI': 'Federal Bureau of Investigation',
    'CIA': 'Central Intelligence Agency',
    'DOJ': 'Department of Justice',
    'DOD': 'Department of Defense',
    'DHS': 'Department of Homeland Security',
    'ICJ': 'International Court of Justice',
    'ICC': 'International Criminal Court',
    'IMF': 'International Monetary Fund',
    'ECB': 'European Central Bank',
  }

  // Check exact alias match first
  if (normalizations[name]) {
    return normalizations[name]
  }

  let normalized = name

  // Remove parenthetical content: "Donald Trump (Trump)" → "Donald Trump"
  normalized = normalized.replace(/\s*\([^)]*\)\s*/g, ' ').trim()

  // For person entities, apply name normalization rules
  if (type === 'person') {
    // Remove title prefixes: "President Donald Trump" → "Donald Trump"
    const titlePrefixes = [
      'president', 'vice president', 'vice-president',
      'prime minister', 'premier', 'chancellor',
      'senator', 'sen\\.', 'representative', 'rep\\.',
      'congressman', 'congresswoman',
      'governor', 'gov\\.',
      'mayor', 'judge', 'justice', 'chief justice',
      'secretary', 'minister', 'ambassador',
      'general', 'gen\\.', 'admiral', 'colonel', 'col\\.',
      'captain', 'capt\\.',
      'king', 'queen', 'prince', 'princess',
      'pope', 'cardinal', 'bishop', 'archbishop',
      'dr\\.', 'doctor', 'prof\\.', 'professor',
      'sir', 'dame', 'lord', 'lady',
      'former president', 'former prime minister',
      'ex-president', 'ex-prime minister',
    ]
    const titlePattern = new RegExp(`^(?:${titlePrefixes.join('|')})\\s+`, 'i')
    normalized = normalized.replace(titlePattern, '')

    // Normalize periods out of middle initials for consistent matching:
    // "Donald J. Trump" → "Donald J Trump" (keep the letter, remove the period)
    // This ensures "Donald J. Trump" and "Donald J Trump" match each other
    normalized = normalized.replace(/\b([A-Z])\./g, '$1')
  }

  // Collapse whitespace and trim
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized || name
}
