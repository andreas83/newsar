-- Stable story identity + AI story narratives
--
-- Clustering used to drop and recreate every story on each run, so story IDs
-- (and URLs) changed every 4 hours. It now keeps an ID when a new cluster
-- continues an old story. Stories that dissolve leave a redirect to the story
-- that took most of their articles.

CREATE TABLE IF NOT EXISTS story_redirects (
  old_id integer PRIMARY KEY,
  new_id integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS story_redirects_new_id_idx ON story_redirects (new_id);

-- One narrative per story: what it is about, how it developed, how outlets
-- differ. Generated from member article summaries; regenerated when the story
-- grows.
CREATE TABLE IF NOT EXISTS story_narratives (
  story_id integer PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  headline text NOT NULL,
  lede text NOT NULL,
  background text,
  developments jsonb NOT NULL DEFAULT '[]'::jsonb,
  perspectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  agreements jsonb NOT NULL DEFAULT '[]'::jsonb,
  disagreements jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  article_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  article_count integer NOT NULL DEFAULT 0,
  model varchar(100),
  prompt_tokens integer,
  output_tokens integer,
  generated_at timestamp NOT NULL DEFAULT now()
);
