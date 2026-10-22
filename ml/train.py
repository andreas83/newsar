"""
Model Training Pipeline with Walk-Forward Validation.

Models trained:
  1. XGBoost 4w Classifier — primary (binary: will price go up >1% in 4 weeks?)
  2. XGBoost 4w Alpha Classifier — primary (binary: will stock beat SPY in 4 weeks?)
  3. LightGBM 4w Classifier — ensemble member (same 4w target)
  4. Logistic Regression — baseline (4w target)

Walk-forward validation:
  - Chronological split (no random — prevents lookahead bias)
  - Expanding training window
  - 30-day rolling test blocks
  - Minimum 5 folds

Output:
  ml/models/xgb_4w_classifier.joblib
  ml/models/xgb_4w_alpha_classifier.joblib
  ml/models/lgbm_4w_classifier.joblib
  ml/models/logreg_baseline.joblib
  ml/models/model_metadata.json
  ml/models/training_history.json (append-only)

Usage: python train.py
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
import cv
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, f1_score, log_loss,
                             precision_score, recall_score, roc_auc_score,
                             mean_squared_error)
from sklearn.model_selection import RandomizedSearchCV
from sklearn.preprocessing import StandardScaler
from lightgbm import LGBMClassifier
from xgboost import XGBClassifier, XGBRegressor

warnings.filterwarnings('ignore', category=UserWarning)

DATA_DIR = Path(__file__).parent / 'data'
MODELS_DIR = Path(__file__).parent / 'models'
MODELS_DIR.mkdir(exist_ok=True)

MIN_TRAIN_SAMPLES = 30
MIN_FOLDS = 3
# One test block spans a full label horizon, so every fold contains at least one
# independent unit rather than half of one.
FOLD_DAYS = 28
# How far the label looks forward, in calendar days (20 trading days ~= 28).
# Training rows whose label window reaches into a test fold are purged.
HORIZON_DAYS = 28
# Slack for the price-availability lag that FOUR_WEEK_SETTLE_DAYS already admits.
EMBARGO_DAYS = 3
RANDOM_SEARCH_ITER = 30
# Worker processes for the hyperparameter search. Keep well under nproc so
# concurrent training runs (stocks + btc) do not fight for the same cores.
SEARCH_N_JOBS = int(os.environ.get('ML_SEARCH_JOBS', '4'))
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
    """Chronological walk-forward splits, purged and embargoed.

    Previously `train_mask = event_dt < fold_start` with no gap, while the label
    looks HORIZON_DAYS forward — so every training row within four weeks of the
    boundary had its outcome realised inside the test fold. Expect fewer folds
    and a lower AUC than the unpurged version; that difference was never a
    result.
    """
    dates = pd.to_datetime(df['event_date'])
    return cv.purged_walk_forward(
        dates,
        fold_days=FOLD_DAYS,
        horizon_days=HORIZON_DAYS,
        embargo_days=EMBARGO_DAYS,
        min_train=MIN_TRAIN_SAMPLES,
        min_test=3,
        index=df.index,
    )


def get_xgb_param_space():
    """Parameter space for XGBoost hyperparameter search.

    Constrained to reduce overfitting with small sample sizes (<1000):
    - max_depth capped at 5 (was 8)
    - Higher min_child_weight floor
    - Stronger regularization (no zero/near-zero alpha/lambda)
    """
    return {
        'max_depth': [3, 4, 5],
        'learning_rate': [0.01, 0.02, 0.05, 0.1],
        'n_estimators': [50, 100, 150, 200],
        'min_child_weight': [3, 5, 7, 10],
        'subsample': [0.7, 0.8, 0.9],
        'colsample_bytree': [0.5, 0.6, 0.7, 0.8],
        'reg_alpha': [0.1, 0.5, 1.0, 2.0],
        'reg_lambda': [1.0, 2.0, 5.0],
    }


def fit_with_params(family: str, params: dict, X: np.ndarray, y: np.ndarray,
                    model_type: str, sample_weight=None) -> object:
    """Fit one model with fixed hyperparameters (no search)."""
    if family.startswith('logreg'):
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        model = LogisticRegression(max_iter=1000, C=params.get('C', 1.0), random_state=42)
        model.fit(X_scaled, y, sample_weight=sample_weight)
        model._scaler = scaler
        return model

    if family.startswith('lgbm'):
        model = LGBMClassifier(objective='binary', random_state=42, verbosity=-1,
                               n_jobs=1, **params)
        model.fit(X, y, sample_weight=sample_weight)
        return model

    if model_type == 'classifier':
        model = XGBClassifier(eval_metric='logloss', random_state=42,
                              use_label_encoder=False, verbosity=0, n_jobs=1, **params)
    else:
        model = XGBRegressor(eval_metric='rmse', random_state=42,
                             verbosity=0, n_jobs=1, **params)
    model.fit(X, y, sample_weight=sample_weight)
    return model


# Hyperparameters are searched ONCE on the earliest history and then frozen.
# Searching per fold tunes each fold on its own training set, which inflates that
# fold's score and makes folds incomparable — and it was ~10x the CPU.
FROZEN_PARAMS: dict[str, dict] = {}

# Per-row weights, set by train_all once the frame is deduped.
SAMPLE_WEIGHTS: np.ndarray = np.array([])


def train_model(model_name: str, X_train: np.ndarray, y_train: np.ndarray,
                model_type: str = 'classifier',
                sample_weight: np.ndarray | None = None,
                search: bool = False) -> object:
    """Train a model, reusing frozen hyperparameters unless `search` is set."""
    family = model_name.replace('_final', '')

    if not search and family in FROZEN_PARAMS:
        return fit_with_params(family, FROZEN_PARAMS[family], X_train, y_train,
                               model_type, sample_weight)

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
                n_jobs=1,
            )
            scoring = 'neg_log_loss'
        else:
            base = XGBRegressor(
                eval_metric='rmse',
                random_state=42,
                verbosity=0,
                n_jobs=1,
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
            n_jobs=SEARCH_N_JOBS,
            verbose=0,
        )
        search.fit(X_train, y_train)
        return search.best_estimator_

    if 'lgbm' in model_name:
        base = LGBMClassifier(
            objective='binary',
            random_state=42,
            verbosity=-1,
            n_jobs=1,
        )
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

        search = RandomizedSearchCV(
            base, param_space, n_iter=n_iter, cv=cv,
            scoring='neg_log_loss', random_state=42, n_jobs=SEARCH_N_JOBS, verbose=0,
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

        # A single-class test fold produces no usable ranking metric. Recording
        # 0.5 (or a zero-division 0.0) averages a failure in as if it were a
        # result: it drags a good model down and lifts a bad one up. Report None
        # and count the fold as degenerate instead.
        degenerate = len(np.unique(y_test)) < 2
        metrics['degenerate'] = bool(degenerate)

        metrics['accuracy'] = float(accuracy_score(y_test, y_pred))
        if degenerate:
            metrics['precision'] = metrics['recall'] = metrics['f1'] = None
            metrics['roc_auc'] = None
        else:
            metrics['precision'] = float(precision_score(y_test, y_pred, zero_division=0))
            metrics['recall'] = float(recall_score(y_test, y_pred, zero_division=0))
            metrics['f1'] = float(f1_score(y_test, y_pred, zero_division=0))
            try:
                metrics['roc_auc'] = float(roc_auc_score(y_test, y_prob))
            except ValueError:
                metrics['roc_auc'] = None
                metrics['degenerate'] = True

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


def search_hyperparameters(df: pd.DataFrame, feature_cols: list[str]) -> dict:
    """Search hyperparameters ONCE, on the earliest 60% of history.

    Searching inside every fold tunes each fold on its own training data, which
    inflates that fold's score and makes folds incomparable. Doing it once on
    early history and freezing the result is both more honest and roughly 10x
    cheaper — which is what pays for the purged folds and the bootstrap.

    The inner CV is the same purged splitter as the outer loop; an int `cv` here
    silently becomes StratifiedKFold(shuffle=False), i.e. future rows tuning the
    model that scores past rows.
    """
    cutoff = max(MIN_TRAIN_SAMPLES * 2, int(len(df) * 0.6))
    hist = df.iloc[:cutoff].reset_index(drop=True)
    print(f'[train] Searching hyperparameters once on the earliest {len(hist)} '
          f'samples ({hist["event_date"].min()} → {hist["event_date"].max()})')

    inner = cv.purged_walk_forward(
        pd.to_datetime(hist['event_date']), fold_days=FOLD_DAYS,
        horizon_days=HORIZON_DAYS, embargo_days=EMBARGO_DAYS,
        min_train=MIN_TRAIN_SAMPLES, min_test=3, index=hist.index)

    if len(inner) < 2:
        print('[train] WARNING: not enough purged history for an inner search; '
              'falling back to library defaults.')
        return {}

    X = np.nan_to_num(hist[feature_cols].values.astype(np.float32), 0)
    found = {}

    for family, target_col in (('xgb_4w', 'target_4w_up'),
                               ('xgb_4w_alpha', 'target_4w_alpha'),
                               ('lgbm_4w', 'target_4w_up')):
        y = hist[target_col].values.astype(int)
        if len(np.unique(y)) < 2:
            continue

        if family.startswith('lgbm'):
            base = LGBMClassifier(objective='binary', random_state=42,
                                  verbosity=-1, n_jobs=1)
            space = {
                'max_depth': [3, 4, 5],
                'learning_rate': [0.01, 0.02, 0.05, 0.1],
                'n_estimators': [50, 100, 150, 200],
                'min_child_samples': [5, 10, 15, 20],
                'subsample': [0.7, 0.8, 0.9],
                'colsample_bytree': [0.5, 0.6, 0.7, 0.8],
                'reg_alpha': [0.1, 0.5, 1.0, 2.0],
                'reg_lambda': [1.0, 2.0, 5.0],
            }
        else:
            base = XGBClassifier(eval_metric='logloss', random_state=42,
                                 use_label_encoder=False, verbosity=0, n_jobs=1)
            space = get_xgb_param_space()

        search = RandomizedSearchCV(
            base, space, n_iter=RANDOM_SEARCH_ITER, cv=inner,
            scoring='neg_log_loss', random_state=42, n_jobs=SEARCH_N_JOBS, verbose=0)
        search.fit(X, y)
        found[family] = {k: v for k, v in search.best_params_.items()}
        print(f'  {family}: {found[family]}')

    return found


def summarize_folds(fold_metrics: list[dict]) -> dict:
    """Average only the folds that produced a usable metric, and say how many did not."""
    usable = [m for m in fold_metrics if not m.get('degenerate')]
    degenerate = len(fold_metrics) - len(usable)

    summary = {'folds': len(fold_metrics), 'usable_folds': len(usable),
               'degenerate_folds': degenerate}
    for key in ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']:
        vals = [m[key] for m in usable if m.get(key) is not None]
        summary[key] = float(np.mean(vals)) if vals else None
        if key == 'roc_auc':
            summary['roc_auc_std'] = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
    return summary


def train_all():
    """Full training pipeline."""
    df, feature_cols, target_cols = load_features()
    print(f'[train] Loaded {len(df)} samples with {len(feature_cols)} features')

    # A ticker-day that trips both a volume tier and a source-diversity spike
    # yields two rows with byte-identical labels. That is label duplication, not
    # two observations.
    before = len(df)
    df = cv.dedupe_same_day_events(df, 'watchlist_id', 'event_date',
                                   keep_by='multiplier').reset_index(drop=True)
    if before != len(df):
        print(f'[train] Collapsed {before - len(df)} same-day duplicate events '
              f'({len(df)} remain)')

    # Overlapping label windows mean rows are not independent evidence.
    global SAMPLE_WEIGHTS
    SAMPLE_WEIGHTS = cv.average_uniqueness_weights(
        df['event_date'], df['ticker'], HORIZON_DAYS)
    print(f'[train] Average uniqueness weight {SAMPLE_WEIGHTS.mean():.3f} '
          f'(1.0 = fully independent); effective sample '
          f'{SAMPLE_WEIGHTS.sum():.0f} of {len(df)} rows')

    FROZEN_PARAMS.update(search_hyperparameters(df, feature_cols))

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
        'cv': {
            'fold_days': FOLD_DAYS,
            'horizon_days': HORIZON_DAYS,
            'embargo_days': EMBARGO_DAYS,
            'purged': True,
            'sample_weighting': 'average_uniqueness',
            'hyperparameter_search': 'once_on_earliest_60pct',
            'frozen_params': FROZEN_PARAMS,
        },
        'models': {},
    }

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

        model = train_model('xgb_4w', X_train, y_train, 'classifier',
                             sample_weight=SAMPLE_WEIGHTS[train_idx.to_numpy()])
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_4w.append(metrics)

        print(f'  Fold {i}: AUC=' + (f'{metrics["roc_auc"] if metrics["roc_auc"] is not None else float("nan"):.3f}' if metrics.get('roc_auc') is not None else 'n/a (single-class fold)')
              + f', Acc={metrics["accuracy"]:.3f}')

        best_model_4w = model

    if best_model_4w is not None:
        X_all = df_valid[feature_cols].values.astype(np.float32)
        y_all = df_valid[target_col].values.astype(int)
        X_all = np.nan_to_num(X_all, 0)

        final_model_4w = train_model('xgb_4w_final', X_all, y_all, 'classifier',
                                      sample_weight=SAMPLE_WEIGHTS[df_valid.index.to_numpy()])
        joblib.dump(final_model_4w, MODELS_DIR / 'xgb_4w_classifier.joblib')

        importance_4w = dict(zip(feature_cols,
                                 final_model_4w.feature_importances_.tolist()))

        avg_metrics_4w = summarize_folds(fold_metrics_4w)

        all_metadata['models']['xgb_4w_classifier'] = {
            'fold_metrics': fold_metrics_4w,
            'avg_metrics': avg_metrics_4w,
            'feature_importance': importance_4w,
        }
        print('  → Average AUC: ' + (f'{avg_metrics_4w["roc_auc"]:.3f}' if avg_metrics_4w['roc_auc'] is not None else 'n/a')
              + f' over {avg_metrics_4w["usable_folds"]} usable folds'
              + (f' ({avg_metrics_4w["degenerate_folds"]} degenerate)' if avg_metrics_4w['degenerate_folds'] else ''))

    # --- Train 4w alpha classifier (XGBoost) ---
    # Predicts whether stock will outperform SPY (market-adjusted returns)
    print('\n=== Training XGBoost 4w Alpha Classifier ===')
    target_col = 'target_4w_alpha'
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)
    print(f'  Samples with {target_col}: {len(df_valid)}')
    print(f'  Class distribution: {df_valid[target_col].value_counts().to_dict()}')

    fold_metrics_4w_alpha = []
    best_model_4w_alpha = None

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

        model = train_model('xgb_4w_alpha', X_train, y_train, 'classifier',
                             sample_weight=SAMPLE_WEIGHTS[train_idx.to_numpy()])
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_4w_alpha.append(metrics)

        print(f'  Fold {i}: AUC={metrics["roc_auc"] if metrics["roc_auc"] is not None else float("nan"):.3f}, Acc={metrics["accuracy"]:.3f}, '
              f'F1={metrics["f1"]:.3f} (train={len(train_idx)}, test={len(test_idx)})')

        best_model_4w_alpha = model

    if best_model_4w_alpha is not None:
        X_all = df_valid[feature_cols].values.astype(np.float32)
        y_all = df_valid[target_col].values.astype(int)
        X_all = np.nan_to_num(X_all, 0)

        final_model_4w_alpha = train_model('xgb_4w_alpha_final', X_all, y_all, 'classifier',
                                      sample_weight=SAMPLE_WEIGHTS[df_valid.index.to_numpy()])
        joblib.dump(final_model_4w_alpha, MODELS_DIR / 'xgb_4w_alpha_classifier.joblib')

        importance_4w_alpha = dict(zip(feature_cols,
                                       final_model_4w_alpha.feature_importances_.tolist()))

        avg_metrics_4w_alpha = summarize_folds(fold_metrics_4w_alpha)

        all_metadata['models']['xgb_4w_alpha_classifier'] = {
            'fold_metrics': fold_metrics_4w_alpha,
            'avg_metrics': avg_metrics_4w_alpha,
            'feature_importance': importance_4w_alpha,
            'best_params': final_model_4w_alpha.get_params() if hasattr(final_model_4w_alpha, 'get_params') else {},
        }
        print('  → Average AUC: ' + (f'{avg_metrics_4w_alpha["roc_auc"]:.3f}' if avg_metrics_4w_alpha['roc_auc'] is not None else 'n/a')
              + ', F1: ' + (f'{avg_metrics_4w_alpha["f1"]:.3f}' if avg_metrics_4w_alpha['f1'] is not None else 'n/a')
              + f' over {avg_metrics_4w_alpha["usable_folds"]} usable folds'
              + (f' ({avg_metrics_4w_alpha["degenerate_folds"]} degenerate)' if avg_metrics_4w_alpha['degenerate_folds'] else ''))
    else:
        print('  → Skipped: insufficient data')

    # --- Train Logistic Regression baseline (4w target) ---
    print('\n=== Training Logistic Regression Baseline (4w) ===')
    target_col = 'target_4w_up'
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

        model = train_model('logreg', X_train, y_train, 'classifier',
                             sample_weight=SAMPLE_WEIGHTS[train_idx.to_numpy()])
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        fold_metrics_lr.append(metrics)

        print(f'  Fold {i}: AUC=' + (f'{metrics["roc_auc"] if metrics["roc_auc"] is not None else float("nan"):.3f}' if metrics.get('roc_auc') is not None else 'n/a (single-class fold)')
              + f', Acc={metrics["accuracy"]:.3f}')

    # Train final logreg on all data
    X_all = df_valid[feature_cols].values.astype(np.float32)
    y_all = df_valid[target_col].values.astype(int)
    X_all = np.nan_to_num(X_all, 0)

    final_lr = train_model('logreg', X_all, y_all, 'classifier',
                                      sample_weight=SAMPLE_WEIGHTS[df_valid.index.to_numpy()])
    joblib.dump(final_lr, MODELS_DIR / 'logreg_baseline.joblib')

    if fold_metrics_lr:
        avg_metrics_lr = summarize_folds(fold_metrics_lr)
        all_metadata['models']['logreg_baseline'] = {
            'fold_metrics': fold_metrics_lr,
            'avg_metrics': avg_metrics_lr,
        }
        print('  → Average AUC: ' + (f'{avg_metrics_lr["roc_auc"]:.3f}' if avg_metrics_lr['roc_auc'] is not None else 'n/a')
              + f' over {avg_metrics_lr["usable_folds"]} usable folds'
              + (f' ({avg_metrics_lr["degenerate_folds"]} degenerate)' if avg_metrics_lr['degenerate_folds'] else ''))

    # --- Train LightGBM 4w classifier ---
    print('\n=== Training LightGBM 4w Classifier ===')
    target_col = 'target_4w_up'
    valid_mask = df[target_col].notna()
    df_valid = df[valid_mask].reset_index(drop=True)

    fold_metrics_lgbm = []
    best_model_lgbm = None

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

        model = train_model('lgbm_4w', X_train, y_train, 'classifier',
                             sample_weight=SAMPLE_WEIGHTS[train_idx.to_numpy()])
        metrics = evaluate_fold(model, X_test, y_test, 'classifier')
        metrics['fold'] = i
        metrics['train_size'] = len(train_idx)
        metrics['test_size'] = len(test_idx)
        fold_metrics_lgbm.append(metrics)

        print(f'  Fold {i}: AUC=' + (f'{metrics["roc_auc"] if metrics["roc_auc"] is not None else float("nan"):.3f}' if metrics.get('roc_auc') is not None else 'n/a (single-class fold)')
              + f', Acc={metrics["accuracy"]:.3f}')

        best_model_lgbm = model

    if best_model_lgbm is not None:
        X_all = df_valid[feature_cols].values.astype(np.float32)
        y_all = df_valid[target_col].values.astype(int)
        X_all = np.nan_to_num(X_all, 0)

        final_model_lgbm = train_model('lgbm_4w_final', X_all, y_all, 'classifier',
                                      sample_weight=SAMPLE_WEIGHTS[df_valid.index.to_numpy()])
        joblib.dump(final_model_lgbm, MODELS_DIR / 'lgbm_4w_classifier.joblib')

        importance_lgbm = dict(zip(feature_cols,
                                    final_model_lgbm.feature_importances_.tolist()))

        avg_metrics_lgbm = summarize_folds(fold_metrics_lgbm)

        all_metadata['models']['lgbm_4w_classifier'] = {
            'fold_metrics': fold_metrics_lgbm,
            'avg_metrics': avg_metrics_lgbm,
            'feature_importance': importance_lgbm,
        }
        print('  → Average AUC: ' + (f'{avg_metrics_lgbm["roc_auc"]:.3f}' if avg_metrics_lgbm['roc_auc'] is not None else 'n/a')
              + f' over {avg_metrics_lgbm["usable_folds"]} usable folds'
              + (f' ({avg_metrics_lgbm["degenerate_folds"]} degenerate)' if avg_metrics_lgbm['degenerate_folds'] else ''))
    else:
        print('  → Skipped: insufficient data')

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

    # --- Append to training history ---
    history_path = MODELS_DIR / 'training_history.json'
    try:
        if history_path.exists():
            with open(history_path) as f:
                history = json.load(f)
        else:
            history = []
    except (json.JSONDecodeError, IOError):
        history = []

    history_entry = {
        'training_date': all_metadata['training_date'],
        'total_samples': all_metadata['total_samples'],
        'total_features': all_metadata['total_features'],
        'n_folds': all_metadata['n_folds'],
        'models': {},
    }
    for model_name, model_info in all_metadata['models'].items():
        avg = model_info.get('avg_metrics', {})
        history_entry['models'][model_name] = {
            'roc_auc': avg.get('roc_auc'),
            'accuracy': avg.get('accuracy'),
            'f1': avg.get('f1'),
        }

    history.append(history_entry)
    with open(history_path, 'w') as f:
        json.dump(history, f, indent=2, default=str)
    print(f'[train] Training history appended to {history_path} ({len(history)} entries)')


if __name__ == '__main__':
    train_all()
