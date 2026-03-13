"""meta-d' computation via Maximum Likelihood Estimation.

Implements the MLE approach for fitting meta-d' (Maniscalco & Lau, 2012).
meta-d' is the d' value that provides the best fit to the observed Type 2 ROC,
under the assumption that confidence ratings reflect an ideal SDT observer.
"""

import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import minimize


def prepare_ratings(sub_df, stim_col, resp_col, conf_col):
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


def fit_meta_d_MLE(nR_S1, nR_S2):
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
    dict with keys: meta_d, d, c, logL, success
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
    x0[0] = d1  # meta_d init = d'

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


def meta_d(data, group_by_subject=True):
    """
    Compute meta-d' per subject via MLE.

    Requires stimulus and response columns (binary classification task).

    Returns DataFrame with columns: subject, meta_d, dprime, criterion
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

        nR_S1, nR_S2, n_conf = prepare_ratings(group, stim, resp, conf_col)
        fit = fit_meta_d_MLE(nR_S1, nR_S2)

        results.append({
            'subject': subject,
            'meta_d': fit['meta_d'],
            'dprime': fit['d'],
            'criterion': fit['c'],
        })

    return pd.DataFrame(results)
