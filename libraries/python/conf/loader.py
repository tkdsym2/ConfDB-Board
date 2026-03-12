"""Data loader with automatic column role detection for the Confidence Database."""

import re
import pandas as pd

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


def detect_columns(df):
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


def load(df, compute_accuracy=True):
    """
    Wrap a raw DataFrame with auto-detected column mappings.

    Args:
        df: pandas DataFrame (already loaded by the WebWorker)
        compute_accuracy: if True and no accuracy column found,
                         compute it from stimulus == response (for binary tasks)

    Returns:
        ConfData instance
    """
    columns = detect_columns(df)

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
