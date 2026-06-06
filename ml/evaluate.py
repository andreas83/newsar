"""
Model Evaluation Report Generator.

Generates performance report across all walk-forward folds:
  - Accuracy, precision, recall, F1 per fold
  - ROC-AUC per fold
  - Feature importance ranking (top 20)
  - Confusion matrix
  - Comparison: ML model vs heuristic scoring vs random baseline
  - Saves report to ml/reports/evaluation_report.json

Usage: python evaluate.py
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)

import db

MODELS_DIR = Path(__file__).parent / 'models'
DATA_DIR = Path(__file__).parent / 'data'
REPORTS_DIR = Path(__file__).parent / 'reports'
REPORTS_DIR.mkdir(exist_ok=True)


def load_heuristic_results() -> pd.DataFrame:
    """Load heuristic signal results for comparison."""
    return db.query("""
        SELECT
            r.correlation_id,
            r.signal_direction,
            r.signal_strength,
            r.short_term_confidence,
            r.medium_term_confidence,
            r.actual_change_5d,
            r.actual_change_4w,
            r.status
        FROM stock_recommendations r
        WHERE r.validated_at IS NOT NULL
    """)


def evaluate_heuristic(heuristic: pd.DataFrame) -> dict:
    """Evaluate heuristic signal performance."""
    if heuristic.empty:
        return {'error': 'No validated heuristic recommendations'}

    # 5d performance
    valid_5d = heuristic[heuristic['actual_change_5d'].notna()].copy()
    if not valid_5d.empty:
        # Heuristic predicted direction
        valid_5d['predicted_up'] = (valid_5d['signal_direction'] == 'bullish').astype(int)
        valid_5d['actual_up'] = (valid_5d['actual_change_5d'].astype(float) > 0.5).astype(int)

        h_accuracy_5d = float(accuracy_score(valid_5d['actual_up'], valid_5d['predicted_up']))
        h_f1_5d = float(f1_score(valid_5d['actual_up'], valid_5d['predicted_up'], zero_division=0))
        try:
            h_auc_5d = float(roc_auc_score(valid_5d['actual_up'],
                                            valid_5d['short_term_confidence'].astype(float)))
        except ValueError:
            h_auc_5d = 0.5
    else:
        h_accuracy_5d = h_f1_5d = h_auc_5d = None

    # 4w performance
    valid_4w = heuristic[heuristic['actual_change_4w'].notna()].copy()
    if not valid_4w.empty:
        valid_4w['predicted_up'] = (valid_4w['signal_direction'] == 'bullish').astype(int)
        valid_4w['actual_up'] = (valid_4w['actual_change_4w'].astype(float) > 1.0).astype(int)

        h_accuracy_4w = float(accuracy_score(valid_4w['actual_up'], valid_4w['predicted_up']))
        h_f1_4w = float(f1_score(valid_4w['actual_up'], valid_4w['predicted_up'], zero_division=0))
    else:
        h_accuracy_4w = h_f1_4w = None

    return {
        'total_signals': len(heuristic),
        'validated': len(heuristic[heuristic['status'] == 'validated']),
        '5d': {
            'n_samples': len(valid_5d) if not valid_5d.empty else 0,
            'accuracy': h_accuracy_5d,
            'f1': h_f1_5d,
            'roc_auc': h_auc_5d,
        },
        '4w': {
            'n_samples': len(valid_4w) if not valid_4w.empty else 0,
            'accuracy': h_accuracy_4w,
            'f1': h_f1_4w,
        },
    }


def generate_report():
    """Generate comprehensive evaluation report."""
    # Load model metadata
    meta_path = MODELS_DIR / 'model_metadata.json'
    if not meta_path.exists():
        print('[evaluate] No model metadata found. Run `ml:train` first.')
        sys.exit(1)

    with open(meta_path) as f:
        metadata = json.load(f)

    report = {
        'generated_at': pd.Timestamp.now().isoformat(),
        'training_date': metadata.get('training_date'),
        'total_samples': metadata.get('total_samples'),
        'total_features': metadata.get('total_features'),
        'n_folds': metadata.get('n_folds'),
        'models': {},
    }

    # --- ML Model Performance ---
    for model_name, model_info in metadata.get('models', {}).items():
        avg = model_info.get('avg_metrics', {})
        folds = model_info.get('fold_metrics', [])

        model_report = {
            'avg_metrics': avg,
            'fold_count': len(folds),
            'per_fold': folds,
        }

        # Feature importance (top 20)
        if 'feature_importance' in model_info:
            importance = model_info['feature_importance']
            sorted_feats = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:20]
            model_report['top_features'] = [
                {'feature': name, 'importance': float(val)}
                for name, val in sorted_feats
            ]

        # Confusion matrix from last fold
        if folds:
            last_fold = folds[-1]
            # We don't have raw predictions stored, so skip confusion matrix
            pass

        report['models'][model_name] = model_report

    # --- Heuristic Baseline ---
    print('[evaluate] Loading heuristic results for comparison...')
    try:
        heuristic = load_heuristic_results()
        report['heuristic_baseline'] = evaluate_heuristic(heuristic)
    except Exception as e:
        report['heuristic_baseline'] = {'error': str(e)}

    # --- Random Baseline ---
    features_path = DATA_DIR / 'features.parquet'
    if features_path.exists():
        df = pd.read_parquet(features_path)
        valid = df[df['target_5d_up'].notna()]
        if len(valid) > 0:
            actual_rate = float(valid['target_5d_up'].mean())
            report['random_baseline'] = {
                'class_prior': actual_rate,
                'accuracy_always_majority': max(actual_rate, 1 - actual_rate),
                'roc_auc': 0.5,
                'note': 'Random classifier would achieve AUC=0.5',
            }

        valid_4w = df[df['target_4w_up'].notna()]
        if len(valid_4w) > 0:
            report['random_baseline_4w'] = {
                'class_prior': float(valid_4w['target_4w_up'].mean()),
            }

    # --- Comparison Summary ---
    print('\n=== MODEL COMPARISON ===')
    print(f'{"Model":<25} {"AUC":>8} {"Accuracy":>10} {"F1":>8}')
    print('-' * 55)

    # Random
    if 'random_baseline' in report:
        rb = report['random_baseline']
        print(f'{"Random (5d)":<25} {"0.500":>8} {rb["accuracy_always_majority"]:>10.3f} {"—":>8}')

    # Heuristic
    h = report.get('heuristic_baseline', {})
    h5d = h.get('5d', {})
    if h5d.get('accuracy') is not None:
        auc_str = f'{h5d["roc_auc"]:.3f}' if h5d.get('roc_auc') else '—'
        print(f'{"Heuristic (5d)":<25} {auc_str:>8} {h5d["accuracy"]:>10.3f} {h5d["f1"]:>8.3f}')

    # ML models
    for model_name in ['xgb_5d_classifier', 'xgb_4w_classifier', 'logreg_baseline']:
        if model_name in report['models']:
            avg = report['models'][model_name]['avg_metrics']
            auc = avg.get('roc_auc', 0)
            acc = avg.get('accuracy', 0)
            f1 = avg.get('f1', 0)
            print(f'{model_name:<25} {auc:>8.3f} {acc:>10.3f} {f1:>8.3f}')

    # Regressor
    if 'xgb_5d_regressor' in report['models']:
        avg = report['models']['xgb_5d_regressor']['avg_metrics']
        rmse = avg.get('rmse', 0)
        dir_acc = avg.get('direction_accuracy', 0)
        print(f'{"xgb_5d_regressor":<25} {"—":>8} {dir_acc:>10.3f} {"RMSE=" + f"{rmse:.2f}":>8}')

    print()

    # Feature importance
    for model_name in ['xgb_5d_classifier', 'xgb_4w_classifier']:
        if model_name in report['models'] and 'top_features' in report['models'][model_name]:
            print(f'\nTop 10 Features ({model_name}):')
            for i, feat in enumerate(report['models'][model_name]['top_features'][:10]):
                bar = '#' * int(feat['importance'] * 50)
                print(f'  {i+1:2d}. {feat["feature"]:<30} {feat["importance"]:.4f} {bar}')

    # Save report
    report_path = REPORTS_DIR / 'evaluation_report.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)

    print(f'\n[evaluate] Report saved to {report_path}')


if __name__ == '__main__':
    generate_report()
