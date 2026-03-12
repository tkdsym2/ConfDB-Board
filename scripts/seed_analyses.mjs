import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Read .env manually
const envPath = resolve(__dirname, '..', '.env')
const envContent = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envContent.split('\n')) {
  const [key, ...rest] = line.split('=')
  if (key && rest.length) env[key.trim()] = rest.join('=').trim()
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const analyses = [
  {
    id: 1,
    name: 'Basic Descriptive Statistics',
    description: 'Compute per-subject mean, standard deviation, and count of confidence ratings, plus the grand mean across all trials.',
    category: 'basic',
    difficulty: 'basic',
    python_template: `import pandas as pd

# Dataset: #{dataset_id} — {paper_author} ({paper_year})

grouped = df.groupby('Subj_idx')['Confidence'].agg(['mean', 'std', 'count'])
print(grouped.round(3))
print(f"\\nGrand mean: {df['Confidence'].mean():.3f}")
print(f"Grand std:  {df['Confidence'].std():.3f}")
print(f"N subjects: {df['Subj_idx'].nunique()}")`,
    r_template: null,
    required_columns: ['confidence'],
    sort_order: 1,
  },
  {
    id: 2,
    name: "Signal Detection: d' and criterion",
    description: 'Compute d-prime and criterion per subject using signal detection theory with log-linear correction to avoid infinite values.',
    category: 'sdt',
    difficulty: 'basic',
    python_template: `import pandas as pd
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
print(f"\\nMean d':        {results_df['d_prime'].mean():.3f} (SD={results_df['d_prime'].std():.3f})")
print(f"Mean criterion: {results_df['criterion'].mean():.3f} (SD={results_df['criterion'].std():.3f})")`,
    r_template: null,
    required_columns: ['stimulus', 'response'],
    sort_order: 2,
  },
  {
    id: 3,
    name: 'Confidence-Accuracy Correlation',
    description: 'Plot the calibration curve showing mean accuracy at each confidence level. A well-calibrated observer has higher accuracy at higher confidence.',
    category: 'metacognition',
    difficulty: 'basic',
    python_template: `import pandas as pd
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
ax.set_xlabel('Confidence')
ax.set_ylabel('Mean Accuracy')
ax.set_title('Confidence-Accuracy Calibration')
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()`,
    r_template: null,
    required_columns: ['confidence', 'accuracy'],
    sort_order: 3,
  },
  {
    id: 4,
    name: 'RT Distribution',
    description: 'Visualize the distribution of decision reaction times across all trials with summary statistics.',
    category: 'rt',
    difficulty: 'basic',
    python_template: `import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

# Dataset: #{dataset_id} — {paper_author} ({paper_year})
# Reaction time distribution

rt = df['RT_decision'].dropna()

print("RT summary statistics:")
print(rt.describe().round(3))
print(f"\\nMedian: {rt.median():.3f}")

fig, axes = plt.subplots(1, 2, figsize=(10, 4))

# Histogram
axes[0].hist(rt, bins=50, edgecolor='white', alpha=0.8)
axes[0].axvline(rt.median(), color='red', linestyle='--', label=f'median={rt.median():.2f}')
axes[0].set_xlabel('Reaction Time (s)')
axes[0].set_ylabel('Count')
axes[0].set_title('RT Distribution')
axes[0].legend()
axes[0].grid(True, alpha=0.3)

# Log RT histogram
log_rt = np.log(rt[rt > 0])
axes[1].hist(log_rt, bins=50, edgecolor='white', alpha=0.8, color='#2ca02c')
axes[1].set_xlabel('log(RT)')
axes[1].set_ylabel('Count')
axes[1].set_title('log(RT) Distribution')
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.show()`,
    r_template: null,
    required_columns: ['rt_decision'],
    sort_order: 4,
  },
]

// Tag mappings: analysis index -> [{ tag_id, is_primary }]
const tagMappings = [
  [{ tag_id: 'mean_confidence', is_primary: true }],
  [{ tag_id: 'dprime', is_primary: true }, { tag_id: 'criterion', is_primary: false }],
  [{ tag_id: 'confidence_accuracy', is_primary: true }],
  [{ tag_id: 'rt_distribution', is_primary: true }],
]

async function main() {
  // Delete existing
  console.log('Deleting existing analysis_tags...')
  const { error: delTags } = await supabase.from('analysis_tags').delete().neq('analysis_id', 0)
  if (delTags) console.log('  (may be empty):', delTags.message)

  console.log('Deleting existing analyses...')
  const { error: delAnalyses } = await supabase.from('analyses').delete().neq('id', 0)
  if (delAnalyses) console.log('  (may be empty):', delAnalyses.message)

  // Insert analyses
  console.log('Inserting analyses...')
  const { data: inserted, error: insertErr } = await supabase
    .from('analyses')
    .insert(analyses)
    .select('id, name, sort_order')
  if (insertErr) {
    console.error('Insert error:', insertErr)
    process.exit(1)
  }
  console.log('Inserted:', inserted.map(a => `${a.id}: ${a.name}`))

  // Sort by sort_order to match tagMappings index
  inserted.sort((a, b) => a.sort_order - b.sort_order)

  // Insert analysis_tags
  const analysisTagRows = []
  for (let i = 0; i < inserted.length; i++) {
    for (const mapping of tagMappings[i]) {
      analysisTagRows.push({
        analysis_id: inserted[i].id,
        tag_id: mapping.tag_id,
        is_primary: mapping.is_primary,
      })
    }
  }

  console.log('Inserting analysis_tags...')
  const { error: tagErr } = await supabase.from('analysis_tags').insert(analysisTagRows)
  if (tagErr) {
    console.error('Tag insert error:', tagErr)
    process.exit(1)
  }

  console.log('Done! Inserted', inserted.length, 'analyses and', analysisTagRows.length, 'analysis_tags')
}

main()
