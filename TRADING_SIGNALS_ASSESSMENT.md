# Trading Signals & ML Models Assessment

> **⚠ Superseded (2026-10-21).** The numbers below are from June 2026 and are contradicted by the live
> record. As of October: ML model live AUC 0.43 (90% CI 0.35–0.52), right 52% of the time vs 52% for
> always making the same call; heuristic AUC 0.50, and its bullish calls made at event time lagged SPY.
> Neither has shown skill (`ml/models/label_contract.json`, both `tradeable: false`). The ML stock
> pipeline also failed silently every night from 2026-08-23 to 2026-10-21 (feature-builder progress
> printed to stdout corrupted predict.py's JSON). Current public view: `/stocks/predictions` (Spike
> watch); diagnostics: `/admin/ml-models`.

> Analysis of the Newsar stock signal system, model reliability, and improvement roadmap.
> Last updated: 2026-06-06

## Current Performance Summary

**Dataset:** 1,152 anomaly events, 54 features, 72 tickers, 9 walk-forward folds
**Date range:** Dec 2025 — Jun 2026

| Model | ROC-AUC | Accuracy | F1 | Verdict |
|-------|---------|----------|----|---------|
| Random baseline | 0.500 | 60.3% | — | Coin flip |
| **Heuristic (4w)** | **0.764** | 43.9% | 0.433 | **Best performer** — historical win rates |
| XGBoost 4w classifier | 0.657 | 66.5% | 0.186 | Above random, modest signal |
| LightGBM 4w classifier | *training* | — | — | Ensemble member (new) |
| Logistic regression (4w) | 0.588 | 67.9% | 0.400 | Simpler, comparable to XGBoost |
| XGBoost 4w alpha | 0.580 | 70.0% | 0.232 | Market-adjusted, emerging signal |

**Bottom line:** The heuristic approach (historical win rates per ticker/event type) remains the most reliable signal at AUC 0.764. ML models now consistently beat random (0.50) after the data expansion from 338 → 1,152 samples. The 4-week XGBoost classifier at AUC 0.657 shows real but modest predictive power. 5-day models were dropped entirely — they had no signal.

**New in Phase 2:** LightGBM ensemble member, FinBERT article sentiment scoring, training history tracking, and a dedicated predictions page at `/stocks/predictions`.

---

## Changes Made (Phase 2 — June 2026)

### Completed

1. **Added LightGBM 4w classifier** as an ensemble member alongside XGBoost. Predictions now average XGBoost + LightGBM probabilities for the `prob_up_4w` score.

2. **FinBERT article sentiment scoring** (`ml/sentiment.py`) — ProsusAI/finbert runs on CPU to score articles linked to anomaly events. Fills the previously-empty `avg_article_sentiment` feature via `article_entities.sentiment`. Added to weekly cron before feature extraction.

3. **Training history tracking** — Each `ml:train` run now appends metrics to `ml/models/training_history.json` (append-only JSON array). Enables timeline visualization of model improvement over time.

4. **Predictions page** (`/stocks/predictions`) with 4 tabs:
   - Active Predictions — current ML signals with P(Up 4w), confidence, event details
   - Scorecard — validated prediction accuracy, win rates by event type and confidence bucket
   - Model Timeline — AUC chart over time, sample growth, training history table
   - Learning Dashboard — pipeline metrics, data coverage progress bars, next retrain date

5. **Predictions API** (`/api/stocks/predictions`) with 4 actions: active, scorecard, history, dashboard

6. **Fixed stale 5d model references** in ml-model.get.ts (removed xgb_5d_classifier/regressor, added alpha + lgbm)

7. **Cron improvements:**
   - Daily anomaly detection expanded from 1 to 7 day lookback (catches retroactive article processing)
   - `ml:sentiment` added to weekly retrain cron before feature extraction

8. **Navigation** — "Predictions" link added to stocks page tab bar

---

## Changes Made (Phase 1 — June 2026)

### Completed

1. **Dropped all 5-day ML models** — 5d classifier (AUC 0.43) and 5d regressor (44% directional accuracy) removed. System now focuses exclusively on 4-week horizon.

2. **Added market-adjusted alpha targets** — New `target_4w_alpha` (stock beats SPY over 4 weeks) trained alongside raw return `target_4w_up` (stock rises >1%). Alpha model removes market regime noise from predictions.

3. **Tightened hyperparameters** to reduce overfitting:
   - `max_depth`: 3-5 (was 3-8)
   - `min_child_weight`: 3-10 (was 1-7)
   - `reg_alpha`: 0.1-2.0 (was 0-1.0)
   - `reg_lambda`: 1.0-5.0 (was 0.5-5.0)

4. **Expanded dataset 3.4x** (338 → 1,152 samples):
   - Added `volume_spike_1_5x` event type (1.5x baseline threshold)
   - Lowered minimum baseline from 0.3 to 0.1 mentions/day
   - Lowered daily mention floor from 2 to 1
   - Backfilled 190 days of anomaly detection

5. **Shifted heuristic weighting** toward medium-term:
   - Overall score: 0.3 * short-term + 0.7 * medium-term (was 0.6/0.4)
   - Direction priority: medium-term preferred when short and medium disagree

6. **ML signal expiry** extended from 7 days to 28 days (matches 4-week horizon)

### Before vs After

| Metric | Before (338 samples) | After (1,152 samples) | Change |
|--------|---------------------|----------------------|--------|
| XGBoost 4w AUC | 0.630 | **0.657** | +4.3% |
| LogReg AUC | 0.453 (5d target) | **0.588** (4w target) | +29.8% |
| Fold stability | AUC 0.0—0.66 | AUC 0.47—0.78 | Much less variance |
| Test fold sizes | 3—155 samples | 38—266 samples | Reliable evaluation |
| Feature count | 43 | 54 | +11 (new sectors, 1.5x type) |
| Ticker coverage | 22 | 72 | +227% |

---

## System Architecture Overview

```
News Volume Anomalies → Heuristic Signals → ML Scoring → Paper Trading → Predictions Page
         ↓                      ↓                ↓              ↓                ↓
  3x/2x/1.5x/diversity  Historical win rates  XGB+LGBM    Simulated P&L   /stocks/predictions
     spikes              + composite score    ensemble      + metrics        + scorecard
                                              + alpha
```

### Anomaly Event Types

| Type | Threshold | Count | Strength |
|------|-----------|-------|----------|
| `volume_spike_3x` | 3x baseline | 747 | 1.0 |
| `volume_spike_2x` | 2x baseline | 160 | 0.6 |
| `volume_spike_1_5x` | 1.5x baseline | 108 | 0.35 |
| `source_diversity_spike` | 2x sources, min 3 | 137 | 0.4 |

### Components

- **Anomaly Detection** (`newsVolumeAnomalyDetector.ts`): Detects 3x/2x/1.5x mention volume spikes and source diversity spikes against 30-day baseline
- **Heuristic Signals** (`stockSignalGenerator.ts`): Composite scoring from 5 weighted factors, medium-term weighted (0.3 short + 0.7 medium)
- **ML Models** (`ml/train.py`): XGBoost 4w + LightGBM 4w (ensemble) + 4w alpha classifier + logistic regression baseline
- **FinBERT Sentiment** (`ml/sentiment.py`): Article sentiment scoring for anomaly-linked articles (CPU batch processing)
- **Backtesting** (`stockBacktester.ts`): Forward price lookups at 1d/3d/5d/2w/4w horizons, benchmarked against SPY
- **Paper Trading** (`paper_portfolios`, `paper_trades` tables): Simulated portfolio tracking with equity curves

---

## Feature Importance Analysis

### XGBoost 4w Classifier (raw returns)

| Rank | Feature | Importance | Category |
|------|---------|-----------|----------|
| 1 | `spy_20d_return` | 10.4% | Market regime |
| 2 | `sector_anomaly_count` | 7.2% | Cross-ticker |
| 3 | `spy_20d_volatility` | 6.7% | Market regime |
| 4 | `sector_Energy` | 5.5% | Sector |
| 5 | `sma_ratio_50` | 5.0% | Technical |
| 6 | `volume_x_mentions` | 4.5% | Interaction |
| 7 | `rsi_14` | 4.4% | Technical |
| 8 | `rsi_vs_spy` | 4.4% | Relative |
| 9 | `baseline_avg` | 3.7% | Baseline |
| 10 | `spy_rsi_14` | 3.4% | Market regime |

### XGBoost 4w Alpha Classifier (beat SPY)

| Rank | Feature | Importance | Category |
|------|---------|-----------|----------|
| 1 | **`volume_x_mentions`** | **11.2%** | **Interaction** |
| 2 | `sector_anomaly_count` | 5.9% | Cross-ticker |
| 3 | `sector_Energy` | 5.2% | Sector |
| 4 | `spy_rsi_14` | 4.8% | Market regime |
| 5 | `sma_ratio_50` | 4.5% | Technical |
| 6 | `rsi_14` | 3.9% | Technical |
| 7 | `rsi_vs_spy` | 3.6% | Relative |
| 8 | `volatility_20d` | 3.6% | Technical |
| 9 | `volume_trend_5d` | 3.5% | Volume |
| 10 | `anomaly_x_momentum` | 3.5% | Interaction |

**Key finding:** In the alpha model, the top feature is `volume_x_mentions` (11.2%) — an interaction between trading volume and news mentions. This is a signal-specific feature, not a market regime feature. The alpha target successfully shifts the model away from just predicting the market.

---

## Remaining Issues & Next Steps

### What Works Now

- **Heuristic win rates** (AUC 0.764) — still the strongest signal
- **4-week XGBoost** (AUC 0.657) — real signal, useful as confidence filter
- **Interaction features** — `volume_x_mentions`, `anomaly_x_momentum` rank highly in alpha model
- **Sector effects** — Energy sector shows distinct patterns
- **Fold stability** — AUC ranges 0.47-0.78, much more consistent than before

### Still Needs Improvement

- **Alpha model underperforms raw return model** (0.58 vs 0.66) — removing market signal also removes some usable information. Need more data for the alpha model to learn stock-specific patterns.
- **F1 scores remain low** (0.19-0.40) — class imbalance still an issue (66% negative class). Consider threshold tuning or cost-sensitive learning.
- **SPY features still prominent** in raw return model — 3 of top 10 features are SPY-related. The alpha model addresses this.

### Roadmap (Priority Order)

#### Near Term
- ~~**Ensemble models**~~ — DONE: LightGBM added as ensemble partner to XGBoost
- ~~**Article sentiment**~~ — DONE: FinBERT fills `avg_article_sentiment` feature
- ~~**Training history**~~ — DONE: Timeline tracking for model improvement
- ~~**Predictions page**~~ — DONE: `/stocks/predictions` with scorecard and dashboard
- **Cost-sensitive learning** — weight false negatives higher to improve F1/recall
- **Increase article volume** — more feeds and entities mapped to tickers

#### Medium Term
- **Sector-relative features** — replace SPY with sector ETF benchmarks (XLK, XLF, XLE)
- **Fundamental features** — P/E ratio, market cap, earnings proximity
- **Time-decay sample weighting** — weight recent samples higher
- **TimesFM / Chronos** — zero-shot time series forecasting via RunPod GPU

#### Longer Term
- **Deep learning** (LSTM/Transformer) once data exceeds 2,000+ samples
- **Separate models by sector** once per-sector counts support it (100+)
- **Real-time paper portfolio** deployment with automated signal execution

---

## Current Configuration

### Anomaly Detection Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Baseline window | 30 days | Rolling lookback for mention averages |
| Min baseline mentions | 0.1/day (~3/month) | Lowered from 0.3 |
| Min daily mentions | 1 | Lowered from 2 |
| Volume spike 3x | 3.0x multiplier | Highest confidence spike |
| Volume spike 2x | 2.0x multiplier | Medium confidence spike |
| Volume spike 1.5x | 1.5x multiplier | Low confidence spike (new) |
| Source diversity spike | 2.0x source count, min 3 | Multiple outlets reporting |

### Signal Generation Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Short-term horizon | 5 days | Heuristic only (ML dropped) |
| Medium-term horizon | 4 weeks | Primary ML and heuristic horizon |
| Score threshold | 0.55 | Min for bullish/bearish classification |
| Signal expiry (heuristic) | 7 days | Short-term active window |
| Signal expiry (ML) | 28 days | Matches 4-week horizon |
| Short/medium weighting | 30% / 70% | Medium-term prioritized |

### ML Model Hyperparameters (Search Space)

| Parameter | Range | Notes |
|-----------|-------|-------|
| `max_depth` | 3-5 | Constrained to prevent overfitting |
| `learning_rate` | 0.01-0.1 | Conservative |
| `n_estimators` | 50-200 | Moderate ensemble size |
| `min_child_weight` | 3-10 | Higher floor for small data |
| `subsample` | 0.7-0.9 | Row sampling |
| `reg_alpha` | 0.1-2.0 | Strong L1 regularization |
| `reg_lambda` | 1.0-5.0 | Strong L2 regularization |

### Walk-Forward Validation

| Parameter | Value | Notes |
|-----------|-------|-------|
| Folds | 9 | Chronological, no lookahead |
| Fold duration | 14 days | Test window per fold |
| Min train samples | 30 | Per fold |
| Min test samples | 3 | Some late folds still small |

---

## Key Metrics to Track Going Forward

### Model Quality (retrain monthly)
- **ROC-AUC on 4-week classifier** — current: 0.657, target: >0.70
- **ROC-AUC on 4-week alpha** — current: 0.580, target: >0.65
- **Per-fold variance** — current: 0.47-0.78, target: all folds >0.55
- **Feature importance shift** — interaction features should rank higher over time

### Paper Trading (track weekly)
- **Sharpe ratio** — risk-adjusted returns (target: >0.5)
- **Win rate** — percentage of profitable trades (target: >55%)
- **Max drawdown** — largest peak-to-trough decline
- **Alpha vs SPY** — outperformance over buy-and-hold index

### Signal Quality (validate after each batch)
- **Signal-to-noise ratio** — what percentage of signals produce >1% moves?
- **Direction accuracy** — bullish signals that actually went up
- **Average alpha per signal** — mean outperformance vs benchmark

---

## Files Reference

### ML Pipeline
```
ml/
├── train.py              # Walk-forward training (XGB + LGBM + alpha + logreg)
├── features.py           # Feature extraction (54 features)
├── predict.py            # Real-time scoring (XGB+LGBM ensemble)
├── evaluate.py           # Evaluation report generation
├── sentiment.py          # FinBERT article sentiment scoring (NEW)
├── models/               # Trained model artifacts (.joblib)
│   ├── xgb_4w_classifier.joblib
│   ├── xgb_4w_alpha_classifier.joblib
│   ├── lgbm_4w_classifier.joblib       # (NEW)
│   ├── logreg_baseline.joblib
│   ├── training_history.json           # (NEW) append-only AUC timeline
│   └── model_metadata.json
├── data/features.parquet # Cached feature matrix (1,152 samples)
└── reports/              # Evaluation reports
```

### Frontend Pages
```
app/pages/stocks/
├── index.vue             # Watchlist + Signals (added Predictions nav link)
├── predictions.vue       # ML Predictions page (4 tabs) (NEW)
└── simulator.vue         # Paper trading simulator
```

### API Endpoints
```
server/api/stocks/
├── predictions.get.ts    # ML predictions API (4 actions) (NEW)
├── ml-model.get.ts       # Model status/metrics/features (fixed model list)
├── paper-trading.get.ts  # Paper trading data
├── watchlist.get.ts      # Stock watchlist
└── [...params].get.ts    # Ticker detail, recommendations, signal-stats
```

### TypeScript Services
```
server/services/
├── newsVolumeAnomalyDetector.ts  # Anomaly detection (3x/2x/1.5x/diversity)
├── stockSignalGenerator.ts       # Heuristic + ML signal generation
├── stockBacktester.ts            # Backtesting & profile computation
├── stockPriceCollector.ts        # Live prices (Finnhub)
├── stockHistoryBackfiller.ts     # Historical data (Alpaca/Alpha Vantage)
├── stockEntityMapper.ts          # Entity-to-ticker linking
└── stockPersonAnnotator.ts       # Person-org-stock annotations
```

### CLI Commands
```bash
# Anomaly pipeline
npm run stocks:anomalies [days]  # Detect volume anomalies (default cron: 7 days)
npm run stocks:backtest          # Backtest anomalies, compute profiles
npm run stocks:signals           # Generate heuristic + ML signals
npm run stocks:validate          # Validate past signal outcomes

# ML pipeline
npm run ml:sentiment             # FinBERT article sentiment scoring (NEW)
npm run ml:features              # Extract features from anomaly events
npm run ml:train                 # Train all models (XGB + LGBM + alpha + logreg)
npm run ml:evaluate              # Generate evaluation report
npm run ml:predict               # Score recent anomalies (XGB+LGBM ensemble)

# Full retrain sequence
npm run stocks:anomalies 190 && npm run stocks:backtest && \
  npm run ml:sentiment && npm run ml:features -- --force && \
  npm run ml:train && npm run ml:evaluate && npm run ml:predict

# Weekly cron runs: sentiment → features → train → evaluate
```
