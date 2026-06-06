-- Migration: Add OSINT role column to article_entities
-- Stores entity role classification: protagonist, antagonist, neutral, context

ALTER TABLE article_entities
ADD COLUMN IF NOT EXISTS role VARCHAR(20);

-- Add comment for documentation
COMMENT ON COLUMN article_entities.role IS 'OSINT classification: protagonist, antagonist, neutral, context';
