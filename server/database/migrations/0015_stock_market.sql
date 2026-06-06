-- Stock watchlist: curated set of tracked tickers linked to organization entities
CREATE TABLE IF NOT EXISTS stock_watchlist (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(20) NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  exchange VARCHAR(50) DEFAULT 'US',
  sector VARCHAR(100),
  entity_id INTEGER REFERENCES entities(id),
  mapping_method VARCHAR(50),
  mapping_confidence REAL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  finnhub_profile JSONB,
  metadata JSONB,
  last_price_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_stock_watchlist_ticker ON stock_watchlist(ticker);
CREATE INDEX idx_stock_watchlist_entity_id ON stock_watchlist(entity_id);
CREATE INDEX idx_stock_watchlist_sector ON stock_watchlist(sector);
CREATE INDEX idx_stock_watchlist_is_active ON stock_watchlist(is_active);

-- Stock prices: time-series price data (one row per ticker per fetch)
CREATE TABLE IF NOT EXISTS stock_prices (
  id SERIAL PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES stock_watchlist(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  open_price REAL,
  high_price REAL,
  low_price REAL,
  previous_close REAL,
  change_amount REAL,
  change_percent REAL,
  volume BIGINT,
  market_status VARCHAR(20),
  source VARCHAR(50) DEFAULT 'finnhub',
  fetched_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_stock_prices_watchlist_fetched ON stock_prices(watchlist_id, fetched_at DESC);
CREATE INDEX idx_stock_prices_fetched_at ON stock_prices(fetched_at DESC);
CREATE UNIQUE INDEX idx_stock_prices_watchlist_fetched_unique ON stock_prices(watchlist_id, fetched_at);

-- Stock-news correlations: pre-computed events for future ML training (Phase 2)
CREATE TABLE IF NOT EXISTS stock_news_correlations (
  id SERIAL PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES stock_watchlist(id) ON DELETE CASCADE,
  entity_id INTEGER REFERENCES entities(id),
  event_type VARCHAR(50) NOT NULL,
  event_date TIMESTAMP NOT NULL,
  price_before REAL,
  price_after REAL,
  price_change_percent REAL,
  mention_count_window REAL,
  avg_sentiment REAL,
  article_ids JSONB,
  window_hours INTEGER DEFAULT 24,
  confidence REAL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_stock_news_correlations_watchlist ON stock_news_correlations(watchlist_id);
CREATE INDEX idx_stock_news_correlations_entity ON stock_news_correlations(entity_id);
CREATE INDEX idx_stock_news_correlations_event_date ON stock_news_correlations(event_date DESC);
CREATE INDEX idx_stock_news_correlations_event_type ON stock_news_correlations(event_type);
