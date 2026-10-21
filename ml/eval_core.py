"""
Evaluation primitives shared by the report generators.

Pure functions over numpy arrays: no database access, no file IO, no globals.
That keeps them unit-testable without the production box, and it is why every
function takes the label expression as a string and echoes it back — a metric
that does not say which event it measured is how the stock and BTC scorecards
ended up grading something different from what the models were trained on.

Design notes that are easy to get wrong:

* Base rates here swing from 13% to 78% between months, so an accuracy or a win
  rate is meaningless without the base rate over the *same* calendar window.
  Every directional metric is reported against a matched-period baseline.
* Labels look 20 trading days forward while rows arrive daily, so rows are not
  independent. Confidence intervals resample whole clusters (tickers), never
  rows — an i.i.d. bootstrap over overlapping labels is as fake as the AUC it
  wraps.
* Degenerate folds are counted, never substituted with 0.5. Substituting drags a
  good model down and a bad model up, which is how a 0.55 AUC came to look like
  a result.
"""

from __future__ import annotations

import numpy as np

__all__ = [
    'auc_score',
    'auc_with_ci',
    'matched_period_base_rate',
    'effective_n',
    'calibration',
    'directional_scorecard',
    'degenerate_fold_count',
]


def _as_arrays(y, p):
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    ok = ~(np.isnan(y) | np.isnan(p))
    return y[ok].astype(int), p[ok]


def auc_score(y, p) -> float | None:
    """Mann-Whitney ROC-AUC with tie correction.

    Returns None for a single-class input rather than 0.5 — the caller must
    count that as degenerate, not average it in as a result.
    """
    y, p = _as_arrays(y, p)
    n_pos = int(y.sum())
    n_neg = len(y) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None

    order = np.argsort(p, kind='mergesort')
    ranks = np.empty(len(p), dtype=float)
    sorted_p = p[order]
    i = 0
    while i < len(sorted_p):
        j = i
        while j + 1 < len(sorted_p) and sorted_p[j + 1] == sorted_p[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1

    rank_sum_pos = ranks[y == 1].sum()
    return float((rank_sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def auc_with_ci(y, p, clusters=None, n_boot: int = 2000, alpha: float = 0.10,
                label_expr: str = '', seed: int = 42) -> dict:
    """AUC with a cluster bootstrap confidence interval.

    `clusters` groups rows whose labels overlap (ticker for stocks). Whole
    clusters are resampled, so the interval reflects the number of independent
    units rather than the number of rows. Pass clusters=None only when rows are
    genuinely independent.
    """
    y_arr = np.asarray(y, dtype=float)
    p_arr = np.asarray(p, dtype=float)
    ok = ~(np.isnan(y_arr) | np.isnan(p_arr))
    y_arr, p_arr = y_arr[ok].astype(int), p_arr[ok]
    clusters = np.arange(len(y_arr)) if clusters is None else np.asarray(clusters)[ok]

    point = auc_score(y_arr, p_arr)
    result = {
        'auc': point,
        'ci_low': None,
        'ci_high': None,
        'ci_level': 1 - alpha,
        'n': int(len(y_arr)),
        'n_pos': int(y_arr.sum()),
        'n_neg': int(len(y_arr) - y_arr.sum()),
        'n_clusters': int(len(np.unique(clusters))),
        'label_expr': label_expr,
    }
    if point is None:
        return result

    rng = np.random.default_rng(seed)
    uniq = np.unique(clusters)
    index_by_cluster = {c: np.flatnonzero(clusters == c) for c in uniq}

    draws = []
    for _ in range(n_boot):
        picked = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([index_by_cluster[c] for c in picked])
        val = auc_score(y_arr[idx], p_arr[idx])
        if val is not None:
            draws.append(val)

    if draws:
        result['ci_low'] = float(np.quantile(draws, alpha / 2))
        result['ci_high'] = float(np.quantile(draws, 1 - alpha / 2))
        result['n_boot_valid'] = len(draws)
    return result


def matched_period_base_rate(y_all, dates_all, subset_mask=None) -> dict:
    """Base rate over the calendar window the subset actually spans.

    Comparing a subset's hit rate to the all-time base rate is what let a
    below-baseline model look acceptable: bullish calls clustered in months when
    almost everything rose. This restricts the baseline to the subset's own
    window.
    """
    y_all = np.asarray(y_all, dtype=float)
    dates_all = np.asarray(dates_all, dtype='datetime64[D]')
    ok = ~np.isnan(y_all)

    if subset_mask is None:
        window = ok
    else:
        subset_mask = np.asarray(subset_mask, dtype=bool) & ok
        if not subset_mask.any():
            return {'base_rate': None, 'n': 0, 'window_start': None, 'window_end': None}
        lo, hi = dates_all[subset_mask].min(), dates_all[subset_mask].max()
        window = ok & (dates_all >= lo) & (dates_all <= hi)

    if not window.any():
        return {'base_rate': None, 'n': 0, 'window_start': None, 'window_end': None}

    return {
        'base_rate': float(y_all[window].mean()),
        'n': int(window.sum()),
        'window_start': str(dates_all[window].min()),
        'window_end': str(dates_all[window].max()),
    }


def effective_n(dates, clusters, horizon_days: int) -> dict:
    """Independent-observation counts behind a raw row count.

    Three numbers, and the third is usually the sobering one:
      n_raw          rows
      n_eff          distinct (cluster, horizon-block) cells — corrects for one
                     ticker being sampled repeatedly inside one label window
      n_eff_market   distinct horizon blocks, ignoring cluster — the ceiling for
                     any label driven by a common factor. Every ticker shares the
                     same market over the same four weeks, so a market-directional
                     label cannot have more independent observations than there
                     are non-overlapping windows in the sample, no matter how many
                     tickers are in it.
    """
    dates = np.asarray(dates, dtype='datetime64[D]').astype('int64')
    if len(dates) == 0:
        return {'n_raw': 0, 'n_eff': 0, 'n_eff_market': 0, 'horizon_days': horizon_days}

    block = (dates - dates.min()) // max(1, horizon_days)
    n_eff_market = int(len(np.unique(block)))

    if clusters is None:
        n_eff = n_eff_market
    else:
        clusters = np.asarray(clusters).astype(str)
        pairs = np.char.add(np.char.add(clusters, '@'), block.astype(str))
        n_eff = int(len(np.unique(pairs)))

    return {
        'n_raw': int(len(dates)),
        'n_eff': n_eff,
        'n_eff_market': n_eff_market,
        'horizon_days': horizon_days,
    }


def calibration(y, p, bins: int = 5, base_rate: float | None = None,
                label_expr: str = '') -> dict:
    """Reliability table, Brier score, and Brier skill against the base rate.

    brier_skill <= 0 means the probabilities carry nothing beyond quoting the
    base rate every day. It is the headline number because, unlike accuracy, it
    is unaffected by how the base rate moves between months.
    """
    y, p = _as_arrays(y, p)
    if len(y) == 0:
        return {'brier': None, 'brier_base': None, 'brier_skill': None,
                'table': [], 'mean_pred': None, 'actual_rate': None,
                'label_expr': label_expr}

    rate = float(y.mean()) if base_rate is None else float(base_rate)
    brier = float(np.mean((p - y) ** 2))
    brier_base = float(np.mean((rate - y) ** 2))
    skill = None if brier_base == 0 else float(1 - brier / brier_base)

    edges = np.linspace(0.0, 1.0, bins + 1)
    table = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi if hi < 1.0 else p <= hi)
        if m.any():
            table.append({
                'bin_low': float(lo),
                'bin_high': float(hi),
                'mean_predicted': float(p[m].mean()),
                'actual_rate': float(y[m].mean()),
                'n': int(m.sum()),
            })

    return {
        'brier': brier,
        'brier_base': brier_base,
        'brier_skill': skill,
        'mean_pred': float(p.mean()),
        'actual_rate': rate,
        'calibration_gap': float(p.mean() - rate),
        'table': table,
        'label_expr': label_expr,
    }


def directional_scorecard(direction, y, dates, label_expr: str = '') -> dict:
    """Per-direction hit rate against the base rate over the same window.

    n_bullish and n_bearish are first-class outputs: "the model has never made a
    bullish call" is the single most important fact a scorecard can surface, and
    it is invisible in any aggregate accuracy number.
    """
    direction = np.asarray(direction).astype(str)
    y_arr = np.asarray(y, dtype=float)
    dates_arr = np.asarray(dates, dtype='datetime64[D]')

    out = {'label_expr': label_expr, 'directions': {}}
    for name, correct_when in (('bullish', 1), ('bearish', 0), ('neutral', None)):
        mask = direction == name
        entry = {'n': int(mask.sum())}

        if mask.any() and correct_when is not None:
            graded = mask & ~np.isnan(y_arr)
            if graded.any():
                hit = float((y_arr[graded] == correct_when).mean())
                baseline = matched_period_base_rate(y_arr, dates_arr, graded)
                base = baseline['base_rate']
                # For a bearish call the baseline is P(not the labelled event).
                expected = base if correct_when == 1 else (None if base is None else 1 - base)
                entry.update({
                    'n_graded': int(graded.sum()),
                    'hit_rate': hit,
                    'matched_base_rate': expected,
                    'edge_pp': None if expected is None else (hit - expected) * 100,
                    'window_start': baseline['window_start'],
                    'window_end': baseline['window_end'],
                })
        out['directions'][name] = entry

    out['n_bullish'] = out['directions']['bullish']['n']
    out['n_bearish'] = out['directions']['bearish']['n']
    out['n_neutral'] = out['directions']['neutral']['n']
    return out


def degenerate_fold_count(folds) -> dict:
    """Count folds that produced no usable metric instead of scoring them 0.5."""
    total = len(folds)
    degenerate = sum(1 for f in folds if f.get('roc_auc') is None)
    usable = [f['roc_auc'] for f in folds if f.get('roc_auc') is not None]
    return {
        'folds': total,
        'degenerate_folds': degenerate,
        'usable_folds': len(usable),
        'auc_mean': float(np.mean(usable)) if usable else None,
        'auc_std': float(np.std(usable, ddof=1)) if len(usable) > 1 else None,
    }
