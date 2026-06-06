"""
ML Prediction Script.

Takes recent anomaly events (no outcome yet), extracts features,
runs through trained model, outputs predictions as JSON to stdout.

Usage: python predict.py [--since 7]
  --since N: Score anomalies from last N days (default: 7)

Output: JSON array of {
    correlation_id, ticker, event_type, event_date,
    prob_up_5d, expected_change_5d, prob_up_4w, expected_change_4w,
    confidence, top_features
}
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

import db

MODELS_DIR = Path(__file__).parent / 'models'


def load_models():
    """Load all trained models."""
    models = {}

    for name in ['xgb_5d_classifier', 'xgb_5d_regressor', 'xgb_4w_classifier', 'logreg_baseline']:
        path = MODELS_DIR / f'{name}.joblib'
        if path.exists():
            models[name] = joblib.load(path)

    meta_path = MODELS_DIR / 'feature_columns.json'
    if not meta_path.exists():
        print('ERROR: feature_columns.json not found. Run ml:features first.', file=sys.stderr)
        sys.exit(1)

    with open(meta_path) as f:
        meta = json.load(f)

    return models, meta['feature_columns']


def get_recent_anomalies(days_back: int) -> pd.DataFrame:
    """Load recent anomaly events without outcomes."""
    return db.query(f"""
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
            sw.sector
        FROM stock_news_correlations c
        JOIN stock_watchlist sw ON sw.id = c.watchlist_id
        WHERE c.event_date >= NOW() - INTERVAL '{int(days_back)} days'
        ORDER BY c.event_date DESC
    """)


def extract_features_for_prediction(anomalies: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    """Extract features for prediction, matching the training feature set."""
    # Use the same feature extraction logic as features.py but simplified
    # for real-time prediction (no target variables needed)

    from features import (load_price_history, compute_technical_features,
                          compute_spy_features, extract_anomaly_features)

    prices = load_price_history()
    tech = compute_technical_features(prices)
    spy = compute_spy_features(prices)
    anomaly_feats = extract_anomaly_features(anomalies)

    df = anomalies.copy()
    df['event_date_only'] = pd.to_datetime(df['event_date']).dt.date

    # Merge anomaly metadata
    df = df.merge(anomaly_feats, on='correlation_id', how='left')

    # Event type one-hot
    df['is_3x_spike'] = (df['event_type'] == 'volume_spike_3x').astype(int)
    df['is_2x_spike'] = (df['event_type'] == 'volume_spike_2x').astype(int)
    df['is_source_spike'] = (df['event_type'] == 'source_diversity_spike').astype(int)

    # Event day price change
    df['event_day_change_pct'] = df['price_change_percent'].fillna(0).astype(float)

    # Technical features
    if not tech.empty:
        tech['trade_date'] = pd.to_datetime(tech['trade_date']).dt.date
        df = df.merge(tech, left_on=['watchlist_id', 'event_date_only'],
                      right_on=['watchlist_id', 'trade_date'], how='left')
        df.rename(columns={
            'return_5d': 'pre_event_5d_return',
            'return_10d': 'pre_event_10d_return',
            'return_20d': 'pre_event_20d_return',
        }, inplace=True)

    # SPY features
    if not spy.empty:
        spy['trade_date'] = pd.to_datetime(spy['trade_date']).dt.date
        df = df.merge(spy, left_on='event_date_only', right_on='trade_date',
                      how='left', suffixes=('', '_spy'))

    # Sector one-hot
    if 'sector' in df.columns and df['sector'].notna().any():
        sector_dummies = pd.get_dummies(df['sector'], prefix='sector')
        df = pd.concat([df, sector_dummies], axis=1)

    # Temporal
    event_dt = pd.to_datetime(df['event_date'])
    df['day_of_week'] = event_dt.dt.dayofweek
    df['month'] = event_dt.dt.month
    df['is_earnings_season'] = event_dt.dt.month.isin([1, 4, 7, 10]).astype(int)

    # Sentiment placeholder
    df['avg_article_sentiment'] = np.nan

    # Cross-ticker sector count
    if 'sector' in df.columns:
        sector_day_counts = df.groupby(['sector', 'event_date_only']).size().reset_index(name='sector_anomaly_count')
        df = df.merge(sector_day_counts, on=['sector', 'event_date_only'], how='left')
    else:
        df['sector_anomaly_count'] = 1

    # Ensure all expected columns exist (fill missing with 0)
    for col in feature_cols:
        if col not in df.columns:
            df[col] = 0

    # Fill NaN
    for col in feature_cols:
        if df[col].dtype in [np.float64, np.float32, float]:
            df[col] = df[col].fillna(df[col].median() if df[col].notna().any() else 0)

    return df


def predict(days_back: int = 7):
    """Generate predictions for recent anomalies."""
    models, feature_cols = load_models()

    if not models:
        print('ERROR: No trained models found. Run ml:train first.', file=sys.stderr)
        sys.exit(1)

    anomalies = get_recent_anomalies(days_back)
    if anomalies.empty:
        print(json.dumps([]))
        return

    print(f'Scoring {len(anomalies)} anomalies from last {days_back} days...', file=sys.stderr)

    df = extract_features_for_prediction(anomalies, feature_cols)

    X = df[feature_cols].values.astype(np.float32)
    X = np.nan_to_num(X, 0)

    predictions = []

    for i, row in df.iterrows():
        pred = {
            'correlation_id': int(row['correlation_id']),
            'ticker': row['ticker'],
            'event_type': row['event_type'],
            'event_date': str(row['event_date']),
        }

        xi = X[i:i+1]

        # 5d classifier
        if 'xgb_5d_classifier' in models:
            model = models['xgb_5d_classifier']
            prob = float(model.predict_proba(xi)[0, 1])
            pred['prob_up_5d'] = round(prob, 4)
        elif 'logreg_baseline' in models:
            model = models['logreg_baseline']
            xi_scaled = model._scaler.transform(xi)
            prob = float(model.predict_proba(xi_scaled)[0, 1])
            pred['prob_up_5d'] = round(prob, 4)

        # 5d regressor
        if 'xgb_5d_regressor' in models:
            model = models['xgb_5d_regressor']
            pred['expected_change_5d'] = round(float(model.predict(xi)[0]), 4)

        # 4w classifier
        if 'xgb_4w_classifier' in models:
            model = models['xgb_4w_classifier']
            prob = float(model.predict_proba(xi)[0, 1])
            pred['prob_up_4w'] = round(prob, 4)

        # Confidence: average of classifier probabilities (distance from 0.5)
        probs = [pred.get('prob_up_5d', 0.5), pred.get('prob_up_4w', 0.5)]
        confidence = np.mean([abs(p - 0.5) * 2 for p in probs])
        pred['confidence'] = round(float(confidence), 4)

        # Top contributing features (XGBoost feature importance weighted by value)
        if 'xgb_5d_classifier' in models:
            model = models['xgb_5d_classifier']
            importances = model.feature_importances_
            values = xi[0]
            contributions = importances * np.abs(values)
            top_idx = np.argsort(contributions)[::-1][:5]
            pred['top_features'] = [
                {'feature': feature_cols[j], 'importance': round(float(importances[j]), 4),
                 'value': round(float(values[j]), 4)}
                for j in top_idx
            ]

        predictions.append(pred)

    # Output JSON to stdout
    print(json.dumps(predictions, indent=2, default=str))


if __name__ == '__main__':
    days = 7
    for i, arg in enumerate(sys.argv):
        if arg == '--since' and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])

    predict(days)
