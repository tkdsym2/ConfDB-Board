"""SDT ideal observer simulation for computing expected metacognitive measures.

Given a subject's d' and criterion, simulates an ideal SDT observer whose
confidence perfectly reflects the strength of internal evidence. Computes
expected AUC2, Gamma, Phi, and ΔConf under this ideal model, which serve
as the denominator for Ratio measures and the subtrahend for Diff measures.
"""

import numpy as np
import pandas as pd
from scipy.stats import norm


def _simulate_ideal_observer(dprime, crit_position, n_conf_levels, n_samples=50000):
    """
    Simulate an ideal SDT observer and compute expected measures.

    The ideal observer uses |x - criterion| as confidence, binned into
    n_conf_levels equally-populated bins.

    Parameters
    ----------
    dprime : float — Type 1 d'
    crit_position : float — criterion position on x-axis (k = -z(FAR))
    n_conf_levels : int — number of confidence levels to bin into
    n_samples : int — samples per stimulus class

    Returns
    -------
    dict with keys: auc2, gamma, phi, delta_conf
    """
    rng = np.random.RandomState(42)

    # Generate internal signals
    noise = rng.randn(n_samples)             # S1 ~ N(0, 1)
    signal = rng.randn(n_samples) + dprime   # S2 ~ N(d', 1)

    # Type 1 responses
    resp_noise = (noise > crit_position).astype(int)   # 1 = S2, 0 = S1
    resp_signal = (signal > crit_position).astype(int)

    # Accuracy
    acc_noise = 1 - resp_noise      # correct = responded S1 for noise
    acc_signal = resp_signal        # correct = responded S2 for signal

    # Confidence: |distance from criterion|
    conf_noise = np.abs(noise - crit_position)
    conf_signal = np.abs(signal - crit_position)

    # Bin confidence into n_conf_levels using quantiles
    all_conf = np.concatenate([conf_noise, conf_signal])
    if n_conf_levels > 1:
        quantiles = np.linspace(0, 1, n_conf_levels + 1)[1:-1]
        thresholds = np.quantile(all_conf, quantiles)

        def bin_conf(vals):
            return np.searchsorted(thresholds, vals) + 1  # 1 to n_conf_levels

        conf_noise_binned = bin_conf(conf_noise)
        conf_signal_binned = bin_conf(conf_signal)
    else:
        conf_noise_binned = np.ones(n_samples, dtype=int)
        conf_signal_binned = np.ones(n_samples, dtype=int)

    # Combine all trials
    accuracy = np.concatenate([acc_noise, acc_signal])
    confidence = np.concatenate([conf_noise_binned, conf_signal_binned])

    # --- Compute expected measures ---

    # AUC2 (Type 2 AUROC)
    correct = accuracy == 1
    conf_levels = sorted(np.unique(confidence))
    roc_x, roc_y = [0.0], [0.0]
    for thr in conf_levels:
        high_conf = confidence >= thr
        n_correct_total = np.sum(correct)
        n_incorrect_total = len(correct) - n_correct_total
        t2_hr = np.sum(correct & high_conf) / max(n_correct_total, 1)
        t2_fr = np.sum(~correct & high_conf) / max(n_incorrect_total, 1)
        roc_x.append(t2_fr)
        roc_y.append(t2_hr)
    roc_x.append(1.0)
    roc_y.append(1.0)
    roc_x, roc_y = np.array(roc_x), np.array(roc_y)
    order = np.argsort(roc_x)
    auc2 = float(np.trapezoid(roc_y[order], roc_x[order]))

    # Gamma (Goodman-Kruskal)
    correct_conf = confidence[correct].astype(float)
    incorrect_conf = confidence[~correct].astype(float)
    if len(correct_conf) > 0 and len(incorrect_conf) > 0:
        correct_sorted = np.sort(correct_conf)
        n_correct = len(correct_sorted)
        right_idx = np.searchsorted(correct_sorted, incorrect_conf, side='right')
        left_idx = np.searchsorted(correct_sorted, incorrect_conf, side='left')
        C = float(np.sum(n_correct - right_idx))
        D = float(np.sum(left_idx))
        gamma_val = (C - D) / (C + D) if (C + D) > 0 else 0.0
    else:
        gamma_val = 0.0

    # Phi (Pearson correlation)
    if np.std(confidence) > 0 and np.std(accuracy) > 0:
        phi_val = float(np.corrcoef(confidence.astype(float), accuracy.astype(float))[0, 1])
    else:
        phi_val = 0.0

    # ΔConf
    if len(correct_conf) > 0 and len(incorrect_conf) > 0:
        delta_conf_val = float(np.mean(correct_conf) - np.mean(incorrect_conf))
    else:
        delta_conf_val = 0.0

    return {
        'auc2': round(auc2, 4),
        'gamma': round(gamma_val, 4),
        'phi': round(phi_val, 4),
        'delta_conf': round(delta_conf_val, 4),
    }


def sdt_expected(data, sdt_df=None, group_by_subject=True, n_samples=50000):
    """
    Compute SDT-expected metacognitive measures per subject.

    Uses each subject's observed d' and criterion to simulate an ideal
    SDT observer, then computes expected AUC2, Gamma, Phi, and ΔConf.

    Parameters
    ----------
    data : ConfData instance
    sdt_df : DataFrame with columns [subject, dprime, criterion] (from conf.dprime)
             If None, will be computed internally using conf.dprime().
    group_by_subject : bool
    n_samples : int — simulation samples per stimulus class

    Returns
    -------
    DataFrame with columns: subject, expected_auc2, expected_gamma,
                            expected_phi, expected_delta_conf
    """
    if sdt_df is None:
        # Assume conf is available in global scope (Pyodide sandbox)
        sdt_df = conf.dprime(data)  # noqa: F821

    n_conf_levels = data.raw[data.col('confidence')].nunique()

    results = []
    for _, row in sdt_df.iterrows():
        d = row['dprime']
        c = row.get('criterion', 0.0)

        if np.isnan(d) or np.isnan(c):
            results.append({
                'subject': row['subject'],
                'expected_auc2': np.nan,
                'expected_gamma': np.nan,
                'expected_phi': np.nan,
                'expected_delta_conf': np.nan,
            })
            continue

        # Convert criterion c to position on x-axis: k = c + d/2
        # In our SDT: S1~N(0,1), S2~N(d,1), c = -(z(HR)+z(FAR))/2
        # k = -z(FAR) = c + d/2
        crit_pos = c + d / 2.0

        expected = _simulate_ideal_observer(d, crit_pos, n_conf_levels, n_samples)
        results.append({
            'subject': row['subject'],
            'expected_auc2': expected['auc2'],
            'expected_gamma': expected['gamma'],
            'expected_phi': expected['phi'],
            'expected_delta_conf': expected['delta_conf'],
        })

    return pd.DataFrame(results)
