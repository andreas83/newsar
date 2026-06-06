-- Entity summary history: archived versions of entity summaries for timeline tracking
CREATE TABLE IF NOT EXISTS entity_summary_history (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  summary TEXT,
  short_description VARCHAR(500),
  change_note TEXT,
  mention_count INTEGER,
  trending_score REAL,
  article_context JSONB,
  generated_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_summary_history_entity_id_idx
  ON entity_summary_history(entity_id);

CREATE INDEX IF NOT EXISTS entity_summary_history_entity_generated_idx
  ON entity_summary_history(entity_id, generated_at DESC);
