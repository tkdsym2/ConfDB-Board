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

const analysis = {
  id: 5,
  name: 'Metacognitive Measures',
  description: 'Compute all 17 metacognitive measures (Shekhar & Rahnev, 2025): meta-d\', AUC2, Gamma, Phi, ΔConf, plus Ratio, Difference, and model-based variants. Requires binary classification task with confidence ratings.',
  category: 'metacognition',
  difficulty: 'basic',
  python_template: `# Metacognitive Measures
# Dataset: #{dataset_id} — {paper_author} ({paper_year})
# Shekhar & Rahnev (2025) — 17 measures of metacognition
#
# Set include_model_based=False to skip slower model fitting:
#   metacog_results = metacog.compute_all(data, include_model_based=False)

metacog_results = metacog.compute_all(data)
metacog.print_summary(metacog_results)

# Per-subject results are also available as a DataFrame:
# print(metacog_results.to_string())
`,
  r_template: null,
  required_columns: ['confidence', 'accuracy'],
  sort_order: 5,
}

// Tags: primary = confidence_accuracy (metacognition), also dprime (sdt) since SDT measures are included
const tagMappings = [
  { tag_id: 'confidence_accuracy', is_primary: true },
  { tag_id: 'dprime', is_primary: false },
  { tag_id: 'type2_auc', is_primary: false },
]

async function main() {
  // Check if analysis 5 already exists
  const { data: existing } = await supabase
    .from('analyses')
    .select('id')
    .eq('id', 5)
    .single()

  if (existing) {
    console.log('Analysis 5 already exists, updating...')
    const { error } = await supabase
      .from('analyses')
      .update(analysis)
      .eq('id', 5)
    if (error) {
      console.error('Update error:', error)
      process.exit(1)
    }
    // Delete existing tags and re-insert
    await supabase.from('analysis_tags').delete().eq('analysis_id', 5)
  } else {
    console.log('Inserting analysis 5...')
    const { error } = await supabase.from('analyses').insert(analysis)
    if (error) {
      console.error('Insert error:', error)
      process.exit(1)
    }
  }

  // Insert analysis_tags
  const tagRows = tagMappings.map(m => ({
    analysis_id: 5,
    tag_id: m.tag_id,
    is_primary: m.is_primary,
  }))

  const { error: tagErr } = await supabase.from('analysis_tags').insert(tagRows)
  if (tagErr) {
    console.error('Tag insert error:', tagErr)
    process.exit(1)
  }

  console.log('Done! Seeded Metacognitive Measures analysis (id=5) with', tagRows.length, 'tags')
}

main()
