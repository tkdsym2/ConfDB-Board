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

// Parse paper_info.csv
const csvPath = resolve(__dirname, '..', 'datasheet', 'paper_info.csv')
const csvContent = readFileSync(csvPath, 'utf-8')
const lines = csvContent.split('\n').slice(1) // skip header

// Simple CSV parser that handles quoted fields
function parseCSVLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

const updates = []
for (const line of lines) {
  if (!line.trim()) continue
  const fields = parseCSVLine(line)
  const [datasetId, paperTitle, paperDoi] = fields
  if (!datasetId) continue
  if (!paperTitle && !paperDoi) continue // skip datasets with no paper info
  updates.push({
    id: datasetId,
    paper_title: paperTitle || null,
    paper_doi: paperDoi || null,
  })
}

console.log(`Found ${updates.length} datasets with paper info to update`)

// Update in batches
let successCount = 0
let errorCount = 0

for (const update of updates) {
  const { error } = await supabase
    .from('datasets')
    .update({
      paper_title: update.paper_title,
      paper_doi: update.paper_doi,
    })
    .eq('id', update.id)

  if (error) {
    console.error(`Error updating ${update.id}:`, error.message)
    errorCount++
  } else {
    successCount++
  }
}

console.log(`Done: ${successCount} updated, ${errorCount} errors`)
