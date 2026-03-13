"""Compute all 17 metacognitive measures and format output."""

import numpy as np
import pandas as pd

from .raw import gamma, phi, delta_conf
from .meta_d import meta_d
from .ideal import sdt_expected
from .model_based import meta_noise_fit, meta_uncertainty_fit


def compute_all(data, include_model_based=True, verbose=True):
    """
    Compute all 17 metacognitive measures per subject.

    Measures
    --------
    Raw (5):        meta_d, auc2, gamma, phi, delta_conf
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
    gamma_df = gamma(data, verbose=verbose)
    phi_df = phi(data, verbose=verbose)
    dconf_df = delta_conf(data, verbose=verbose)

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
        md_df = meta_d(data, verbose=verbose)
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
        expected_df = sdt_expected(data, sdt_df_for_expected, verbose=verbose)
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
                mn_df = meta_noise_fit(data, sdt_df_for_expected, verbose=verbose)
                result = result.merge(mn_df, on='subject', how='outer')
            except Exception as e:
                if verbose:
                    print(f"       meta-noise failed: {e}")
                result['meta_noise'] = np.nan

            if verbose:
                print(f"[6/6] Fitting CASANDRE model ({n_subj} subjects)...")
            try:
                mu_df = meta_uncertainty_fit(data, sdt_df_for_expected, verbose=verbose)
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


def print_summary(results):
    """
    Print a formatted summary of metacognitive measures.

    Parameters
    ----------
    results : DataFrame from compute_all()
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
