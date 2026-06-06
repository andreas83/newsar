/**
 * Wikidata enrichment service for entity pages.
 * Fetches structured data (birth dates, occupations, HQ locations, etc.)
 * from Wikidata and Wikipedia REST API.
 *
 * Builds on the pattern from wikiImageFetcher.ts.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const WIKIPEDIA_API = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const USER_AGENT = 'Newsar/1.0 (news aggregation platform; contact@codejungle.org)'

// In-memory cache (1 hour TTL)
const enrichmentCache = new Map<string, { data: EnrichmentResult | null; fetchedAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000

export interface EnrichmentResult {
  wikidataId: string
  wikipediaUrl: string | null
  imageUrl: string | null
  description: string | null
  properties: Record<string, any>
}

// Wikidata property IDs by entity type
const PROPERTY_MAP: Record<string, string[]> = {
  person: ['P569', 'P570', 'P106', 'P27', 'P39'],        // birth, death, occupation, nationality, position
  organization: ['P571', 'P159', 'P169', 'P452', 'P856'], // inception, HQ, CEO, industry, website
  location: ['P17', 'P1082', 'P625', 'P856'],             // country, population, coordinates, website
  event: ['P580', 'P582', 'P276', 'P710'],                // start, end, location, participants
}

const PROPERTY_LABELS: Record<string, string> = {
  P569: 'birthDate',
  P570: 'deathDate',
  P106: 'occupation',
  P27: 'nationality',
  P39: 'positionHeld',
  P571: 'founded',
  P159: 'headquarters',
  P169: 'ceo',
  P452: 'industry',
  P856: 'website',
  P17: 'country',
  P1082: 'population',
  P625: 'coordinates',
  P580: 'startDate',
  P582: 'endDate',
  P276: 'location',
  P710: 'participants',
  P18: 'image',
  P154: 'logo',
}

/**
 * Search Wikidata for an entity by name and return the best match ID.
 * Replicates logic from wikiImageFetcher.ts searchWikidata().
 */
async function searchWikidata(name: string, entityType: string): Promise<string | null> {
  try {
    const url = new URL(WIKIDATA_API)
    url.searchParams.set('action', 'wbsearchentities')
    url.searchParams.set('search', name)
    url.searchParams.set('language', 'en')
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '5')
    url.searchParams.set('origin', '*')

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    })
    if (!response.ok) return null

    const data = await response.json() as {
      search?: Array<{ id: string; label: string; description?: string }>
    }
    if (!data.search?.length) return null

    const typeKeywords: Record<string, string[]> = {
      person: ['politician', 'president', 'minister', 'actor', 'singer', 'writer', 'journalist', 'athlete', 'leader', 'born', 'american', 'british', 'french', 'german', 'human'],
      organization: ['company', 'organization', 'corporation', 'agency', 'institution', 'party', 'group', 'association', 'foundation', 'bank', 'media', 'news', 'alliance', 'military', 'government', 'intergovernmental', 'international', 'union', 'council', 'commission', 'ministry'],
      location: ['city', 'country', 'state', 'province', 'region', 'capital', 'municipality', 'territory'],
      event: ['event', 'war', 'conflict', 'election', 'summit', 'conference', 'disaster', 'crisis'],
    }

    // Negative keywords: descriptions that indicate a wrong match (e.g. "given name", "family name")
    const negativeKeywords = ['given name', 'family name', 'surname', 'disambiguation']

    const keywords = typeKeywords[entityType] || []

    // Score each result: keyword match + position bonus (earlier = better).
    // This avoids picking a lower-ranked result just because it has a keyword match.
    let bestId: string | null = null
    let bestScore = -1

    for (let i = 0; i < data.search.length; i++) {
      const result = data.search[i]
      const desc = (result.description || '').toLowerCase()

      // Skip results with negative keywords
      if (negativeKeywords.some(nk => desc.includes(nk))) continue

      const positionScore = 5 - i // 5 for first, 4 for second, etc.
      const keywordScore = keywords.some(kw => desc.includes(kw)) ? 3 : 0
      const score = positionScore + keywordScore

      if (score > bestScore) {
        bestScore = score
        bestId = result.id
      }
    }

    return bestId || data.search[0].id
  } catch (error) {
    console.warn(`[WikidataEnricher] Search failed for "${name}":`, error)
    return null
  }
}

/**
 * Fetch full entity data from Wikidata using wbgetentities API.
 */
async function fetchEntityData(wikidataId: string): Promise<any | null> {
  try {
    const url = new URL(WIKIDATA_API)
    url.searchParams.set('action', 'wbgetentities')
    url.searchParams.set('ids', wikidataId)
    url.searchParams.set('props', 'claims|sitelinks|descriptions')
    url.searchParams.set('languages', 'en')
    url.searchParams.set('sitefilter', 'enwiki')
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    })
    if (!response.ok) return null

    const data = await response.json()
    return data.entities?.[wikidataId] || null
  } catch (error) {
    console.warn(`[WikidataEnricher] Failed to fetch entity ${wikidataId}:`, error)
    return null
  }
}

/**
 * Resolve Wikidata entity IDs (Q-numbers) to their labels in batch.
 */
async function resolveEntityLabels(entityIds: string[]): Promise<Record<string, string>> {
  if (entityIds.length === 0) return {}

  // Batch in groups of 50 (Wikidata API limit)
  const labels: Record<string, string> = {}
  const batches: string[][] = []
  for (let i = 0; i < entityIds.length; i += 50) {
    batches.push(entityIds.slice(i, i + 50))
  }

  for (const batch of batches) {
    try {
      const url = new URL(WIKIDATA_API)
      url.searchParams.set('action', 'wbgetentities')
      url.searchParams.set('ids', batch.join('|'))
      url.searchParams.set('props', 'labels')
      url.searchParams.set('languages', 'en')
      url.searchParams.set('format', 'json')
      url.searchParams.set('origin', '*')

      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      })
      if (!response.ok) continue

      const data = await response.json()
      for (const [id, entity] of Object.entries(data.entities || {})) {
        const label = (entity as any)?.labels?.en?.value
        if (label) labels[id] = label
      }
    } catch {
      // Continue with partial labels
    }
  }

  return labels
}

/**
 * Extract a claim value from Wikidata claims structure.
 */
function extractClaimValue(claim: any): { type: string; value: any } | null {
  const snak = claim?.mainsnak
  if (!snak?.datavalue) return null

  const { type, value } = snak.datavalue

  switch (type) {
    case 'time':
      return { type: 'time', value: value.time }
    case 'string':
      return { type: 'string', value }
    case 'wikibase-entityid':
      return { type: 'entity', value: value.id }
    case 'quantity':
      return { type: 'quantity', value: value.amount?.replace('+', '') }
    case 'globecoordinate':
      return { type: 'coordinates', value: { lat: value.latitude, lng: value.longitude } }
    default:
      return null
  }
}

/**
 * Format a Wikidata time string to a readable date.
 */
function formatWikidataTime(timeStr: string): string {
  // Format: +1946-06-14T00:00:00Z
  const match = timeStr.match(/([+-]?\d+)-(\d{2})-(\d{2})/)
  if (!match) return timeStr

  const year = parseInt(match[1])
  const month = parseInt(match[2])
  const day = parseInt(match[3])

  if (month === 0 && day === 0) return `${year}`
  if (day === 0) {
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December']
    return `${months[month]} ${year}`
  }

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  })
}

/**
 * Extract structured properties from Wikidata entity claims.
 */
async function extractProperties(claims: Record<string, any[]>, entityType: string): Promise<Record<string, any>> {
  const properties: Record<string, any> = {}
  const propertyIds = PROPERTY_MAP[entityType] || []
  // Also check for image (P18) and logo (P154)
  const allProps = [...propertyIds, 'P18', 'P154']

  // Collect all entity IDs that need label resolution
  const entityIdsToResolve: string[] = []

  for (const propId of allProps) {
    const propClaims = claims[propId]
    if (!propClaims?.length) continue

    const propLabel = PROPERTY_LABELS[propId] || propId

    // For multi-value properties (occupation, nationality, etc.), collect all values
    const multiValueProps = ['P106', 'P27', 'P39', 'P710']
    if (multiValueProps.includes(propId)) {
      const values: any[] = []
      for (const claim of propClaims.slice(0, 5)) {
        const extracted = extractClaimValue(claim)
        if (!extracted) continue
        if (extracted.type === 'entity') {
          entityIdsToResolve.push(extracted.value)
          values.push({ entityId: extracted.value, label: extracted.value })
        } else {
          values.push(extracted.value)
        }
      }
      if (values.length > 0) properties[propLabel] = values
    } else {
      // Single value
      const extracted = extractClaimValue(propClaims[0])
      if (!extracted) continue

      if (extracted.type === 'time') {
        properties[propLabel] = formatWikidataTime(extracted.value)
      } else if (extracted.type === 'entity') {
        entityIdsToResolve.push(extracted.value)
        properties[propLabel] = { entityId: extracted.value, label: extracted.value }
      } else if (extracted.type === 'coordinates') {
        properties[propLabel] = extracted.value
      } else if (extracted.type === 'quantity') {
        const num = parseFloat(extracted.value)
        properties[propLabel] = isNaN(num) ? extracted.value : num.toLocaleString('en-US')
      } else {
        properties[propLabel] = extracted.value
      }
    }
  }

  // Batch-resolve all entity references to labels
  if (entityIdsToResolve.length > 0) {
    const labels = await resolveEntityLabels([...new Set(entityIdsToResolve)])

    // Replace entity IDs with labels in properties
    for (const [key, value] of Object.entries(properties)) {
      if (Array.isArray(value)) {
        properties[key] = value.map(v => {
          if (v?.entityId && labels[v.entityId]) return labels[v.entityId]
          return v
        })
      } else if (value?.entityId && labels[value.entityId]) {
        properties[key] = labels[value.entityId]
      }
    }
  }

  return properties
}

/**
 * Get Wikipedia summary/description for an entity.
 */
async function getWikipediaDescription(title: string): Promise<string | null> {
  try {
    const encodedTitle = encodeURIComponent(title.replace(/ /g, '_'))
    const response = await fetch(`${WIKIPEDIA_API}/${encodedTitle}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    })
    if (!response.ok) return null

    const data = await response.json()
    return data.extract || null
  } catch {
    return null
  }
}

/**
 * Convert a Wikimedia Commons filename to an image URL.
 */
function getCommonsImageUrl(filename: string, width: number = 300): string {
  const encodedFilename = encodeURIComponent(filename.replace(/ /g, '_'))
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=${width}`
}

/**
 * Main enrichment function: fetches structured data from Wikidata for an entity.
 */
export async function enrichEntity(name: string, entityType: string): Promise<EnrichmentResult | null> {
  // Check in-memory cache
  const cacheKey = `${entityType}:${name.toLowerCase()}`
  const cached = enrichmentCache.get(cacheKey)
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    // Step 1: Search Wikidata for the entity
    const wikidataId = await searchWikidata(name, entityType)
    if (!wikidataId) {
      enrichmentCache.set(cacheKey, { data: null, fetchedAt: Date.now() })
      return null
    }

    // Step 2: Fetch full entity data
    const entityData = await fetchEntityData(wikidataId)
    if (!entityData) {
      enrichmentCache.set(cacheKey, { data: null, fetchedAt: Date.now() })
      return null
    }

    // Step 3: Extract Wikipedia URL from sitelinks
    const enwikiTitle = entityData.sitelinks?.enwiki?.title || null
    const wikipediaUrl = enwikiTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwikiTitle.replace(/ /g, '_'))}`
      : null

    // Step 4: Extract image URL from claims (P18 image, P154 logo)
    let imageUrl: string | null = null
    const imageClaims = entityData.claims?.['P18'] || entityData.claims?.['P154']
    if (imageClaims?.length) {
      const filename = imageClaims[0]?.mainsnak?.datavalue?.value
      if (filename) imageUrl = getCommonsImageUrl(filename)
    }

    // Step 5: Get Wikipedia description
    const description = enwikiTitle
      ? await getWikipediaDescription(enwikiTitle)
      : entityData.descriptions?.en?.value || null

    // Step 6: Extract structured properties
    const properties = await extractProperties(entityData.claims || {}, entityType)

    const result: EnrichmentResult = {
      wikidataId,
      wikipediaUrl,
      imageUrl,
      description,
      properties,
    }

    enrichmentCache.set(cacheKey, { data: result, fetchedAt: Date.now() })
    return result
  } catch (error) {
    console.warn(`[WikidataEnricher] Failed to enrich "${name}" (${entityType}):`, error)
    enrichmentCache.set(cacheKey, { data: null, fetchedAt: Date.now() })
    return null
  }
}
