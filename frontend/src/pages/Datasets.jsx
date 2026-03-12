import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useDatasets, useTagCounts } from '../hooks/useDatasets'

const DOMAINS = ['Perception', 'Memory', 'Cognitive', 'Mixed', 'Motor']

const TASK_TYPES = [
  { value: 'binary_classification', label: 'Binary' },
  { value: 'binary_response_graded_stimulus', label: 'Graded Stim' },
  { value: 'ambiguous_binary', label: 'Ambiguous' },
  { value: 'multi_class', label: 'Multi-class' },
  { value: 'continuous_estimation', label: 'Continuous' },
]

const TAG_CATEGORY_ORDER = ['basic', 'sdt', 'metacognition', 'rt']

const TAG_CATEGORY_LABELS = {
  basic: 'Basic',
  sdt: 'SDT',
  metacognition: 'Metacognition',
  rt: 'RT',
}

export default function Datasets() {
  const { data: datasets, isLoading, error } = useDatasets()
  const { data: tagCounts } = useTagCounts()

  const [search, setSearch] = useState('')
  const [selectedDomains, setSelectedDomains] = useState([])
  const [selectedTaskTypes, setSelectedTaskTypes] = useState([])
  const [selectedTags, setSelectedTags] = useState([])

  const tagsByCategory = useMemo(() => {
    if (!tagCounts) return {}
    const grouped = {}
    for (const tag of tagCounts) {
      const cat = tag.category
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(tag)
    }
    return grouped
  }, [tagCounts])

  const filtered = useMemo(() => {
    if (!datasets) return []
    return datasets.filter((d) => {
      // Search filter
      if (search) {
        const q = search.toLowerCase()
        const matchesId = String(d.id).includes(q)
        const matchesAuthor = d.paper_author?.toLowerCase().includes(q)
        const matchesDesc = d.task_description?.toLowerCase().includes(q)
        const matchesTitle = d.paper_title?.toLowerCase().includes(q)
        if (!matchesId && !matchesAuthor && !matchesDesc && !matchesTitle) return false
      }
      // Domain filter
      if (selectedDomains.length > 0 && !selectedDomains.includes(d.domain)) {
        return false
      }
      // Task type filter
      if (selectedTaskTypes.length > 0 && !selectedTaskTypes.includes(d.task_type)) {
        return false
      }
      // Tag filter — dataset must have ALL selected tags
      if (selectedTags.length > 0) {
        const datasetTagNames = d.tag_names || []
        for (const tagName of selectedTags) {
          if (!datasetTagNames.includes(tagName)) return false
        }
      }
      return true
    })
  }, [datasets, search, selectedDomains, selectedTaskTypes, selectedTags])

  function toggleInList(list, setList, value) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto py-12 px-4">
        <p className="text-gray-500">Loading datasets...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto py-12 px-4">
        <p className="text-red-600">Error loading datasets: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-bold">Dataset Catalog</h1>
        <span className="text-sm text-gray-500">
          {filtered.length} of {datasets.length} datasets
        </span>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by ID, author, paper title, or description..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />

      {/* Domain filters */}
      <div className="mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase mr-2">Domain</span>
        {DOMAINS.map((domain) => (
          <button
            key={domain}
            onClick={() => toggleInList(selectedDomains, setSelectedDomains, domain)}
            className={`inline-block mr-1.5 mb-1 px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors ${
              selectedDomains.includes(domain)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            }`}
          >
            {domain}
          </button>
        ))}
      </div>

      {/* Task type filters */}
      <div className="mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase mr-2">Task Type</span>
        {TASK_TYPES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => toggleInList(selectedTaskTypes, setSelectedTaskTypes, value)}
            className={`inline-block mr-1.5 mb-1 px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors ${
              selectedTaskTypes.includes(value)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tag filters grouped by category */}
      <div className="mb-6 space-y-2">
        {TAG_CATEGORY_ORDER.map((cat) => {
          const tags = tagsByCategory[cat]
          if (!tags) return null
          return (
            <div key={cat}>
              <span className="text-xs font-medium text-gray-500 uppercase mr-2">
                {TAG_CATEGORY_LABELS[cat]}
              </span>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleInList(selectedTags, setSelectedTags, tag.name)}
                  className={`inline-block mr-1.5 mb-1 px-2.5 py-1 text-xs rounded-full border cursor-pointer transition-colors ${
                    selectedTags.includes(tag.name)
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {tag.name}
                  <span className="ml-1 opacity-60">{tag.dataset_count}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {/* Results table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Author</th>
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Paper</th>
              <th className="px-3 py-2">Domain</th>
              <th className="px-3 py-2">Task Type</th>
              <th className="px-3 py-2 text-right">N</th>
              <th className="px-3 py-2 text-right">Trials</th>
            </tr>
          </thead>
          {filtered.map((d) => (
            <tbody key={d.id} className="border-b-2 border-gray-300 hover:bg-gray-50">
              {/* Top row: metadata */}
              <tr>
                <td className="px-3 pt-2 pb-1">
                  <Link
                    to={`/datasets/${d.id}`}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {d.id}
                  </Link>
                </td>
                <td className="px-3 pt-2 pb-1">{d.paper_author}</td>
                <td className="px-3 pt-2 pb-1">{d.paper_year}</td>
                <td className="px-3 pt-2 pb-1 max-w-xs">
                  {d.paper_title ? (
                    d.paper_doi ? (
                      <a
                        href={d.paper_doi}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs line-clamp-1"
                      >
                        {d.paper_title}
                      </a>
                    ) : (
                      <span className="text-xs text-gray-600 line-clamp-1">{d.paper_title}</span>
                    )
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 pt-2 pb-1">{d.domain}</td>
                <td className="px-3 pt-2 pb-1 whitespace-nowrap">
                  {TASK_TYPES.find((t) => t.value === d.task_type)?.label || d.task_type}
                </td>
                <td className="px-3 pt-2 pb-1 text-right tabular-nums">
                  {d.n_participants?.toLocaleString()}
                </td>
                <td className="px-3 pt-2 pb-1 text-right tabular-nums">
                  {d.n_trials_total?.toLocaleString()}
                </td>
              </tr>
              {/* Bottom row: tags */}
              {(d.tag_names || []).length > 0 && (
                <tr>
                  <td colSpan={8} className="px-3 pt-1.5 pb-2">
                    <div className="flex flex-wrap gap-1">
                      {(d.tag_names || []).map((tag) => (
                        <span
                          key={tag}
                          className="inline-block px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-600 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          ))}
          {filtered.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  No datasets match the current filters.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  )
}
