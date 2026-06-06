-- Migration 0012: Data quality fixes & propaganda risk score
-- 1. Normalize entity roles to 4 canonical values
-- 2. Backfill entity sentiment from article sentiment + role
-- 3. Remove boilerplate claims
-- 4. Add and populate propaganda_risk score

BEGIN;

-- === TASK 1: Normalize entity roles ===

-- Step 1a: Lowercase the uppercase canonical values
UPDATE article_entities SET role = lower(role)
WHERE role IN ('PROTAGONIST', 'ANTAGONIST', 'NEUTRAL', 'CONTEXT');

-- Step 1b: Map location-like roles → context
UPDATE article_entities SET role = 'context'
WHERE role IN (
  'location', 'LOCATION', 'setting', 'primary location', 'secondary location',
  'geoPov', 'destination', 'venue', 'city', 'region', 'country',
  'organization', 'ORGANIZATION', 'event', 'PERSON', 'person',
  'primary', 'primary perspective', 'primary context', 'primary geography',
  'primary geo pov', 'primary-geo pov', 'primary pov', 'primary setting',
  'primary entity', 'primary POV', 'primary actor',
  'court location', 'strategic location', 'context/location', 'location/context',
  'context/event', 'context/agency', 'context/subject',
  'headquarters', 'origin', 'nationality', 'continent', ' continent',
  'mountain range', ' mountain range', 'court', 'market', 'platform',
  'incident', 'cause', 'consequence', 'background', 'building',
  'city/state', ' state/province', ' country', 'secondary',
  'neutral context'
);

-- Step 1c: Map victim-like roles → protagonist
UPDATE article_entities SET role = 'protagonist'
WHERE role IN (
  'victim', 'target', 'defendant', 'affected', 'deceased',
  'VICTIM', 'TARGET', 'ACCUSED',
  'victim/antagonist', 'victim/subject', 'victim/eyewitness', 'victim/official',
  'victim/setting', 'victim/abuser', 'victim''s relative',
  'subject', 'SUBJECT', 'subject of song',
  'beneficiary', 'responder',
  'artist/subject', 'context/subject',
  'proagonist'
);

-- Step 1d: Map actor/aggressor-like roles → antagonist
UPDATE article_entities SET role = 'antagonist'
WHERE role IN (
  'actor', 'ACTOR', 'investigator', 'suspect', 'perpetrator', 'aggressor',
  'competitor', 'opponent',
  'co-aggressor', 'co-belligerent', 'conflict party',
  'antagonist/subject', 'antagonist/neutral', 'antagonist/actor',
  'antagonist/agency', 'antagonist/context', 'antagonist/region',
  'antagonized entity', 'ally/antagonist',
  'main actor', 'actor/agent', 'actor/victim', 'agent/actor',
  'suspected actor', 'prosecutor', 'regulator'
);

-- Step 1e: Map expert/witness-like roles → neutral
UPDATE article_entities SET role = 'neutral'
WHERE role IN (
  'expert', 'witness', 'source', 'author', 'AUTHOR', 'narrator',
  'supporter', 'partner', 'ally', 'member', 'collaborator',
  'agent', 'organizer', 'investor', 'owner', 'host',
  'supporting character', 'supporting', 'support',
  'sponsor', 'funder', 'creator', 'founder',
  'mediator', 'mediator/context', 'mediation agency',
  'researcher', 'producer', 'director', 'designer',
  'guest', 'spectator', 'speaker', 'presenter', 'spokeswoman',
  'judge', 'official', 'lawyer', 'attorney/neutral', 'trade lawyer',
  'minister', 'foreign minister', 'prime minister', 'president', 'former president',
  'government leader', 'LEADER',
  'ambassador', 'predecessor', 'mentor', 'neighbour', 'son-in-law',
  'friend and co-star', 'co-star', 'actress', 'band',
  'expert/analyst', 'eyewitness/witness', 'witness/neutral',
  'settlement partner', 'publisher', 'journalist', ' journalist',
  'religious figure', 'glaciologist', 'interim coach',
  'authoritative agency', 'investigating agency', 'government agency',
  'government/agency', 'government entity', 'police force',
  'agency', 'institution', 'bank', 'subsidiary', 'company',
  'team', 'tv show', 'media', ' news outlet',
  'technology', 'product', 'index', 'industry',
  'database project', 'entity', 'component', 'object', 'inspiration',
  'alias', 'previous character', 'previous employer', 'historical'
);

-- Step 1f: NULL → context (safest default)
UPDATE article_entities SET role = 'context' WHERE role IS NULL;

-- Step 1g: Catch-all for anything remaining → neutral
UPDATE article_entities SET role = 'neutral'
WHERE role NOT IN ('protagonist', 'antagonist', 'neutral', 'context');


-- === TASK 2: Backfill entity sentiment from article sentiment + role ===

UPDATE article_entities ae
SET sentiment = CASE
  WHEN ae.role = 'protagonist' THEN
    CASE
      WHEN a.sentiment > 0.15 THEN 'positive'
      WHEN a.sentiment < -0.15 THEN 'negative'
      ELSE 'neutral'
    END
  WHEN ae.role = 'antagonist' THEN
    CASE
      WHEN a.sentiment > 0.15 THEN 'negative'
      WHEN a.sentiment < -0.15 THEN 'positive'
      ELSE 'neutral'
    END
  ELSE 'neutral'
END
FROM analyses a
WHERE a.article_id = ae.article_id;

-- For entities with no matching analysis row, set to neutral
UPDATE article_entities SET sentiment = 'neutral'
WHERE sentiment IS NULL;


-- === TASK 3: Remove boilerplate claims ===

DELETE FROM article_claims WHERE
  claim_text ILIKE '%paywall%'
  OR claim_text ILIKE '%SPIEGEL+%'
  OR claim_text ILIKE '%subscription%renew%'
  OR claim_text ILIKE '%iTunes%'
  OR claim_text ILIKE '%cookie%'
  OR claim_text ILIKE '%browser extension%'
  OR claim_text ILIKE '%ad blocker%'
  OR claim_text ILIKE '%couldn''t load%'
  OR claim_text ILIKE '%advertising is essential%'
  OR claim_text ILIKE '%BFM Bourse%'
  OR claim_text ILIKE '%Tout pour investir%'
  OR claim_text ILIKE '%FAZ+%'
  OR claim_text ILIKE '%S+-Artikel%'
  OR claim_text ILIKE '%verlängert sich das Abo%'
  OR claim_text ILIKE '%no longer accessible%'
  OR claim_text ILIKE '%personalized advertising%'
  OR claim_text ILIKE '%tracking or personalized%'
  OR claim_text ILIKE '%browsing information%for advertising%'
  OR claim_text ILIKE '%Kaufbestätigung bezahlt%'
  OR claim_text ILIKE '%subscription%managed through%';


-- === TASK 4: Propaganda risk score ===

-- Add column and index
ALTER TABLE classifications ADD COLUMN IF NOT EXISTS propaganda_risk REAL;
CREATE INDEX IF NOT EXISTS classifications_propaganda_risk_idx ON classifications (propaganda_risk);

-- Populate propaganda risk score
-- Formula weights: 30% sensationalism, 30% low factuality, 20% few sources, 20% extreme bias
UPDATE classifications SET propaganda_risk = LEAST(1.0, GREATEST(0.0,
  (COALESCE(sensationalism, 0.3) * 0.30)
  + ((1.0 - COALESCE(fact_opinion_ratio, 0.7)) * 0.30)
  + (CASE
      WHEN COALESCE(source_count_cited, 2) = 0 THEN 0.20
      WHEN COALESCE(source_count_cited, 2) = 1 THEN 0.10
      ELSE 0.0
    END)
  + (GREATEST(0, ABS(COALESCE(political_bias, 0)) - 0.3) * 0.50)
))
WHERE sensationalism IS NOT NULL
   OR fact_opinion_ratio IS NOT NULL
   OR source_count_cited IS NOT NULL;

COMMIT;
