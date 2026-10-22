-- Structured entity summary evolution (2026-10-21)
--
-- Before this migration a history row held the OLD summary, but its change_note
-- and article_context described the NEXT version, so the timeline showed every
-- note one version too early. The note came from diffing two summaries rather
-- than from articles, so it could not cite sources and often reported
-- paraphrase as news.
--
-- Now every version owns its own data: the article window it was built from,
-- dated developments with article ids, theme labels and coverage stats. The
-- current version lives in entity_summaries and moves to history unchanged
-- when it is replaced. Additive only: no existing rows are modified.

ALTER TABLE entity_summaries
  ADD COLUMN IF NOT EXISTS window_start TIMESTAMP,      -- start of the article window (end = generated_at)
  ADD COLUMN IF NOT EXISTS developments JSONB,           -- [{date, text, articleIds[], theme}]
  ADD COLUMN IF NOT EXISTS themes JSONB,                 -- ["Iran ceasefire talks", ...]
  ADD COLUMN IF NOT EXISTS article_context JSONB,        -- {articleIds, articleTitles, dateRange}
  ADD COLUMN IF NOT EXISTS window_stats JSONB;           -- {articles, outlets, stories, roles, avgSentiment}

ALTER TABLE entity_summary_history
  ADD COLUMN IF NOT EXISTS window_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS developments JSONB,
  ADD COLUMN IF NOT EXISTS themes JSONB,
  ADD COLUMN IF NOT EXISTS window_stats JSONB,
  -- 1 = legacy row (note/context belong to the next version), 2 = self-contained
  ADD COLUMN IF NOT EXISTS format_version SMALLINT NOT NULL DEFAULT 1,
  -- Set when a backfill rebuilt this period in format 2. Kept, not deleted.
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP;
