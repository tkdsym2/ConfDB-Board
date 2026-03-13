# metacog_bundle.py — Auto-generated single-file bundle for Pyodide injection
# Built from libraries/python/metacog/ by scripts/build_metacog_bundle.py
# DO NOT EDIT — modify the source modules and re-run the build script.
#
# Metacognitive measures (Shekhar & Rahnev, 2025)
# Assumes `conf` class is already available in global scope.
#
# Usage inside the sandbox:
#   results = metacog.compute_all(data)
#   metacog.print_summary(results)

import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import minimize
from scipy.integrate import quad


# ---------------------------------------------------------------------------
# raw.py — Gamma, Phi, ΔConf
# ---------------------------------------------------------------------------

def _gamma(data, group_by_subject=True):
    """
    Goodman-Kruskal _gamma correlation between confidence and accuracy.

    Gamma = (C - D) / (C + D) where C = concordant pairs, D = discordant pairs.
    For binary accuracy x ordinal confidence, a concordant pair is one where
    the correct trial has higher confidence than the incorrect trial.

    Returns DataFrame with columns: subject, _gamma
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


def _phi(data, group_by_subject=True):
    """
    Pearson correlation (Phi) between confidence and accuracy.

    Returns DataFrame with columns: subject, _phi
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


def _delta_conf(data, group_by_subject=True):
    """
    ΔConf: difference in mean confidence between correct and error trials.

    ΔConf = mean_confidence(correct) - mean_confidence(incorrect)

    Returns DataFrame with columns: subject, _delta_conf
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


# ---------------------------------------------------------------------------
# meta_d.py — meta-d' MLE
# ---------------------------------------------------------------------------

def _prepare_ratings(sub_df, stim_col, resp_col, conf_col):
    """
    Convert trial-level data to nR_S1 and nR_S2 count arrays.

    Format: [high_conf_S1, ..., low_conf_S1, low_conf_S2, ..., high_conf_S2]
    Length: 2 * n_confidence_levels

    Parameters
    ----------
    sub_df : DataFrame for a single subject
    stim_col, resp_col, conf_col : column names

    Returns
    -------
    nR_S1 : array — counts for S1 (noise) stimulus trials
    nR_S2 : array — counts for S2 (signal) stimulus trials
    n_conf : int — number of confidence levels
    """
    conf_levels = sorted(sub_df[conf_col].unique())
    n_conf = len(conf_levels)
    conf_map = {c: i for i, c in enumerate(conf_levels)}

    stim_vals = sorted(sub_df[stim_col].unique())
    s1_val = stim_vals[0]

    nR_S1 = np.zeros(2 * n_conf)
    nR_S2 = np.zeros(2 * n_conf)

    conf_idx = sub_df[conf_col].map(conf_map).values
    is_resp_s1 = (sub_df[resp_col] == s1_val).values
    is_stim_s1 = (sub_df[stim_col] == s1_val).values

    # S1 response: high conf at index 0, low conf at index n_conf-1
    # S2 response: low conf at index n_conf, high conf at index 2*n_conf-1
    bin_idx = np.where(is_resp_s1, n_conf - 1 - conf_idx, n_conf + conf_idx)

    for i in range(len(sub_df)):
        if is_stim_s1[i]:
            nR_S1[bin_idx[i]] += 1
        else:
            nR_S2[bin_idx[i]] += 1

    return nR_S1, nR_S2, n_conf


def _neg_log_likelihood(params, nR_S1, nR_S2, nRatings, c1):
    """
    Negative log-likelihood for the meta-d' model.

    Parameters
    ----------
    params : array
        [md_param, delta_s2_0, ..., delta_s2_{K-2}, delta_s1_0, ..., delta_s1_{K-2}]
        where K = nRatings. Criteria are parameterized as cumulative sums of
        exp(delta) to ensure ordering.
    nR_S1, nR_S2 : count arrays (length 2*nRatings)
    nRatings : number of confidence levels
    c1 : Type 1 criterion (position on x-axis)
    """
    K = nRatings
    md_param = params[0]

    # Reconstruct criteria from unconstrained parameters
    if K > 1:
        # S2 side: criteria > c1, increasing
        delta_s2 = params[1:K]
        t2c_s2 = c1 + np.cumsum(np.exp(delta_s2))

        # S1 side: criteria < c1, decreasing
        delta_s1 = params[K:2 * K - 1]
        t2c_s1 = c1 - np.cumsum(np.exp(delta_s1))
    else:
        t2c_s2 = np.array([])
        t2c_s1 = np.array([])

    eps = 1e-10
    log_L = 0.0

    # --- S2 response side (indices K to 2K-1) ---
    # Boundaries for confidence bins (low conf to high conf)
    bounds_s2 = np.concatenate([[c1], t2c_s2, [np.inf]])

    # P(bin j | S2 stimulus, resp=S2)
    p_s2_given_S2 = norm.cdf(md_param - bounds_s2[:-1]) - norm.cdf(md_param - bounds_s2[1:])
    norm_s2_S2 = norm.cdf(md_param - c1)  # P(x > c1 | S2) under meta-d' model
    p_s2_given_S2 = np.clip(p_s2_given_S2 / max(norm_s2_S2, eps), eps, 1 - eps)

    # P(bin j | S1 stimulus, resp=S2) — S1 ~ N(0, 1)
    p_s2_given_S1 = norm.cdf(-bounds_s2[:-1]) - norm.cdf(-bounds_s2[1:])
    norm_s2_S1 = norm.cdf(-c1)  # P(x > c1 | S1)
    p_s2_given_S1 = np.clip(p_s2_given_S1 / max(norm_s2_S1, eps), eps, 1 - eps)

    for j in range(K):
        idx = K + j
        if nR_S2[idx] > 0:
            log_L += nR_S2[idx] * np.log(p_s2_given_S2[j])
        if nR_S1[idx] > 0:
            log_L += nR_S1[idx] * np.log(p_s2_given_S1[j])

    # --- S1 response side (indices K-1 down to 0) ---
    # Boundaries from low conf (near c1) to high conf (far below c1)
    bounds_s1 = np.concatenate([[-np.inf], np.flip(t2c_s1), [c1]])

    # P(bin j | S2 stimulus, resp=S1)
    p_s1_given_S2 = norm.cdf(md_param - bounds_s1[:-1]) - norm.cdf(md_param - bounds_s1[1:])
    norm_s1_S2 = 1.0 - norm.cdf(md_param - c1)  # P(x < c1 | S2)
    p_s1_given_S2 = np.clip(p_s1_given_S2 / max(norm_s1_S2, eps), eps, 1 - eps)

    # P(bin j | S1 stimulus, resp=S1) — S1 ~ N(0, 1)
    p_s1_given_S1 = norm.cdf(-bounds_s1[:-1]) - norm.cdf(-bounds_s1[1:])
    norm_s1_S1 = norm.cdf(c1)  # P(x < c1 | S1)
    p_s1_given_S1 = np.clip(p_s1_given_S1 / max(norm_s1_S1, eps), eps, 1 - eps)

    for j in range(K):
        # Map: bin j (low to high conf) corresponds to nR index K-1-j (high to low conf)
        idx = K - 1 - j
        if nR_S2[idx] > 0:
            log_L += nR_S2[idx] * np.log(p_s1_given_S2[j])
        if nR_S1[idx] > 0:
            log_L += nR_S1[idx] * np.log(p_s1_given_S1[j])

    return -log_L


def _fit_meta_d_MLE(nR_S1, nR_S2):
    """
    Fit meta-d' using maximum likelihood estimation.

    Parameters
    ----------
    nR_S1 : array of length 2*K
        Response counts for S1 (noise) stimulus trials.
    nR_S2 : array of length 2*K
        Response counts for S2 (signal) stimulus trials.

    Returns
    -------
    dict with keys: _meta_d, d, c, logL, success
    """
    nR_S1 = np.array(nR_S1, dtype=float)
    nR_S2 = np.array(nR_S2, dtype=float)
    K = len(nR_S1) // 2

    if K < 2:
        return {'meta_d': np.nan, 'd': np.nan, 'c': np.nan,
                'logL': np.nan, 'success': False}

    # Add small count to avoid log(0) — log-linear correction
    adj = 1.0 / (2 * K)
    nR_S1_adj = nR_S1.copy()
    nR_S2_adj = nR_S2.copy()
    nR_S1_adj[nR_S1_adj == 0] = adj
    nR_S2_adj[nR_S2_adj == 0] = adj

    # Type 1 d' and criterion from marginal response counts
    HR = np.sum(nR_S2_adj[K:]) / np.sum(nR_S2_adj)
    FAR = np.sum(nR_S1_adj[K:]) / np.sum(nR_S1_adj)

    HR = np.clip(HR, 0.001, 0.999)
    FAR = np.clip(FAR, 0.001, 0.999)

    d1 = norm.ppf(HR) - norm.ppf(FAR)
    c1 = -norm.ppf(FAR)  # Criterion on x-axis (S1 ~ N(0,1))

    # Initial parameters
    n_params = 2 * K - 1
    x0 = np.zeros(n_params)
    x0[0] = d1  # _meta_d init = d'

    # Initial criteria spacing: spread evenly
    if K > 1:
        spacing = max(abs(d1), 1.0) / K
        x0[1:K] = np.log(spacing)        # delta_s2
        x0[K:2 * K - 1] = np.log(spacing)  # delta_s1

    # Optimize
    try:
        result = minimize(
            _neg_log_likelihood,
            x0,
            args=(nR_S1_adj, nR_S2_adj, K, c1),
            method='Nelder-Mead',
            options={'maxiter': 5000, 'xatol': 1e-6, 'fatol': 1e-6}
        )
        meta_d_val = result.x[0]
        logL = -result.fun
        success = result.success
    except Exception:
        meta_d_val = np.nan
        logL = np.nan
        success = False

    return {
        'meta_d': round(float(meta_d_val), 4) if not np.isnan(meta_d_val) else np.nan,
        'd': round(float(d1), 4),
        'c': round(float(c1), 4),
        'logL': float(logL) if not np.isnan(logL) else np.nan,
        'success': success,
    }


def _meta_d(data, group_by_subject=True):
    """
    Compute meta-d' per subject via MLE.

    Requires stimulus and response columns (binary classification task).

    Returns DataFrame with columns: subject, _meta_d, dprime, criterion
    """
    df = data.raw
    subj = data.col('subject')
    stim = data.col('stimulus')
    resp = data.col('response')
    conf_col = data.col('confidence')

    stim_vals = sorted(df[stim].unique())
    if len(stim_vals) != 2:
        raise ValueError(
            f"meta-d' requires exactly 2 stimulus values, got {len(stim_vals)}"
        )

    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        if group[conf_col].nunique() < 2:
            results.append({
                'subject': subject, 'meta_d': np.nan,
                'dprime': np.nan, 'criterion': np.nan,
            })
            continue

        nR_S1, nR_S2, n_conf = _prepare_ratings(group, stim, resp, conf_col)
        fit = _fit_meta_d_MLE(nR_S1, nR_S2)

        results.append({
            'subject': subject,
            'meta_d': fit['meta_d'],
            'dprime': fit['d'],
            'criterion': fit['c'],
        })

    return pd.DataFrame(results)


# ---------------------------------------------------------------------------
# ideal.py — SDT ideal observer expected values
# ---------------------------------------------------------------------------

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


def _sdt_expected(data, sdt_df=None, group_by_subject=True, n_samples=50000):
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


# ---------------------------------------------------------------------------
# model_based.py — meta-noise and meta-uncertainty
# ---------------------------------------------------------------------------

def _noisy_type2_probs(sigma_meta, dprime, crit_pos, n_conf, side='s2'):
    """
    Compute expected Type 2 response probabilities under the noisy readout model.

    The observer's confidence is based on x_meta = x + ε, where ε ~ N(0, σ²).
    Confidence criteria are placed at equal quantiles of the noisy distribution.

    Parameters
    ----------
    sigma_meta : float — metacognitive noise
    dprime : float — Type 1 d'
    crit_pos : float — criterion position on x-axis
    n_conf : int — number of confidence levels
    side : 's2' or 's1' — which response side

    Returns
    -------
    probs_signal : array of length n_conf — P(conf_j | S2, resp=side)
    probs_noise : array of length n_conf — P(conf_j | S1, resp=side)
    """
    sigma_total = np.sqrt(1.0 + sigma_meta ** 2)
    eps = 1e-10

    if side == 's2':
        # S2 response: x > crit_pos, confidence increases with x
        # Place criteria at equal quantiles of the truncated noisy distribution
        # For simplicity, use equally spaced criteria above crit_pos
        spacing = max(dprime, 1.0) * 2.0 / n_conf
        t2c = [crit_pos + (i + 1) * spacing for i in range(n_conf - 1)]
        bounds = [crit_pos] + t2c + [np.inf]

        probs_signal = np.zeros(n_conf)
        probs_noise = np.zeros(n_conf)

        for j in range(n_conf):
            lo, hi = bounds[j], bounds[j + 1]
            # P(lo < x_meta < hi | S2, x > crit)
            # = integral_crit^inf P(lo < x+eps < hi) * phi(x - d') dx / P(x>crit|S2)
            def integrand_s2(x, lo=lo, hi=hi):
                p_bin = norm.cdf((hi - x) / max(sigma_meta, eps)) - norm.cdf((lo - x) / max(sigma_meta, eps))
                p_x_s2 = norm.pdf(x - dprime)
                return p_bin * p_x_s2

            def integrand_s1(x, lo=lo, hi=hi):
                p_bin = norm.cdf((hi - x) / max(sigma_meta, eps)) - norm.cdf((lo - x) / max(sigma_meta, eps))
                p_x_s1 = norm.pdf(x)
                return p_bin * p_x_s1

            val_s2, _ = quad(integrand_s2, crit_pos, crit_pos + 10 * sigma_total, limit=50)
            val_s1, _ = quad(integrand_s1, crit_pos, crit_pos + 10 * sigma_total, limit=50)

            probs_signal[j] = val_s2
            probs_noise[j] = val_s1

        # Normalize
        norm_s2 = max(np.sum(probs_signal), eps)
        norm_s1 = max(np.sum(probs_noise), eps)
        probs_signal = np.clip(probs_signal / norm_s2, eps, 1.0)
        probs_noise = np.clip(probs_noise / norm_s1, eps, 1.0)

    else:
        # S1 response: x < crit_pos, confidence increases as x decreases
        spacing = max(dprime, 1.0) * 2.0 / n_conf
        t2c = [crit_pos - (i + 1) * spacing for i in range(n_conf - 1)]
        bounds = [-np.inf] + list(reversed(t2c)) + [crit_pos]

        probs_signal = np.zeros(n_conf)
        probs_noise = np.zeros(n_conf)

        for j in range(n_conf):
            lo, hi = bounds[j], bounds[j + 1]

            def integrand_s2(x, lo=lo, hi=hi):
                p_bin = norm.cdf((hi - x) / max(sigma_meta, eps)) - norm.cdf((lo - x) / max(sigma_meta, eps))
                return p_bin * norm.pdf(x - dprime)

            def integrand_s1(x, lo=lo, hi=hi):
                p_bin = norm.cdf((hi - x) / max(sigma_meta, eps)) - norm.cdf((lo - x) / max(sigma_meta, eps))
                return p_bin * norm.pdf(x)

            val_s2, _ = quad(integrand_s2, crit_pos - 10 * sigma_total, crit_pos, limit=50)
            val_s1, _ = quad(integrand_s1, crit_pos - 10 * sigma_total, crit_pos, limit=50)

            probs_signal[j] = val_s2
            probs_noise[j] = val_s1

        norm_s2 = max(np.sum(probs_signal), eps)
        norm_s1 = max(np.sum(probs_noise), eps)
        probs_signal = np.clip(probs_signal / norm_s2, eps, 1.0)
        probs_noise = np.clip(probs_noise / norm_s1, eps, 1.0)

    return probs_signal, probs_noise


def _meta_noise_nll(sigma_meta, nR_S1, nR_S2, dprime, crit_pos, n_conf):
    """Negative log-likelihood for the noisy readout model."""
    if sigma_meta < 0.01:
        sigma_meta = 0.01

    K = n_conf
    eps = 1e-10
    log_L = 0.0

    # S2 response side
    ps_s2, pn_s2 = _noisy_type2_probs(sigma_meta, dprime, crit_pos, K, 's2')
    for j in range(K):
        idx = K + j
        if nR_S2[idx] > 0:
            log_L += nR_S2[idx] * np.log(max(ps_s2[j], eps))
        if nR_S1[idx] > 0:
            log_L += nR_S1[idx] * np.log(max(pn_s2[j], eps))

    # S1 response side
    ps_s1, pn_s1 = _noisy_type2_probs(sigma_meta, dprime, crit_pos, K, 's1')
    for j in range(K):
        idx = K - 1 - j
        if nR_S2[idx] > 0:
            log_L += nR_S2[idx] * np.log(max(ps_s1[j], eps))
        if nR_S1[idx] > 0:
            log_L += nR_S1[idx] * np.log(max(pn_s1[j], eps))

    return -log_L


def _meta_noise_fit(data, sdt_df=None, group_by_subject=True):
    """
    Fit meta-noise (σ_meta) per subject using the noisy readout model.

    Parameters
    ----------
    data : ConfData instance
    sdt_df : DataFrame with [subject, dprime, criterion] (optional)
    group_by_subject : bool

    Returns
    -------
    DataFrame with columns: subject, meta_noise
    """

    if sdt_df is None:
        sdt_df = conf.dprime(data)  # noqa: F821

    df = data.raw
    subj = data.col('subject')
    stim = data.col('stimulus')
    resp = data.col('response')
    conf_col = data.col('confidence')

    sdt_dict = {row['subject']: row for _, row in sdt_df.iterrows()}
    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        sdt_row = sdt_dict.get(subject)
        if sdt_row is None or np.isnan(sdt_row['dprime']):
            results.append({'subject': subject, 'meta_noise': np.nan})
            continue

        d = sdt_row['dprime']
        c = sdt_row['criterion']
        crit_pos = c + d / 2.0

        if group[conf_col].nunique() < 2:
            results.append({'subject': subject, 'meta_noise': np.nan})
            continue

        nR_S1, nR_S2, n_conf = _prepare_ratings(group, stim, resp, conf_col)

        # Add small count adjustment
        adj = 1.0 / (2 * n_conf)
        nR_S1[nR_S1 == 0] = adj
        nR_S2[nR_S2 == 0] = adj

        try:
            result = minimize(
                _meta_noise_nll,
                x0=[0.5],
                args=(nR_S1, nR_S2, d, crit_pos, n_conf),
                method='Nelder-Mead',
                options={'maxiter': 200, 'xatol': 1e-4}
            )
            sigma = max(result.x[0], 0.0)
            results.append({'subject': subject, 'meta_noise': round(float(sigma), 4)})
        except Exception:
            results.append({'subject': subject, 'meta_noise': np.nan})

    return pd.DataFrame(results)


def _casandre_nll(params, confidence, accuracy, evidence_strength):
    """
    Negative log-likelihood for the CASANDRE model.

    confidence = a * evidence_strength + b + N(0, σ²)

    Parameters
    ----------
    params : [a, b, log_sigma]
    confidence : observed confidence values (float)
    accuracy : not used directly (evidence_strength encodes it)
    evidence_strength : |x - criterion| values (estimated from Type 1 data)
    """
    a, b, log_sigma = params
    sigma = np.exp(log_sigma)
    eps = 1e-10

    predicted = a * evidence_strength + b
    # Log-likelihood of observed confidence given predicted + Gaussian noise
    log_L = -0.5 * np.sum(((confidence - predicted) / max(sigma, eps)) ** 2)
    log_L -= len(confidence) * np.log(max(sigma, eps))

    return -log_L


def _meta_uncertainty_fit(data, sdt_df=None, group_by_subject=True):
    """
    Fit meta-uncertainty per subject using a simplified CASANDRE model.

    CASANDRE: confidence = a * |evidence - criterion| + b + noise
    meta-uncertainty is the fitted noise parameter σ.

    Parameters
    ----------
    data : ConfData instance
    sdt_df : DataFrame with [subject, dprime, criterion, hit_rate, fa_rate]
    group_by_subject : bool

    Returns
    -------
    DataFrame with columns: subject, meta_uncertainty, scaling, bias
    """
    if sdt_df is None:
        sdt_df = conf.dprime(data)  # noqa: F821

    df = data.raw
    subj = data.col('subject')
    stim = data.col('stimulus')
    resp = data.col('response')
    conf_col = data.col('confidence')

    stim_vals = sorted(df[stim].unique())
    s1_val = stim_vals[0]

    sdt_dict = {row['subject']: row for _, row in sdt_df.iterrows()}
    results = []
    groups = df.groupby(subj) if group_by_subject else [('all', df)]

    for subject, group in groups:
        sdt_row = sdt_dict.get(subject)
        if sdt_row is None or np.isnan(sdt_row['dprime']):
            results.append({
                'subject': subject, 'meta_uncertainty': np.nan,
                'scaling': np.nan, 'bias': np.nan,
            })
            continue

        d = sdt_row['dprime']
        c = sdt_row['criterion']
        crit_pos = c + d / 2.0

        confidence = group[conf_col].values.astype(float)
        stim_vals_trial = group[stim].values
        resp_vals = group[resp].values

        # Estimate evidence strength as |z-score of response probability|
        # For each trial, approximate the internal evidence from stimulus identity
        # S2 trials: x ~ N(d', 1), approximate x ≈ d' (mean)
        # S1 trials: x ~ N(0, 1), approximate x ≈ 0 (mean)
        # Evidence strength = |estimated_x - criterion|
        is_s1 = stim_vals_trial == s1_val
        estimated_x = np.where(is_s1, 0.0, d)
        evidence_strength = np.abs(estimated_x - crit_pos)

        if len(confidence) < 3 or np.std(confidence) == 0:
            results.append({
                'subject': subject, 'meta_uncertainty': np.nan,
                'scaling': np.nan, 'bias': np.nan,
            })
            continue

        try:
            # Initial values
            a0 = np.std(confidence) / max(np.std(evidence_strength), 0.1)
            b0 = np.mean(confidence) - a0 * np.mean(evidence_strength)
            sigma0 = np.std(confidence) * 0.5

            result = minimize(
                _casandre_nll,
                x0=[a0, b0, np.log(max(sigma0, 0.01))],
                args=(confidence, None, evidence_strength),
                method='Nelder-Mead',
                options={'maxiter': 1000, 'xatol': 1e-5}
            )

            a_fit, b_fit, log_sigma_fit = result.x
            sigma_fit = np.exp(log_sigma_fit)

            results.append({
                'subject': subject,
                'meta_uncertainty': round(float(sigma_fit), 4),
                'scaling': round(float(a_fit), 4),
                'bias': round(float(b_fit), 4),
            })
        except Exception:
            results.append({
                'subject': subject, 'meta_uncertainty': np.nan,
                'scaling': np.nan, 'bias': np.nan,
            })

    return pd.DataFrame(results)


# ---------------------------------------------------------------------------
# summary.py — Compute all measures and format output
# ---------------------------------------------------------------------------

def _compute_all(data, include_model_based=True, verbose=True):
    """
    Compute all 17 metacognitive measures per subject.

    Measures
    --------
    Raw (5):        _meta_d, auc2, _gamma, _phi, _delta_conf
    Ratio (5):      m_ratio, auc2_ratio, gamma_ratio, phi_ratio, delta_conf_ratio
    Difference (5): m_diff, auc2_diff, gamma_diff, phi_diff, delta_conf_diff
    Model-based (2): meta_noise, meta_uncertainty

    Parameters
    ----------
    data : ConfData instance (from conf.load(df))
    include_model_based : bool — whether to compute meta-noise and meta-uncertainty
                          (these are slower due to numerical integration)
    verbose : bool — print progress messages

    Returns
    -------
    DataFrame with one row per subject and columns for all measures
    """
    # Ensure accuracy is available (compute from stimulus==response if needed)
    if not data.has('accuracy') and data.has('stimulus') and data.has('response'):
        data.raw = data.raw.copy()
        data.raw['_accuracy'] = (
            data.raw[data.col('stimulus')] == data.raw[data.col('response')]
        ).astype(int)
        data.columns['accuracy'] = '_accuracy'

    has_sdt = data.has('stimulus') and data.has('response')
    n_subj = data.raw[data.col('subject')].nunique()

    if verbose:
        print(f"Dataset: {n_subj} subjects, {len(data.raw)} trials")
        print("")

    # --- Step 1: Measures that only need accuracy + confidence ---
    if verbose:
        print("[1/6] Computing raw measures (Gamma, Phi, ΔConf)...")
    gamma_df = _gamma(data)
    phi_df = _phi(data)
    dconf_df = _delta_conf(data)

    # AUC2 — use conf library
    if verbose:
        print("[2/6] Computing AUC2...")
    auc2_df = conf.type2_auc(data)  # noqa: F821

    # Start building result
    result = gamma_df.merge(phi_df, on='subject', how='outer')
    result = result.merge(dconf_df, on='subject', how='outer')
    result = result.merge(auc2_df, on='subject', how='outer')

    # --- Step 2: SDT-dependent measures ---
    if has_sdt:
        if verbose:
            print(f"[3/6] Computing meta-d' (MLE fitting, {n_subj} subjects)...")
        md_df = _meta_d(data)
        if verbose:
            n_ok = md_df['meta_d'].notna().sum()
            print(f"       meta-d' fitted for {n_ok}/{n_subj} subjects")

        # Get d' and criterion from meta-d' fitting (uses same Type 1 data)
        result = result.merge(
            md_df[['subject', 'meta_d', 'dprime', 'criterion']],
            on='subject', how='outer'
        )

        # SDT expected values
        if verbose:
            print(f"[4/6] Simulating ideal SDT observer ({n_subj} subjects)...")
        sdt_df_for_expected = md_df[['subject', 'dprime', 'criterion']].copy()
        expected_df = _sdt_expected(data, sdt_df_for_expected)
        result = result.merge(expected_df, on='subject', how='outer')

        # --- Ratio measures ---
        result['m_ratio'] = result['meta_d'] / result['dprime'].replace(0, np.nan)
        result['auc2_ratio'] = result['type2_auc'] / result['expected_auc2'].replace(0, np.nan)
        result['gamma_ratio'] = result['gamma'] / result['expected_gamma'].replace(0, np.nan)
        result['phi_ratio'] = result['phi'] / result['expected_phi'].replace(0, np.nan)
        result['delta_conf_ratio'] = result['delta_conf'] / result['expected_delta_conf'].replace(0, np.nan)

        # --- Difference measures ---
        result['m_diff'] = result['meta_d'] - result['dprime']
        result['auc2_diff'] = result['type2_auc'] - result['expected_auc2']
        result['gamma_diff'] = result['gamma'] - result['expected_gamma']
        result['phi_diff'] = result['phi'] - result['expected_phi']
        result['delta_conf_diff'] = result['delta_conf'] - result['expected_delta_conf']

        # Round ratio and diff measures
        ratio_diff_cols = [
            'm_ratio', 'auc2_ratio', 'gamma_ratio', 'phi_ratio', 'delta_conf_ratio',
            'm_diff', 'auc2_diff', 'gamma_diff', 'phi_diff', 'delta_conf_diff',
        ]
        for col in ratio_diff_cols:
            if col in result.columns:
                result[col] = result[col].round(4)

        # --- Model-based measures ---
        if include_model_based:
            if verbose:
                print(f"[5/6] Fitting meta-noise model ({n_subj} subjects)...")
            try:
                mn_df = _meta_noise_fit(data, sdt_df_for_expected)
                result = result.merge(mn_df, on='subject', how='outer')
            except Exception as e:
                if verbose:
                    print(f"       meta-noise failed: {e}")
                result['meta_noise'] = np.nan

            if verbose:
                print(f"[6/6] Fitting CASANDRE model ({n_subj} subjects)...")
            try:
                mu_df = _meta_uncertainty_fit(data, sdt_df_for_expected)
                result = result.merge(
                    mu_df[['subject', 'meta_uncertainty']],
                    on='subject', how='outer'
                )
            except Exception as e:
                if verbose:
                    print(f"       meta-uncertainty failed: {e}")
                result['meta_uncertainty'] = np.nan
        else:
            result['meta_noise'] = np.nan
            result['meta_uncertainty'] = np.nan
    else:
        if verbose:
            print("[3/6] No stimulus/response columns — skipping SDT-dependent measures.")
        # Fill SDT-dependent columns with NaN
        for col in ['meta_d', 'dprime', 'criterion',
                     'm_ratio', 'auc2_ratio', 'gamma_ratio', 'phi_ratio', 'delta_conf_ratio',
                     'm_diff', 'auc2_diff', 'gamma_diff', 'phi_diff', 'delta_conf_diff',
                     'meta_noise', 'meta_uncertainty']:
            result[col] = np.nan

    if verbose:
        print("Done.\n")

    return result


def _print_summary(results):
    """
    Print a formatted summary of metacognitive measures.

    Parameters
    ----------
    results : DataFrame from _compute_all()
    """
    n = len(results)
    print(f"{'=' * 56}")
    print(f"  Metacognitive Measures")
    print(f"  N subjects = {n}")
    print(f"{'=' * 56}")

    def _fmt(col_name, display_name=None, width=20):
        if display_name is None:
            display_name = col_name
        if col_name not in results.columns:
            return
        vals = results[col_name].dropna()
        if len(vals) == 0:
            print(f"  {display_name:<{width}}:  N/A")
        else:
            m = vals.mean()
            s = vals.std()
            valid = len(vals)
            suffix = f"  (n={valid})" if valid < n else ""
            print(f"  {display_name:<{width}}: {m:>8.4f} +/- {s:.4f}{suffix}")

    print("\n--- Raw Measures ---")
    _fmt('meta_d', "meta-d'")
    _fmt('type2_auc', 'AUC2')
    _fmt('gamma', 'Gamma')
    _fmt('phi', 'Phi')
    _fmt('delta_conf', 'ΔConf')

    has_sdt = 'dprime' in results.columns and results['dprime'].notna().any()
    if has_sdt:
        print("\n--- Ratio Measures (raw / SDT-expected) ---")
        _fmt('m_ratio', 'M-Ratio')
        _fmt('auc2_ratio', 'AUC2-Ratio')
        _fmt('gamma_ratio', 'Gamma-Ratio')
        _fmt('phi_ratio', 'Phi-Ratio')
        _fmt('delta_conf_ratio', 'ΔConf-Ratio')

        print("\n--- Difference Measures (raw - SDT-expected) ---")
        _fmt('m_diff', 'M-Diff')
        _fmt('auc2_diff', 'AUC2-Diff')
        _fmt('gamma_diff', 'Gamma-Diff')
        _fmt('phi_diff', 'Phi-Diff')
        _fmt('delta_conf_diff', 'ΔConf-Diff')

        print("\n--- Model-Based Measures ---")
        _fmt('meta_noise', 'meta-noise')
        _fmt('meta_uncertainty', 'meta-uncertainty')

    print(f"\n{'=' * 56}")
    print("Per-subject results are in the `metacog_results` variable.")


# ---------------------------------------------------------------------------
# Public namespace — all functions accessible as metacog.xxx()
# ---------------------------------------------------------------------------

class metacog:
    """Namespace for metacognitive measure functions."""

    # Raw measures
    gamma = staticmethod(_gamma)
    phi = staticmethod(_phi)
    delta_conf = staticmethod(_delta_conf)

    # meta-d'
    prepare_ratings = staticmethod(_prepare_ratings)
    meta_d = staticmethod(_meta_d)

    # SDT expected values
    sdt_expected = staticmethod(_sdt_expected)

    # Model-based
    meta_noise = staticmethod(_meta_noise_fit)
    meta_uncertainty = staticmethod(_meta_uncertainty_fit)

    # Summary
    compute_all = staticmethod(_compute_all)
    print_summary = staticmethod(_print_summary)
