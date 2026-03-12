import { useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useDataset, useDatasetTags } from '../hooks/useDatasets'
import { supabaseUrl } from '../lib/supabase'

const TASK_TYPE_LABELS = {
  binary_classification: 'Binary Classification',
  binary_response_graded_stimulus: 'Graded Stimulus',
  ambiguous_binary: 'Ambiguous Binary',
  multi_class: 'Multi-class',
  continuous_estimation: 'Continuous Estimation',
}

const TAG_CATEGORY_ORDER = ['basic', 'sdt', 'metacognition', 'rt']
const TAG_CATEGORY_LABELS = {
  basic: 'Basic',
  sdt: 'SDT',
  metacognition: 'Metacognition',
  rt: 'RT',
}

function formatBytes(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DatasetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: dataset, isLoading, error } = useDataset(id)
  const { data: datasetTags } = useDatasetTags(id)

  const tagsByCategory = useMemo(() => {
    if (!datasetTags) return {}
    const grouped = {}
    for (const dt of datasetTags) {
      const tag = dt.tags
      if (!tag) continue
      const cat = tag.category
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push({ name: tag.name, note: dt.note })
    }
    return grouped
  }, [datasetTags])

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <p className="text-gray-500">Loading dataset...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <p className="text-red-600">Error: {error.message}</p>
        <Link to="/datasets" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          Back to catalog
        </Link>
      </div>
    )
  }

  if (!dataset) return null

  const d = dataset
  const csvUrl = d.storage_path
    ? `${supabaseUrl}/storage/v1/object/public/csv-files/${d.storage_path}`
    : null

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Back link */}
      <Link to="/datasets" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        &larr; Back to catalog
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold mb-1">Dataset #{d.id}</h1>
            <p className="text-lg text-gray-700">
              {d.paper_author}{d.paper_year ? ` (${d.paper_year})` : ''}
            </p>
            {d.paper_journal && (
              <p className="text-sm text-gray-500 italic">{d.paper_journal}</p>
            )}
            {d.paper_title && (
              <p className="text-sm text-gray-600 mt-1">
                {d.paper_doi ? (
                  <a
                    href={d.paper_doi}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {d.paper_title}
                  </a>
                ) : (
                  <span>{d.paper_title}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {csvUrl && (
              <a
                href={csvUrl}
                download
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
              >
                Download CSV
              </a>
            )}
            <button
              onClick={() => navigate(`/sandbox?dataset=${d.id}`)}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
            >
              Open in Sandbox
            </button>
          </div>
        </div>

        {/* Domain & task type badges */}
        <div className="flex gap-2 mt-3">
          <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700">
            {d.domain}
          </span>
          <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            {TASK_TYPE_LABELS[d.task_type] || d.task_type}
          </span>
        </div>

        {d.task_description && (
          <p className="mt-3 text-sm text-gray-600">{d.task_description}</p>
        )}
      </div>

      {/* Metadata */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        <Row label="Participants" value={d.n_participants?.toLocaleString()} />
        <Row label="Total trials" value={d.n_trials_total?.toLocaleString()} />
        <Row
          label="Confidence scale"
          value={
            <span>
              {d.confidence_scale || '—'}
              {d.confidence_min != null && d.confidence_max != null && (
                <span className="text-gray-500"> ({d.confidence_min}–{d.confidence_max})</span>
              )}
              <span className="text-gray-500">
                {' · '}{d.conf_is_discrete ? 'discrete' : 'continuous'}
              </span>
              {d.conf_n_levels != null && (
                <span className="text-gray-500"> · {d.conf_n_levels} levels</span>
              )}
            </span>
          }
        />
        <Row
          label="Reaction time"
          value={
            d.has_rt
              ? <span>Yes{d.rt_type ? ` (${d.rt_type})` : ''}{d.has_confidence_rt ? ' · confidence RT available' : ''}</span>
              : 'No'
          }
        />
        <Row label="Multi-task" value={d.is_multi_task ? 'Yes' : 'No'} />
        <Row label="Has condition" value={d.has_condition ? 'Yes' : 'No'} />
        <Row label="CSV size" value={formatBytes(d.csv_size_bytes)} />

        {/* Tags */}
        <div className="px-4 py-3">
          <dt className="text-xs font-medium text-gray-500 uppercase mb-2">Tags</dt>
          <dd>
            {TAG_CATEGORY_ORDER.map((cat) => {
              const tags = tagsByCategory[cat]
              if (!tags || tags.length === 0) return null
              return (
                <div key={cat} className="mb-1.5 last:mb-0">
                  <span className="text-[11px] font-medium text-gray-400 uppercase mr-1.5">
                    {TAG_CATEGORY_LABELS[cat]}
                  </span>
                  {tags.map((t) => (
                    <span
                      key={t.name}
                      className="inline-block mr-1.5 mb-0.5 px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                      title={t.note || undefined}
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              )
            })}
            {(!datasetTags || datasetTags.length === 0) && (
              <span className="text-sm text-gray-400">No tags</span>
            )}
          </dd>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="px-4 py-3 flex items-baseline gap-4">
      <dt className="text-xs font-medium text-gray-500 uppercase w-36 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900">{value ?? '—'}</dd>
    </div>
  )
}
