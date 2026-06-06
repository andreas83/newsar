-- Persistent geocoding cache for Nominatim results
CREATE TABLE IF NOT EXISTS geocache (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  lat REAL,
  lon REAL,
  found BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS geocache_name_idx ON geocache (name);
