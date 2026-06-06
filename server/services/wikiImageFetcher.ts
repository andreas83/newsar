/**
 * Fetches portrait/logo images from Wikidata for entity pages.
 * Uses the Wikidata API (no auth needed, free, good coverage for public figures).
 *
 * For persons: Uses P18 (image) property
 * For organizations: Uses P18 (image) or P154 (logo image) property
 */

// In-memory cache to avoid repeated API calls within the same process
const imageCache = new Map<string, { url: string | null; fetchedAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Search Wikidata for an entity by name and return the best matching entity ID
 */
async function searchWikidata(name: string, entityType: string): Promise<string | null> {
  try {
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.searchParams.set('action', 'wbsearchentities')
    url.searchParams.set('search', name)
    url.searchParams.set('language', 'en')
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '5')
    url.searchParams.set('origin', '*')

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Newsar/1.0 (news aggregation platform; contact@codejungle.org)',
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      console.warn(`[WikiImageFetcher] Wikidata search failed with status ${response.status}`)
      return null
    }

    const data = await response.json() as {
      search?: Array<{
        id: string
        label: string
        description?: string
      }>
    }

    if (!data.search || data.search.length === 0) {
      return null
    }

    // Try to find the best match based on entity type
    // For persons, prefer results with descriptions containing person-related keywords
    // For organizations, prefer descriptions with org-related keywords
    const typeKeywords: Record<string, string[]> = {
      person: ['politician', 'president', 'minister', 'actor', 'singer', 'writer', 'journalist', 'athlete', 'leader', 'born', 'american', 'british', 'french', 'german', 'human'],
      organization: ['company', 'organization', 'corporation', 'agency', 'institution', 'party', 'group', 'association', 'foundation', 'bank', 'media', 'news'],
      location: ['city', 'country', 'state', 'province', 'region', 'capital', 'municipality', 'territory'],
      event: ['event', 'war', 'conflict', 'election', 'summit', 'conference', 'disaster', 'crisis'],
    }

    const keywords = typeKeywords[entityType] || []

    // First pass: try to find a result whose description matches the entity type
    for (const result of data.search) {
      const desc = (result.description || '').toLowerCase()
      if (keywords.some(kw => desc.includes(kw))) {
        return result.id
      }
    }

    // If no type-specific match, return the first result
    return data.search[0].id
  } catch (error) {
    console.warn(`[WikiImageFetcher] Error searching Wikidata for "${name}":`, error)
    return null
  }
}

/**
 * Get image filename from a Wikidata entity's claims
 * Checks P18 (image) first, then P154 (logo) for organizations
 */
async function getImageFromEntity(entityId: string, entityType: string): Promise<string | null> {
  try {
    // Properties to check: P18 = image, P154 = logo image
    const properties = entityType === 'organization' ? ['P18', 'P154'] : ['P18']

    for (const property of properties) {
      const url = new URL('https://www.wikidata.org/w/api.php')
      url.searchParams.set('action', 'wbgetclaims')
      url.searchParams.set('entity', entityId)
      url.searchParams.set('property', property)
      url.searchParams.set('format', 'json')
      url.searchParams.set('origin', '*')

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Newsar/1.0 (news aggregation platform; contact@codejungle.org)',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) continue

      const data = await response.json() as {
        claims?: Record<string, Array<{
          mainsnak?: {
            datavalue?: {
              value?: string
            }
          }
        }>>
      }

      const claims = data.claims?.[property]
      if (claims && claims.length > 0) {
        const filename = claims[0]?.mainsnak?.datavalue?.value
        if (filename) {
          return filename
        }
      }
    }

    return null
  } catch (error) {
    console.warn(`[WikiImageFetcher] Error getting image for entity ${entityId}:`, error)
    return null
  }
}

/**
 * Convert a Wikimedia Commons filename to an actual image URL
 * Uses Special:FilePath for reliable resolution
 */
function getCommonsImageUrl(filename: string, width: number = 300): string {
  const encodedFilename = encodeURIComponent(filename.replace(/ /g, '_'))
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=${width}`
}

/**
 * Main function: Fetches an image URL from Wikidata for a given entity
 *
 * @param name - The entity name (e.g., "Donald Trump", "Microsoft")
 * @param entityType - The entity type: 'person', 'organization', 'location', 'event'
 * @returns The image URL string or null if not found
 */
export async function fetchEntityImage(name: string, entityType: string): Promise<string | null> {
  // Check cache first
  const cacheKey = `${entityType}:${name.toLowerCase()}`
  const cached = imageCache.get(cacheKey)
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.url
  }

  try {
    // Step 1: Search Wikidata for the entity
    const wikidataId = await searchWikidata(name, entityType)
    if (!wikidataId) {
      imageCache.set(cacheKey, { url: null, fetchedAt: Date.now() })
      return null
    }

    // Step 2: Get image filename from entity claims
    const filename = await getImageFromEntity(wikidataId, entityType)
    if (!filename) {
      imageCache.set(cacheKey, { url: null, fetchedAt: Date.now() })
      return null
    }

    // Step 3: Convert filename to Commons URL
    const imageUrl = getCommonsImageUrl(filename, 300)

    // Cache the result
    imageCache.set(cacheKey, { url: imageUrl, fetchedAt: Date.now() })

    return imageUrl
  } catch (error) {
    console.warn(`[WikiImageFetcher] Failed to fetch image for "${name}" (${entityType}):`, error)
    imageCache.set(cacheKey, { url: null, fetchedAt: Date.now() })
    return null
  }
}
