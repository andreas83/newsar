/**
 * Recognise an outlet's mentions of itself among extracted entities.
 *
 * The LLM lists the publishing outlet as an organization ("Al Jazeera" in an
 * Al Jazeera article, "BBC Verify" in a BBC one). Those are bylines, not
 * subjects, and they skewed entity rankings and the network graph.
 *
 * Aliases come from feeds.publisher_aliases. A trailing "*" matches as a prefix
 * ("bbc*" covers "BBC Persian"); otherwise the match must be exact, so a
 * "guardian" alias doesn't catch Iran's "Guardian Council".
 */

function normalizeOutletText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isOutletSelfMention(entityName: string, aliases: string[] | null | undefined): boolean {
  if (!aliases?.length) return false
  const name = normalizeOutletText(entityName)

  return aliases.some(alias => {
    if (alias.endsWith('*')) {
      const prefix = normalizeOutletText(alias.slice(0, -1))
      return name === prefix || name.startsWith(`${prefix} `) || name.startsWith(`${prefix}-`)
    }
    return name === normalizeOutletText(alias)
  })
}
