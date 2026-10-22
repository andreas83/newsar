"""
BTC Model Training with Walk-Forward Validation.

Models:
  1. XGBoost 2w Classifier — will BTC go up >2% in 14 days?
  2. LightGBM 2w Classifier — ensemble partner
  3. Logistic Regression — baseline

Walk-forward: 14-day folds, expanding window, MIN_TRAIN_SAMPLES = 60.

Output:
  ml/models/btc_xgb_2w_classifier.joblib
  ml/models/btc_lgbm_2w_classifier.joblib
  ml/models/btc_logreg_baseline.joblib
  ml/models/btc_model_metadata.json
  ml/models/btc_training_history.json

Usage: python btc_train.py
"""

import json
import os
import sys
import warnings

# Single-threaded BLAS/OpenMP: parallelism comes from RandomizedSearchCV's
# process pool only. Nested (processes x OMP threads) oversubscribes the box.
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')

from datetime import timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, f1_score, log_loss,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import RandomizedSearchCV
from sklearn.preprocessing import StandardScaler
from lightgbm import LGBMClassifier
from xgboost import XGBClassifier

warnings.filterwarnings('ignore', category=UserWarning)

DATA_DIR = Path(__file__).parent / 'data'
MODELS_DIR = Path(__file__).parent / 'models'
MODELS_DIR.mkdir(exist_ok=True)

MIN_TRAIN_SAMPLES = 60
MIN_FOLDS = 3
FOLD_DAYS = 14
RANDOM_SEARCH_ITER = 10
# Worker processes for the hyperparameter search. Keep well under nproc so
# concurrent training runs (stocks + btc) do not fight for the same cores.
SEARCH_N_JOBS = int(os.environ.get('ML_SEARCH_JOBS', '2'))
INNER_CV = 2


def load_features():
    feature_path = DATA_DIR / 'btc_features.parquet'
    if not feature_path.exists():
        print('[btc_train] Feature matrix not found. Run ml:btc-features first.')
        sys.exit(1)

    df = pd.read_parquet(feature_path)
    meta_path = MODELS_DIR / 'btc_feature_columns.json'
    with open(meta_path) as f:
        meta = json.load(f)

    feature_cols = [c for c in meta['feature_columns'] if c in df.columns]
    target_cols = meta['target_columns']
    return df, feature_cols, target_cols


def generate_walk_forward_splits(df):
    df = df.copy()
    df['feature_dt'] = pd.to_datetime(df['feature_date'])
    dates = df['feature_dt'].sort_values()
    min_date = dates.min()
    max_date = dates.max()

    splits = []
    fold_start = min_date + timedelta(days=max(60, FOLD_DAYS * 3))

    while fold_start + timedelta(days=FOLD_DAYS) <= max_date:
        fold_end = fold_start + timedelta(days=FOLD_DAYS)
        train_mask = df['feature_dt'] < fold_start
        test_mask = (df['feature_dt'] >= fold_start) & (df['feature_dt'] < fold_end)
        train_idx = df[train_mask].index
        test_idx = df[test_mask].index
        if len(train_idx) >= MIN_TRAIN_SAMPLES and len(test_idx) >= 3:
            splits.append((train_idx, test_idx))
        fold_start = fold_end

    return splits


def train_model(model_name, X_train, y_train):
    if model_name == 'logreg':
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X_train)
        model = LogisticRegression(max_iter=1000, random_state=42, C=1.0)
        model.fit(X_scaled, y_train)
        model._scaler = scaler
        return model

    if 'xgb' in model_name:
        base = XGBClassifier(eval_metric='logloss', random_state=42, use_label_encoder=False,
                              verbosity=0, n_jobs=1)
        param_space = {
            'max_depth': [3, 4, 5],
            'learning_rate': [0.01, 0.02, 0.05, 0.1],
            'n_estimators': [50, 100, 150, 200],
            'min_child_weight': [3, 5, 7, 10],
            'subsample': [0.7, 0.8, 0.9],
            'colsample_bytree': [0.5, 0.6, 0.7, 0.8],
            'reg_alpha': [0.1, 0.5, 1.0, 2.0],
            'reg_lambda': [1.0, 2.0, 5.0],
        }
        n_samples = len(X_train)
        n_iter = min(RANDOM_SEARCH_ITER, max(5, n_samples // 10))
        cv = min(INNER_CV, max(2, n_samples // 15))
        search = RandomizedSearchCV(base, param_space, n_iter=n_iter, cv=cv,
                                    scoring='neg_log_loss', random_state=42, n_jobs=SEARCH_N_JOBS, verbose=0)
        search.fit(X_train, y_train)
        return search.best_estimator_

    if 'lgbm' in model_name:
        base = LGBMClassifier(objective='binary', random_state=42, verbosity=-1, n_jobs=1)
        param_space = {
            'max_depth': [3, 4, 5],
            'learning_rate': [0.01, 0.02, 0.05, 0.1],
            'n_estimators': [50, 100, 150, 200],
            'min_child_samples': [5, 10, 15, 20],
            'subsample': [0.7, 0.8, 0.9],
            'colsample_bytree': [0.5, 0.6, 0.7, 0.8],
            'reg_alpha': [0.1, 0.5, 1.0, 2.0],
            'reg_lambda': [1.0, 2.0, 5.0],
        }
        n_samples = len(X_train)
        n_iter = min(RANDOM_SEARCH_ITER, max(5, n_samples // 10))
        cv = min(INNER_CV, max(2, n_samples // 15))
        search = RandomizedSearchCV(base, param_space, n_iter=n_iter, cv=cv,
                                    scoring='neg_log_loss', random_state=42, n_jobs=SEARCH_N_JOBS, verbose=0)
        search.fit(X_train, y_train)
        return search.best_estimator_

    raise ValueError(f'Unknown model: {model_name}')


def evaluate_fold(model, X_test, y_test):
    X_eval = model._scaler.transform(X_test) if hasattr(model, '_scaler') else X_test
    y_pred = model.predict(X_eval)
    y_prob = model.predict_proba(X_eval)[:, 1] if hasattr(model, 'predict_proba') else y_pred.astype(float)

    metrics = {
        'accuracy': float(accuracy_score(y_test, y_pred)),
        'precision': float(precision_score(y_test, y_pred, zero_division=0)),
        'recall': float(recall_score(y_test, y_pred, zero_division=0)),
        'f1': float(f1_score(y_test, y_pred, zero_division=0)),
    }
    try:
        metrics['roc_auc'] = float(roc_auc_score(y_test, y_prob))
    except ValueError:
        metrics['roc_auc'] = 0.5
    try:
        metrics['log_loss'] = float(log_loss(y_test, y_prob))
    except ValueError:
        metrics['log_loss'] = None
    return metrics


def sanitize(obj):
    if isinstance(obj, float):
        return None if (np.isnan(obj) or np.isinf(obj)) else obj
    if isinstance(obj, (np.floating, np.integer)):
        v = float(obj)
        return None if (np.isnan(v) or np.isinf(v)) else v
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj


def train_all():
    df, feature_cols, target_cols = load_features()
    print(f'[btc_train] Loaded {len(df)} samples with {len(feature_cols)} features')

    splits = generate_walk_forward_splits(df)
    print(f'[btc_train] Generated {len(splits)} walk-forward folds')

    if len(splits) < MIN_FOLDS:
        print(f'[btc_train] WARNING: Only {len(splits)} folds (min {MIN_FOLDS}).')
        if len(splits) == 0:
            print('[btc_train] Not enough data. Need more daily features.')
            sys.exit(1)

    all_metadata = {
        'training_date': pd.Timestamp.now().isoformat(),
        'total_samples': len(df),
        'total_features': len(feature_cols),
        'feature_columns': feature_cols,
        'n_folds': len(splits),
        'models': {},
    }

    target_col = 'target_14d_up'

    # --- XGBoost 2w Classifier ---
    print('\n=== Training XGBoost 2w Classifier ===')
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)
    print(f'  Samples with {target_col}: {len(df_valid)}')

    fold_metrics_xgb = []
    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue
        X_train = np.nan_to_num(df_valid.loc[train_idx, feature_cols].values.astype(np.float32), 0)
        y_train = df_valid.loc[train_idx, target_col].values.astype(int)
        X_test = np.nan_to_num(df_valid.loc[test_idx, feature_cols].values.astype(np.float32), 0)
        y_test = df_valid.loc[test_idx, target_col].values.astype(int)
        model = train_model('xgb_2w', X_train, y_train)
        metrics = evaluate_fold(model, X_test, y_test)
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_xgb.append(metrics)
        print(f'  Fold {i}: AUC={metrics["roc_auc"]:.3f}, Acc={metrics["accuracy"]:.3f}')

    # Train final on all data
    X_all = np.nan_to_num(df_valid[feature_cols].values.astype(np.float32), 0)
    y_all = df_valid[target_col].values.astype(int)
    final_xgb = train_model('xgb_2w_final', X_all, y_all)
    joblib.dump(final_xgb, MODELS_DIR / 'btc_xgb_2w_classifier.joblib')

    if fold_metrics_xgb:
        avg = {k: float(np.nanmean([m[k] for m in fold_metrics_xgb if m.get(k) is not None]))
               for k in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']}
        all_metadata['models']['btc_xgb_2w_classifier'] = {
            'fold_metrics': fold_metrics_xgb, 'avg_metrics': avg,
            'feature_importance': dict(zip(feature_cols, final_xgb.feature_importances_.tolist())),
        }
        print(f'  → Average AUC: {avg["roc_auc"]:.3f}')

    # --- LightGBM 2w Classifier ---
    print('\n=== Training LightGBM 2w Classifier ===')
    fold_metrics_lgbm = []
    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue
        X_train = np.nan_to_num(df_valid.loc[train_idx, feature_cols].values.astype(np.float32), 0)
        y_train = df_valid.loc[train_idx, target_col].values.astype(int)
        X_test = np.nan_to_num(df_valid.loc[test_idx, feature_cols].values.astype(np.float32), 0)
        y_test = df_valid.loc[test_idx, target_col].values.astype(int)
        model = train_model('lgbm_2w', X_train, y_train)
        metrics = evaluate_fold(model, X_test, y_test)
        metrics['fold'] = i
        fold_metrics_lgbm.append(metrics)
        print(f'  Fold {i}: AUC={metrics["roc_auc"]:.3f}, Acc={metrics["accuracy"]:.3f}')

    final_lgbm = train_model('lgbm_2w_final', X_all, y_all)
    joblib.dump(final_lgbm, MODELS_DIR / 'btc_lgbm_2w_classifier.joblib')

    if fold_metrics_lgbm:
        avg = {k: float(np.nanmean([m[k] for m in fold_metrics_lgbm if m.get(k) is not None]))
               for k in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']}
        all_metadata['models']['btc_lgbm_2w_classifier'] = {
            'fold_metrics': fold_metrics_lgbm, 'avg_metrics': avg,
            'feature_importance': dict(zip(feature_cols, final_lgbm.feature_importances_.tolist())),
        }
        print(f'  → Average AUC: {avg["roc_auc"]:.3f}')

    # --- Logistic Regression Baseline ---
    print('\n=== Training Logistic Regression Baseline ===')
    fold_metrics_lr = []
    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue
        X_train = np.nan_to_num(df_valid.loc[train_idx, feature_cols].values.astype(np.float32), 0)
        y_train = df_valid.loc[train_idx, target_col].values.astype(int)
        X_test = np.nan_to_num(df_valid.loc[test_idx, feature_cols].values.astype(np.float32), 0)
        y_test = df_valid.loc[test_idx, target_col].values.astype(int)
        model = train_model('logreg', X_train, y_train)
        metrics = evaluate_fold(model, X_test, y_test)
        metrics['fold'] = i
        fold_metrics_lr.append(metrics)
        print(f'  Fold {i}: AUC={metrics["roc_auc"]:.3f}')

    final_lr = train_model('logreg', X_all, y_all)
    joblib.dump(final_lr, MODELS_DIR / 'btc_logreg_baseline.joblib')

    if fold_metrics_lr:
        avg = {k: float(np.nanmean([m[k] for m in fold_metrics_lr if m.get(k) is not None]))
               for k in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']}
        all_metadata['models']['btc_logreg_baseline'] = {
            'fold_metrics': fold_metrics_lr, 'avg_metrics': avg,
        }
        print(f'  → Average AUC: {avg["roc_auc"]:.3f}')

    # Save metadata
    all_metadata = sanitize(all_metadata)
    meta_path = MODELS_DIR / 'btc_model_metadata.json'
    with open(meta_path, 'w') as f:
        json.dump(all_metadata, f, indent=2, default=str)
    print(f'\n[btc_train] All models saved to {MODELS_DIR}')

    # Append to training history
    history_path = MODELS_DIR / 'btc_training_history.json'
    try:
        history = json.load(open(history_path)) if history_path.exists() else []
    except (json.JSONDecodeError, IOError):
        history = []

    entry = {
        'training_date': all_metadata['training_date'],
        'total_samples': all_metadata['total_samples'],
        'total_features': all_metadata['total_features'],
        'n_folds': all_metadata['n_folds'],
        'models': {name: {'roc_auc': info.get('avg_metrics', {}).get('roc_auc'),
                          'accuracy': info.get('avg_metrics', {}).get('accuracy'),
                          'f1': info.get('avg_metrics', {}).get('f1')}
                   for name, info in all_metadata['models'].items()},
    }
    history.append(entry)
    with open(history_path, 'w') as f:
        json.dump(history, f, indent=2, default=str)
    print(f'[btc_train] History appended ({len(history)} entries)')


if __name__ == '__main__':
    train_all()
