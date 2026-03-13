import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link, useSearchParams, useBlocker } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { useDatasetWithTags } from '../hooks/useDatasets'
import { useAnalyses, useAnalysis, datasetSupportsAnalysis } from '../hooks/useAnalyses'
import { useEngine } from '../hooks/useEngine'
import { supabaseUrl } from '../lib/supabase'

function buildDefaultTemplate(dataset) {
  if (!dataset) return '# Select a dataset to get started\nimport pandas as pd\n'
  const d = dataset
  return `import pandas as pd
import numpy as np

# Dataset: #${d.id} — ${d.paper_author || 'Unknown'} (${d.paper_year || '?'})
# Participants: ${d.n_participants?.toLocaleString() ?? '?'}, Trials: ${d.n_trials_total?.toLocaleString() ?? '?'}

# Auto-detected columns:
data = conf.load(df)
for role, col_name in data.columns.items():
    if col_name:
        print(f"  {role:20s} -> {col_name}")

print(f"\\nShape: {df.shape}")
print(f"\\nFirst 5 rows:")
print(df.head())
`
}

function interpolateTemplate(template, dataset) {
  if (!template || !dataset) return template || ''
  const d = dataset
  return template
    .replace(/\{dataset_id\}/g, d.id ?? '')
    .replace(/\{paper_author\}/g, d.paper_author ?? 'Unknown')
    .replace(/\{paper_year\}/g, d.paper_year ?? '?')
    .replace(/\{n_participants\}/g, d.n_participants?.toLocaleString() ?? '?')
    .replace(/\{n_trials\}/g, d.n_trials_total?.toLocaleString() ?? '?')
    .replace(/\{dataset_name\}/g, `#${d.id} ${d.paper_author || ''}`)
}

function buildCsvUrl(datasetId) {
  return `${supabaseUrl}/storage/v1/object/public/csv-files/data_${datasetId}.csv`
}

const CUSTOM_STORAGE_KEY = 'sandbox-custom-scripts'
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const DEFAULT_CUSTOM_CODE = `import pandas as pd
import numpy as np

data = conf.load(df)
# Write your analysis here
`

const CATEGORY_COLORS = {
  basic: 'bg-gray-100 text-gray-700 border-gray-200',
  sdt: 'bg-blue-50 text-blue-700 border-blue-200',
  metacognition: 'bg-purple-50 text-purple-700 border-purple-200',
  rt: 'bg-orange-50 text-orange-700 border-orange-200',
}

export default function Sandbox() {
  const [searchParams] = useSearchParams()
  const datasetId = searchParams.get('dataset')
  const analysisIdParam = searchParams.get('analysis')

  const { data: dataset, isLoading: datasetLoading } = useDatasetWithTags(datasetId)
  const { data: analyses } = useAnalyses()
  const { data: initialAnalysis } = useAnalysis(analysisIdParam)
  const engine = useEngine()

  const [code, setCode] = useState('')
  const [codeSaved, setCodeSaved] = useState('')     // Cmd+S checkpoint — for dirty dot
  const [codeInitial, setCodeInitial] = useState('')  // original template — for leave guard
  const [confCode, setConfCode] = useState('')
  const [confSaved, setConfSaved] = useState('')      // Cmd+S checkpoint — for dirty dot
  const [confInitial, setConfInitial] = useState('')   // original fetched — for leave guard
  const [metacogCode, setMetacogCode] = useState('')
  const [metacogSaved, setMetacogSaved] = useState('')       // Cmd+S checkpoint — for dirty dot
  const [metacogInitial, setMetacogInitial] = useState('')    // original fetched — for leave guard
  const [activeTab, setActiveTab] = useState('script') // 'script' | 'conf' | 'metacog'
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(null)
  const [elapsed, setElapsed] = useState(null)
  const [saveFlash, setSaveFlash] = useState(false)
  const [customScripts, setCustomScripts] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || '[]') }
    catch { return [] }
  })
  const [selectedCustomId, setSelectedCustomId] = useState(null)
  const [creatingScript, setCreatingScript] = useState(false)
  const outputEndRef = useRef(null)
  const initStartedRef = useRef(false)
  const templateAppliedRef = useRef(false)
  const scriptsMapRef = useRef({}) // { [analysisId | 'explore']: code }

  const confDirty = confCode !== confSaved       // tab dot: changed since last save
  const metacogDirty = metacogCode !== metacogSaved       // tab dot: changed since last save
  const codeDirty = code !== codeSaved            // tab dot: changed since last save
  const hasModifiedWork = code !== codeInitial || confCode !== confInitial || metacogCode !== metacogInitial // leave guard: differs from original
  const consoleItems = useMemo(() => engine.output.filter((item) => item.type !== 'plot'), [engine.output])
  const plots = useMemo(() => engine.output.filter((item) => item.type === 'plot'), [engine.output])

  // Warn on browser reload / close
  useEffect(() => {
    if (!hasModifiedWork) return
    const handler = (e) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasModifiedWork])

  // Persist custom scripts to localStorage
  useEffect(() => {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customScripts))
  }, [customScripts])

  // Save current script code to the right place
  const saveCurrentScript = useCallback(() => {
    if (selectedCustomId) {
      setCustomScripts(prev => prev.map(s => s.id === selectedCustomId ? { ...s, code } : s))
    } else {
      const key = selectedAnalysisId ?? 'explore'
      scriptsMapRef.current[key] = code
    }
  }, [selectedCustomId, selectedAnalysisId, code])

  // Cmd+S / Ctrl+S — save current edits as checkpoint
  const handleSave = useCallback(() => {
    setCodeSaved(code)
    setConfSaved(confCode)
    setMetacogSaved(metacogCode)
    saveCurrentScript()
    // For custom scripts, saving updates the initial baseline (user owns the template)
    if (selectedCustomId) {
      setCodeInitial(code)
    }
    setSaveFlash(true)
    setTimeout(() => setSaveFlash(false), 1500)
  }, [code, confCode, metacogCode, saveCurrentScript, selectedCustomId])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  // Warn on in-app navigation
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasModifiedWork && currentLocation.pathname !== nextLocation.pathname
  )

  // Fetch conf_bundle.py and metacog_bundle.py source
  useEffect(() => {
    fetch('/conf_bundle.py')
      .then((res) => res.text())
      .then((text) => {
        setConfCode(text)
        setConfSaved(text)
        setConfInitial(text)
      })
    fetch('/metacog_bundle.py')
      .then((res) => res.text())
      .then((text) => {
        setMetacogCode(text)
        setMetacogSaved(text)
        setMetacogInitial(text)
      })
  }, [])

  // Compatible analyses for this dataset
  const compatibleAnalyses = useMemo(() => {
    if (!analyses || !dataset) return []
    return analyses.filter((a) => datasetSupportsAnalysis(dataset, a))
  }, [analyses, dataset])

  // Set initial template: from analysis param or default
  useEffect(() => {
    if (!dataset || templateAppliedRef.current) return
    templateAppliedRef.current = true

    if (initialAnalysis) {
      const tmpl = interpolateTemplate(initialAnalysis.python_template, dataset)
      setCode(tmpl)
      setCodeSaved(tmpl)
      setCodeInitial(tmpl)
      setSelectedAnalysisId(initialAnalysis.id)
    } else {
      const tmpl = buildDefaultTemplate(dataset)
      setCode(tmpl)
      setCodeSaved(tmpl)
      setCodeInitial(tmpl)
    }
  }, [dataset, initialAnalysis])

  // Auto-init Pyodide and load dataset
  useEffect(() => {
    if (!datasetId || !dataset || initStartedRef.current) return
    initStartedRef.current = true

    async function bootstrap() {
      await engine.init()
      await engine.loadDataset(datasetId, buildCsvUrl(datasetId))
    }
    bootstrap()
  }, [datasetId, dataset]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll output
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [engine.output])

  const handleRun = useCallback(async () => {
    if (engine.status !== 'ready') return
    engine.clearOutput()
    setElapsed(null)
    const start = performance.now()
    if (confCode !== confInitial) {
      await engine.reloadConf(confCode)
    }
    if (metacogCode !== metacogInitial) {
      await engine.reloadMetacog(metacogCode)
    }
    await engine.execute(code)
    setElapsed(((performance.now() - start) / 1000).toFixed(2))
  }, [engine, code, confCode, confInitial, metacogCode, metacogInitial])

  const handleSelectAnalysis = useCallback((analysis) => {
    if (!dataset) return
    saveCurrentScript()
    const saved = scriptsMapRef.current[analysis.id]
    const freshTmpl = interpolateTemplate(analysis.python_template, dataset)
    const tmpl = saved ?? freshTmpl
    setSelectedAnalysisId(analysis.id)
    setSelectedCustomId(null)
    setCode(tmpl)
    setCodeSaved(tmpl)
    setCodeInitial(freshTmpl)
    setActiveTab('script')
  }, [dataset, saveCurrentScript])

  const handleSelectExplore = useCallback(() => {
    if (!dataset) return
    saveCurrentScript()
    const saved = scriptsMapRef.current['explore']
    const freshTmpl = buildDefaultTemplate(dataset)
    const tmpl = saved ?? freshTmpl
    setSelectedAnalysisId(null)
    setSelectedCustomId(null)
    setCode(tmpl)
    setCodeSaved(tmpl)
    setCodeInitial(freshTmpl)
    setActiveTab('script')
  }, [dataset, saveCurrentScript])

  // --- Custom script handlers ---

  const handleSelectCustomScript = useCallback((script) => {
    saveCurrentScript()
    setSelectedAnalysisId(null)
    setSelectedCustomId(script.id)
    setCode(script.code)
    setCodeSaved(script.code)
    setCodeInitial(script.code)
    setActiveTab('script')
  }, [saveCurrentScript])

  const handleCreateScript = useCallback((name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const newScript = { id: genId(), name: trimmed, code: DEFAULT_CUSTOM_CODE }
    setCustomScripts(prev => [...prev, newScript])
    setCreatingScript(false)
    saveCurrentScript()
    setSelectedAnalysisId(null)
    setSelectedCustomId(newScript.id)
    setCode(newScript.code)
    setCodeSaved(newScript.code)
    setCodeInitial(newScript.code)
    setActiveTab('script')
  }, [saveCurrentScript])

  const handleDeleteScript = useCallback((scriptId) => {
    const script = customScripts.find(s => s.id === scriptId)
    if (!script || !window.confirm(`Delete "${script.name}"?`)) return
    setCustomScripts(prev => prev.filter(s => s.id !== scriptId))
    if (selectedCustomId === scriptId) {
      setSelectedCustomId(null)
      const tmpl = buildDefaultTemplate(dataset)
      setCode(tmpl)
      setCodeSaved(tmpl)
      setCodeInitial(tmpl)
    }
  }, [customScripts, selectedCustomId, dataset])

  const d = dataset
  const isRunnable = engine.status === 'ready' && !!datasetId

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {d ? (
            <>
              <span className="font-medium text-sm truncate">
                #{d.id} {d.paper_author}
                {d.paper_year ? ` (${d.paper_year})` : ''}
              </span>
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-indigo-100 text-indigo-700 flex-shrink-0">
                {d.domain}
              </span>
            </>
          ) : datasetLoading ? (
            <span className="text-sm text-gray-400">Loading dataset...</span>
          ) : (
            <span className="text-sm text-gray-400">No dataset selected</span>
          )}
          <Link to="/datasets" className="text-xs text-gray-500 hover:text-gray-700 flex-shrink-0">
            {d ? 'Change dataset' : 'Browse datasets'}
          </Link>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveFlash && (
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-100 text-green-700 animate-pulse">
              Saved
            </span>
          )}
          <StatusBadge status={engine.status} message={engine.statusMessage} />
          <button
            onClick={() => { engine.clearOutput(); setElapsed(null) }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={handleRun}
            disabled={!isRunnable}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Run
          </button>
        </div>
      </div>

      {/* Analysis selector */}
      {compatibleAnalyses.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-white overflow-x-auto flex-shrink-0">
          <span className="text-xs text-gray-400 flex-shrink-0">Template:</span>
          <button
            onClick={handleSelectExplore}
            className={`px-2.5 py-1 text-xs rounded border cursor-pointer transition-colors flex-shrink-0 ${
              selectedAnalysisId === null && selectedCustomId === null
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            Explore
          </button>
          {compatibleAnalyses.map((a) => (
            <button
              key={a.id}
              onClick={() => handleSelectAnalysis(a)}
              className={`px-2.5 py-1 text-xs rounded border cursor-pointer transition-colors flex-shrink-0 ${
                selectedAnalysisId === a.id
                  ? 'bg-gray-800 text-white border-gray-800'
                  : `${CATEGORY_COLORS[a.category] || 'bg-white text-gray-600 border-gray-200'} hover:opacity-80`
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      {/* Custom scripts */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 bg-white overflow-x-auto flex-shrink-0">
        <span className="text-xs text-gray-400 flex-shrink-0">Custom:</span>
        {customScripts.map((script) => (
          <div key={script.id} className="relative flex-shrink-0 group/script">
            <button
              onClick={() => handleSelectCustomScript(script)}
              className={`px-2.5 py-1 text-xs rounded border cursor-pointer transition-colors flex-shrink-0 ${
                selectedCustomId === script.id
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:opacity-80'
              }`}
            >
              {script.name}
            </button>
            <button
              onClick={() => handleDeleteScript(script.id)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-red-100 hover:text-red-500 items-center justify-center cursor-pointer hidden group-hover/script:flex"
              title="Delete script"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l4 4M7 3l-4 4" />
              </svg>
            </button>
          </div>
        ))}
        {creatingScript ? (
          <input
            autoFocus
            type="text"
            placeholder="Script name"
            className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400 w-32"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateScript(e.target.value)
              if (e.key === 'Escape') setCreatingScript(false)
            }}
            onBlur={(e) => {
              if (e.target.value.trim()) handleCreateScript(e.target.value)
              else setCreatingScript(false)
            }}
          />
        ) : (
          <button
            onClick={() => setCreatingScript(true)}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 border border-dashed border-gray-300 hover:border-gray-400 rounded cursor-pointer transition-colors flex-shrink-0"
            title="New script"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 3v8M3 7h8" />
            </svg>
          </button>
        )}
      </div>

      {/* Main panels */}
      <div className="flex flex-1 min-h-0">
        {/* Editor panel */}
        <div className="w-3/5 border-r border-gray-200 flex flex-col">
          {/* File tabs */}
          <div className="flex items-center bg-[#252526] flex-shrink-0">
            <button
              onClick={() => setActiveTab('script')}
              className={`px-5 py-2 text-sm font-medium cursor-pointer transition-colors border-t-2 ${
                activeTab === 'script'
                  ? 'text-white bg-[#1e1e1e] border-blue-400'
                  : 'text-gray-500 bg-[#2d2d2d] border-transparent hover:text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              main.py
              {codeDirty && (
                <span className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-400 align-middle" title="Modified" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('conf')}
              className={`px-5 py-2 text-sm font-medium cursor-pointer transition-colors border-t-2 ${
                activeTab === 'conf'
                  ? 'text-white bg-[#1e1e1e] border-blue-400'
                  : 'text-gray-500 bg-[#2d2d2d] border-transparent hover:text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              conf.py
              {confDirty && (
                <span className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-400 align-middle" title="Modified" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('metacog')}
              className={`px-5 py-2 text-sm font-medium cursor-pointer transition-colors border-t-2 ${
                activeTab === 'metacog'
                  ? 'text-white bg-[#1e1e1e] border-blue-400'
                  : 'text-gray-500 bg-[#2d2d2d] border-transparent hover:text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              metacog.py
              {metacogDirty && (
                <span className="ml-2 inline-block w-2 h-2 rounded-full bg-amber-400 align-middle" title="Modified" />
              )}
            </button>
            <div className="flex-1 bg-[#252526]" />
            {confDirty && activeTab === 'conf' && (
              <button
                onClick={() => { setConfCode(confInitial); setConfSaved(confInitial) }}
                className="mr-3 px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 rounded cursor-pointer transition-colors"
              >
                Reset
              </button>
            )}
            {metacogDirty && activeTab === 'metacog' && (
              <button
                onClick={() => { setMetacogCode(metacogInitial); setMetacogSaved(metacogInitial) }}
                className="mr-3 px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 rounded cursor-pointer transition-colors"
              >
                Reset
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0">
            {activeTab === 'script' ? (
              <Editor
                height="100%"
                language="python"
                theme="vs-dark"
                value={code}
                onChange={(val) => setCode(val || '')}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  padding: { top: 8 },
                }}
              />
            ) : activeTab === 'conf' ? (
              <Editor
                height="100%"
                language="python"
                theme="vs-dark"
                value={confCode}
                onChange={(val) => setConfCode(val || '')}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  padding: { top: 8 },
                }}
              />
            ) : (
              <Editor
                height="100%"
                language="python"
                theme="vs-dark"
                value={metacogCode}
                onChange={(val) => setMetacogCode(val || '')}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  padding: { top: 8 },
                }}
              />
            )}
          </div>
        </div>

        {/* Output panel — split into Console + Plots */}
        <div className="w-2/5 flex flex-col bg-gray-900 text-gray-100 min-h-0">
          {/* Console */}
          <div className={`flex flex-col min-h-0 ${plots.length > 0 ? 'h-1/2 border-b border-gray-700' : 'flex-1'}`}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 flex-shrink-0">
              <span className="text-xs text-gray-400 uppercase font-medium">Console</span>
              {elapsed != null && (
                <span className="text-xs text-gray-500">{elapsed}s</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-sm font-mono">
              {consoleItems.length === 0 && plots.length === 0 && (engine.status === 'ready' || engine.status === 'idle') && (
                <span className="text-gray-500">
                  {!datasetId
                    ? 'Select a dataset to run code. You can browse the conf library via the conf.py tab.'
                    : 'Click Run to execute your code.'}
                </span>
              )}
              {consoleItems.map((item, i) => {
                if (item.type === 'stdout') {
                  return <pre key={i} className="whitespace-pre-wrap">{item.text}</pre>
                }
                if (item.type === 'stderr') {
                  return <pre key={i} className="whitespace-pre-wrap text-red-400">{item.text}</pre>
                }
                if (item.type === 'result') {
                  return (
                    <div key={i} className={`text-xs mt-2 ${item.success ? 'text-green-400' : 'text-red-400'}`}>
                      {item.success ? '--- Done ---' : '--- Failed ---'}
                    </div>
                  )
                }
                return null
              })}
              <div ref={outputEndRef} />
            </div>
          </div>

          {/* Plots */}
          {plots.length > 0 && (
            <div className="h-1/2 flex flex-col min-h-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 flex-shrink-0">
                <span className="text-xs text-gray-400 uppercase font-medium">
                  Plots
                  <span className="ml-1.5 text-gray-500">({plots.length})</span>
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {plots.map((item, i) => (
                  <img
                    key={i}
                    src={`data:image/png;base64,${item.data}`}
                    alt={`Plot ${i + 1}`}
                    className="max-w-full rounded bg-white mb-3 last:mb-0"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation blocker modal */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Leave this page?</h3>
            <p className="text-sm text-gray-600 mb-5">
              You have unsaved changes. If you leave, your edits will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => blocker.reset()}
                className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                Stay
              </button>
              <button
                onClick={() => blocker.proceed()}
                className="px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 cursor-pointer"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, message }) {
  if (status === 'idle') return null

  const colors = {
    loading: 'bg-yellow-100 text-yellow-700',
    ready: 'bg-green-100 text-green-700',
    running: 'bg-blue-100 text-blue-700',
  }

  const labels = {
    loading: message || 'Loading...',
    ready: 'Ready',
    running: 'Running...',
  }

  return (
    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${colors[status] || ''}`}>
      {labels[status] || status}
    </span>
  )
}
