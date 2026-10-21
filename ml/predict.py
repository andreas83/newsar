"""
ML Prediction Script.

Takes recent anomaly events (no outcome yet), extracts features,
runs through trained 4-week models, outputs predictions as JSON to stdout.

Usage: python predict.py [--since 7]
  --since N: Score anomalies from last N days (default: 7)

Output: JSON array of {
    correlation_id, ticker, event_type, event_date,
    prob_up_4w, prob_alpha_4w,
    confidence, top_features
}
"""

import json
import contextlib
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

    for name in ['xgb_4w_classifier', 'xgb_4w_alpha_classifier', 'lgbm_4w_classifier', 'logreg_baseline']:
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
    """Build the serving feature vector using the training code path.

    This used to be a hand-copy of features.py that computed 47 of the 54
    features and filled the rest with 0 — vol_relative (LightGBM's third-heaviest
    split), rsi_vs_spy, the three interaction terms, momentum_vs_spy and
    ticker_event_count_30d all arrived at the model as zero. There is now exactly
    one definition of a feature vector, in features.build_features_from_correlations.
    """
    from features import (load_price_history, load_correlations,
                          build_features_from_correlations)

    prices = load_price_history()
    # Full event history, so cross-sectional and 30-day-history features see the
    # same world they saw during training rather than just this batch.
    panel = load_correlations()

    df = build_features_from_correlations(anomalies, prices, panel=panel)

    # Sector one-hots are structurally zero for sectors absent from this batch,
    # and the event-type flags are always computed. Anything else missing is a
    # train/serve divergence and must stop the run rather than quietly score.
    missing = [c for c in feature_cols if c not in df.columns]
    structural = [c for c in missing if c.startswith('sector_')]
    divergent = [c for c in missing if c not in structural]
    if divergent:
        print(f'[predict] FATAL: {len(divergent)} feature(s) not produced by the '
              f'feature builder: {", ".join(divergent)}', file=sys.stderr)
        print('[predict] Scoring on a vector the model was not trained on is '
              'worse than not scoring at all.', file=sys.stderr)
        sys.exit(1)
    for col in structural:
        df[col] = 0

    # Impute with the medians recorded at training time, never with this batch's
    # own medians — a three-row nightly batch must not redefine "normal".
    imputation_path = MODELS_DIR / 'feature_imputation.json'
    imputation = {}
    if imputation_path.exists():
        with open(imputation_path) as f:
            imputation = json.load(f)
    else:
        print('[predict] WARNING: no feature_imputation.json; run ml:features to '
              'regenerate it. Falling back to zero-fill.', file=sys.stderr)

    for col in feature_cols:
        fill = imputation.get(col, 0)
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0 if fill is None else fill)

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

    # stdout is reserved for the JSON result; the feature builder prints progress,
    # which corrupted the output and silently broke every nightly run from 2026-08-23.
    with contextlib.redirect_stdout(sys.stderr):
        df = extract_features_for_prediction(anomalies, feature_cols)
    df = df.reset_index(drop=True)

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

        # 4w classifier — ensemble XGBoost + LightGBM (average probabilities)
        prob_up_sources = []
        if 'xgb_4w_classifier' in models:
            prob = float(models['xgb_4w_classifier'].predict_proba(xi)[0, 1])
            pred['prob_up_4w_xgb'] = round(prob, 4)
            prob_up_sources.append(prob)
        if 'lgbm_4w_classifier' in models:
            prob = float(models['lgbm_4w_classifier'].predict_proba(xi)[0, 1])
            pred['prob_up_4w_lgbm'] = round(prob, 4)
            prob_up_sources.append(prob)

        if prob_up_sources:
            pred['prob_up_4w'] = round(float(np.mean(prob_up_sources)), 4)
        elif 'logreg_baseline' in models:
            model = models['logreg_baseline']
            xi_scaled = model._scaler.transform(xi)
            prob = float(model.predict_proba(xi_scaled)[0, 1])
            pred['prob_up_4w'] = round(prob, 4)

        # 4w alpha classifier (outperform SPY)
        if 'xgb_4w_alpha_classifier' in models:
            model = models['xgb_4w_alpha_classifier']
            prob = float(model.predict_proba(xi)[0, 1])
            pred['prob_alpha_4w'] = round(prob, 4)

        # Confidence: average of all 4w classifier probabilities (distance from 0.5)
        probs = [pred.get('prob_up_4w', 0.5), pred.get('prob_alpha_4w', 0.5)]
        confidence = np.mean([abs(p - 0.5) * 2 for p in probs])
        pred['confidence'] = round(float(confidence), 4)

        # Top contributing features from alpha model (primary)
        feat_model = models.get('xgb_4w_alpha_classifier') or models.get('xgb_4w_classifier')
        if feat_model is not None and hasattr(feat_model, 'feature_importances_'):
            importances = feat_model.feature_importances_
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
