"""Signal Detection Theory computations for the Confidence Database."""

import numpy as np
import pandas as pd
from scipy.stats import norm


def dprime(data, group_by_subject=True, correction='loglinear'):
    """
    Compute d' and criterion for each subject.

    Args:
        data: ConfData instance
        group_by_subject: if True, compute per subject
        correction: 'loglinear' (default) or None

    Returns:
        DataFrame with columns: subject, dprime, criterion, hit_rate, fa_rate,
                                n_signal, n_noise
    """
    df = data.raw
    subj = data.col('subject')
    stim = data.col('stimulus')
    resp = data.col('response')

    stim_vals = sorted(df[stim].unique())
    if len(stim_vals) != 2:
        raise ValueError(
            f"d' requires exactly 2 stimulus values, got {len(stim_vals)}: {stim_vals}"
        )

    signal_val = stim_vals[1]  # Higher value = signal

    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        signal_trials = group[group[stim] == signal_val]
        noise_trials = group[group[stim] != signal_val]

        n_signal = len(signal_trials)
        n_noise = len(noise_trials)

        hits = (signal_trials[resp] == signal_val).sum()
        fas = (noise_trials[resp] == signal_val).sum()

        if correction == 'loglinear':
            hit_rate = (hits + 0.5) / (n_signal + 1)
            fa_rate = (fas + 0.5) / (n_noise + 1)
        else:
            hit_rate = hits / max(n_signal, 1)
            fa_rate = fas / max(n_noise, 1)
            hit_rate = np.clip(hit_rate, 0.001, 0.999)
            fa_rate = np.clip(fa_rate, 0.001, 0.999)

        d = norm.ppf(hit_rate) - norm.ppf(fa_rate)
        c = -0.5 * (norm.ppf(hit_rate) + norm.ppf(fa_rate))

        results.append({
            'subject': subject,
            'dprime': round(d, 4),
            'criterion': round(c, 4),
            'hit_rate': round(hit_rate, 4),
            'fa_rate': round(fa_rate, 4),
            'n_signal': n_signal,
            'n_noise': n_noise,
        })

    return pd.DataFrame(results)
