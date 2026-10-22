"""
Walk-forward splitting for overlapping-label problems.

The label here looks 20 trading days (~28 calendar days) forward, but rows arrive
daily. A split that puts training rows immediately before the test window lets the
model train on rows whose outcome is realised *inside* that window — the model is
graded on information it already saw. That is why cross-validation kept reporting
AUC ~0.55 while the live track record sat at 0.50.

Purge and embargo fix it:

    |<------- train ------->|<- purge+embargo ->|<--- test --->|
                            ^ any training row whose label window
                              reaches past here is dropped

Also here: average-uniqueness sample weights, so a ticker sampled ten times inside
one label window does not count as ten independent observations.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd

__all__ = ['purged_walk_forward', 'average_uniqueness_weights', 'dedupe_same_day_events']


def purged_walk_forward(dates, fold_days: int, horizon_days: int,
                        embargo_days: int = 0, min_train: int = 30,
                        min_test: int = 3, index=None):
    """Expanding-window splits with a purge gap sized to the label horizon.

    `dates` are event dates; `horizon_days` is how far the label looks forward in
    calendar days. A training row is kept only if its entire label window closes
    before the test fold opens, plus `embargo_days` of slack.

    Returns a list of (train_index, test_index) pairs using `index` (defaults to
    a positional RangeIndex), so it can be handed straight to sklearn as `cv`.
    """
    dt = pd.to_datetime(pd.Series(list(dates))).reset_index(drop=True)
    idx = pd.Index(range(len(dt))) if index is None else pd.Index(index)

    if dt.empty:
        return []

    min_date, max_date = dt.min(), dt.max()
    gap = timedelta(days=horizon_days + embargo_days)

    splits = []
    fold_start = min_date + timedelta(days=max(45, fold_days * 2))

    while fold_start + timedelta(days=fold_days) <= max_date:
        fold_end = fold_start + timedelta(days=fold_days)

        # The purge: a training row's label window must close before the fold opens.
        train_mask = (dt + gap) < fold_start
        test_mask = (dt >= fold_start) & (dt < fold_end)

        train_idx = idx[train_mask.to_numpy()]
        test_idx = idx[test_mask.to_numpy()]

        if len(train_idx) >= min_train and len(test_idx) >= min_test:
            splits.append((train_idx, test_idx))

        fold_start = fold_end

    return splits


def average_uniqueness_weights(dates, clusters, horizon_days: int) -> np.ndarray:
    """Weight each row by 1 / (rows sharing its label window within its cluster).

    Two events on the same ticker three days apart are graded on almost the same
    four weeks of price action. Counting both at full weight tells the model that
    one outcome is two pieces of evidence.
    """
    dt = pd.to_datetime(pd.Series(list(dates))).reset_index(drop=True)
    cl = pd.Series(list(clusters)).reset_index(drop=True).astype(str)
    horizon = np.timedelta64(horizon_days, 'D')

    weights = np.ones(len(dt), dtype=float)
    values = dt.to_numpy()

    for cluster in cl.unique():
        members = np.flatnonzero((cl == cluster).to_numpy())
        member_dates = values[members]
        for i, when in zip(members, member_dates):
            # |{j in cluster : label windows of i and j overlap}|
            overlap = np.sum(np.abs(member_dates - when) < horizon)
            weights[i] = 1.0 / max(1, overlap)

    return weights


def dedupe_same_day_events(df: pd.DataFrame, cluster_col: str, date_col: str,
                           keep_by: str | None = None) -> pd.DataFrame:
    """Collapse rows that describe the same cluster-day.

    A ticker-day that trips both a volume tier and a source-diversity spike
    produces two rows with byte-identical labels, differing only in one-hot flags.
    They are label duplication, not two observations.
    """
    if df.empty:
        return df

    keyed = df.copy()
    keyed['_day'] = pd.to_datetime(keyed[date_col]).dt.date

    if keep_by is not None and keep_by in keyed.columns:
        keyed = keyed.sort_values(keep_by, ascending=False)

    deduped = keyed.drop_duplicates(subset=[cluster_col, '_day'], keep='first')
    return deduped.drop(columns=['_day']).sort_index()
