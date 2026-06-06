-- Migration: Add 'topic' entity type
-- Reclassify abstract concepts from 'event'/'organization' to 'topic'
-- Merge duplicate AI entities (2158 → 804)

-- Step 1: Merge duplicate "artificial intelligence" (id 2158) into "Artificial Intelligence" (id 804)
-- Move article_entities from 2158 to 804 where no conflict
UPDATE article_entities
SET entity_id = 804
WHERE entity_id = 2158
  AND article_id NOT IN (
    SELECT article_id FROM article_entities WHERE entity_id = 804
  );

-- Delete remaining conflicting article_entities for 2158
DELETE FROM article_entities WHERE entity_id = 2158;

-- Clean up related tables for entity 2158
DELETE FROM entity_relationships WHERE source_entity_id = 2158 OR target_entity_id = 2158;
DELETE FROM story_entities WHERE entity_id = 2158;
DELETE FROM entity_summaries WHERE entity_id = 2158;
DELETE FROM entity_summary_history WHERE entity_id = 2158;
DELETE FROM entities WHERE id = 2158;

-- Step 2: Reclassify known concept entities from 'event' to 'topic'
UPDATE entities SET type = 'topic', subtype = 'technology'
WHERE id = 804;  -- Artificial Intelligence

UPDATE entities SET type = 'topic', subtype = 'science'
WHERE id = 1380;  -- Climate Change

UPDATE entities SET type = 'topic', subtype = 'economic'
WHERE id = 87166;  -- Inflation

-- Reclassify COVID-related entities to topic/health
UPDATE entities SET type = 'topic', subtype = 'health'
WHERE id IN (4706, 6938, 10015, 10703, 90027, 106919);

-- Step 3: Reclassify misclassified organization entities to topic
UPDATE entities SET type = 'topic', subtype = 'economic'
WHERE id IN (46696, 115206);  -- Cryptocurrency Industry, Cryptocurrency

UPDATE entities SET type = 'topic', subtype = 'policy'
WHERE id = 76283;  -- Immigration

-- Step 4: Also reclassify other AI-related organization entries
UPDATE entities SET type = 'topic', subtype = 'technology'
WHERE id IN (14030, 53473, 75950, 120984)
  AND name IN ('Artificial Intelligence (AI)', 'IA (Artificial Intelligence)', 'Artificial Intelligence (IA)', 'Artificial Intelligence Boom');
