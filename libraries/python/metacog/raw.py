"""Raw metacognitive measures: Gamma, Phi, ΔConf."""

import numpy as np
import pandas as pd


def gamma(data, group_by_subject=True):
    """
    Goodman-Kruskal gamma correlation between confidence and accuracy.

    Gamma = (C - D) / (C + D) where C = concordant pairs, D = discordant pairs.
    For binary accuracy x ordinal confidence, a concordant pair is one where
    the correct trial has higher confidence than the incorrect trial.

    Returns DataFrame with columns: subject, gamma
    """
    df = data.raw
    subj = data.col('subject')
    conf_col = data.col('confidence')
    acc_col = data.col('accuracy')

    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        confidence = group[conf_col].values
        accuracy = group[acc_col].astype(int).values

        correct_conf = confidence[accuracy == 1]
        incorrect_conf = confidence[accuracy == 0]

        if len(correct_conf) == 0 or len(incorrect_conf) == 0:
            results.append({'subject': subject, 'gamma': np.nan})
            continue

        # Efficient vectorized computation using searchsorted
        correct_sorted = np.sort(correct_conf)
        n_correct = len(correct_sorted)

        # For each incorrect trial, count correct trials above/below
        right_idx = np.searchsorted(correct_sorted, incorrect_conf, side='right')
        left_idx = np.searchsorted(correct_sorted, incorrect_conf, side='left')

        C = np.sum(n_correct - right_idx)   # correct > incorrect
        D = np.sum(left_idx)                 # correct < incorrect

        denom = C + D
        g = (C - D) / denom if denom > 0 else np.nan
        results.append({'subject': subject, 'gamma': round(float(g), 4)})

    return pd.DataFrame(results)


def phi(data, group_by_subject=True):
    """
    Pearson correlation (Phi) between confidence and accuracy.

    Returns DataFrame with columns: subject, phi
    """
    df = data.raw
    subj = data.col('subject')
    conf_col = data.col('confidence')
    acc_col = data.col('accuracy')

    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        confidence = group[conf_col].values.astype(float)
        accuracy = group[acc_col].values.astype(float)

        if len(confidence) < 2 or np.std(confidence) == 0 or np.std(accuracy) == 0:
            results.append({'subject': subject, 'phi': np.nan})
            continue

        r = np.corrcoef(confidence, accuracy)[0, 1]
        results.append({'subject': subject, 'phi': round(float(r), 4)})

    return pd.DataFrame(results)


def delta_conf(data, group_by_subject=True):
    """
    ΔConf: difference in mean confidence between correct and error trials.

    ΔConf = mean_confidence(correct) - mean_confidence(incorrect)

    Returns DataFrame with columns: subject, delta_conf
    """
    df = data.raw
    subj = data.col('subject')
    conf_col = data.col('confidence')
    acc_col = data.col('accuracy')

    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        accuracy = group[acc_col].astype(int).values
        confidence = group[conf_col].values.astype(float)

        correct_conf = confidence[accuracy == 1]
        incorrect_conf = confidence[accuracy == 0]

        if len(correct_conf) == 0 or len(incorrect_conf) == 0:
            results.append({'subject': subject, 'delta_conf': np.nan})
            continue

        dc = float(np.mean(correct_conf) - np.mean(incorrect_conf))
        results.append({'subject': subject, 'delta_conf': round(dc, 4)})

    return pd.DataFrame(results)
