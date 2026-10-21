-- Evaluation contract (2026-08-23)
--
-- Makes the label the model was trained on, the score that decides direction,
-- and the outcome it is graded against all recoverable from one row.
--
-- Before this migration:
--   * signal_direction was set from the alpha probability, but the only column
--     that stored it was short_term_confidence — a field whose name means
--     something else and which the heuristic path reuses for a composite score.
--     ml_prob_up_4w held the raw-return probability, which decides nothing.
--   * The alpha model is trained on "beat SPY", but validation stored only the
--     raw return, so the label it was trained on could never be reconstructed.
--   * Nothing recorded which model version produced a row, so predictions from
--     before and after a methodology change averaged together silently.

ALTER TABLE stock_recommendations
  -- The probability that actually decides signal_direction.
  ADD COLUMN IF NOT EXISTS ml_prob_alpha_4w REAL,
  -- SPY over the identical 20-trading-day window, so the alpha label is
  -- reconstructible: (actual_change_4w - actual_benchmark_change_4w) > 0.
  ADD COLUMN IF NOT EXISTS actual_benchmark_change_4w REAL,
  -- Hash of ml/models/label_contract.json. Rows with NULL predate the contract
  -- and must be reported as a separate cohort, never pooled with later ones.
  ADD COLUMN IF NOT EXISTS model_version VARCHAR(40),
  -- When the score was computed, as distinct from when the event happened.
  -- The gap matters: a signal first scored six days after its event is a
  -- four-week forecast with six days of the outcome already known.
  ADD COLUMN IF NOT EXISTS scored_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_recommendations_model_version
  ON stock_recommendations (model_version);

COMMENT ON COLUMN stock_recommendations.ml_prob_alpha_4w IS
  'P(beat SPY over 4w) from xgb_4w_alpha_classifier — the score that sets signal_direction';
COMMENT ON COLUMN stock_recommendations.actual_benchmark_change_4w IS
  'SPY % change over the same 20 trading days as actual_change_4w';
COMMENT ON COLUMN stock_recommendations.model_version IS
  'Hash of the label contract in force when this row was scored; NULL = pre-contract';
COMMENT ON COLUMN stock_recommendations.scored_at IS
  'When the model scored this event (event_date is when the event occurred)';
