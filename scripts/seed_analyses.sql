-- Seed 4 basic analysis templates into the analyses table
-- Run against Supabase SQL Editor

-- Clear existing data (idempotent)
DELETE FROM analysis_tags;
DELETE FROM analyses;

-- Insert analyses
INSERT INTO analyses (id, name, description, category, difficulty, python_template, r_template, required_columns, sort_order)
VALUES
(1,
 'Basic Descriptive Statistics',
 'Compute per-subject mean, standard deviation, and count of confidence ratings, plus the grand mean across all trials.',
 'basic',
 'basic',
 $tmpl$import pandas as pd

# Dataset: #{dataset_id} — {paper_author} ({paper_year})

grouped = df.groupby('Subj_idx')['Confidence'].agg(['mean', 'std', 'count'])
print(grouped.round(3))
print(f"\nGrand mean: {df['Confidence'].mean():.3f}")
print(f"Grand std:  {df['Confidence'].std():.3f}")
print(f"N subjects: {df['Subj_idx'].nunique()}")
$tmpl$,
 NULL,
 '{confidence}',
 1),

(2,
 'Signal Detection: d'' and criterion',
 'Compute d-prime and criterion per subject using signal detection theory with log-linear correction to avoid infinite values.',
 'sdt',
 'basic',
 $tmpl$import pandas as pd
import numpy as np
from scipy.stats import norm

# Dataset: #{dataset_id} — {paper_author} ({paper_year})
# Compute d' and criterion per subject (log-linear correction)

results = []
for subj, g in df.groupby('Subj_idx'):
    signal = g[g['Stimulus'] == 1]
    noise = g[g['Stimulus'] == 0]

    # Log-linear correction: add 0.5 to counts, add 1 to totals
    hit_rate = (signal['Response'].sum() + 0.5) / (len(signal) + 1)
    fa_rate = (noise['Response'].sum() + 0.5) / (len(noise) + 1)

    d_prime = norm.ppf(hit_rate) - norm.ppf(fa_rate)
    criterion = -0.5 * (norm.ppf(hit_rate) + norm.ppf(fa_rate))

    results.append({
        'subject': subj,
        'd_prime': round(d_prime, 3),
        'criterion': round(criterion, 3),
        'hit_rate': round(hit_rate, 3),
        'fa_rate': round(fa_rate, 3)
    })

results_df = pd.DataFrame(results)
print(results_df.to_string(index=False))
print(f"\nMean d':        {results_df['d_prime'].mean():.3f} (SD={results_df['d_prime'].std():.3f})")
print(f"Mean criterion: {results_df['criterion'].mean():.3f} (SD={results_df['criterion'].std():.3f})")
$tmpl$,
 NULL,
 '{stimulus,response}',
 2),

(3,
 'Confidence-Accuracy Correlation',
 'Plot the calibration curve showing mean accuracy at each confidence level. A well-calibrated observer has higher accuracy at higher confidence.',
 'metacognition',
 'basic',
 $tmpl$import pandas as pd
import matplotlib.pyplot as plt

# Dataset: #{dataset_id} — {paper_author} ({paper_year})
# Confidence-accuracy calibration curve

cal = df.groupby('Confidence')['Accuracy'].agg(['mean', 'sem', 'count']).reset_index()
cal.columns = ['Confidence', 'Accuracy', 'SEM', 'Count']

print("Calibration table:")
print(cal.round(3).to_string(index=False))

fig, ax = plt.subplots(figsize=(6, 4))
ax.errorbar(cal['Confidence'], cal['Accuracy'], yerr=cal['SEM'],
            fmt='o-', capsize=3, markersize=5)
ax.plot([cal['Confidence'].min(), cal['Confidence'].max()],
        [cal['Accuracy'].min(), cal['Accuracy'].max()],
        '--', color='gray', alpha=0.5, label='perfect calibration')
ax.set_xlabel('Confidence')
ax.set_ylabel('Mean Accuracy')
ax.set_title('Confidence-Accuracy Calibration')
ax.legend()
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()
$tmpl$,
 NULL,
 '{confidence,accuracy}',
 3),

(4,
 'RT Distribution',
 'Visualize the distribution of decision reaction times across all trials with summary statistics.',
 'rt',
 'basic',
 $tmpl$import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

# Dataset: #{dataset_id} — {paper_author} ({paper_year})
# Reaction time distribution

rt = df['RT_decision'].dropna()

print("RT summary statistics:")
print(rt.describe().round(3))
print(f"\nMedian: {rt.median():.3f}")

fig, axes = plt.subplots(1, 2, figsize=(10, 4))

# Histogram
axes[0].hist(rt, bins=50, edgecolor='white', alpha=0.8)
axes[0].axvline(rt.median(), color='red', linestyle='--', label=f'median={rt.median():.2f}')
axes[0].set_xlabel('Reaction Time (s)')
axes[0].set_ylabel('Count')
axes[0].set_title('RT Distribution')
axes[0].legend()
axes[0].grid(True, alpha=0.3)

# Log RT histogram (often more normal)
log_rt = np.log(rt[rt > 0])
axes[1].hist(log_rt, bins=50, edgecolor='white', alpha=0.8, color='#2ca02c')
axes[1].set_xlabel('log(RT)')
axes[1].set_ylabel('Count')
axes[1].set_title('log(RT) Distribution')
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.show()
$tmpl$,
 NULL,
 '{rt_decision}',
 4);

-- Insert analysis_tags (link analyses to their tags by tag ID)
INSERT INTO analysis_tags (analysis_id, tag_id, is_primary) VALUES
  (1, 'mean_confidence', true),
  (2, 'dprime', true),
  (2, 'criterion', false),
  (3, 'confidence_accuracy', true),
  (4, 'rt_distribution', true);
