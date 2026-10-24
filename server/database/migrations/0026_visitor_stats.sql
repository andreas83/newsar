-- Cookieless visitor statistics
--
-- Page views arrive from a small client beacon (app/plugins/analytics.client.ts),
-- so crawlers that don't run JavaScript never show up here. No IP address or
-- cookie is stored: visitor_hash is sha256(daily random salt + IP + user agent),
-- and the salt is thrown away after two days, so a visitor can't be followed
-- from one day to the next.
--
-- Rows that look automated keep a bot_reason instead of being dropped, so the
-- filter can be inspected and tuned. Headless crawlers (Reflectionbot,
-- PerplexityBot and friends) run JavaScript with a normal Chrome UA, so the
-- dashboard only counts a view as human when it also got a real interaction or
-- stayed visible for 15 seconds (engaged).

CREATE TABLE IF NOT EXISTS page_views (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  path varchar(512) NOT NULL,
  referrer_host varchar(255),
  utm_source varchar(100),
  visitor_hash char(16) NOT NULL,
  browser varchar(32),
  os varchar(32),
  device varchar(16),
  language varchar(8),
  bot_reason varchar(32),
  engaged boolean NOT NULL DEFAULT false,
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_human_idx ON page_views (created_at) WHERE bot_reason IS NULL AND engaged;

-- Server-side count of page requests from user agents that identify as bots.
-- These never execute the beacon, so this is the only place they are visible.
CREATE TABLE IF NOT EXISTS bot_hits_daily (
  day date NOT NULL,
  bot varchar(64) NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bot)
);
