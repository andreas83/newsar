"""
BTC ML Prediction Script.

Scores recent daily features through trained 2-week models.
Outputs JSON predictions to stdout.

Usage: python btc_predict.py [--since 7]
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
    models = {}
    for name in ['btc_xgb_2w_classifier', 'btc_lgbm_2w_classifier', 'btc_logreg_baseline']:
        path = MODELS_DIR / f'{name}.joblib'
        if path.exists():
            models[name] = joblib.load(path)

    meta_path = MODELS_DIR / 'btc_feature_columns.json'
    if not meta_path.exists():
        print('ERROR: btc_feature_columns.json not found.', file=sys.stderr)
        sys.exit(1)

    with open(meta_path) as f:
        meta = json.load(f)
    return models, meta['feature_columns']


def get_recent_features(days_back: int) -> pd.DataFrame:
    df = db.query(f"""
        SELECT id, feature_date, features
        FROM btc_daily_features
        WHERE feature_date >= NOW() - INTERVAL '{int(days_back)} days'
        ORDER BY feature_date DESC
    """)
    if df.empty:
        return df

    # Expand JSONB
    import json as json_mod
    features_expanded = pd.json_normalize(df['features'].apply(
        lambda x: x if isinstance(x, dict) else json_mod.loads(x) if isinstance(x, str) else {}
    ))
    df = pd.concat([df.drop(columns=['features']), features_expanded], axis=1)
    return df


def predict(days_back: int = 7):
    models, feature_cols = load_models()
    if not models:
        print('ERROR: No trained BTC models.', file=sys.stderr)
        sys.exit(1)

    df = get_recent_features(days_back)
    if df.empty:
        print(json.dumps([]))
        return

    print(f'Scoring {len(df)} daily features from last {days_back} days...', file=sys.stderr)

    # Ensure all feature cols exist
    for col in feature_cols:
        if col not in df.columns:
            df[col] = 0

    X = np.nan_to_num(df[feature_cols].values.astype(np.float32), 0)

    predictions = []
    for i, row in df.iterrows():
        pred = {
            'prediction_date': str(row['feature_date']),
        }

        xi = X[i:i+1] if isinstance(i, int) else X[list(df.index).index(i):list(df.index).index(i)+1]

        # Ensemble: average XGBoost + LightGBM probabilities
        prob_sources = []
        if 'btc_xgb_2w_classifier' in models:
            prob = float(models['btc_xgb_2w_classifier'].predict_proba(xi)[0, 1])
            pred['prob_up_2w_xgb'] = round(prob, 4)
            prob_sources.append(prob)
        if 'btc_lgbm_2w_classifier' in models:
            prob = float(models['btc_lgbm_2w_classifier'].predict_proba(xi)[0, 1])
            pred['prob_up_2w_lgbm'] = round(prob, 4)
            prob_sources.append(prob)

        if prob_sources:
            prob_up = float(np.mean(prob_sources))
        elif 'btc_logreg_baseline' in models:
            m = models['btc_logreg_baseline']
            xi_s = m._scaler.transform(xi)
            prob_up = float(m.predict_proba(xi_s)[0, 1])
        else:
            prob_up = 0.5

        pred['prob_up_2w'] = round(prob_up, 4)
        pred['model_source'] = 'ensemble'

        # Direction
        if prob_up > 0.6:
            pred['direction'] = 'bullish'
        elif prob_up < 0.4:
            pred['direction'] = 'bearish'
        else:
            pred['direction'] = 'neutral'

        pred['confidence'] = round(abs(prob_up - 0.5) * 2, 4)

        # Top features
        feat_model = models.get('btc_xgb_2w_classifier') or models.get('btc_lgbm_2w_classifier')
        if feat_model is not None and hasattr(feat_model, 'feature_importances_'):
            importances = feat_model.feature_importances_
            xi_vals = xi[0]
            contributions = importances * np.abs(xi_vals)
            top_idx = np.argsort(contributions)[::-1][:5]
            pred['top_features'] = [
                {'feature': feature_cols[j], 'importance': round(float(importances[j]), 4),
                 'value': round(float(xi_vals[j]), 4)}
                for j in top_idx
            ]

        predictions.append(pred)

    print(json.dumps(predictions, indent=2, default=str))


if __name__ == '__main__':
    days = 7
    for i, arg in enumerate(sys.argv):
        if arg == '--since' and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])
    predict(days)
