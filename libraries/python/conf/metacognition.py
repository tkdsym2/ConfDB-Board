"""Metacognition metrics (Type 2 ROC / AUC) for the Confidence Database."""

import numpy as np
import pandas as pd


def type2_roc(data, group_by_subject=True):
    """
    Compute Type 2 ROC points for each subject.

    For each confidence threshold, compute:
    - Type 2 hit rate: P(high confidence | correct)
    - Type 2 false alarm rate: P(high confidence | incorrect)

    Returns:
        DataFrame with: subject, threshold, type2_hit_rate, type2_fa_rate
    """
    df = data.raw
    subj = data.col('subject')
    conf = data.col('confidence')
    acc_col = data.col('accuracy')

    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        conf_levels = sorted(group[conf].unique())
        correct = group[acc_col].astype(int)
        confidence = group[conf]

        for threshold in conf_levels:
            high_conf = confidence >= threshold

            n_correct_high = (correct[high_conf] == 1).sum()
            n_correct_total = (correct == 1).sum()
            n_incorrect_high = (correct[high_conf] == 0).sum()
            n_incorrect_total = (correct == 0).sum()

            t2_hr = n_correct_high / max(n_correct_total, 1)
            t2_fr = n_incorrect_high / max(n_incorrect_total, 1)

            results.append({
                'subject': subject,
                'threshold': threshold,
                'type2_hit_rate': round(t2_hr, 4),
                'type2_fa_rate': round(t2_fr, 4),
            })

    return pd.DataFrame(results)


def type2_auc(data, group_by_subject=True):
    """
    Compute Type 2 AUC (AUROC2) per subject using trapezoidal integration.

    Returns:
        DataFrame with: subject, type2_auc
    """
    roc_df = type2_roc(data, group_by_subject)
    results = []

    for subject, group in roc_df.groupby('subject'):
        pts = group.sort_values('type2_fa_rate')
        x = pts['type2_fa_rate'].values
        y = pts['type2_hit_rate'].values

        # Add (0,0) and (1,1) endpoints
        x = np.concatenate([[0], x, [1]])
        y = np.concatenate([[0], y, [1]])

        auc = np.trapezoid(y, x)
        results.append({'subject': subject, 'type2_auc': round(auc, 4)})

    return pd.DataFrame(results)
