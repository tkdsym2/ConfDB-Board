"""Model-based metacognitive measures: meta-noise and meta-uncertainty.

meta-noise: Metacognition noise from the noisy readout model
    (Maniscalco & Lau, 2016). Adds Gaussian noise to the internal evidence
    before the confidence judgment.

meta-uncertainty: From the CASANDRE model (Shekhar & Rahnev, 2024).
    Confidence = scaling * |evidence - criterion| + bias + noise.
    meta-uncertainty is the noise parameter σ.
"""

import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import minimize
from scipy.integrate import quad


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


def meta_noise_fit(data, sdt_df=None, group_by_subject=True):
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
    from .meta_d import prepare_ratings

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

        nR_S1, nR_S2, n_conf = prepare_ratings(group, stim, resp, conf_col)

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


def meta_uncertainty_fit(data, sdt_df=None, group_by_subject=True):
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
