-- Create topic_relationships table
CREATE TABLE IF NOT EXISTS topic_relationships (
  id SERIAL PRIMARY KEY,
  source_type VARCHAR(50) NOT NULL,
  source_id INTEGER NOT NULL,
  source_value VARCHAR(255) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id INTEGER NOT NULL,
  target_value VARCHAR(255) NOT NULL,
  relationship_type VARCHAR(50) NOT NULL,
  strength REAL NOT NULL,
  supporting_evidence JSONB,
  auto_detected BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for topic_relationships
CREATE INDEX IF NOT EXISTS topic_relationships_source_idx ON topic_relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS topic_relationships_target_idx ON topic_relationships(target_type, target_id);
CREATE INDEX IF NOT EXISTS topic_relationships_type_idx ON topic_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS topic_relationships_strength_idx ON topic_relationships(strength DESC);

-- Create topic_clusters table
CREATE TABLE IF NOT EXISTS topic_clusters (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  parent_cluster_id INTEGER REFERENCES topic_clusters(id),
  primary_keywords TEXT[],
  primary_entities TEXT[],
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for topic_clusters
CREATE INDEX IF NOT EXISTS topic_clusters_parent_idx ON topic_clusters(parent_cluster_id);
CREATE INDEX IF NOT EXISTS topic_clusters_name_idx ON topic_clusters(name);
