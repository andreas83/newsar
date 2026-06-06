-- Stock backtest results: forward-looking price changes for each historical anomaly event
CREATE TABLE IF NOT EXISTS stock_backtest_results (
  id SERIAL PRIMARY KEY,
  correlation_id INTEGER NOT NULL REFERENCES stock_news_correlations(id) ON DELETE CASCADE,
  -- Closing prices at each forward horizon
  price_1d REAL,
  price_3d REAL,
  price_5d REAL,
  price_1w REAL,  -- 5 trading days
  price_2w REAL,  -- 10 trading days
  price_4w REAL,  -- 20 trading days
  -- Percent changes from event-day close
  change_1d REAL,
  change_3d REAL,
  change_5d REAL,
  change_1w REAL,
  change_2w REAL,
  change_4w REAL,
  -- Benchmark (SPY) changes for same periods (alpha calculation)
  benchmark_change_1d REAL,
  benchmark_change_5d REAL,
  benchmark_change_2w REAL,
  benchmark_change_4w REAL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX idx_backtest_correlation_id ON stock_backtest_results(correlation_id);
CREATE INDEX idx_backtest_created_at ON stock_backtest_results(created_at DESC);

-- Stock signal profiles: aggregated stats per (ticker, event_type) pair
CREATE TABLE IF NOT EXISTS stock_signal_profiles (
  id SERIAL PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES stock_watchlist(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  -- Average change at each horizon
  avg_change_1d REAL,
  avg_change_3d REAL,
  avg_change_5d REAL,
  avg_change_1w REAL,
  avg_change_2w REAL,
  avg_change_4w REAL,
  -- Win rate (% of positive outcomes) at each horizon
  win_rate_1d REAL,
  win_rate_3d REAL,
  win_rate_5d REAL,
  win_rate_1w REAL,
  win_rate_2w REAL,
  win_rate_4w REAL,
  -- Standard deviation at each horizon
  stddev_1d REAL,
  stddev_3d REAL,
  stddev_5d REAL,
  stddev_1w REAL,
  stddev_2w REAL,
  stddev_4w REAL,
  -- Alpha vs benchmark (SPY)
  avg_alpha_5d REAL,
  avg_alpha_4w REAL,
  -- Confidence: min(1, count/10) * clamp(1 - stddev/|avg|, 0.2, 1.0)
  profile_confidence REAL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX idx_signal_profiles_watchlist_event ON stock_signal_profiles(watchlist_id, event_type);
CREATE INDEX idx_signal_profiles_confidence ON stock_signal_profiles(profile_confidence DESC);

-- Stock recommendations: generated buy/sell signals from anomalies + historical profiles
CREATE TABLE IF NOT EXISTS stock_recommendations (
  id SERIAL PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES stock_watchlist(id) ON DELETE CASCADE,
  correlation_id INTEGER NOT NULL REFERENCES stock_news_correlations(id) ON DELETE CASCADE,
  profile_id INTEGER REFERENCES stock_signal_profiles(id),
  -- Overall signal
  signal_direction VARCHAR(20) NOT NULL DEFAULT 'neutral', -- bullish, bearish, neutral
  signal_strength REAL NOT NULL DEFAULT 0, -- 0 to 1
  -- Short-term (1-5 day) outlook
  short_term_direction VARCHAR(20) NOT NULL DEFAULT 'neutral',
  short_term_confidence REAL DEFAULT 0,
  short_term_expected_change REAL,
  -- Medium-term (1-4 week) outlook
  medium_term_direction VARCHAR(20) NOT NULL DEFAULT 'neutral',
  medium_term_confidence REAL DEFAULT 0,
  medium_term_expected_change REAL,
  -- Scoring components for explainability
  event_strength REAL,       -- 3x=1.0, 2x=0.6, diversity=0.4
  historical_winrate REAL,   -- from signal profile
  anomaly_confidence REAL,   -- from stock_news_correlations.confidence
  source_diversity REAL,     -- min(1, (sources-1)/4)
  mention_multiplier REAL,   -- min(1, (multiplier-2)/6)
  -- Trigger context
  event_type VARCHAR(50) NOT NULL,
  event_date TIMESTAMP NOT NULL,
  trigger_metadata JSONB,    -- snapshot of anomaly data for display
  -- Lifecycle
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, expired, validated
  expires_at TIMESTAMP,
  -- Validation (feedback loop)
  actual_change_5d REAL,
  actual_change_4w REAL,
  validated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_recommendations_watchlist ON stock_recommendations(watchlist_id);
CREATE INDEX idx_recommendations_status ON stock_recommendations(status);
CREATE INDEX idx_recommendations_signal ON stock_recommendations(signal_direction, signal_strength DESC);
CREATE INDEX idx_recommendations_created ON stock_recommendations(created_at DESC);
CREATE UNIQUE INDEX idx_recommendations_correlation ON stock_recommendations(correlation_id);
