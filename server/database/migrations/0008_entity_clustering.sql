-- Migration: Entity-Based Topic Clustering
-- Adds composite affinity clustering columns to stories and geo normalization lookup table

-- Add new columns to stories table for entity-based clustering metadata
ALTER TABLE stories ADD COLUMN IF NOT EXISTS topic_label VARCHAR(255);
COMMENT ON COLUMN stories.topic_label IS 'Top 3 entities by IDF-weighted relevance, e.g. "Netanyahu / Israel / Hamas"';

ALTER TABLE stories ADD COLUMN IF NOT EXISTS primary_region VARCHAR(100);
COMMENT ON COLUMN stories.primary_region IS 'Normalized country from most common geoPov in cluster';

ALTER TABLE stories ADD COLUMN IF NOT EXISTS primary_entities JSONB;
COMMENT ON COLUMN stories.primary_entities IS 'Top 5 entities cached as [{id, name, type}]';

ALTER TABLE stories ADD COLUMN IF NOT EXISTS time_span_hours REAL;
COMMENT ON COLUMN stories.time_span_hours IS 'Hours between earliest and latest article in cluster';

ALTER TABLE stories ADD COLUMN IF NOT EXISTS cluster_version VARCHAR(10) DEFAULT 'v1';
COMMENT ON COLUMN stories.cluster_version IS 'Clustering algorithm version: v1=embedding-only, v2=entity-composite';

-- Add indexes on new columns
CREATE INDEX IF NOT EXISTS stories_primary_region_idx ON stories (primary_region);
CREATE INDEX IF NOT EXISTS stories_cluster_version_idx ON stories (cluster_version);

-- Geo normalization lookup table for standardizing geographic points of view
CREATE TABLE IF NOT EXISTS geo_normalization (
  id SERIAL PRIMARY KEY,
  raw_value VARCHAR(255) UNIQUE NOT NULL,
  normalized_country VARCHAR(100) NOT NULL,
  normalized_region VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE geo_normalization IS 'Maps raw geoPov values to normalized country/region for clustering';
COMMENT ON COLUMN geo_normalization.raw_value IS 'Raw geoPov value from classifications (case-insensitive lookup)';
COMMENT ON COLUMN geo_normalization.normalized_country IS 'Standardized country name';
COMMENT ON COLUMN geo_normalization.normalized_region IS 'Broad geographic region (e.g. Middle East, Europe, North America)';

CREATE INDEX IF NOT EXISTS geo_normalization_raw_value_idx ON geo_normalization (LOWER(raw_value));

-- Seed geo normalization mappings (~80 entries)
INSERT INTO geo_normalization (raw_value, normalized_country, normalized_region) VALUES
  -- North America
  ('United States', 'United States', 'North America'),
  ('US', 'United States', 'North America'),
  ('USA', 'United States', 'North America'),
  ('America', 'United States', 'North America'),
  ('Washington', 'United States', 'North America'),
  ('Washington DC', 'United States', 'North America'),
  ('Washington D.C.', 'United States', 'North America'),
  ('New York', 'United States', 'North America'),
  ('California', 'United States', 'North America'),
  ('Texas', 'United States', 'North America'),
  ('Florida', 'United States', 'North America'),
  ('Canada', 'Canada', 'North America'),
  ('Mexico', 'Mexico', 'North America'),
  -- Europe
  ('United Kingdom', 'United Kingdom', 'Europe'),
  ('UK', 'United Kingdom', 'Europe'),
  ('Britain', 'United Kingdom', 'Europe'),
  ('England', 'United Kingdom', 'Europe'),
  ('London', 'United Kingdom', 'Europe'),
  ('France', 'France', 'Europe'),
  ('Paris', 'France', 'Europe'),
  ('Germany', 'Germany', 'Europe'),
  ('Berlin', 'Germany', 'Europe'),
  ('Italy', 'Italy', 'Europe'),
  ('Rome', 'Italy', 'Europe'),
  ('Spain', 'Spain', 'Europe'),
  ('Netherlands', 'Netherlands', 'Europe'),
  ('Belgium', 'Belgium', 'Europe'),
  ('Brussels', 'Belgium', 'Europe'),
  ('Switzerland', 'Switzerland', 'Europe'),
  ('Poland', 'Poland', 'Europe'),
  ('Sweden', 'Sweden', 'Europe'),
  ('Norway', 'Norway', 'Europe'),
  ('Denmark', 'Denmark', 'Europe'),
  ('Finland', 'Finland', 'Europe'),
  ('Austria', 'Austria', 'Europe'),
  ('Greece', 'Greece', 'Europe'),
  ('Portugal', 'Portugal', 'Europe'),
  ('Ireland', 'Ireland', 'Europe'),
  ('Czech Republic', 'Czech Republic', 'Europe'),
  ('Romania', 'Romania', 'Europe'),
  ('Hungary', 'Hungary', 'Europe'),
  ('Ukraine', 'Ukraine', 'Europe'),
  ('Kyiv', 'Ukraine', 'Europe'),
  -- Middle East
  ('Israel', 'Israel', 'Middle East'),
  ('Tel Aviv', 'Israel', 'Middle East'),
  ('Jerusalem', 'Israel', 'Middle East'),
  ('Palestine', 'Palestine', 'Middle East'),
  ('Gaza', 'Palestine', 'Middle East'),
  ('West Bank', 'Palestine', 'Middle East'),
  ('Iran', 'Iran', 'Middle East'),
  ('Tehran', 'Iran', 'Middle East'),
  ('Iraq', 'Iraq', 'Middle East'),
  ('Baghdad', 'Iraq', 'Middle East'),
  ('Syria', 'Syria', 'Middle East'),
  ('Damascus', 'Syria', 'Middle East'),
  ('Lebanon', 'Lebanon', 'Middle East'),
  ('Beirut', 'Lebanon', 'Middle East'),
  ('Saudi Arabia', 'Saudi Arabia', 'Middle East'),
  ('Riyadh', 'Saudi Arabia', 'Middle East'),
  ('Turkey', 'Turkey', 'Middle East'),
  ('Ankara', 'Turkey', 'Middle East'),
  ('Istanbul', 'Turkey', 'Middle East'),
  ('Yemen', 'Yemen', 'Middle East'),
  ('Jordan', 'Jordan', 'Middle East'),
  ('UAE', 'United Arab Emirates', 'Middle East'),
  ('United Arab Emirates', 'United Arab Emirates', 'Middle East'),
  ('Dubai', 'United Arab Emirates', 'Middle East'),
  ('Qatar', 'Qatar', 'Middle East'),
  ('Kuwait', 'Kuwait', 'Middle East'),
  ('Oman', 'Oman', 'Middle East'),
  ('Bahrain', 'Bahrain', 'Middle East'),
  -- Asia-Pacific
  ('China', 'China', 'Asia-Pacific'),
  ('Beijing', 'China', 'Asia-Pacific'),
  ('Shanghai', 'China', 'Asia-Pacific'),
  ('Japan', 'Japan', 'Asia-Pacific'),
  ('Tokyo', 'Japan', 'Asia-Pacific'),
  ('South Korea', 'South Korea', 'Asia-Pacific'),
  ('Seoul', 'South Korea', 'Asia-Pacific'),
  ('North Korea', 'North Korea', 'Asia-Pacific'),
  ('India', 'India', 'Asia-Pacific'),
  ('New Delhi', 'India', 'Asia-Pacific'),
  ('Mumbai', 'India', 'Asia-Pacific'),
  ('Pakistan', 'Pakistan', 'Asia-Pacific'),
  ('Australia', 'Australia', 'Asia-Pacific'),
  ('Taiwan', 'Taiwan', 'Asia-Pacific'),
  ('Taipei', 'Taiwan', 'Asia-Pacific'),
  ('Indonesia', 'Indonesia', 'Asia-Pacific'),
  ('Philippines', 'Philippines', 'Asia-Pacific'),
  ('Thailand', 'Thailand', 'Asia-Pacific'),
  ('Vietnam', 'Vietnam', 'Asia-Pacific'),
  ('Singapore', 'Singapore', 'Asia-Pacific'),
  ('Malaysia', 'Malaysia', 'Asia-Pacific'),
  ('Myanmar', 'Myanmar', 'Asia-Pacific'),
  ('Afghanistan', 'Afghanistan', 'Asia-Pacific'),
  ('Kabul', 'Afghanistan', 'Asia-Pacific'),
  -- Russia & Central Asia
  ('Russia', 'Russia', 'Europe'),
  ('Moscow', 'Russia', 'Europe'),
  ('Kazakhstan', 'Kazakhstan', 'Central Asia'),
  -- Africa
  ('South Africa', 'South Africa', 'Africa'),
  ('Nigeria', 'Nigeria', 'Africa'),
  ('Egypt', 'Egypt', 'Africa'),
  ('Cairo', 'Egypt', 'Africa'),
  ('Kenya', 'Kenya', 'Africa'),
  ('Ethiopia', 'Ethiopia', 'Africa'),
  ('Morocco', 'Morocco', 'Africa'),
  ('Sudan', 'Sudan', 'Africa'),
  ('Libya', 'Libya', 'Africa'),
  ('Congo', 'Congo', 'Africa'),
  -- South America
  ('Brazil', 'Brazil', 'South America'),
  ('Argentina', 'Argentina', 'South America'),
  ('Colombia', 'Colombia', 'South America'),
  ('Venezuela', 'Venezuela', 'South America'),
  ('Chile', 'Chile', 'South America'),
  ('Peru', 'Peru', 'South America'),
  -- International / Supranational
  ('European Union', 'European Union', 'Europe'),
  ('EU', 'European Union', 'Europe'),
  ('NATO', 'NATO', 'International'),
  ('United Nations', 'United Nations', 'International'),
  ('UN', 'United Nations', 'International')
ON CONFLICT (raw_value) DO NOTHING;
