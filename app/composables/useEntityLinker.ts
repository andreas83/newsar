/**
 * Composable for linking entities in article text
 * Replaces entity mentions with clickable links to entity pages
 */

interface EntityMention {
  id: number
  type: string
  name: string
  slug: string
  relevanceScore: number
}

interface LinkedText {
  raw: string
  html: string
  entities: EntityMention[]
}

export function useEntityLinker() {
  /**
   * Process article text and replace entity mentions with links
   * @param text - The article text to process
   * @param entities - Array of entities mentioned in the article
   * @returns Object with raw text, HTML with entity links, and entity metadata
   */
  function linkEntities(text: string, entities: EntityMention[]): LinkedText {
    if (!text || !entities || entities.length === 0) {
      return {
        raw: text,
        html: escapeHtml(text),
        entities: []
      }
    }

    // Sort entities by name length (longest first) to avoid partial matches
    const sortedEntities = [...entities].sort((a, b) => b.name.length - a.name.length)

    let linkedText = escapeHtml(text)
    const linkedEntities: EntityMention[] = []

    // Replace each entity mention with a link
    for (const entity of sortedEntities) {
      // Create a case-insensitive regex that matches whole words
      // Use word boundaries to avoid matching partial words
      const regex = new RegExp(`\\b${escapeRegex(entity.name)}\\b`, 'gi')

      // Check if this entity is actually mentioned in the text
      if (regex.test(linkedText)) {
        // Create the entity link HTML
        const entityLink = `<a href="/${entity.type}/${entity.slug}" class="entity-link entity-${entity.type}" data-entity-id="${entity.id}" data-entity-type="${entity.type}">${entity.name}</a>`

        // Replace all occurrences
        linkedText = linkedText.replace(regex, entityLink)

        // Track that we linked this entity
        linkedEntities.push(entity)
      }
    }

    return {
      raw: text,
      html: linkedText,
      entities: linkedEntities
    }
  }

  /**
   * Extract entity links from HTML text
   * @param html - HTML text containing entity links
   * @returns Array of entity IDs found in the HTML
   */
  function extractEntityIds(html: string): number[] {
    const regex = /data-entity-id="(\d+)"/g
    const ids: number[] = []
    let match

    while ((match = regex.exec(html)) !== null) {
      ids.push(parseInt(match[1]))
    }

    return [...new Set(ids)] // Remove duplicates
  }

  /**
   * Escape HTML special characters (SSR-safe)
   */
  function escapeHtml(text: string): string {
    const htmlEscapes: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return text.replace(/[&<>"']/g, char => htmlEscapes[char] || char)
  }

  /**
   * Escape regex special characters
   */
  function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  return {
    linkEntities,
    extractEntityIds
  }
}
