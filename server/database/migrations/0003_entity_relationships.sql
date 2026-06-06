-- Migration: Entity Relationships for Network Graph OSINT
-- Creates entity_relationships table for tracking entity co-occurrence patterns

CREATE TABLE IF NOT EXISTS entity_relationships (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  cooccurrence_count INTEGER NOT NULL DEFAULT 1,
  strength REAL NOT NULL, -- 0-1 normalized weight
  sentiment_correlation REAL, -- -1 to 1, sentiment similarity
  first_co_occurrence TIMESTAMP NOT NULL,
  last_co_occurrence TIMESTAMP NOT NULL,
  shared_articles JSONB, -- [{article_id, published_at, relevance_scores}]
  temporal_pattern JSONB, -- Time-series co-occurrence data
  metadata JSONB, -- Additional relationship metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint to prevent duplicate relationships
CREATE UNIQUE INDEX entity_rel_source_target_unique ON entity_relationships(source_entity_id, target_entity_id);

-- Indexes for efficient graph queries
CREATE INDEX entity_relationships_source_idx ON entity_relationships(source_entity_id);
CREATE INDEX entity_relationships_target_idx ON entity_relationships(target_entity_id);
CREATE INDEX entity_relationships_strength_idx ON entity_relationships(strength DESC);
CREATE INDEX entity_relationships_last_cooccur_idx ON entity_relationships(last_co_occurrence DESC);
CREATE INDEX entity_rel_source_target_strength_idx ON entity_relationships(source_entity_id, strength DESC);

-- Comment for documentation
COMMENT ON TABLE entity_relationships IS 'Entity-to-entity co-occurrence network for OSINT analysis and network graphs';
COMMENT ON COLUMN entity_relationships.strength IS 'Normalized relationship strength (0-1) based on co-occurrence frequency and article relevance';
COMMENT ON COLUMN entity_relationships.sentiment_correlation IS 'Correlation of sentiment scores when entities appear together (-1 to 1)';
COMMENT ON COLUMN entity_relationships.temporal_pattern IS 'Time-series data showing how relationship evolves: {daily_counts: [{date, count}], velocity_trend}';
