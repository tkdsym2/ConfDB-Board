"""Basic visualizations for the Confidence Database."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np


def plot_confidence_accuracy(data, ax=None):
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


def plot_dprime_distribution(sdt_result, ax=None):
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


def plot_rt_distribution(data, n_subjects=6, ax=None):
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
