import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAnalyses, getAnalysisTagNames, datasetSupportsAnalysis } from '../hooks/useAnalyses'
import { useDatasets } from '../hooks/useDatasets'

const DIFFICULTY_COLORS = {
  basic: 'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
  advanced: 'bg-red-100 text-red-700',
}

const CATEGORY_COLORS = {
  basic: 'bg-gray-100 text-gray-700',
  sdt: 'bg-blue-100 text-blue-700',
  metacognition: 'bg-purple-100 text-purple-700',
  rt: 'bg-orange-100 text-orange-700',
}

export default function Analyses() {
  const { data: analyses, isLoading, error } = useAnalyses()
  const { data: datasets } = useDatasets()
  const [selectedId, setSelectedId] = useState(null)

  const compatibleDatasets = useMemo(() => {
    if (!selectedId || !analyses || !datasets) return []
    const analysis = analyses.find((a) => a.id === selectedId)
    if (!analysis) return []
    return datasets.filter((d) => datasetSupportsAnalysis(d, analysis))
  }, [selectedId, analyses, datasets])

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4">
        <p className="text-gray-500">Loading analyses...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4">
        <p className="text-red-600">Error: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">Analysis Templates</h1>

      <div className="space-y-3">
        {analyses?.map((a) => {
          const isSelected = selectedId === a.id
          const tagNames = getAnalysisTagNames(a)

          return (
            <div key={a.id}>
              {/* Analysis card */}
              <button
                onClick={() => setSelectedId(isSelected ? null : a.id)}
                className={`w-full text-left p-4 border rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-sm">{a.name}</h2>
                    <p className="text-sm text-gray-500 mt-0.5">{a.description}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${CATEGORY_COLORS[a.category] || 'bg-gray-100 text-gray-600'}`}>
                      {a.category}
                    </span>
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${DIFFICULTY_COLORS[a.difficulty] || 'bg-gray-100 text-gray-600'}`}>
                      {a.difficulty}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {tagNames.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-600 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>

              {/* Compatible datasets (expanded) */}
              {isSelected && (
                <div className="ml-4 mt-2 mb-1 border-l-2 border-blue-300 pl-4">
                  <p className="text-xs text-gray-500 mb-2">
                    {compatibleDatasets.length} compatible dataset{compatibleDatasets.length !== 1 ? 's' : ''}
                  </p>
                  {compatibleDatasets.length === 0 ? (
                    <p className="text-sm text-gray-400">No datasets support this analysis.</p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {compatibleDatasets.map((d) => (
                        <Link
                          key={d.id}
                          to={`/sandbox?dataset=${d.id}&analysis=${a.id}`}
                          className="flex items-center gap-3 px-3 py-2 text-sm rounded hover:bg-gray-50 border border-gray-100"
                        >
                          <span className="font-medium text-blue-600">#{d.id}</span>
                          <span className="text-gray-700 truncate">
                            {d.paper_author}{d.paper_year ? ` (${d.paper_year})` : ''}
                          </span>
                          <span className="px-1.5 py-0.5 text-[11px] rounded-full bg-indigo-100 text-indigo-700 flex-shrink-0">
                            {d.domain}
                          </span>
                          <span className="text-gray-400 text-xs ml-auto flex-shrink-0">
                            {d.n_participants} subj
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
