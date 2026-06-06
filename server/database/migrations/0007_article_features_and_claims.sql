-- Migration: Article Features and Claims
-- Adds framing analysis, factuality signals, sensationalism scoring, and claim extraction

-- Add new columns to classifications table
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS primary_framing VARCHAR(50);
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS secondary_framing VARCHAR(50);
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS article_type VARCHAR(30);
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS sensationalism REAL;
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS fact_opinion_ratio REAL;
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS source_count_cited INTEGER;
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS feature_extraction_done BOOLEAN DEFAULT FALSE;

-- Add indexes on new classification columns
CREATE INDEX IF NOT EXISTS classifications_primary_framing_idx ON classifications (primary_framing);
CREATE INDEX IF NOT EXISTS classifications_sensationalism_idx ON classifications (sensationalism);
CREATE INDEX IF NOT EXISTS classifications_fact_opinion_ratio_idx ON classifications (fact_opinion_ratio);

-- Create article_claims table
CREATE TABLE IF NOT EXISTS article_claims (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  claim_text TEXT NOT NULL,
  attribution VARCHAR(255),
  claim_type VARCHAR(50),
  confidence REAL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS article_claims_article_id_idx ON article_claims (article_id);
CREATE INDEX IF NOT EXISTS article_claims_claim_type_idx ON article_claims (claim_type);

-- Add new columns to story_coverage table
ALTER TABLE story_coverage ADD COLUMN IF NOT EXISTS framing_distribution JSONB;
ALTER TABLE story_coverage ADD COLUMN IF NOT EXISTS avg_sensationalism REAL;
ALTER TABLE story_coverage ADD COLUMN IF NOT EXISTS avg_factuality REAL;
