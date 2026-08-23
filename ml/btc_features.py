"""
BTC Feature Extraction.

Loads btc_daily_features from DB and exports to parquet for training.
Each row = one calendar day with ~40 features.

Output: ml/data/btc_features.parquet

Usage: python btc_features.py [--force]
"""

import sys
import json
import numpy as np
import pandas as pd
from pathlib import Path

import db

DATA_DIR = Path(__file__).parent / 'data'
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_PATH = DATA_DIR / 'btc_features.parquet'
MODELS_DIR = Path(__file__).parent / 'models'
MODELS_DIR.mkdir(exist_ok=True)


def load_daily_features() -> pd.DataFrame:
    """Load btc_daily_features and expand JSONB features column."""
    df = db.query("""
        SELECT
            id, feature_date, features,
            target_7d_change, target_14d_change,
            target_7d_up, target_14d_up
        FROM btc_daily_features
        ORDER BY feature_date ASC
    """)

    if df.empty:
        return df

    # Expand JSONB features column into individual columns
    features_expanded = pd.json_normalize(df['features'].apply(
        lambda x: x if isinstance(x, dict) else json.loads(x) if isinstance(x, str) else {}
    ))

    df = pd.concat([df.drop(columns=['features']), features_expanded], axis=1)
    return df


def build_feature_matrix():
    """Build feature matrix from btc_daily_features."""
    print('[btc_features] Loading daily features...')
    df = load_daily_features()

    if df.empty:
        print('[btc_features] No daily features found. Run btc:features first.')
        sys.exit(1)

    print(f'  → {len(df)} daily feature rows loaded')

    # Identify feature columns (everything except id, dates, and targets)
    exclude_cols = {'id', 'feature_date', 'target_7d_change', 'target_14d_change',
                    'target_7d_up', 'target_14d_up', 'created_at'}
    feature_cols = [c for c in df.columns if c not in exclude_cols]

    # Target: will BTC go up >2% in 14 days
    target_cols = ['target_7d_up', 'target_14d_up', 'target_7d_change', 'target_14d_change']

    id_cols = ['feature_date']

    # Fill NaN for numeric features
    for col in feature_cols:
        if df[col].dtype in [np.float64, np.float32, float, 'float64', 'float32']:
            df[col] = df[col].fillna(df[col].median() if df[col].notna().any() else 0)
        elif df[col].dtype in [np.int64, np.int32, int, 'int64', 'int32']:
            df[col] = df[col].fillna(0)

    # Drop rows where all targets are NaN
    df = df.dropna(subset=['target_14d_change', 'target_14d_up'], how='all')

    # Save feature column names
    feature_meta = {
        'feature_columns': feature_cols,
        'target_columns': target_cols,
        'id_columns': id_cols,
        'total_features': len(feature_cols),
    }

    meta_path = MODELS_DIR / 'btc_feature_columns.json'
    with open(meta_path, 'w') as f:
        json.dump(feature_meta, f, indent=2)

    return df, feature_cols, target_cols


def main():
    force = '--force' in sys.argv

    if OUTPUT_PATH.exists() and not force:
        print(f'[btc_features] Cached features at {OUTPUT_PATH}')
        print('  Use --force to re-extract.')
        existing = pd.read_parquet(OUTPUT_PATH)
        print(f'  → Shape: {existing.shape}')
        return

    result, feature_cols, target_cols = build_feature_matrix()

    result.to_parquet(OUTPUT_PATH, index=False)
    print(f'\n[btc_features] Feature matrix saved to {OUTPUT_PATH}')
    print(f'  → Shape: {result.shape}')
    print(f'  → Features: {len(feature_cols)}')
    print(f'  → Samples with 14d target: {result["target_14d_up"].notna().sum()}')
    print(f'  → Date range: {result["feature_date"].min()} to {result["feature_date"].max()}')


if __name__ == '__main__':
    main()
