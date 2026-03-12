-- Update analysis templates to use the conf library
-- Run against Supabase SQL Editor

-- 1. Basic Descriptive Statistics
UPDATE analyses SET python_template = $tmpl$import pandas as pd

data = conf.load(df)
subj = data.subject_col
conf_col = data.confidence_col

grouped = df.groupby(subj)[conf_col].agg(['mean', 'std', 'count'])
print(grouped.round(3))
print(f"\nGrand mean confidence: {df[conf_col].mean():.3f}")
print(f"Grand std: {df[conf_col].std():.3f}")
print(f"N subjects: {df[subj].nunique()}")$tmpl$
WHERE id = 1;

-- 2. Signal Detection: d' and criterion
UPDATE analyses SET python_template = $tmpl$import matplotlib.pyplot as plt

data = conf.load(df)
sdt_result = conf.dprime(data)
print(sdt_result.to_string(index=False))
print(f"\nMean d': {sdt_result['dprime'].mean():.3f} (SD = {sdt_result['dprime'].std():.3f})")
print(f"Mean criterion: {sdt_result['criterion'].mean():.3f}")

conf.plot_dprime_distribution(sdt_result)
plt.show()$tmpl$
WHERE id = 2;

-- 3. Confidence-Accuracy Correlation
UPDATE analyses SET python_template = $tmpl$import matplotlib.pyplot as plt

data = conf.load(df)
conf.plot_confidence_accuracy(data)
plt.show()

# Also print the raw values
conf_col = data.confidence_col
acc_col = data.col('accuracy')
grouped = data.raw.groupby(conf_col)[acc_col].agg(['mean', 'count'])
print(grouped.round(3))$tmpl$
WHERE id = 3;

-- 4. RT Distribution
UPDATE analyses SET python_template = $tmpl$import matplotlib.pyplot as plt

data = conf.load(df)
conf.plot_rt_distribution(data, n_subjects=6)
plt.show()$tmpl$
WHERE id = 4;
