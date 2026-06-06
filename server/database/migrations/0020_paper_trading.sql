-- Paper trading portfolios
CREATE TABLE IF NOT EXISTS paper_portfolios (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  strategy VARCHAR(50) NOT NULL,
  initial_capital REAL NOT NULL DEFAULT 100000,
  current_capital REAL NOT NULL DEFAULT 100000,
  current_value REAL NOT NULL DEFAULT 100000,
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  total_pnl REAL DEFAULT 0,
  max_drawdown REAL DEFAULT 0,
  sharpe_ratio REAL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual paper trades
CREATE TABLE IF NOT EXISTS paper_trades (
  id SERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
  watchlist_id INTEGER NOT NULL REFERENCES stock_watchlist(id),
  recommendation_id INTEGER REFERENCES stock_recommendations(id),
  direction VARCHAR(10) NOT NULL,
  entry_price REAL NOT NULL,
  entry_date TIMESTAMP NOT NULL,
  shares REAL NOT NULL,
  position_size REAL NOT NULL,
  exit_price REAL,
  exit_date TIMESTAMP,
  pnl REAL,
  pnl_percent REAL,
  status VARCHAR(20) DEFAULT 'open',
  stop_loss REAL,
  take_profit REAL,
  exit_reason VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Daily portfolio snapshots for equity curve
CREATE TABLE IF NOT EXISTS paper_portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
  snapshot_date DATE NOT NULL,
  capital REAL NOT NULL,
  portfolio_value REAL NOT NULL,
  open_positions INTEGER DEFAULT 0,
  daily_pnl REAL DEFAULT 0,
  cumulative_pnl REAL DEFAULT 0,
  drawdown REAL DEFAULT 0,
  spy_value REAL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(portfolio_id, snapshot_date)
);

-- Add ML columns to stock_recommendations if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_recommendations' AND column_name = 'model_source') THEN
    ALTER TABLE stock_recommendations ADD COLUMN model_source VARCHAR(20) NOT NULL DEFAULT 'heuristic';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_recommendations' AND column_name = 'ml_prob_up_5d') THEN
    ALTER TABLE stock_recommendations ADD COLUMN ml_prob_up_5d REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_recommendations' AND column_name = 'ml_expected_change_5d') THEN
    ALTER TABLE stock_recommendations ADD COLUMN ml_expected_change_5d REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_recommendations' AND column_name = 'ml_prob_up_4w') THEN
    ALTER TABLE stock_recommendations ADD COLUMN ml_prob_up_4w REAL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_recommendations' AND column_name = 'ml_confidence') THEN
    ALTER TABLE stock_recommendations ADD COLUMN ml_confidence REAL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS paper_trades_portfolio_idx ON paper_trades(portfolio_id);
CREATE INDEX IF NOT EXISTS paper_trades_status_idx ON paper_trades(status);
CREATE INDEX IF NOT EXISTS paper_trades_watchlist_idx ON paper_trades(watchlist_id);
CREATE INDEX IF NOT EXISTS paper_snapshots_portfolio_date_idx ON paper_portfolio_snapshots(portfolio_id, snapshot_date);
CREATE INDEX IF NOT EXISTS recommendations_model_source_idx ON stock_recommendations(model_source);
