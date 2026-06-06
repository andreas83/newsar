"""
Model Training Pipeline with Walk-Forward Validation.

Models trained:
  1. Logistic Regression — baseline
  2. XGBoost Classifier — primary (binary: will price go up?)
  3. XGBoost Regressor — secondary (magnitude: how much will it change?)

Walk-forward validation:
  - Chronological split (no random — prevents lookahead bias)
  - Expanding training window
  - 30-day rolling test blocks
  - Minimum 5 folds

Output:
  ml/models/xgb_5d_classifier.joblib
  ml/models/xgb_5d_regressor.joblib
  ml/models/xgb_4w_classifier.joblib
  ml/models/logreg_baseline.joblib
  ml/models/model_metadata.json

Usage: python train.py
"""

import json
import sys
import warnings
from datetime import timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, f1_score, log_loss,
                             precision_score, recall_score, roc_auc_score,
                             mean_squared_error)
from sklearn.model_selection import RandomizedSearchCV
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier, XGBRegressor

warnings.filterwarnings('ignore', category=UserWarning)

DATA_DIR = Path(__file__).parent / 'data'
MODELS_DIR = Path(__file__).parent / 'models'
MODELS_DIR.mkdir(exist_ok=True)

MIN_TRAIN_SAMPLES = 30
MIN_FOLDS = 3
FOLD_DAYS = 14
RANDOM_SEARCH_ITER = 30
INNER_CV = 3


def load_features() -> tuple[pd.DataFrame, list[str], list[str]]:
    """Load feature matrix and column definitions."""
    feature_path = DATA_DIR / 'features.parquet'
    if not feature_path.exists():
        print('[train] Feature matrix not found. Run `ml:features` first.')
        sys.exit(1)

    df = pd.read_parquet(feature_path)

    meta_path = MODELS_DIR / 'feature_columns.json'
    with open(meta_path) as f:
        meta = json.load(f)

    feature_cols = [c for c in meta['feature_columns'] if c in df.columns]
    target_cols = meta['target_columns']

    return df, feature_cols, target_cols


def generate_walk_forward_splits(df: pd.DataFrame) -> list[tuple[pd.Index, pd.Index]]:
    """Generate chronological walk-forward train/test splits."""
    df = df.copy()
    df['event_dt'] = pd.to_datetime(df['event_date'])
    dates = df['event_dt'].sort_values()

    min_date = dates.min()
    max_date = dates.max()

    # Need at least MIN_TRAIN_SAMPLES before first test fold
    splits = []
    fold_start = min_date + timedelta(days=max(45, FOLD_DAYS * 2))

    while fold_start + timedelta(days=FOLD_DAYS) <= max_date:
        fold_end = fold_start + timedelta(days=FOLD_DAYS)

        train_mask = df['event_dt'] < fold_start
        test_mask = (df['event_dt'] >= fold_start) & (df['event_dt'] < fold_end)

        train_idx = df[train_mask].index
        test_idx = df[test_mask].index

        if len(train_idx) >= MIN_TRAIN_SAMPLES and len(test_idx) >= 3:
            splits.append((train_idx, test_idx))

        fold_start = fold_end

    return splits


def get_xgb_param_space():
    """Parameter space for XGBoost hyperparameter search."""
    return {
        'max_depth': [3, 4, 5, 6, 7, 8],
        'learning_rate': [0.01, 0.02, 0.05, 0.1, 0.15],
        'n_estimators': [50, 100, 150, 200, 300],
        'min_child_weight': [1, 3, 5, 7],
        'subsample': [0.6, 0.7, 0.8, 0.9, 1.0],
        'colsample_bytree': [0.5, 0.6, 0.7, 0.8, 0.9],
        'reg_alpha': [0, 0.01, 0.1, 0.5, 1.0],
        'reg_lambda': [0.5, 1.0, 2.0, 5.0],
    }


def train_model(model_name: str, X_train: np.ndarray, y_train: np.ndarray,
                model_type: str = 'classifier') -> object:
    """Train a model with optional hyperparameter search."""

    if model_name == 'logreg':
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X_train)
        model = LogisticRegression(max_iter=1000, random_state=42, C=1.0)
        model.fit(X_scaled, y_train)
        model._scaler = scaler
        return model

    if 'xgb' in model_name:
        if model_type == 'classifier':
            base = XGBClassifier(
                eval_metric='logloss',
                random_state=42,
                use_label_encoder=False,
                verbosity=0,
            )
            scoring = 'neg_log_loss'
        else:
            base = XGBRegressor(
                eval_metric='rmse',
                random_state=42,
                verbosity=0,
            )
            scoring = 'neg_root_mean_squared_error'

        param_space = get_xgb_param_space()

        n_samples = len(X_train)
        n_iter = min(RANDOM_SEARCH_ITER, max(5, n_samples // 10))
        cv = min(INNER_CV, max(2, n_samples // 15))

        search = RandomizedSearchCV(
            base,
            param_space,
            n_iter=n_iter,
            cv=cv,
            scoring=scoring,
            random_state=42,
            n_jobs=-1,
            verbose=0,
        )
        search.fit(X_train, y_train)
        return search.best_estimator_

    raise ValueError(f'Unknown model: {model_name}')


def evaluate_fold(model, X_test: np.ndarray, y_test: np.ndarray,
                  model_type: str = 'classifier') -> dict:
    """Evaluate a model on a test fold."""
    metrics = {}

    if model_type == 'classifier':
        # Handle logistic regression with scaler
        X_eval = X_test
        if hasattr(model, '_scaler'):
            X_eval = model._scaler.transform(X_test)

        y_pred = model.predict(X_eval)
        y_prob = model.predict_proba(X_eval)[:, 1] if hasattr(model, 'predict_proba') else y_pred.astype(float)

        metrics['accuracy'] = float(accuracy_score(y_test, y_pred))
        metrics['precision'] = float(precision_score(y_test, y_pred, zero_division=0))
        metrics['recall'] = float(recall_score(y_test, y_pred, zero_division=0))
        metrics['f1'] = float(f1_score(y_test, y_pred, zero_division=0))

        try:
            metrics['roc_auc'] = float(roc_auc_score(y_test, y_prob))
        except ValueError:
            metrics['roc_auc'] = 0.5  # Only one class in test set

        try:
            metrics['log_loss'] = float(log_loss(y_test, y_prob))
        except ValueError:
            metrics['log_loss'] = None

    else:  # regressor
        X_eval = X_test
        y_pred = model.predict(X_eval)
        metrics['rmse'] = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        metrics['mae'] = float(np.mean(np.abs(y_test - y_pred)))
        # Directional accuracy
        metrics['direction_accuracy'] = float(np.mean(
            (y_pred > 0) == (y_test > 0)
        ))

    return metrics


def train_all():
    """Full training pipeline."""
    df, feature_cols, target_cols = load_features()
    print(f'[train] Loaded {len(df)} samples with {len(feature_cols)} features')

    splits = generate_walk_forward_splits(df)
    print(f'[train] Generated {len(splits)} walk-forward folds')

    if len(splits) < MIN_FOLDS:
        print(f'[train] WARNING: Only {len(splits)} folds (minimum {MIN_FOLDS}).')
        if len(splits) == 0:
            print('[train] Not enough data for walk-forward validation. Need more anomaly events.')
            sys.exit(1)

    all_metadata = {
        'training_date': pd.Timestamp.now().isoformat(),
        'total_samples': len(df),
        'total_features': len(feature_cols),
        'feature_columns': feature_cols,
        'n_folds': len(splits),
        'models': {},
    }

    # --- Train 5d classifier (XGBoost) ---
    print('\n=== Training XGBoost 5d Classifier ===')
    target_col = 'target_5d_up'
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)
    print(f'  Samples with {target_col}: {len(df_valid)}')
    print(f'  Class distribution: {df_valid[target_col].value_counts().to_dict()}')

    fold_metrics_5d = []
    best_model_5d = None

    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue

        X_train = df_valid.loc[train_idx, feature_cols].values.astype(np.float32)
        y_train = df_valid.loc[train_idx, target_col].values.astype(int)
        X_test = df_valid.loc[test_idx, feature_cols].values.astype(np.float32)
        y_test = df_valid.loc[test_idx, target_col].values.astype(int)

        # Replace remaining NaN with 0
        X_train = np.nan_to_num(X_train, 0)
        X_test = np.nan_to_num(X_test, 0)

        model = train_model('xgb_5d', X_train, y_train, 'classifier')
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_5d.append(metrics)

        print(f'  Fold {i}: AUC={metrics["roc_auc"]:.3f}, Acc={metrics["accuracy"]:.3f}, '
              f'F1={metrics["f1"]:.3f} (train={len(train_idx)}, test={len(test_idx)})')

        best_model_5d = model  # Keep last fold's model (trained on most data)

    if best_model_5d is not None:
        # Retrain on all valid data for final model
        X_all = df_valid[feature_cols].values.astype(np.float32)
        y_all = df_valid[target_col].values.astype(int)
        X_all = np.nan_to_num(X_all, 0)

        final_model_5d = train_model('xgb_5d_final', X_all, y_all, 'classifier')
        joblib.dump(final_model_5d, MODELS_DIR / 'xgb_5d_classifier.joblib')

        # Feature importance
        importance_5d = dict(zip(feature_cols,
                                 final_model_5d.feature_importances_.tolist()))

        avg_metrics_5d = {k: float(np.mean([m[k] for m in fold_metrics_5d if m.get(k) is not None]))
                          for k in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']}

        all_metadata['models']['xgb_5d_classifier'] = {
            'fold_metrics': fold_metrics_5d,
            'avg_metrics': avg_metrics_5d,
            'feature_importance': importance_5d,
            'best_params': final_model_5d.get_params() if hasattr(final_model_5d, 'get_params') else {},
        }
        print(f'  → Average AUC: {avg_metrics_5d["roc_auc"]:.3f}, F1: {avg_metrics_5d["f1"]:.3f}')
    else:
        print('  → Skipped: insufficient data')

    # --- Train 5d regressor (XGBoost) ---
    print('\n=== Training XGBoost 5d Regressor ===')
    target_col = 'target_5d_change'
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)
    print(f'  Samples with {target_col}: {len(df_valid)}')

    fold_metrics_5d_reg = []
    best_model_5d_reg = None

    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue

        X_train = df_valid.loc[train_idx, feature_cols].values.astype(np.float32)
        y_train = df_valid.loc[train_idx, target_col].values.astype(np.float32)
        X_test = df_valid.loc[test_idx, feature_cols].values.astype(np.float32)
        y_test = df_valid.loc[test_idx, target_col].values.astype(np.float32)

        X_train = np.nan_to_num(X_train, 0)
        X_test = np.nan_to_num(X_test, 0)

        model = train_model('xgb_5d_reg', X_train, y_train, 'regressor')
        metrics = evaluate_fold(model, X_test, y_test, 'regressor')
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_5d_reg.append(metrics)

        print(f'  Fold {i}: RMSE={metrics["rmse"]:.3f}, DirAcc={metrics["direction_accuracy"]:.3f}')

        best_model_5d_reg = model

    if best_model_5d_reg is not None:
        X_all = df_valid[feature_cols].values.astype(np.float32)
        y_all = df_valid[target_col].values.astype(np.float32)
        X_all = np.nan_to_num(X_all, 0)

        final_model_5d_reg = train_model('xgb_5d_reg_final', X_all, y_all, 'regressor')
        joblib.dump(final_model_5d_reg, MODELS_DIR / 'xgb_5d_regressor.joblib')

        avg_metrics_5d_reg = {k: float(np.mean([m[k] for m in fold_metrics_5d_reg if m.get(k) is not None]))
                              for k in ['rmse', 'mae', 'direction_accuracy']}

        all_metadata['models']['xgb_5d_regressor'] = {
            'fold_metrics': fold_metrics_5d_reg,
            'avg_metrics': avg_metrics_5d_reg,
        }
        print(f'  → Average RMSE: {avg_metrics_5d_reg["rmse"]:.3f}, DirAcc: {avg_metrics_5d_reg["direction_accuracy"]:.3f}')

    # --- Train 4w classifier (XGBoost) ---
    print('\n=== Training XGBoost 4w Classifier ===')
    target_col = 'target_4w_up'
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)
    print(f'  Samples with {target_col}: {len(df_valid)}')

    fold_metrics_4w = []
    best_model_4w = None

    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue

        X_train = df_valid.loc[train_idx, feature_cols].values.astype(np.float32)
        y_train = df_valid.loc[train_idx, target_col].values.astype(int)
        X_test = df_valid.loc[test_idx, feature_cols].values.astype(np.float32)
        y_test = df_valid.loc[test_idx, target_col].values.astype(int)

        X_train = np.nan_to_num(X_train, 0)
        X_test = np.nan_to_num(X_test, 0)

        model = train_model('xgb_4w', X_train, y_train, 'classifier')
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_4w.append(metrics)

        print(f'  Fold {i}: AUC={metrics["roc_auc"]:.3f}, Acc={metrics["accuracy"]:.3f}')

        best_model_4w = model

    if best_model_4w is not None:
        X_all = df_valid[feature_cols].values.astype(np.float32)
        y_all = df_valid[target_col].values.astype(int)
        X_all = np.nan_to_num(X_all, 0)

        final_model_4w = train_model('xgb_4w_final', X_all, y_all, 'classifier')
        joblib.dump(final_model_4w, MODELS_DIR / 'xgb_4w_classifier.joblib')

        importance_4w = dict(zip(feature_cols,
                                 final_model_4w.feature_importances_.tolist()))

        avg_metrics_4w = {k: float(np.mean([m[k] for m in fold_metrics_4w if m.get(k) is not None]))
                          for k in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']}

        all_metadata['models']['xgb_4w_classifier'] = {
            'fold_metrics': fold_metrics_4w,
            'avg_metrics': avg_metrics_4w,
            'feature_importance': importance_4w,
        }
        print(f'  → Average AUC: {avg_metrics_4w["roc_auc"]:.3f}')

    # --- Train Logistic Regression baseline ---
    print('\n=== Training Logistic Regression Baseline ===')
    target_col = 'target_5d_up'
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)

    fold_metrics_lr = []
    for i, (train_idx, test_idx) in enumerate(splits):
        train_idx = train_idx[train_idx.isin(df_valid.index)]
        test_idx = test_idx[test_idx.isin(df_valid.index)]
        if len(train_idx) < MIN_TRAIN_SAMPLES or len(test_idx) < 3:
            continue

        X_train = df_valid.loc[train_idx, feature_cols].values.astype(np.float32)
        y_train = df_valid.loc[train_idx, target_col].values.astype(int)
        X_test = df_valid.loc[test_idx, feature_cols].values.astype(np.float32)
        y_test = df_valid.loc[test_idx, target_col].values.astype(int)

        X_train = np.nan_to_num(X_train, 0)
        X_test = np.nan_to_num(X_test, 0)

        model = train_model('logreg', X_train, y_train, 'classifier')
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        fold_metrics_lr.append(metrics)

        print(f'  Fold {i}: AUC={metrics["roc_auc"]:.3f}, Acc={metrics["accuracy"]:.3f}')

    # Train final logreg on all data
    X_all = df_valid[feature_cols].values.astype(np.float32)
    y_all = df_valid[target_col].values.astype(int)
    X_all = np.nan_to_num(X_all, 0)

    final_lr = train_model('logreg', X_all, y_all, 'classifier')
    joblib.dump(final_lr, MODELS_DIR / 'logreg_baseline.joblib')

    if fold_metrics_lr:
        avg_metrics_lr = {k: float(np.mean([m[k] for m in fold_metrics_lr if m.get(k) is not None]))
                          for k in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']}
        all_metadata['models']['logreg_baseline'] = {
            'fold_metrics': fold_metrics_lr,
            'avg_metrics': avg_metrics_lr,
        }
        print(f'  → Average AUC: {avg_metrics_lr["roc_auc"]:.3f}')

    # --- Save metadata ---
    # Clean up non-serializable params
    for model_name, model_info in all_metadata['models'].items():
        if 'best_params' in model_info:
            cleaned = {}
            for k, v in model_info['best_params'].items():
                try:
                    json.dumps(v)
                    cleaned[k] = v
                except (TypeError, ValueError):
                    cleaned[k] = str(v)
            model_info['best_params'] = cleaned

    # Sanitize NaN/Inf for JSON compatibility
    def sanitize(obj):
        if isinstance(obj, float):
            if np.isnan(obj) or np.isinf(obj):
                return None
            return obj
        if isinstance(obj, (np.floating, np.integer)):
            v = float(obj)
            if np.isnan(v) or np.isinf(v):
                return None
            return v
        if isinstance(obj, dict):
            return {k: sanitize(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [sanitize(v) for v in obj]
        return obj

    all_metadata = sanitize(all_metadata)

    meta_path = MODELS_DIR / 'model_metadata.json'
    with open(meta_path, 'w') as f:
        json.dump(all_metadata, f, indent=2, default=str)

    print(f'\n[train] All models saved to {MODELS_DIR}')
    print(f'[train] Metadata saved to {meta_path}')


if __name__ == '__main__':
    train_all()
