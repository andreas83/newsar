"""
Feature Extraction for Stock Signal ML Model.

Extracts a feature matrix from existing database tables. Each row = one anomaly event
from stock_news_correlations joined with price data, backtest results, and article metadata.

Output: ml/data/features.parquet — cached feature matrix for fast iteration.

Usage: python features.py [--force]
  --force: re-extract even if cached features exist
"""

import sys
import os
import json
import numpy as np
import pandas as pd
from pathlib import Path

import db

DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_PATH = DATA_DIR / 'features.parquet'


def load_correlations() -> pd.DataFrame:
    """Load all anomaly events with their backtest results and watchlist metadata."""
    return db.query("""
        SELECT
            c.id as correlation_id,
            c.watchlist_id,
            c.entity_id,
            c.event_type,
            c.event_date,
            c.confidence,
            c.mention_count_window,
            c.price_before,
            c.price_after,
            c.price_change_percent,
            c.metadata as corr_metadata,
            sw.ticker,
            sw.sector,
            b.change_1d, b.change_3d, b.change_5d,
            b.change_1w, b.change_2w, b.change_4w,
            b.benchmark_change_1d, b.benchmark_change_5d,
            b.benchmark_change_2w, b.benchmark_change_4w
        FROM stock_news_correlations c
        JOIN stock_watchlist sw ON sw.id = c.watchlist_id
        LEFT JOIN stock_backtest_results b ON b.correlation_id = c.id
        ORDER BY c.event_date ASC
    """)


def load_price_history() -> pd.DataFrame:
    """Load daily price data for all watched stocks (one row per ticker per day)."""
    return db.query("""
        SELECT DISTINCT ON (watchlist_id, DATE(fetched_at))
            watchlist_id,
            DATE(fetched_at) as trade_date,
            price,
            open_price,
            high_price,
            low_price,
            volume,
            previous_close
        FROM stock_prices
        ORDER BY watchlist_id, DATE(fetched_at) ASC, source ASC, fetched_at DESC
    """)


def compute_technical_features(prices: pd.DataFrame) -> pd.DataFrame:
    """Compute technical indicators per ticker from daily price history."""
    import ta

    results = []
    for wid, group in prices.groupby('watchlist_id'):
        g = group.sort_values('trade_date').copy()
        if len(g) < 20:
            continue

        close = g['price'].astype(float)
        high = g['high_price'].astype(float).fillna(close)
        low = g['low_price'].astype(float).fillna(close)
        volume = g['volume'].astype(float).fillna(0)

        # RSI 14
        g['rsi_14'] = ta.momentum.RSIIndicator(close, window=14).rsi()

        # SMA ratios
        sma20 = close.rolling(20).mean()
        sma50 = close.rolling(50).mean()
        g['sma_ratio_20'] = close / sma20
        g['sma_ratio_50'] = close / sma50

        # Volatility (20d stddev of daily returns)
        daily_returns = close.pct_change()
        g['volatility_20d'] = daily_returns.rolling(20).std()

        # ATR 14
        g['atr_14'] = ta.volatility.AverageTrueRange(high, low, close, window=14).average_true_range()

        # Volume ratio (current day vs 20d avg)
        vol_avg_20 = volume.rolling(20).mean()
        g['volume_ratio'] = volume / vol_avg_20.replace(0, np.nan)

        # Volume trend 5d
        g['volume_trend_5d'] = volume.rolling(5).mean() / vol_avg_20.replace(0, np.nan)

        # Pre-event returns
        g['return_5d'] = close.pct_change(5) * 100
        g['return_10d'] = close.pct_change(10) * 100
        g['return_20d'] = close.pct_change(20) * 100

        g['watchlist_id'] = wid
        results.append(g[['watchlist_id', 'trade_date', 'rsi_14', 'sma_ratio_20',
                          'sma_ratio_50', 'volatility_20d', 'atr_14', 'volume_ratio',
                          'volume_trend_5d', 'return_5d', 'return_10d', 'return_20d']])

    if not results:
        return pd.DataFrame()
    return pd.concat(results, ignore_index=True)


def compute_spy_features(prices: pd.DataFrame) -> pd.DataFrame:
    """Compute market regime features from SPY."""
    # Find SPY watchlist_id
    spy_ids = db.query("SELECT id FROM stock_watchlist WHERE ticker = 'SPY'")
    if spy_ids.empty:
        return pd.DataFrame()

    spy_id = int(spy_ids.iloc[0]['id'])
    spy = prices[prices['watchlist_id'] == spy_id].sort_values('trade_date').copy()
    if len(spy) < 20:
        return pd.DataFrame()

    close = spy['price'].astype(float)
    daily_returns = close.pct_change()

    import ta
    spy['spy_20d_return'] = close.pct_change(20) * 100
    spy['spy_20d_volatility'] = daily_returns.rolling(20).std()
    spy['spy_rsi_14'] = ta.momentum.RSIIndicator(close, window=14).rsi()

    return spy[['trade_date', 'spy_20d_return', 'spy_20d_volatility', 'spy_rsi_14']]


def extract_anomaly_features(df: pd.DataFrame) -> pd.DataFrame:
    """Extract features from the anomaly metadata."""
    records = []
    for _, row in df.iterrows():
        meta = row.get('corr_metadata')
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except (json.JSONDecodeError, TypeError):
                meta = {}
        if not isinstance(meta, dict):
            meta = {}

        records.append({
            'correlation_id': row['correlation_id'],
            'multiplier': float(meta.get('multiplier', 2)),
            'source_count': int(meta.get('source_count', 1)),
            'mention_count': int(meta.get('mention_count', row.get('mention_count_window', 0) or 0)),
            'new_keyword_count': len(meta.get('new_keywords', [])),
            'baseline_avg': float(meta.get('baseline_avg', 0) or 0),
            'baseline_stddev': float(meta.get('baseline_stddev', 0) or 0),
        })

    features = pd.DataFrame(records)

    # Coefficient of variation
    features['baseline_cv'] = np.where(
        features['baseline_avg'] > 0,
        features['baseline_stddev'] / features['baseline_avg'],
        0
    )

    return features


def assert_no_dead_features(df, feature_cols, missing_threshold=0.95):
    """Fail the build if a declared feature carries no information.

    A feature that is all-NaN or constant trains and scores without complaint:
    NaN becomes the column median, the median of an all-NaN column is NaN, and
    np.nan_to_num turns that into 0. The model then learns a constant, the
    feature shows importance exactly 0.0, and nobody notices.

    That is precisely how avg_article_sentiment stayed dead for the entire life
    of this pipeline, and how three BTC news features stayed dead for four
    months. Loudly refusing to build is the cheapest insurance available.
    """
    dead = []
    for col in feature_cols:
        if col not in df.columns:
            dead.append((col, 'missing from frame'))
            continue
        s = df[col]
        missing = float(s.isna().mean())
        if missing >= missing_threshold:
            dead.append((col, f'{missing:.0%} missing'))
        elif s.nunique(dropna=True) <= 1:
            dead.append((col, 'constant'))

    if dead:
        print('[features] DEAD FEATURES — refusing to build:', file=sys.stderr)
        for col, why in dead:
            print(f'  {col}: {why}', file=sys.stderr)
        print('[features] Fix the source of these columns, or remove them from '
              'the feature list. A constant feature is never a harmless one.',
              file=sys.stderr)
        sys.exit(1)


def build_features_from_correlations(corr: pd.DataFrame, prices: pd.DataFrame,
                                     panel: pd.DataFrame | None = None) -> pd.DataFrame:
    """Derive the full feature frame for a set of anomaly events.

    This is the single definition of what a feature vector is. Training
    (build_feature_matrix) and serving (predict.extract_features_for_prediction)
    both call it, because for most of this pipeline's life predict.py carried a
    hand-copy that computed 47 of the 54 features and silently filled the other
    seven with zero — including vol_relative, LightGBM's third-heaviest split.
    A model scored on a vector it was never trained on is not a model.

    `panel` supplies the cross-sectional and historical context (all known
    events). It defaults to `corr`, which is right for a full training build; at
    serving time the caller passes the full event history so a seven-day batch
    does not silently see a smaller world than training did.
    """
    panel = corr if panel is None else panel

    print('[features] Computing technical indicators...')
    tech = compute_technical_features(prices)
    print(f'  → Technical features for {tech["watchlist_id"].nunique()} tickers')

    print('[features] Computing SPY market regime features...')
    spy = compute_spy_features(prices)
    print(f'  → {len(spy)} SPY daily records')

    print('[features] Extracting anomaly metadata features...')
    anomaly_feats = extract_anomaly_features(corr)

    # --- Merge everything ---
    print('[features] Merging feature matrix...')

    # Start with correlation base
    df = corr.copy()
    df['event_date_only'] = pd.to_datetime(df['event_date']).dt.date

    # Merge anomaly metadata features
    df = df.merge(anomaly_feats, on='correlation_id', how='left')

    # Event type one-hot
    df['is_3x_spike'] = (df['event_type'] == 'volume_spike_3x').astype(int)
    df['is_2x_spike'] = (df['event_type'] == 'volume_spike_2x').astype(int)
    df['is_1_5x_spike'] = (df['event_type'] == 'volume_spike_1_5x').astype(int)
    df['is_source_spike'] = (df['event_type'] == 'source_diversity_spike').astype(int)

    # Event day price change
    df['event_day_change_pct'] = df['price_change_percent'].fillna(0).astype(float)

    # Merge technical features (join on watchlist_id + trade_date = event_date)
    if not tech.empty:
        tech['trade_date'] = pd.to_datetime(tech['trade_date']).dt.date
        df = df.merge(
            tech,
            left_on=['watchlist_id', 'event_date_only'],
            right_on=['watchlist_id', 'trade_date'],
            how='left'
        )
        # Rename pre-event returns
        df.rename(columns={
            'return_5d': 'pre_event_5d_return',
            'return_10d': 'pre_event_10d_return',
            'return_20d': 'pre_event_20d_return',
        }, inplace=True)
    else:
        for col in ['rsi_14', 'sma_ratio_20', 'sma_ratio_50', 'volatility_20d',
                     'atr_14', 'volume_ratio', 'volume_trend_5d',
                     'pre_event_5d_return', 'pre_event_10d_return', 'pre_event_20d_return']:
            df[col] = np.nan

    # Merge SPY features
    if not spy.empty:
        spy['trade_date'] = pd.to_datetime(spy['trade_date']).dt.date
        df = df.merge(
            spy,
            left_on='event_date_only',
            right_on='trade_date',
            how='left',
            suffixes=('', '_spy')
        )
    else:
        for col in ['spy_20d_return', 'spy_20d_volatility', 'spy_rsi_14']:
            df[col] = np.nan

    # Sector one-hot encoding
    if 'sector' in df.columns and df['sector'].notna().any():
        sector_dummies = pd.get_dummies(df['sector'], prefix='sector')
        df = pd.concat([df, sector_dummies], axis=1)

    # Temporal features
    event_dt = pd.to_datetime(df['event_date'])
    df['day_of_week'] = event_dt.dt.dayofweek
    df['month'] = event_dt.dt.month
    df['is_earnings_season'] = event_dt.dt.month.isin([1, 4, 7, 10]).astype(int)

    # Sentiment features (from article entities if available)
    print('[features] Loading article sentiment data...')
    try:
        # article_entities.sentiment is varchar(50) holding two formats: labels
        # ('positive'/'negative'/'neutral') written by the classifier up to
        # 2026-04-19, and numeric FinBERT scores written by ml/sentiment.py since.
        # AVG() over a varchar raises in Postgres, which is why this feature has
        # been an all-NaN column for its entire existence. Same expression as
        # ENTITY_SENTIMENT_AVG in server/services/btcFeatureBuilder.ts.
        sentiment = db.query(r"""
            SELECT
                ae.entity_id,
                DATE(a.published_at) as pub_date,
                AVG(CASE
                    WHEN ae.sentiment ~ '^-?[0-9]+(\.[0-9]+)?$' THEN ae.sentiment::float
                    WHEN ae.sentiment = 'positive' THEN 1
                    WHEN ae.sentiment = 'negative' THEN -1
                    WHEN ae.sentiment = 'neutral'  THEN 0
                    ELSE NULL END) as avg_sentiment
            FROM article_entities ae
            JOIN articles a ON a.id = ae.article_id
            WHERE ae.sentiment IS NOT NULL
            GROUP BY ae.entity_id, DATE(a.published_at)
        """)
        if not sentiment.empty:
            sentiment['pub_date'] = pd.to_datetime(sentiment['pub_date']).dt.date
            df = df.merge(
                sentiment.rename(columns={'avg_sentiment': 'avg_article_sentiment'}),
                left_on=['entity_id', 'event_date_only'],
                right_on=['entity_id', 'pub_date'],
                how='left'
            )
        else:
            df['avg_article_sentiment'] = np.nan
    except Exception as e:
        # Do not swallow this silently: a failure here yields an all-NaN feature
        # that trains and scores without complaint, so it has to be visible.
        print(f'[features] WARNING: sentiment feature unavailable, filling with NaN '
              f'({type(e).__name__}: {e})')
        df['avg_article_sentiment'] = np.nan

    # Cross-ticker: sector anomaly count (same sector, same day).
    # Counted over `panel`, not over `df`: at serving time df holds only the last
    # few days of events, so counting within it would understate the true
    # cross-section and produce a feature the model never saw in training.
    if 'sector' in df.columns and 'sector_anomaly_count' not in df.columns:
        panel_sector = panel.copy()
        panel_sector['event_date_only'] = pd.to_datetime(panel_sector['event_date']).dt.date
        sector_day_counts = (panel_sector.groupby(['sector', 'event_date_only'])
                             .size().reset_index(name='sector_anomaly_count'))
        df = df.merge(sector_day_counts, on=['sector', 'event_date_only'], how='left')
        df['sector_anomaly_count'] = df['sector_anomaly_count'].fillna(1)
    elif 'sector_anomaly_count' not in df.columns:
        df['sector_anomaly_count'] = 1

    # --- Interaction Features ---
    # Combine anomaly signals with stock-specific metrics to reduce market regime dominance
    df['anomaly_x_momentum'] = df.get('multiplier', pd.Series(0, index=df.index)).fillna(0) * \
                                df.get('pre_event_5d_return', pd.Series(0, index=df.index)).fillna(0)
    df['confidence_x_volatility'] = df.get('confidence', pd.Series(0, index=df.index)).fillna(0) * \
                                     df.get('volatility_20d', pd.Series(0, index=df.index)).fillna(0)
    df['volume_x_mentions'] = df.get('volume_ratio', pd.Series(0, index=df.index)).fillna(0) * \
                               df.get('mention_count', pd.Series(0, index=df.index)).fillna(0)

    # --- Relative Features (stock vs market) ---
    # Normalize stock metrics relative to SPY to reduce raw market regime dominance
    df['rsi_vs_spy'] = df.get('rsi_14', pd.Series(np.nan, index=df.index)).fillna(50) - \
                        df.get('spy_rsi_14', pd.Series(np.nan, index=df.index)).fillna(50)
    spy_vol = df.get('spy_20d_volatility', pd.Series(np.nan, index=df.index))
    df['vol_relative'] = np.where(
        spy_vol.fillna(0) > 0,
        df.get('volatility_20d', pd.Series(np.nan, index=df.index)).fillna(0) / spy_vol.fillna(1),
        1.0
    )
    df['momentum_vs_spy'] = df.get('pre_event_5d_return', pd.Series(np.nan, index=df.index)).fillna(0) - \
                             (df.get('spy_20d_return', pd.Series(np.nan, index=df.index)).fillna(0) / 4)  # ~5d equivalent

    # --- Ticker Event History ---
    # How many anomalies this ticker has had in the preceding 30 days (repeated
    # signals may be weaker). Counted over `panel` so a 7-day scoring batch sees
    # the same history the training rows did, and via searchsorted so this is not
    # the O(n^2) row loop that made it too slow to compute at serving time — the
    # reason it used to be silently zero-filled there.
    panel_hist = panel[['watchlist_id', 'event_date']].copy()
    panel_hist['event_dt'] = pd.to_datetime(panel_hist['event_date'])
    by_ticker = {wid: np.sort(g['event_dt'].values)
                 for wid, g in panel_hist.groupby('watchlist_id')}

    event_dt_series = pd.to_datetime(df['event_date'])
    counts = []
    for wid, when in zip(df['watchlist_id'], event_dt_series):
        history = by_ticker.get(wid)
        if history is None or len(history) == 0:
            counts.append(0)
            continue
        window_start = np.datetime64(when - pd.Timedelta(days=30))
        lo = np.searchsorted(history, window_start, side='left')
        hi = np.searchsorted(history, np.datetime64(when), side='left')
        counts.append(int(hi - lo))
    df['ticker_event_count_30d'] = counts

    return df


def build_feature_matrix():
    """Build complete feature matrix from all data sources."""
    print('[features] Loading correlation events...')
    corr = load_correlations()
    print(f'  → {len(corr)} correlation events loaded')

    if corr.empty:
        print('[features] No correlation events found. Run stocks:anomalies and stocks:backtest first.')
        sys.exit(1)

    print('[features] Loading price history...')
    prices = load_price_history()
    print(f'  → {len(prices)} daily price records loaded')

    df = build_features_from_correlations(corr, prices)

    # --- Target Variables ---
    # An event whose forward window has no price data has an UNKNOWN outcome, not
    # a negative one. Comparisons against NaN evaluate to False, so casting them
    # straight to int would label every such event as "did not rise" and train the
    # models to be systematically bearish. Keep them NaN so the dropna below
    # removes them from the training set.
    change_4w = df['change_4w'].astype(float)

    # Raw return targets
    df['target_4w_up'] = (change_4w > 1.0).astype(float).where(change_4w.notna())
    df['target_4w_change'] = change_4w

    # Alpha target (stock vs SPY benchmark — removes market regime noise).
    # This is the only deployed label: with a 28-day horizon over ~8 months, the
    # raw-return label has roughly 8 independent market windows behind it, so it
    # is a market-direction label wearing a per-ticker name.
    bm_4w = df['benchmark_change_4w'].astype(float).fillna(0)
    df['target_4w_alpha'] = (change_4w - bm_4w > 0).astype(float).where(change_4w.notna())

    # --- Select final feature columns ---
    # Define the feature column groups
    anomaly_cols = ['multiplier', 'confidence', 'source_count', 'mention_count',
                    'new_keyword_count']
    event_type_cols = ['is_3x_spike', 'is_2x_spike', 'is_1_5x_spike', 'is_source_spike']
    baseline_cols = ['baseline_avg', 'baseline_stddev', 'baseline_cv']
    price_cols = ['event_day_change_pct', 'pre_event_5d_return',
                  'pre_event_10d_return', 'pre_event_20d_return']
    technical_cols = ['rsi_14', 'sma_ratio_20', 'sma_ratio_50',
                      'volatility_20d', 'atr_14']
    volume_cols = ['volume_ratio', 'volume_trend_5d']
    market_cols = ['spy_20d_return', 'spy_20d_volatility', 'spy_rsi_14']
    temporal_cols = ['day_of_week', 'month', 'is_earnings_season']
    sentiment_cols = ['avg_article_sentiment']
    cross_cols = ['sector_anomaly_count']
    interaction_cols = ['anomaly_x_momentum', 'confidence_x_volatility', 'volume_x_mentions']
    relative_cols = ['rsi_vs_spy', 'vol_relative', 'momentum_vs_spy']
    history_cols = ['ticker_event_count_30d']

    sector_cols = [c for c in df.columns if c.startswith('sector_') and c != 'sector_anomaly_count']

    feature_cols = (anomaly_cols + event_type_cols + baseline_cols +
                    price_cols + technical_cols + volume_cols +
                    market_cols + temporal_cols + sentiment_cols +
                    cross_cols + interaction_cols + relative_cols +
                    history_cols + sector_cols)

    target_cols = ['target_4w_up', 'target_4w_change',
                   'target_4w_alpha']
    id_cols = ['correlation_id', 'watchlist_id', 'ticker', 'event_date', 'event_type']

    # Keep only columns that exist
    feature_cols = [c for c in feature_cols if c in df.columns]
    all_cols = id_cols + feature_cols + target_cols
    all_cols = [c for c in all_cols if c in df.columns]

    result = df[all_cols].copy()

    # Drop any duplicate columns from merges
    result = result.loc[:, ~result.columns.duplicated()]

    # Fill NaN for numeric features with median, and record the values used.
    # Serving must impute with these same numbers: imputing from the current
    # batch means a three-row nightly batch defines its own idea of "normal".
    imputation = {}
    for col in feature_cols:
        if col not in result.columns:
            continue
        s = result[col]
        if s.dtype in [np.float64, np.float32, float, 'float64', 'float32']:
            median = s.median()
            imputation[col] = None if pd.isna(median) else float(median)
            result[col] = s.fillna(median)
        elif s.dtype in [np.int64, np.int32, int, 'int64', 'int32']:
            imputation[col] = 0
            result[col] = s.fillna(0)

    # Drop rows with no 4-week outcome (no backtest data). Use how='any' rather
    # than how='all': with 'all', a single target that never goes NaN silently
    # keeps every unlabelled row in the training set.
    before = len(result)
    result = result.dropna(subset=['target_4w_change', 'target_4w_alpha'], how='any')
    if before != len(result):
        print(f'[features] Dropped {before - len(result)} events with no 4w outcome '
              f'({len(result)} labelled samples remain)')

    # Guaranteed non-NaN after the drop; restore integer dtype for the classifiers.
    result['target_4w_up'] = result['target_4w_up'].astype(int)
    result['target_4w_alpha'] = result['target_4w_alpha'].astype(int)

    assert_no_dead_features(result, feature_cols)

    # Save feature column names for inference
    feature_meta = {
        'feature_columns': feature_cols,
        'target_columns': target_cols,
        'id_columns': id_cols,
        'total_features': len(feature_cols),
    }

    meta_path = Path(__file__).parent / 'models' / 'feature_columns.json'
    meta_path.parent.mkdir(exist_ok=True)
    with open(meta_path, 'w') as f:
        json.dump(feature_meta, f, indent=2)

    with open(meta_path.parent / 'feature_imputation.json', 'w') as f:
        json.dump(imputation, f, indent=2)

    return result, feature_cols, target_cols


def main():
    force = '--force' in sys.argv

    if OUTPUT_PATH.exists() and not force:
        print(f'[features] Cached features found at {OUTPUT_PATH}')
        print(f'  Use --force to re-extract.')
        existing = pd.read_parquet(OUTPUT_PATH)
        print(f'  → Shape: {existing.shape}')
        print(f'  → Samples with 4w target: {existing["target_4w_up"].notna().sum()}')
        print(f'  → Samples with 4w alpha target: {existing["target_4w_alpha"].notna().sum() if "target_4w_alpha" in existing.columns else "N/A"}')
        return

    result, feature_cols, target_cols = build_feature_matrix()

    result.to_parquet(OUTPUT_PATH, index=False)
    print(f'\n[features] Feature matrix saved to {OUTPUT_PATH}')
    print(f'  → Shape: {result.shape}')
    print(f'  → Features: {len(feature_cols)}')
    print(f'  → Samples with 4w target: {result["target_4w_up"].notna().sum()}')
    print(f'  → Samples with 4w alpha target: {result["target_4w_alpha"].notna().sum()}')
    print(f'  → Tickers: {result["ticker"].nunique()}')
    print(f'  → Date range: {result["event_date"].min()} to {result["event_date"].max()}')

    # Print feature summary
    print(f'\n  Feature columns ({len(feature_cols)}):')
    for i, col in enumerate(feature_cols):
        print(f'    {i+1:2d}. {col}')


if __name__ == '__main__':
    main()
