-- Seed Metacognitive Measures analysis (id=5)
-- Run this in the Supabase SQL Editor

-- Insert analysis (upsert: update if exists)
INSERT INTO analyses (id, name, description, category, difficulty, python_template, r_template, required_columns, sort_order)
VALUES (
  '5',
  'Metacognitive Measures',
  'Compute all 17 metacognitive measures (Shekhar & Rahnev, 2025): meta-d'', AUC2, Gamma, Phi, ΔConf, plus Ratio, Difference, and model-based variants.',
  'metacognition',
  'basic',
  '# Metacognitive Measures
# Dataset: #{dataset_id} — {paper_author} ({paper_year})
# Shekhar & Rahnev (2025) — 17 measures of metacognition
#
# Set include_model_based=False to skip slower model fitting:
#   metacog_results = metacog.compute_all(data, include_model_based=False)

metacog_results = metacog.compute_all(data)
metacog.print_summary(metacog_results)

# Per-subject results are also available as a DataFrame:
# print(metacog_results.to_string())
',
  NULL,
  ARRAY['confidence', 'accuracy'],
  5
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  difficulty = EXCLUDED.difficulty,
  python_template = EXCLUDED.python_template,
  required_columns = EXCLUDED.required_columns,
  sort_order = EXCLUDED.sort_order;

-- Insert analysis_tags
DELETE FROM analysis_tags WHERE analysis_id = '5';

INSERT INTO analysis_tags (analysis_id, tag_id, is_primary) VALUES
  ('5', 'confidence_accuracy', true),
  ('5', 'dprime', false),
  ('5', 'type2_auc', false);

-- Verify
SELECT a.id, a.name, a.category, array_agg(at.tag_id) as tags
FROM analyses a
LEFT JOIN analysis_tags at ON at.analysis_id = a.id
WHERE a.id = '5'
GROUP BY a.id, a.name, a.category;
