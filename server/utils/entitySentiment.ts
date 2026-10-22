/**
 * Reading `article_entities.sentiment`.
 *
 * That column is `varchar(50)` holding two incompatible formats:
 *   - up to 2026-04-19 the classifier wrote labels: 'positive' | 'negative' | 'neutral'
 *   - since then it writes nothing (NULL), and the FinBERT scorers
 *     (ml/sentiment.py, ml/btc_sentiment.py) write numeric scores as strings
 *
 * Code that compares only against the labels reads every recent numeric row as
 * neutral and, when the ELSE branch yields 0 rather than NULL, counts unscored
 * rows as neutral too. That failure is silent: no error, no empty result, just a
 * feature that quietly becomes a constant. It cost this project four months of
 * dead sentiment features on the BTC side and the entire lifetime of the stock
 * `avg_article_sentiment` feature.
 *
 * Anything reading that column should use these helpers rather than writing the
 * comparison again.
 */

import { sql } from 'drizzle-orm'

/**
 * SQL expression averaging entity sentiment across both formats.
 *
 * Unscored rows contribute NULL, not 0, so the average is null when nothing was
 * scored instead of a confident-looking "neutral". Callers that need a number
 * should COALESCE explicitly and know they are doing it.
 *
 * `alias` is the table alias holding the `sentiment` column.
 */
export function entitySentimentAvg(alias: string = 'ae') {
  return sql.raw(`AVG(CASE
        WHEN ${alias}.sentiment ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${alias}.sentiment::float
        WHEN ${alias}.sentiment = 'positive' THEN 1
        WHEN ${alias}.sentiment = 'negative' THEN -1
        WHEN ${alias}.sentiment = 'neutral'  THEN 0
        ELSE NULL END)`)
}

/** Parse one stored sentiment value in either format. Null when unscored. */
export function parseEntitySentiment(value: unknown): number | null {
  if (value == null) return null
  const raw = String(value).trim()
  if (raw === 'positive') return 1
  if (raw === 'negative') return -1
  if (raw === 'neutral') return 0
  const num = parseFloat(raw)
  return Number.isFinite(num) ? num : null
}
