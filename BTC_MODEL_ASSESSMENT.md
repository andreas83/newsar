# BTC Model Assessment

> Analysis of the Bitcoin prediction model, its live track record, and what needs fixing.
> Last updated: 2026-08-23 — **model retired, see below**

## Bottom Line

**The BTC model has no measurable predictive skill.** Cross-validation reports AUC 0.65–0.71;
measured against its own live predictions the AUC is **0.48** — a coin flip, marginally inverted.
The gap is not bad luck, it is the CV design: 14-day forward targets on daily rows make adjacent
samples near-duplicates, so ~428 training rows carry roughly 30 independent observations and the
26 walk-forward folds test about one each.

Three things kept this invisible until now:

1. The model has **never emitted a bullish call** (81 bearish, 24 neutral, 0 bullish since
   2026-05-10) — and its accuracy looked acceptable because the validation window was a downtrend.
2. Accuracy was tracked without a baseline. Its bearish calls hit 75.0%; saying "not up >2%" every
   single day would have hit 76.1%.
3. The news features it was supposed to differentiate on were **dead constants** until 2026-08-23
   (see *Data Quality Fixes*), so the model was technicals + calendar wearing a news-intelligence label.

---

## Retired — 23 August 2026

The model was retired the day this assessment was written. The deciding argument was not that
it scored badly, but that **it cannot be scored at all on a human timescale**: one prediction per
day on a 14-day horizon yields roughly 26 independent observations per year, and separating a
real AUC of 0.55 from chance needs on the order of 550. That is ~20 years of waiting. A model
whose accuracy is unfalsifiable should not be issuing signals.

**What stopped:** `btc:signals`, `btc:validate`, `btc:live-run`, the weekly
`ml:btc-sentiment → ml:btc-features → ml:btc-train` retrain chain, the daily `btc:features`
build, and the 00:45 `ml:btc-sentiment` job added earlier the same day.

**What still runs:** `btc:collect` (price history is the one input that cannot be reconstructed
later), `btc:anomalies` and `btc:backtest` (cheap, and they keep the stored dataset complete),
and `btc:sim-run snapshot` — snapshot-only, so the Buy & Hold benchmark keeps tracking the market
without any strategy opening new positions.

**Positions:** the ML portfolio's open short (entry $78,309) was closed at $76,762 for +$193.86,
leaving it flat before deactivation — retiring a strategy with a position open would have frozen
its equity curve exactly like the benchmark bug fixed the same morning. Portfolios 1 (ML) and 2
(Random) are `is_active = false`; portfolio 3 (Buy & Hold) stays active. The live-money portfolio
holds nothing and is deactivated.

**Final standings** since 2026-06-08: Buy & Hold **+23.2%**, Random **+2.3%**, ML Model **−1.7%**.

**Nothing was deleted.** `ml/btc_*.py`, `server/services/btc*.ts`, every table and all three equity
curves remain, and `/bitcoin/predictions`, `/bitcoin/simulator` and `/bitcoin/live-trading` stay
reachable behind an archived banner — they are the evidence for this decision. A revival would
need a shorter horizon (a 1–3 day target becomes falsifiable in 1.5–4 years instead of 20) and
would start with `npm run btc:features -- --backfill`.

### One correction to the numbers above

The live AUC figures in this document were computed with a Hanley–McNeil standard error, which
assumes independent observations. The evaluation harness built alongside this retirement
(`ml/eval_core.py`) resamples whole clusters instead, and the honest intervals are **wider**. For
the stock models this changed a conclusion — an interval that appeared to exclude 0.5 no longer
does. For BTC it did not: 0.476 was never distinguishable from chance either way.

---

## Current Performance Summary

**Dataset:** 428 daily feature rows, 37 features, 26 walk-forward folds
**Date range:** 2025-06-08 — 2026-08-23
**Target:** `target_14d_up` = BTC rises **more than 2%** within 14 days (positive class: 35.3% of all
days, 23.9% in the May–Aug window)

### Cross-validation (as reported by `ml:btc-train`, 2026-08-23)

| Model | ROC-AUC | Accuracy | Precision | Recall | F1 |
|-------|---------|----------|-----------|--------|-----|
| XGBoost 2w classifier | 0.651 | 61.3% | 0.172 | 0.117 | 0.087 |
| LightGBM 2w classifier | 0.675 | 68.7% | 0.287 | 0.183 | 0.185 |
| Logistic regression (baseline) | 0.710 | 57.7% | 0.336 | 0.298 | 0.248 |

Note that the *simplest* model scores best on AUC, which is itself a warning sign: with this little
independent signal, added model capacity is fitting noise.

### Live predictions (2026-05-10 → 2026-08-23, 92 validated)

| Metric | Value | Reference |
|--------|-------|-----------|
| ROC-AUC vs. trained label (>+2% in 14d) | **0.476** | 0.500 = no skill |
| ROC-AUC vs. simple direction (rose at all) | **0.481** | 0.500 = no skill |
| Mean `prob_up_2w` when label was positive | 0.320 | should be *higher* than below |
| Mean `prob_up_2w` when label was negative | 0.333 | slightly inverted |
| Bearish calls "correct" (did not gain >2%) | 51/68 = 75.0% | base rate 76.1% |
| Bullish calls | **0** | — |

**Direction distribution:** 81 bearish, 24 neutral, 0 bullish. `prob_up_2w` has ranged 0.160–0.584
across four months.

### Paper trading (since 2026-06-08, BTC $61,698 → $76,540)

| Portfolio | Value | Return | Trades |
|-----------|-------|--------|--------|
| **BTC Buy & Hold** | $123,896 | **+23.90%** | 1 open |
| BTC Random (seeded) | $102,344 | +2.34% | 5 |
| **BTC ML Model** | $98,266 | **−1.73%** | 9 closed, 1 open |

The ML portfolio has opened **10 positions, every one of them short**. Four of the last five were
stopped out at −5% during the August rally ($64.5k → $78.3k); it is currently short at $78,309.
The live-money portfolio ($113.64) has taken one trade in two months (long, 2026-06-21, expired
−$0.39) and is otherwise dormant.

---

## Why "Never Bullish" Happens

This is a **label/threshold semantics mismatch**, not a deliberate bearish tilt:

- `prob_up_2w` is P(BTC gains **more than 2%** in 14 days). That event occurs 35.3% of the time
  overall and only 23.9% in the recent window.
- A well-calibrated model therefore outputs ~0.24–0.35 on most days.
- `ml/btc_predict.py` labels direction with fixed cutoffs: `>0.6` bullish, `<0.4` bearish.

So the bullish branch is nearly unreachable by construction, and the bearish branch is the default
state. The observed max probability across four months (0.584) has never once crossed the bullish
threshold. Everything downstream — the simulator opening shorts, the scorecard, the page — inherits
this. Note that fixing the thresholds alone would only relabel the output; with AUC 0.48 the
underlying ranking still carries no information.

---

## Why the CV Numbers Overstate

1. **Overlapping targets.** Each daily row's 14-day forward window overlaps the next 13 rows.
   428 rows ≈ 30 independent observations. Walk-forward folds of 14 consecutive test days ≈ 1
   independent observation per fold.
2. **No embargo.** Train and test folds sit adjacent, so a fold's training data contains rows whose
   target window extends into the test period — direct leakage.
3. **Single-class folds.** 9 of 26 XGBoost folds report `roc_auc: null` because the 14-day test
   window contained only one class. They are silently dropped from the average.
4. **Majority-class prediction.** Most folds show `precision: 0.0, recall: 0.0` — the 61–69%
   "accuracy" is largely the model declining to predict the positive class at all. Per-fold accuracy
   ranges from 0.14 to 1.00, which is the spread you would expect from noise.
5. **Flat across retrains.** Eleven weekly retrains (351 → 428 samples) moved CV AUC not at all:

   | Date | Samples | XGB | LGBM | LogReg |
   |------|---------|-----|------|--------|
   | 2026-06-07 | 351 | 0.613 | 0.645 | 0.722 |
   | 2026-07-05 | 379 | 0.654 | 0.695 | 0.740 |
   | 2026-08-02 | 407 | 0.664 | 0.707 | 0.724 |
   | 2026-08-23 | 428 | 0.651 | 0.675 | 0.710 |

   A metric that ignores 22% more data is measuring fold noise, not learning.

---

## Feature Importance Analysis

### XGBoost 2w classifier (gain)

| Feature | Importance |
|---------|-----------|
| bollinger_pct_b | 0.062 |
| atr_14 | 0.059 |
| is_options_expiry_week | 0.058 |
| spy_volatility_20d | 0.053 |
| trump_mention_count | 0.053 |
| sma_ratio_20 | 0.053 |
| is_earnings_season | 0.052 |
| sma_ratio_50 | 0.052 |
| overall_news_fear | 0.051 |
| days_since_halving | 0.049 |

### LightGBM (split count)

`days_since_halving` 82, `spy_volatility_20d` 78, `atr_14` 72, `spy_20d_return` 46,
`days_to_tax_deadline` 46, `volatility_20d` 43, `sma_ratio_50` 42.

### Two problems visible here

**Dead news features.** `crypto_sentiment`, `crypto_mention_count`, `fed_sentiment`,
`fed_mention_count` and `trump_sentiment` all have importance **exactly 0.0** in both tree models.
They were constants — see the sentiment bug below. The news hypothesis has therefore never actually
been tested.

**`days_since_halving` is a time index.** It is the single most-split feature in LightGBM and a
monotonically increasing counter. On 428 days of history it cannot encode a halving cycle (the
last one is far outside the window); it encodes "later in the dataset". That is a regime-drift
proxy the model can only extrapolate in one direction, and a plausible mechanism for the stuck
output.

---

## Data Quality Fixes (2026-08-23)

Four bugs found while investigating why the newest Bitcoin article never reached `/bitcoin`.
All are fixed and deployed; commit `0965672` on branch `btc-pipeline-fixes`.

1. **`/api/bitcoin/news` returned the oldest articles.** The query ordered by `a.id` inside a
   `DISTINCT ON`, so `LIMIT` sliced by article id rather than date. The page had been showing
   February articles. Fixed with a CTE that dedupes first, then orders by `published_at DESC`.

2. **Entity sentiment had been a constant since May.** `article_entities.sentiment` switched format
   on 2026-04-19 — the classifier stopped writing labels (`positive`/`negative`/`neutral`) and
   `ml/btc_sentiment.py` began writing numeric FinBERT scores. The feature builder's label-only
   `CASE ... ELSE 0` read every recent row as neutral, so all three sentiment features were exactly
   0 for four months. Now matches both formats and yields NULL when nothing was scored, so
   `ml/btc_features.py` median-fills instead of learning a fake neutral.

3. **FinBERT ran after the feature build, never before.** `btc_daily_features` rows are written once
   by the 01:00 job and never recomputed (`ml:btc-features --force` only exports to parquet), while
   sentiment scoring ran weekly. Every day's sentiment was scored *after* its feature row was frozen.
   Added a daily `ml:btc-sentiment` cron at 00:45, ahead of the feature build.

4. **`Crypto.com Arena` counted as crypto news.** The `%crypto%` wildcard matched the Los Angeles
   basketball venue, inflating `crypto_mention_count` on days with Lakers coverage. Excluded from all
   crypto matchers and scrubbed from history.

Additionally, **the buy & hold benchmark was frozen in cash**: `updateOpenTrades()` applied the
14-day signal expiry to the benchmark portfolio, closing its position on 2026-06-23 and pinning the
equity curve at $103,477 while BTC ran from $64k to $77k. Buy & hold now excludes forced exits and
the 77 affected snapshots were recomputed from stored prices. **This is why the ML portfolio
previously looked competitive** — it was being compared against a benchmark that had stopped
tracking the market.

All 442 daily feature rows were rebuilt after the fixes. The retrain of 2026-08-23 10:10 was the
last one trained on dead sentiment; **2026-08-30 will be the first honest test of the news
hypothesis.**

---

## Remaining Issues & Next Steps

### Priority order

1. **Add baselines to the scorecard.** Always-short, always-long, and always-neutral, alongside the
   model. Four months of "58% accurate" hid a below-base-rate result. No metric should be reported
   without the number it must beat.
2. **Fix the direction thresholds.** Either derive cutoffs from the training base rate (e.g. bullish
   if `prob_up > base_rate * 1.3`) or retrain against a symmetric label (`change_14d > 0`) so that
   `prob_up_2w` means what the 0.4/0.6 cutoffs assume it means.
3. **Purge and embargo the walk-forward folds.** Insert a 14-day gap between train and test so a
   fold cannot be graded on target windows its training rows already saw. Expect reported AUC to
   fall; that fall is the measurement getting honest.
4. **Report an effective sample size.** With a 14-day horizon on daily rows, state ~n/14 alongside
   the raw count so that fold metrics are read with appropriate scepticism.
5. **Drop or replace `days_since_halving`.** It is a time index on this window. If cycle position is
   wanted, encode it as a bounded phase (0–1 through the cycle), not a raw day count.
6. **Reconsider the 5% stop on a 14-day horizon.** BTC's daily volatility is ~2–3%, so a 5% stop is
   noise-dominated and the position is closed before the thesis resolves — four stop-outs in five
   days is the symptom. Use ~2×ATR(14), or shorten the horizon to match the stop.
7. **Re-evaluate the news features after 2026-08-30.** If `crypto_sentiment` remains at 0.0
   importance with live values, the news hypothesis is falsified for this horizon and the feature
   set should shrink accordingly.

### What is working

- The data pipeline itself (price collection, feature build, prediction, validation, simulation) is
  sound and runs unattended.
- Validation is honest: `btc_predictions` stores `actual_change_2w` and the outcome is recorded
  regardless of whether the model was right. That is what made this assessment possible.
- The simulator's random and buy & hold portfolios are genuine controls — worth keeping, and worth
  reading before any claim about the model.

### Do not

- Do not deploy real capital against this model at its current AUC. The live portfolio should stay
  at its token size until a validated result beats the baselines listed above.

---

## Current Configuration

### Target definition

```
target_7d_up  = change_7d  > 2%     (14-day model is the one deployed)
target_14d_up = change_14d > 2%
```

### Prediction thresholds (`ml/btc_predict.py`)

```
prob_up > 0.6  → bullish
prob_up < 0.4  → bearish
otherwise      → neutral
confidence     = |prob_up - 0.5| * 2
```

### Simulator parameters (`server/services/btcSimulatorEngine.ts`)

```
RISK_PER_TRADE     = 10% of capital
STOP_LOSS_PCT      = 5%
TAKE_PROFIT_PCT    = 15%
SIGNAL_EXPIRY_DAYS = 14        (not applied to buy_and_hold)
Max open positions = 1
Buy & hold         = 95% of capital, single entry, never exits
```

### Cron schedule

```
*/30 * * * *  btc:collect          price collection (24/7)
45 0  * * *   ml:btc-sentiment     FinBERT scoring — must precede the feature build
0  1  * * *   btc:features         daily feature rows (yesterday + today)
15 1  * * *   btc:anomalies 7      news volume anomalies
30 1  * * *   btc:backtest         forward returns for targets
45 1  * * *   btc:signals 7        ML predictions
55 1  * * *   btc:validate         validate predictions past 14 days
30 2  * * *   btc:sim-run          simulator trades + snapshot
0  12 * * *   btc:live-run         live trading
0  8  * * 0   ml:btc-sentiment → ml:btc-features --force → ml:btc-train   (weekly retrain)
```

---

## Files Reference

### ML pipeline

- `ml/btc_features.py` — exports `btc_daily_features` to parquet (does **not** rebuild rows)
- `ml/btc_train.py` — walk-forward training, appends to `ml/models/btc_training_history.json`
- `ml/btc_predict.py` — ensemble scoring (XGBoost + LightGBM averaged), direction thresholds
- `ml/btc_sentiment.py` — FinBERT scoring for crypto-linked articles

### Services

- `server/services/btcPriceCollector.ts` — CoinGecko price ingestion (`server/utils/coingeckoClient.ts`)
- `server/services/btcFeatureBuilder.ts` — the 37 daily features (technical, news, calendar, regime)
- `server/services/btcBacktester.ts` — forward returns and target labelling
- `server/services/btcSignalGenerator.ts` — runs `btc_predict.py`, stores and validates predictions
- `server/services/btcSimulatorEngine.ts` — three-strategy paper trading
- `server/services/btcLiveTradingEngine.ts` — live trading
- `server/services/btcNewsAnomalyDetector.ts` — crypto news volume spikes

### Pages and API

- `/bitcoin` — price, news, active prediction
- `/bitcoin/predictions` — prediction history and scorecard
- `/bitcoin/simulator` — three-strategy leaderboard and equity curves
- `/bitcoin/live-trading` — live portfolio
- `server/api/bitcoin/{news,prices,predictions,simulator,live-trading}.get.ts`

### CLI

```bash
npm run btc:collect            # price collection
npm run btc:features           # daily feature rows (add -- --backfill for full history)
npm run btc:backtest           # forward returns
npm run btc:signals [days]     # ML predictions
npm run btc:validate           # validate past predictions
npm run btc:sim-run            # simulator
npm run ml:btc-sentiment       # FinBERT scoring
npm run ml:btc-features -- --force && npm run ml:btc-train    # retrain
```

See `TRADING_SIGNALS_ASSESSMENT.md` for the equivalent analysis of the stock signal system.
