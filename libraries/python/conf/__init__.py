"""conf — Analysis library for the Confidence Database."""

from .loader import load, detect_columns, ConfData
from .sdt import dprime
from .metacognition import type2_roc, type2_auc
from .viz import plot_confidence_accuracy, plot_dprime_distribution, plot_rt_distribution

__all__ = [
    'load',
    'detect_columns',
    'ConfData',
    'dprime',
    'type2_roc',
    'type2_auc',
    'plot_confidence_accuracy',
    'plot_dprime_distribution',
    'plot_rt_distribution',
]
