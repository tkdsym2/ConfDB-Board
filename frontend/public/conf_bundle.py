# conf_bundle.py — Auto-generated single-file bundle for Pyodide injection
# Built from libraries/python/conf/ by scripts/build_conf_bundle.py
# DO NOT EDIT — modify the source modules and re-run the build script.
#
# Usage inside the sandbox:
#   data = conf.load(df)
#   print(data.describe())
#   result = conf.dprime(data)
#   conf.plot_dprime_distribution(result)

import re
import numpy as np
import pandas as pd
from scipy.stats import norm
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


# ---------------------------------------------------------------------------
# loader.py — Column detection and ConfData wrapper
# ---------------------------------------------------------------------------

# Patterns ordered by specificity — first match wins per role.
# Based on actual column names found across 180 datasets in column_mapping.csv.
COLUMN_PATTERNS = {
    'subject': re.compile(
        r'^(Subj_idx|subj_idx|subject_id|Subject|subject|Participant|participant|sub|SN)$',
        re.IGNORECASE,
    ),
    'stimulus': re.compile(
        r'^(Stimulus|stimulus|stim)'
        r'(_(col|let|Color|Motion|1|2))?$',
        re.IGNORECASE,
    ),
    'response': re.compile(
        r'^(Response|response|resp)'
        r'(_(col|let|Color|Motion|key))?$',
        re.IGNORECASE,
    ),
    'confidence': re.compile(
        r'^(Confidence|confidence|conf)'
        r'(_(col|let|Color|Motion|1|2))?$',
        re.IGNORECASE,
    ),
    'accuracy': re.compile(
        r'^(Accuracy|accuracy|Correct|correct|ACC|acc)'
        r'(_(col|let|Color|Motion|1|2))?$',
        re.IGNORECASE,
    ),
    'rt_decision': re.compile(
        r'^(RT_dec|rt_dec|RT_decision|rt_decision)'
        r'(_(col|let|Color|Motion))?$',
        re.IGNORECASE,
    ),
    'rt_confidence': re.compile(
        r'^(RT_conf|rt_conf|RT_confidence|rt_confidence|conf_rt)'
        r'(_(col|let))?$',
        re.IGNORECASE,
    ),
    'rt_combined': re.compile(
        r'^(RT_decConf|rt_decConf|RT_decConf_1|RT_decConf_2)$',
        re.IGNORECASE,
    ),
    'rt_generic': re.compile(
        r'^(RT|rt)$',
    ),
    'difficulty': re.compile(
        r'^(Difficulty|difficulty|Diff|diff|coherence|Coherence'
        r'|Contrast|contrast|DotDiff|Dot_diff|NoiseLevel)'
        r'(_(col|let|Color|Motion))?$',
        re.IGNORECASE,
    ),
    'condition': re.compile(
        r'^(Condition|condition|cond|Task|task|Block|block'
        r'|Session|session|Group|group)$',
        re.IGNORECASE,
    ),
    'error': re.compile(
        r'^(Error|error|ErrorDirection|ErrorDirectionJudgment)$',
        re.IGNORECASE,
    ),
}


class ConfData:
    """Wrapper around a DataFrame with auto-detected column mappings."""

    def __init__(self, df, columns):
        self.raw = df
        self.columns = columns

    def col(self, role):
        """Get the actual column name for a given role. Raises KeyError if not found."""
        name = self.columns.get(role)
        if name is None:
            available = [k for k, v in self.columns.items() if v is not None]
            raise KeyError(
                f"Column role '{role}' not found in this dataset. Available: {available}"
            )
        return name

    def has(self, role):
        """Check if a column role exists."""
        return self.columns.get(role) is not None

    def get(self, role):
        """Get the column Series for a role."""
        return self.raw[self.col(role)]

    @property
    def subject_col(self):
        return self.col('subject')

    @property
    def stimulus_col(self):
        return self.col('stimulus')

    @property
    def response_col(self):
        return self.col('response')

    @property
    def confidence_col(self):
        return self.col('confidence')

    def describe(self):
        """Print a summary of detected columns."""
        lines = ["Detected column mappings:"]
        for role, col_name in self.columns.items():
            if col_name is not None:
                lines.append(f"  {role:18s} -> {col_name}")
        unmapped = [role for role, v in self.columns.items() if v is None]
        if unmapped:
            lines.append(f"  Not found: {', '.join(unmapped)}")
        return '\n'.join(lines)


def _detect_columns(df):
    """Auto-detect column roles from a DataFrame's column names."""
    columns = {role: None for role in COLUMN_PATTERNS}
    used = set()

    for role, pattern in COLUMN_PATTERNS.items():
        for col_name in df.columns:
            if col_name not in used and pattern.match(col_name):
                columns[role] = col_name
                used.add(col_name)
                break

    # Resolve RT: if rt_decision is missing, fall back to rt_combined or rt_generic
    if columns['rt_decision'] is None:
        if columns['rt_combined'] is not None:
            pass  # keep rt_combined as a separate role
        elif columns['rt_generic'] is not None:
            columns['rt_decision'] = columns['rt_generic']
            columns['rt_generic'] = None

    return columns


def _load(df, compute_accuracy=True):
    """
    Wrap a raw DataFrame with auto-detected column mappings.

    Args:
        df: pandas DataFrame (already loaded by the WebWorker)
        compute_accuracy: if True and no accuracy column found,
                         compute it from stimulus == response (for binary tasks)

    Returns:
        ConfData instance
    """
    columns = _detect_columns(df)

    # Compute accuracy if missing and possible
    if compute_accuracy and columns['accuracy'] is None:
        stim_col = columns.get('stimulus')
        resp_col = columns.get('response')
        if stim_col and resp_col:
            stim = df[stim_col]
            resp = df[resp_col]
            if stim.nunique() <= 2 and resp.nunique() <= 2:
                df = df.copy()
                df['_accuracy'] = (stim == resp).astype(int)
                columns['accuracy'] = '_accuracy'

    return ConfData(df, columns)


# ---------------------------------------------------------------------------
# sdt.py — Signal Detection Theory
# ---------------------------------------------------------------------------

def _dprime(data, group_by_subject=True, correction='loglinear'):
    """
    Compute d' and criterion for each subject.

    Args:
        data: ConfData instance
        group_by_subject: if True, compute per subject
        correction: 'loglinear' (default) or None

    Returns:
        DataFrame with columns: subject, _dprime, criterion, hit_rate, fa_rate,
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


# ---------------------------------------------------------------------------
# metacognition.py — Type 2 ROC and AUC
# ---------------------------------------------------------------------------

def _type2_roc(data, group_by_subject=True):
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


def _type2_auc(data, group_by_subject=True):
    """
    Compute Type 2 AUC (AUROC2) per subject using trapezoidal integration.

    Returns:
        DataFrame with: subject, _type2_auc
    """
    roc_df = _type2_roc(data, group_by_subject)
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


# ---------------------------------------------------------------------------
# viz.py — Visualization helpers
# ---------------------------------------------------------------------------

def _plot_confidence_accuracy(data, ax=None):
    """Plot mean accuracy as a function of confidence level."""
    df = data.raw
    conf = data.col('confidence')
    acc = data.col('accuracy')

    grouped = df.groupby(conf)[acc].agg(['mean', 'sem', 'count'])

    if ax is None:
        fig, ax = plt.subplots(figsize=(7, 5))

    ax.errorbar(grouped.index, grouped['mean'], yerr=grouped['sem'],
                marker='o', capsize=3, linewidth=1.5)
    ax.set_xlabel('Confidence')
    ax.set_ylabel('Accuracy')
    ax.set_title('Confidence\u2013Accuracy Association')
    ax.set_ylim(0, 1.05)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    return ax


def _plot_dprime_distribution(sdt_result, ax=None):
    """Plot histogram of d' values across subjects."""
    if ax is None:
        fig, ax = plt.subplots(figsize=(7, 5))

    ax.hist(sdt_result['dprime'], bins='auto', edgecolor='white', alpha=0.8)
    ax.axvline(sdt_result['dprime'].mean(), color='red', linestyle='--',
               label=f"Mean = {sdt_result['dprime'].mean():.2f}")
    ax.set_xlabel("d'")
    ax.set_ylabel('Count')
    ax.set_title("Distribution of d' across subjects")
    ax.legend()
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    return ax


def _plot_rt_distribution(data, n_subjects=6, ax=None):
    """Plot RT histograms for a sample of subjects."""
    df = data.raw
    subj = data.col('subject')

    # Find which RT column is available
    rt_col = None
    for role in ['rt_decision', 'rt_combined', 'rt_generic']:
        if data.has(role):
            rt_col = data.col(role)
            break
    if rt_col is None:
        raise ValueError("No RT column found in this dataset")

    subjects = df[subj].unique()[:n_subjects]
    n = len(subjects)
    cols = min(n, 3)
    rows = (n + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(4 * cols, 3 * rows))
    if n == 1:
        axes = np.array([axes])
    axes = np.array(axes).flatten()

    for i, s in enumerate(subjects):
        sub_data = df[df[subj] == s][rt_col].dropna()
        axes[i].hist(sub_data, bins=30, edgecolor='white', alpha=0.8)
        axes[i].set_title(f'Subject {s}', fontsize=10)
        axes[i].set_xlabel('RT (s)')

    for j in range(i + 1, len(axes)):
        axes[j].set_visible(False)

    fig.suptitle('RT Distributions', fontsize=12)
    plt.tight_layout()
    return fig


# ---------------------------------------------------------------------------
# Public namespace — all functions accessible as conf.xxx()
# ---------------------------------------------------------------------------

class conf:
    """Namespace for all conf library functions."""

    # Loader
    load = staticmethod(_load)
    detect_columns = staticmethod(_detect_columns)
    ConfData = ConfData

    # Signal Detection Theory
    dprime = staticmethod(_dprime)

    # Metacognition
    type2_roc = staticmethod(_type2_roc)
    type2_auc = staticmethod(_type2_auc)

    # Visualization
    plot_confidence_accuracy = staticmethod(_plot_confidence_accuracy)
    plot_dprime_distribution = staticmethod(_plot_dprime_distribution)
    plot_rt_distribution = staticmethod(_plot_rt_distribution)
