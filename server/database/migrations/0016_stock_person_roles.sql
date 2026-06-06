-- Enable efficient JSONB metadata queries on entity_relationships
-- Used by stockPersonAnnotator to tag person-org relationships with stock context
CREATE INDEX IF NOT EXISTS entity_relationships_metadata_gin_idx
  ON entity_relationships USING GIN (metadata)
  WHERE metadata IS NOT NULL;
