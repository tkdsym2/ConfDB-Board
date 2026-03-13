import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useEngine } from '../hooks/useEngine'
import { useDatasets } from '../hooks/useDatasets'

const TASK_TYPE_LABELS = {
  binary_classification: 'Binary',
  binary_response_graded_stimulus: 'Graded Stim',
  ambiguous_binary: 'Ambiguous',
  multi_class: 'Multi-class',
  continuous_estimation: 'Continuous',
}

export default function Home() {
  const { status, statusMessage, output, init, execute, clearOutput } = useEngine()
  const { data: datasets, isLoading: datasetsLoading } = useDatasets()

  const featured = useMemo(() => {
    if (!datasets || datasets.length === 0) return []
    const shuffled = [...datasets].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, 6)
  }, [datasets])

  async function handleTest() {
    clearOutput()
    await init()
    await execute('print("Hello from Pyodide")\nprint(f"1 + 1 = {1 + 1}")')
  }

  return (
    <div className="max-w-5xl mx-auto py-12 px-4">
      <h1 className="text-4xl font-bold mb-4">Confidence Database Board</h1>
      <p className="text-lg text-gray-600 mb-8">
        Explore and analyze 180 behavioral datasets from the Confidence Database
        (Rahnev et al., 2020). Browse datasets, select analysis templates, and
        run Python code directly in your browser.
      </p>

      {/* Featured datasets */}
      <div className="mb-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold">Featured Datasets</h2>
          <Link to="/datasets" className="text-sm text-blue-600 hover:underline">
            View all datasets &rarr;
          </Link>
        </div>
        {datasetsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-full mb-3" />
                <div className="flex gap-2 mb-2">
                  <div className="h-4 bg-gray-100 rounded-full w-16" />
                  <div className="h-4 bg-gray-100 rounded-full w-14" />
                </div>
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featured.map((d) => (
              <Link
                key={d.id}
                to={`/datasets/${d.id}`}
                className="block border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <h3 className="font-medium text-blue-600 text-sm mb-1 truncate" title={d.id}>
                  {d.id}
                </h3>
                <p className="text-sm text-gray-700 mb-1">
                  {d.paper_author}{d.paper_year ? ` (${d.paper_year})` : ''}
                </p>
                {d.paper_title && (
                  <p className="text-xs text-gray-500 line-clamp-2 mb-2">{d.paper_title}</p>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-indigo-100 text-indigo-700">
                    {d.domain}
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-700">
                    {TASK_TYPE_LABELS[d.task_type] || d.task_type}
                  </span>
                </div>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span>{d.n_participants?.toLocaleString()} participants</span>
                  <span>{d.n_trials_total?.toLocaleString()} trials</span>
                </div>
                {(d.tag_names || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {d.tag_names.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-600 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Pyodide section */}
      <div className="border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-600 mb-3">
          All analyses run directly in your browser using{' '}
          <a
            href="https://pyodide.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Pyodide
          </a>
          , a Python runtime compiled to WebAssembly.
          No server needed — your PC's processing power handles the computation.
          Click the button below to verify that Pyodide works in your browser.
        </p>
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleTest}
            disabled={status === 'loading' || status === 'running'}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Test Pyodide
          </button>
          <span className="text-sm text-gray-500">
            {status === 'idle' && 'Not initialized'}
            {status === 'loading' && (statusMessage || 'Loading...')}
            {status === 'ready' && 'Ready'}
            {status === 'running' && 'Running...'}
          </span>
        </div>

        {output.length > 0 && (
          <pre className="bg-gray-900 text-gray-100 text-sm p-3 rounded overflow-x-auto">
            {output.map((item, i) => {
              if (item.type === 'stdout' || item.type === 'stdout-cr') return <span key={i}>{item.text}</span>
              if (item.type === 'stderr') return <span key={i} className="text-red-400">{item.text}</span>
              if (item.type === 'result') return <span key={i} className="text-green-400">{item.success ? '\n--- Done ---' : '\n--- Failed ---'}</span>
              return null
            })}
          </pre>
        )}
      </div>

      {/* About & Contact */}
      <div className="mt-12 border-t border-gray-200 pt-8">
        <h2 className="text-lg font-semibold mb-3">About This Project</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          Kazuma Takada led the concept, technology selection, application architecture,
          data tagging, UI design, and interaction design for this project.
          Less than 10% of the codebase was written by hand — the remainder was generated
          via prompts entered into{' '}
          <a
            href="https://claude.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Claude Code
          </a>.
        </p>
        <p className="text-sm text-gray-600">
          To get in touch, reach out on{' '}
          <a
            href="https://x.com/tkdsym2"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            X (@tkdsym2)
          </a>
          {' '}or email{' '}
          <a
            href="mailto:kazuma.takada222@gmail.com"
            className="text-blue-600 hover:underline"
          >
            kazuma.takada222@gmail.com
          </a>.
        </p>
      </div>

      {/* Copyright */}
      <div className="mt-8 border-t border-gray-100 pt-4 pb-2 text-center">
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Kazuma Takada. All rights reserved.
        </p>
      </div>
    </div>
  )
}
