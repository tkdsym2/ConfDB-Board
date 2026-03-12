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

const templates = [
  {
    id: 1,
    python_template: `import pandas as pd

data = conf.load(df)
subj = data.subject_col
conf_col = data.confidence_col

grouped = df.groupby(subj)[conf_col].agg(['mean', 'std', 'count'])
print(grouped.round(3))
print(f"\\nGrand mean confidence: {df[conf_col].mean():.3f}")
print(f"Grand std: {df[conf_col].std():.3f}")
print(f"N subjects: {df[subj].nunique()}")`,
  },
  {
    id: 2,
    python_template: `import matplotlib.pyplot as plt

data = conf.load(df)
sdt_result = conf.dprime(data)
print(sdt_result.to_string(index=False))
print(f"\\nMean d': {sdt_result['dprime'].mean():.3f} (SD = {sdt_result['dprime'].std():.3f})")
print(f"Mean criterion: {sdt_result['criterion'].mean():.3f}")

conf.plot_dprime_distribution(sdt_result)
plt.show()`,
  },
  {
    id: 3,
    python_template: `import matplotlib.pyplot as plt

data = conf.load(df)
conf.plot_confidence_accuracy(data)
plt.show()

# Also print the raw values
conf_col = data.confidence_col
acc_col = data.col('accuracy')
grouped = data.raw.groupby(conf_col)[acc_col].agg(['mean', 'count'])
print(grouped.round(3))`,
  },
  {
    id: 4,
    python_template: `import matplotlib.pyplot as plt

data = conf.load(df)
conf.plot_rt_distribution(data, n_subjects=6)
plt.show()`,
  },
]

async function main() {
  for (const t of templates) {
    console.log(`Updating analysis ${t.id}...`)
    const { error } = await supabase
      .from('analyses')
      .update({ python_template: t.python_template })
      .eq('id', t.id)
    if (error) {
      console.error(`  Error:`, error)
    } else {
      console.log(`  OK`)
    }
  }
  console.log('Done!')
}

main()
