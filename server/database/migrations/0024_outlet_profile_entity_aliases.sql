-- Outlet profiles, unrated coverage bucket, entity alias lookup (2026-10-22)
--
-- 1. A single left–right score doesn't describe every outlet. State media and
--    non-Western outlets (Al Jazeera, Global Times, SCMP) were forced onto the
--    scale, e.g. Global Times as "center-left" and SCMP equal to Fox News.
--    Feeds now carry ownership and country as separate dimensions, and
--    lean_applicable = false marks outlets that are not rated on left–right.
--    Their articles get political_bias NULL and count as "unrated" in story
--    coverage instead of being spread over left/center/right.
--
-- 2. publisher + publisher_aliases name the outlet as it appears in text, so
--    entity extraction can drop an outlet's mentions of itself ("Al Jazeera" in
--    an Al Jazeera article was the 14th most-mentioned entity).
--
-- 3. Merged entities keep the removed name in metadata.aliases. Lookup now
--    resolves new mentions through those aliases; this index serves it.
--
-- Deploy order: the feed worker resolves bias from feeds.known_bias, and an old
-- worker given known_bias NULL falls back to LLM bias analysis. Deploy the code
-- first, run this file, then `pm2 restart newsar-worker`.
--
-- Previous known_bias values, for rollback: Al Jazeera (2) 0, SCMP (9) 0.5,
-- Global Times (28) -0.4.

ALTER TABLE feeds
  ADD COLUMN IF NOT EXISTS publisher varchar(255),
  ADD COLUMN IF NOT EXISTS publisher_aliases text[],
  ADD COLUMN IF NOT EXISTS ownership varchar(20),
  ADD COLUMN IF NOT EXISTS country varchar(2),
  ADD COLUMN IF NOT EXISTS lean_applicable boolean NOT NULL DEFAULT true;

ALTER TABLE story_coverage
  ADD COLUMN IF NOT EXISTS unrated_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS entities_metadata_aliases_idx
  ON entities USING gin ((metadata -> 'aliases'));

-- ownership: private | public (public broadcaster) | state (state-controlled or
-- state-funded without editorial independence) | nonprofit | trust
-- publisher_aliases are matched against entity names after lowercasing and
-- stripping accents and a leading "the". A trailing * matches the alias as a
-- prefix ("bbc*" covers "BBC Verify"); everything else must match exactly, so
-- "guardian" doesn't swallow Iran's Guardian Council.
UPDATE feeds AS f SET
  publisher = v.publisher,
  publisher_aliases = v.aliases,
  ownership = v.ownership,
  country = v.country
FROM (VALUES
  (1, 'BBC', ARRAY['bbc*','british broadcasting corporation'], 'public', 'GB'),
  (2, 'Al Jazeera', ARRAY['al jazeera*','aljazeera'], 'state', 'QA'),
  (3, 'Reuters', ARRAY['reuters','thomson reuters'], 'private', 'GB'),
  (4, 'The Guardian', ARRAY['guardian','guardian australia','guardian us','guardian news','observer'], 'trust', 'GB'),
  (5, 'The New York Times', ARRAY['new york times','nyt','nytimes'], 'private', 'US'),
  (6, 'Fox News', ARRAY['fox news*','fox business'], 'private', 'US'),
  (7, 'Associated Press', ARRAY['associated press','ap','ap news'], 'nonprofit', 'US'),
  (8, 'ProPublica', ARRAY['propublica'], 'nonprofit', 'US'),
  (9, 'South China Morning Post', ARRAY['south china morning post','scmp'], 'private', 'HK'),
  (10, 'Tagesschau (ARD)', ARRAY['tagesschau','tagesthemen','ard'], 'public', 'DE'),
  (11, 'Der Spiegel', ARRAY['spiegel*','der spiegel*'], 'private', 'DE'),
  (12, 'Frankfurter Allgemeine', ARRAY['faz','f.a.z.','frankfurter allgemeine*'], 'trust', 'DE'),
  (13, 'Süddeutsche Zeitung', ARRAY['süddeutsche zeitung','süddeutsche','sz'], 'private', 'DE'),
  (14, 'Die Welt', ARRAY['welt*','die welt'], 'private', 'DE'),
  (15, 'Deutsche Welle', ARRAY['deutsche welle','dw'], 'public', 'DE'),
  (16, 'El País', ARRAY['el país'], 'private', 'ES'),
  (17, 'El Mundo', ARRAY['el mundo'], 'private', 'ES'),
  (18, 'BBC', ARRAY['bbc*','british broadcasting corporation'], 'public', 'GB'),
  (19, 'El Confidencial', ARRAY['el confidencial'], 'private', 'ES'),
  (20, 'La Vanguardia', ARRAY['la vanguardia'], 'private', 'ES'),
  (21, '20 Minutos', ARRAY['20 minutos','20minutos'], 'private', 'ES'),
  (22, 'Le Monde', ARRAY['le monde'], 'private', 'FR'),
  (23, 'Le Figaro', ARRAY['le figaro','figaro'], 'private', 'FR'),
  (24, 'franceinfo', ARRAY['franceinfo','france info'], 'public', 'FR'),
  (25, 'Libération', ARRAY['libération','libé'], 'private', 'FR'),
  (26, 'RFI', ARRAY['rfi','radio france internationale'], 'public', 'FR'),
  (27, 'BFM', ARRAY['bfm*'], 'private', 'FR'),
  (28, 'Global Times', ARRAY['global times'], 'state', 'CN')
) AS v(id, publisher, aliases, ownership, country)
WHERE f.id = v.id;

UPDATE feeds SET lean_applicable = false, known_bias = NULL WHERE id IN (2, 9, 28);

UPDATE classifications c SET political_bias = NULL, method = 'not-rated'
FROM articles a
WHERE a.id = c.article_id AND a.feed_id IN (2, 9, 28) AND c.political_bias IS NOT NULL;
