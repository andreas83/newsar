-- Migration: Add entity_summaries table and slug column to entities
-- Created: 2025-10-26

-- Add slug column to entities table
ALTER TABLE entities ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

-- Create unique index on slug
CREATE UNIQUE INDEX IF NOT EXISTS entities_slug_idx ON entities(slug);

-- Generate slugs for existing entities (lowercase, replace spaces with hyphens, remove special chars)
-- For duplicates, append entity ID to make unique
UPDATE entities
SET slug = CASE
  WHEN (
    SELECT COUNT(*)
    FROM entities e2
    WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(e2.name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')) =
          LOWER(REGEXP_REPLACE(REGEXP_REPLACE(entities.name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'))
  ) > 1
  THEN LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')) || '-' || id::text
  ELSE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'))
END
WHERE slug IS NULL OR slug = '';

-- Create entity_summaries table
CREATE TABLE IF NOT EXISTS entity_summaries (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  summary TEXT, -- LLM-generated summary (150-200 words)
  short_description VARCHAR(500), -- One-line description
  image_url VARCHAR(1000), -- Primary image URL
  wiki_url VARCHAR(500), -- Wikipedia/external link
  mention_count INTEGER DEFAULT 0 NOT NULL, -- Total mentions across articles
  trending_score REAL DEFAULT 0, -- Trending score (0-1)
  metadata JSONB, -- Additional data (aliases, categories, etc.)
  generated_at TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW(),
  CONSTRAINT entity_summaries_entity_id_unique UNIQUE(entity_id)
);

-- Create indexes on entity_summaries
CREATE INDEX IF NOT EXISTS entity_summaries_entity_id_idx ON entity_summaries(entity_id);
CREATE INDEX IF NOT EXISTS entity_summaries_trending_idx ON entity_summaries(trending_score DESC);
CREATE INDEX IF NOT EXISTS entity_summaries_mention_count_idx ON entity_summaries(mention_count DESC);
CREATE INDEX IF NOT EXISTS entity_summaries_last_updated_idx ON entity_summaries(last_updated DESC);

-- Add comment to table
COMMENT ON TABLE entity_summaries IS 'AI-generated summaries and metadata for entities (people, organizations, locations, events)';
COMMENT ON COLUMN entity_summaries.summary IS 'LLM-generated comprehensive summary (150-200 words)';
COMMENT ON COLUMN entity_summaries.short_description IS 'One-line description for previews and cards';
COMMENT ON COLUMN entity_summaries.mention_count IS 'Total number of articles mentioning this entity';
COMMENT ON COLUMN entity_summaries.trending_score IS 'Trending score based on recent mentions and velocity';
