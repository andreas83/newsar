-- Migration: Content extraction quality improvements
-- 1. Add extraction_method column to feeds table
-- 2. Reclassify existing short "success" articles as "partial"

-- Add per-feed extraction method column
ALTER TABLE feeds ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(20) DEFAULT 'readability';

-- Reclassify existing short-content "success" articles as "partial"
-- Articles with < 500 chars of full_content that were marked "success"
-- are really just snippets and should be flagged for re-extraction
UPDATE articles
SET extraction_status = 'partial'
WHERE extraction_status = 'success'
  AND full_content IS NOT NULL
  AND LENGTH(full_content) < 500;

-- Report the reclassification
-- SELECT extraction_status, COUNT(*), AVG(LENGTH(full_content))::int as avg_len
-- FROM articles
-- WHERE content_extracted = true
-- GROUP BY extraction_status
-- ORDER BY extraction_status;
