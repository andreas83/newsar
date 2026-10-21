"""
Model Evaluation Report Generator.

Two sections, and the order matters:

  1. LIVE TRACK RECORD — what the deployed models actually did, scored from
     stock_recommendations rows whose outcome is known. This is the headline,
     because cross-validation on overlapping labels has repeatedly disagreed
     with reality by 0.1 AUC or more.
  2. CROSS-VALIDATION — the fold metrics from the last training run, reported
     with an explicit degenerate-fold count rather than averaging failures in.

Every metric carries the label expression it was computed against, and every
directional hit rate is printed beside the base rate over the same calendar
window. Both exist because this system spent four months grading one event with
a number trained on a different one.

Output: ml/reports/evaluation_report.json

Usage: python evaluate.py
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import db
import eval_core as ec

MODELS_DIR = Path(__file__).parent / 'models'
DATA_DIR = Path(__file__).parent / 'data'
REPORTS_DIR = Path(__file__).parent / 'reports'
REPORTS_DIR.mkdir(exist_ok=True)

# Label horizon in calendar days (20 trading days). Used for effective-n blocks.
HORIZON_DAYS = 28
RAW_HURDLE_PCT = 1.0  # target_4w_up is change_4w > 1.0, per ml/features.py


def load_live_recommendations() -> pd.DataFrame:
    """Validated recommendations with the outcome and the ticker they belong to.

    `ml_prob_alpha_4w` and `actual_benchmark_change_4w` may not exist yet (they
    arrive with migration 0021); the query degrades to NULL so this report runs
    before and after that change.
    """
    cols = db.query("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'stock_recommendations'
    """)['column_name'].tolist()

    alpha_prob = 'r.ml_prob_alpha_4w' if 'ml_prob_alpha_4w' in cols else 'NULL::real'
    benchmark = ('r.actual_benchmark_change_4w'
                 if 'actual_benchmark_change_4w' in cols else 'NULL::real')
    version = 'r.model_version' if 'model_version' in cols else "NULL::varchar"

    return db.query(f"""
        SELECT
            r.id, r.correlation_id, r.model_source, r.event_date,
            r.signal_direction, r.signal_strength,
            r.short_term_confidence, r.medium_term_confidence,
            r.ml_prob_up_4w,
            {alpha_prob} AS ml_prob_alpha_4w,
            r.actual_change_4w,
            {benchmark} AS actual_benchmark_change_4w,
            {version} AS model_version,
            w.ticker
        FROM stock_recommendations r
        JOIN stock_watchlist w ON w.id = r.watchlist_id
        WHERE r.validated_at IS NOT NULL
          AND r.actual_change_4w IS NOT NULL
        ORDER BY r.event_date
    """)


def score_series(df: pd.DataFrame, score_col: str, y: np.ndarray,
                 label_expr: str, note: str = '') -> dict:
    """AUC + calibration + effective n for one score column against one label."""
    p = pd.to_numeric(df[score_col], errors='coerce').to_numpy(dtype=float)
    dates = df['event_date'].to_numpy()
    tickers = df['ticker'].to_numpy()

    ok = ~(np.isnan(p) | np.isnan(y))
    if ok.sum() == 0:
        return {'score': score_col, 'label_expr': label_expr, 'n': 0, 'note': note}

    out = {
        'score': score_col,
        'note': note,
        **ec.auc_with_ci(y[ok], p[ok], clusters=tickers[ok], label_expr=label_expr),
        'sample': ec.effective_n(dates[ok], tickers[ok], HORIZON_DAYS),
        'calibration': ec.calibration(y[ok], p[ok], label_expr=label_expr),
    }
    return out


def evaluate_live(df: pd.DataFrame) -> dict:
    """Live scorecard per model source."""
    if df.empty:
        return {'error': 'No validated recommendations with outcomes'}

    df = df.copy().reset_index(drop=True)
    df['event_date'] = pd.to_datetime(df['event_date']).dt.date
    change = pd.to_numeric(df['actual_change_4w'], errors='coerce')
    bench = pd.to_numeric(df['actual_benchmark_change_4w'], errors='coerce')

    # The two labels the system cares about. `raw` is what the deployed
    # xgb_4w_classifier was trained on; `alpha` is what drives signal_direction.
    labels = {
        f'actual_change_4w > {RAW_HURDLE_PCT}': (change > RAW_HURDLE_PCT).astype(float)
                                                 .where(change.notna()).to_numpy(),
    }
    if bench.notna().any():
        labels['actual_change_4w - benchmark > 0'] = (
            (change - bench > 0).astype(float).where(change.notna() & bench.notna()).to_numpy()
        )

    out = {'horizon_days': HORIZON_DAYS, 'sources': {}}

    for source, group in df.groupby('model_source'):
        pos = group.index.to_numpy()  # RangeIndex after reset_index, so these are positions
        entry = {'n_validated': int(len(group)), 'scores': [], 'directions': {}}

        # Which score column decides, and which is merely displayed, differs by
        # source — that mismatch is itself one of the findings.
        if source == 'ml_model':
            candidates = [
                ('ml_prob_up_4w', 'raw-return model — displayed, does not decide direction'),
                ('ml_prob_alpha_4w', 'alpha model — DECIDES signal_direction'),
                ('short_term_confidence', 'alpha probability before migration 0021 stored it properly'),
            ]
        else:
            candidates = [('signal_strength', 'heuristic composite score — decides direction')]

        for col, note in candidates:
            if col not in group.columns or group[col].notna().sum() == 0:
                continue
            for label_expr, y_all in labels.items():
                entry['scores'].append(
                    score_series(group, col, y_all[pos], label_expr, note)
                )

        for label_expr, y_all in labels.items():
            entry['directions'][label_expr] = ec.directional_scorecard(
                group['signal_direction'].to_numpy(),
                y_all[pos],
                group['event_date'].to_numpy(),
                label_expr=label_expr,
            )

        out['sources'][source] = entry

    # Baselines everything must beat, over the whole validated window.
    primary = list(labels.values())[0]
    ok = ~np.isnan(primary)
    out['baselines'] = {
        'label_expr': list(labels.keys())[0],
        'base_rate': float(primary[ok].mean()),
        'always_bullish_hit_rate': float(primary[ok].mean()),
        'always_bearish_hit_rate': float(1 - primary[ok].mean()),
        'random_auc': 0.5,
        'n': int(ok.sum()),
    }
    return out


def evaluate_cv(metadata: dict) -> dict:
    """Fold metrics, with degenerate folds counted instead of averaged in."""
    models = {}
    for name, info in metadata.get('models', {}).items():
        folds = info.get('fold_metrics', [])
        entry = {
            'reported_avg_metrics': info.get('avg_metrics', {}),
            'fold_summary': ec.degenerate_fold_count(folds),
        }
        if 'feature_importance' in info:
            ranked = sorted(info['feature_importance'].items(),
                            key=lambda kv: kv[1], reverse=True)
            entry['top_features'] = [{'feature': k, 'importance': float(v)}
                                     for k, v in ranked[:20]]
            entry['dead_features'] = [k for k, v in ranked if float(v) == 0.0]
        models[name] = entry
    return models


def fmt(x, spec='.3f'):
    return '—' if x is None or (isinstance(x, float) and np.isnan(x)) else format(x, spec)


# The score that decides direction, per model source. For ml_model this is the
# alpha probability; ml_prob_alpha_4w once migration 0021 is populated, and
# short_term_confidence for rows written before that.
DECIDING_SCORE = {
    'ml_model': ('ml_prob_alpha_4w', 'short_term_confidence'),
    'heuristic': ('signal_strength',),
}


def write_label_contract(live: dict) -> dict:
    """Derive the tradeable flag from the live track record and persist it.

    A model may publish signals for measurement while being barred from trading.
    Those are different bars: publishing needs only that the pipeline runs;
    trading needs evidence that the probabilities carry information beyond
    quoting the base rate. Brier skill is that test, and unlike accuracy or win
    rate it is not moved by a base rate that swings 13%->78% between months.

    This is deliberately computed from data rather than configured by hand: a
    hand-set flag is a flag that stays true after the evidence turns.
    """
    contract = {
        'generated_at': pd.Timestamp.now().isoformat(),
        'criterion': 'brier_skill > 0 on the live track record of the deciding score',
        'horizon_days': HORIZON_DAYS,
        'sources': {},
    }

    for source, entry in live.get('sources', {}).items():
        preferred = DECIDING_SCORE.get(source, ())
        chosen = None
        # Prefer the alpha label when it is available: it is what the deciding
        # model was trained on.
        for score_name in preferred:
            candidates = [s for s in entry.get('scores', [])
                          if s.get('score') == score_name and s.get('n')]
            if not candidates:
                continue
            alpha = [c for c in candidates if 'benchmark' in c.get('label_expr', '')]
            chosen = (alpha or candidates)[0]
            break

        if chosen is None:
            contract['sources'][source] = {
                'tradeable': False,
                'reason': 'no scored track record yet',
            }
            continue

        cal = chosen.get('calibration', {})
        skill = cal.get('brier_skill')
        ci_low = chosen.get('ci_low')
        tradeable = skill is not None and skill > 0

        contract['sources'][source] = {
            'tradeable': bool(tradeable),
            'reason': (f'brier_skill {skill:.4f} > 0' if tradeable
                       else f'brier_skill {skill:.4f} <= 0' if skill is not None
                       else 'brier skill unavailable'),
            'score': chosen.get('score'),
            'label_expr': chosen.get('label_expr'),
            'brier_skill': skill,
            'auc': chosen.get('auc'),
            'auc_ci_low': ci_low,
            'auc_ci_high': chosen.get('ci_high'),
            'n': chosen.get('n'),
            'n_eff': (chosen.get('sample') or {}).get('n_eff'),
        }

    payload = json.dumps(contract, sort_keys=True, default=str).encode()
    contract['version'] = hashlib.sha256(payload).hexdigest()[:16]

    with open(MODELS_DIR / 'label_contract.json', 'w') as f:
        json.dump(contract, f, indent=2, default=str)

    return contract


def generate_report():
    report = {'generated_at': pd.Timestamp.now().isoformat()}

    print('[evaluate] Loading live track record...')
    live_df = load_live_recommendations()
    report['live'] = evaluate_live(live_df)
    report['contract'] = write_label_contract(report['live'])

    meta_path = MODELS_DIR / 'model_metadata.json'
    if meta_path.exists():
        with open(meta_path) as f:
            metadata = json.load(f)
        report['training_date'] = metadata.get('training_date')
        report['total_samples'] = metadata.get('total_samples')
        report['cross_validation'] = evaluate_cv(metadata)
    else:
        print('[evaluate] No model metadata found — live section only.')

    features_path = DATA_DIR / 'features.parquet'
    if features_path.exists():
        fdf = pd.read_parquet(features_path)
        priors = {}
        for col in ('target_4w_up', 'target_4w_alpha'):
            if col in fdf.columns and fdf[col].notna().any():
                priors[col] = float(fdf[col].dropna().mean())
        report['training_class_priors'] = priors

    # ── Console summary ──
    live = report['live']
    if 'error' not in live:
        b = live['baselines']
        print(f'\n=== LIVE TRACK RECORD ===')
        print(f'Label: {b["label_expr"]}   base rate {b["base_rate"]:.3f} over n={b["n"]}')
        print(f'Baselines to beat: always-bullish {b["always_bullish_hit_rate"]:.3f}, '
              f'always-bearish {b["always_bearish_hit_rate"]:.3f}, random AUC 0.500\n')

        for source, entry in live['sources'].items():
            print(f'--- {source} (n={entry["n_validated"]}) ---')
            for s in entry['scores']:
                if not s.get('n'):
                    continue
                ci = f'[{fmt(s.get("ci_low"))}, {fmt(s.get("ci_high"))}]'
                verdict = 'no signal' if (s.get('ci_low') is not None
                                          and s['ci_low'] <= 0.5 <= s.get('ci_high')) else ''
                cal = s['calibration']
                print(f'  {s["score"]:<24} vs {s["label_expr"]}')
                print(f'    AUC {fmt(s.get("auc"))} {ci:<18} n={s["n"]} '
                      f'n_eff={s["sample"]["n_eff"]} n_eff_market={s["sample"]["n_eff_market"]} {verdict}')
                print(f'    brier_skill {fmt(cal["brier_skill"])}  '
                      f'mean_pred {fmt(cal["mean_pred"])} vs actual {fmt(cal["actual_rate"])} '
                      f'(gap {fmt(cal["calibration_gap"], "+.3f")})')
                print(f'    ({s["note"]})')
            for label_expr, d in entry['directions'].items():
                bits = []
                for name in ('bullish', 'bearish', 'neutral'):
                    dd = d['directions'][name]
                    if dd.get('hit_rate') is not None:
                        bits.append(f'{name} {dd["n"]} @ {dd["hit_rate"]:.3f} '
                                    f'(base {fmt(dd["matched_base_rate"])}, '
                                    f'edge {fmt(dd["edge_pp"], "+.1f")}pp)')
                    else:
                        bits.append(f'{name} {dd["n"]}')
                print(f'    calls vs {label_expr}: ' + ' | '.join(bits))
            print()

    if 'cross_validation' in report:
        print('=== CROSS-VALIDATION (last training run) ===')
        print(f'{"model":<32} {"reported":>9} {"usable":>8} {"degenerate":>11} {"honest mean":>12}')
        for name, m in report['cross_validation'].items():
            fs = m['fold_summary']
            print(f'{name:<32} {fmt(m["reported_avg_metrics"].get("roc_auc")):>9} '
                  f'{fs["usable_folds"]:>8} {fs["degenerate_folds"]:>11} '
                  f'{fmt(fs["auc_mean"]):>12}')
            dead = m.get('dead_features', [])
            if dead:
                print(f'    dead features (zero importance): {", ".join(dead[:8])}'
                      f'{" …" if len(dead) > 8 else ""}')
        print()

    contract = report.get('contract', {})
    if contract.get('sources'):
        print('=== TRADEABLE GATE ===')
        print(f'Criterion: {contract["criterion"]}')
        for source, entry in contract['sources'].items():
            state = 'TRADEABLE' if entry['tradeable'] else 'BLOCKED  '
            print(f'  {state}  {source:<12} {entry["reason"]}'
                  + (f'  (n={entry["n"]}, n_eff={entry["n_eff"]})' if entry.get('n') else ''))
        print(f'  contract version {contract.get("version")}\n')

    report_path = REPORTS_DIR / 'evaluation_report.json'
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f'[evaluate] Report saved to {report_path}')


if __name__ == '__main__':
    generate_report()
