/**
 * Temporal grounding for LLM prompts.
 *
 * Every model's training data ends before "now", so without a date it describes
 * people and offices as they were at its cutoff (e.g. calling the sitting US
 * president "former president"). Newer models don't fix this on their own —
 * they still default to stale facts — so we tell them today's date and to treat
 * the supplied articles as the source of truth.
 */

export function getGroundingPreamble(now: Date = new Date()): string {
  const today = now.toISOString().slice(0, 10)
  return `Today's date is ${today}. Your training data ends before this date, so offices, roles, titles and events may have changed since then. When the input contains news articles or other source material, treat it as the source of truth over your own memory. Do not describe anyone as "former" or "current" holder of a position unless the source material supports it.`
}

/** Prepend the grounding preamble to an (optional) system prompt. */
export function groundSystemPrompt(systemPrompt?: string): string {
  const preamble = getGroundingPreamble()
  return systemPrompt ? `${preamble}\n\n${systemPrompt}` : preamble
}
