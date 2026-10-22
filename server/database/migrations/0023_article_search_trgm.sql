-- Trigram indexes for article text search (2026-10-22)
--
-- /api/search matches with ILIKE '%term%' on title, content and full_content,
-- which a btree index can't serve, so every search scanned all article text
-- (~4s). GIN trigram indexes make those lookups index scans (~0.5s).
--
-- Already applied in production on 2026-10-22. CONCURRENTLY keeps the table
-- writable while building, but it can't run inside a transaction: run this
-- file with plain psql, not wrapped in BEGIN/COMMIT. Build time on ~121k
-- articles: ~2 minutes in total, ~340 MB of index.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_title_trgm_idx
  ON articles USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_content_trgm_idx
  ON articles USING gin (content gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS articles_full_content_trgm_idx
  ON articles USING gin (full_content gin_trgm_ops);
