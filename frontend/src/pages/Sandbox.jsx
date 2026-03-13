import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link, useSearchParams, useBlocker } from 'react-router-dom'
import Editor from '@monaco-editor/react'
import { useDatasets, useDatasetWithTags } from '../hooks/useDatasets'
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
  const [extraDatasetsOpen, setExtraDatasetsOpen] = useState(false)
  const [loadedExtras, setLoadedExtras] = useState([]) // [{ datasetId, dfVar, dataVar }]
  const [manualOpen, setManualOpen] = useState(false)
  const handleRunRef = useRef(() => {})
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        handleRunRef.current()
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
  handleRunRef.current = handleRun

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
      <div className="border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex items-center justify-between px-4 py-2">
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
        </div>

        {/* Import additional dataset — below dataset name */}
        {datasetId && (
          <div className="px-4">
            <div className="flex items-center gap-2 pb-1.5">
              <button
                onClick={() => setExtraDatasetsOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${extraDatasetsOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 10 10"
                  fill="currentColor"
                >
                  <path d="M3 1l5 4-5 4z" />
                </svg>
                Import additional dataset
                {loadedExtras.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0 text-[10px] rounded-full bg-blue-100 text-blue-600 font-medium">
                    {loadedExtras.length}
                  </span>
                )}
              </button>
              {/* Loaded extras badges inline */}
              {!extraDatasetsOpen && loadedExtras.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {loadedExtras.map((extra, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0 text-[10px] rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                      <span className="font-mono font-medium">{extra.dfVar}</span>
                      <span className="text-blue-300">&larr;</span>
                      <span>{extra.datasetId}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {extraDatasetsOpen && (
              <div className="pb-2">
                <ExtraDatasetLoader
                  engine={engine}
                  currentDatasetId={datasetId}
                  loadedExtras={loadedExtras}
                  onLoaded={(extra) => setLoadedExtras((prev) => [...prev, extra])}
                />
              </div>
            )}
          </div>
        )}
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
            <div className="flex items-center gap-1.5 mr-2">
              {confDirty && activeTab === 'conf' && (
                <button
                  onClick={() => { setConfCode(confInitial); setConfSaved(confInitial) }}
                  className="px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 rounded cursor-pointer transition-colors"
                >
                  Reset
                </button>
              )}
              {metacogDirty && activeTab === 'metacog' && (
                <button
                  onClick={() => { setMetacogCode(metacogInitial); setMetacogSaved(metacogInitial) }}
                  className="px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 rounded cursor-pointer transition-colors"
                >
                  Reset
                </button>
              )}
              {saveFlash && (
                <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-900/60 text-green-300 animate-pulse">
                  Saved
                </span>
              )}
              <StatusBadge status={engine.status} message={engine.statusMessage} dark />
              <button
                onClick={() => { engine.clearOutput(); setElapsed(null) }}
                className="px-2.5 py-1 text-xs font-medium rounded border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 cursor-pointer transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => setManualOpen(true)}
                className="p-1 rounded border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 cursor-pointer transition-colors"
                title="Sandbox Manual"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 16.82A7.462 7.462 0 0115 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0018 15.06V4.31a.75.75 0 00-.546-.721A9.006 9.006 0 0015 3.25a9.007 9.007 0 00-4.25 1.065V16.82zM9.25 4.315A9.007 9.007 0 005 3.25a9.006 9.006 0 00-2.454.339A.75.75 0 002 4.31v10.75a.75.75 0 00.954.721A7.462 7.462 0 015 15.5c1.579 0 3.042.487 4.25 1.32V4.315z" />
                </svg>
              </button>
              <button
                onClick={handleRun}
                disabled={!isRunnable}
                className="px-3 py-1 text-xs font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                Run
              </button>
            </div>
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

        {/* Output panel — split into Variables + Console + Plots */}
        <div className="w-2/5 flex flex-col bg-gray-900 text-gray-100 min-h-0">
          {/* User-defined globals */}
          {engine.userGlobals.length > 0 && (
            <VariablesPanel variables={engine.userGlobals} />
          )}

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
                if (item.type === 'stdout' || item.type === 'stdout-cr') {
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

      {/* Sandbox manual modal */}
      {manualOpen && <SandboxManual onClose={() => setManualOpen(false)} />}

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

function SandboxManual({ onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Sandbox Manual</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-gray-700 space-y-5">
          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">Pre-loaded globals</h3>
            <p className="mb-2 text-gray-600">These variables are available in every script without importing:</p>
            <div className="bg-gray-50 rounded-md p-3 font-mono text-xs space-y-1">
              <div><span className="text-blue-600">df</span> <span className="text-gray-400">-</span> Primary dataset as a pandas DataFrame</div>
              <div><span className="text-blue-600">data</span> <span className="text-gray-400">-</span> <code>conf.load(df)</code> with auto-detected columns</div>
              <div><span className="text-blue-600">conf</span> <span className="text-gray-400">-</span> Confidence analysis library (SDT, metacognition, plotting)</div>
              <div><span className="text-blue-600">metacog</span> <span className="text-gray-400">-</span> Metacognitive measures library (17 measures)</div>
              <div><span className="text-blue-600">pd</span> <span className="text-gray-400">-</span> pandas</div>
              <div><span className="text-blue-600">np</span> <span className="text-gray-400">-</span> numpy</div>
              <div><span className="text-blue-600">plt</span> <span className="text-gray-400">-</span> matplotlib.pyplot</div>
              <div><span className="text-blue-600">tqdm</span> <span className="text-gray-400">-</span> Progress bar library</div>
            </div>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">conf library</h3>
            <div className="bg-gray-50 rounded-md p-3 font-mono text-xs space-y-1">
              <div><span className="text-purple-600">data = conf.load(df)</span> <span className="text-gray-400">-</span> Auto-detect columns, return ConfData</div>
              <div><span className="text-purple-600">data.col(<span className="text-green-700">'subject'</span>)</span> <span className="text-gray-400">-</span> Get actual column name for a role</div>
              <div><span className="text-purple-600">data.has(<span className="text-green-700">'rt_decision'</span>)</span> <span className="text-gray-400">-</span> Check if a column role exists</div>
              <div><span className="text-purple-600">data.get(<span className="text-green-700">'confidence'</span>)</span> <span className="text-gray-400">-</span> Get column as Series</div>
              <div><span className="text-purple-600">data.raw</span> <span className="text-gray-400">-</span> The underlying DataFrame</div>
              <div><span className="text-purple-600">data.describe()</span> <span className="text-gray-400">-</span> Print all column mappings</div>
              <div className="pt-1 border-t border-gray-200 mt-1"><span className="text-purple-600">conf.dprime(data)</span> <span className="text-gray-400">-</span> d' and criterion per subject</div>
              <div><span className="text-purple-600">conf.type2_roc(data)</span> <span className="text-gray-400">-</span> Type 2 ROC points per subject</div>
              <div><span className="text-purple-600">conf.type2_auc(data)</span> <span className="text-gray-400">-</span> Type 2 AUC per subject</div>
              <div className="pt-1 border-t border-gray-200 mt-1"><span className="text-purple-600">conf.plot_confidence_accuracy(data)</span></div>
              <div><span className="text-purple-600">conf.plot_dprime_distribution(sdt_result)</span></div>
              <div><span className="text-purple-600">conf.plot_rt_distribution(data, n_subjects=6)</span></div>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              Column roles: subject, stimulus, response, confidence, accuracy, rt_decision, rt_confidence, rt_combined, rt_generic, difficulty, condition, error
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">metacog library</h3>
            <div className="bg-gray-50 rounded-md p-3 font-mono text-xs space-y-1">
              <div><span className="text-purple-600">results = metacog.compute_all(data)</span> <span className="text-gray-400">-</span> All 17 measures per subject</div>
              <div><span className="text-purple-600">metacog.print_summary(results)</span> <span className="text-gray-400">-</span> Formatted summary table</div>
              <div><span className="text-purple-600">metacog.compute_all(data, include_model_based=False)</span> <span className="text-gray-400">-</span> Skip slow measures</div>
              <div className="pt-1 border-t border-gray-200 mt-1"><span className="text-purple-600">metacog.gamma(data)</span> <span className="text-gray-400">-</span> Goodman-Kruskal gamma</div>
              <div><span className="text-purple-600">metacog.phi(data)</span> <span className="text-gray-400">-</span> Phi correlation</div>
              <div><span className="text-purple-600">metacog.delta_conf(data)</span> <span className="text-gray-400">-</span> Mean confidence difference</div>
              <div><span className="text-purple-600">metacog.meta_d(data)</span> <span className="text-gray-400">-</span> meta-d' (MLE)</div>
              <div><span className="text-purple-600">metacog.sdt_expected(data, sdt_df)</span> <span className="text-gray-400">-</span> SDT ideal observer values</div>
              <div><span className="text-purple-600">metacog.meta_noise(data)</span> <span className="text-gray-400">-</span> Noisy readout model</div>
              <div><span className="text-purple-600">metacog.meta_uncertainty(data)</span> <span className="text-gray-400">-</span> CASANDRE model</div>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              17 measures: 5 raw + 5 ratio + 5 difference + 2 model-based. Individual functions accept <code>verbose=True</code> for progress bars.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">Importing additional datasets</h3>
            <p className="text-gray-600 mb-2">
              Click "Import additional dataset" below the dataset name to load more datasets into the sandbox.
              You can specify custom variable names (e.g. <code className="text-xs bg-gray-100 px-1 rounded">df2</code>, <code className="text-xs bg-gray-100 px-1 rounded">data2</code>) for each imported dataset.
            </p>
            <div className="bg-gray-50 rounded-md p-3 font-mono text-xs space-y-1">
              <div className="text-gray-500"># After importing a second dataset as df2 / data2:</div>
              <div><span className="text-purple-600">sdt1 = conf.dprime(data)</span>   <span className="text-gray-400"># primary dataset</span></div>
              <div><span className="text-purple-600">sdt2 = conf.dprime(data2)</span>  <span className="text-gray-400"># imported dataset</span></div>
              <div><span className="text-purple-600">merged = pd.concat([sdt1, sdt2])</span></div>
            </div>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">Variable persistence</h3>
            <p className="text-gray-600">
              Variables you define in any script persist across template switches within the same session.
              For example, if you set <code className="text-xs bg-gray-100 px-1 rounded">hoge = 1</code> in Explore and then switch to
              Basic Descriptive Statistics, <code className="text-xs bg-gray-100 px-1 rounded">hoge</code> is still accessible.
              User-defined variables appear in the <strong>Variables</strong> panel in the output area after each run.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">Plots</h3>
            <p className="text-gray-600">
              Call <code className="text-xs bg-gray-100 px-1 rounded">plt.show()</code> to render plots.
              All matplotlib figures with axes are automatically captured and displayed in the Plots panel.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">Keyboard shortcuts</h3>
            <div className="bg-gray-50 rounded-md p-3 text-xs space-y-1">
              <div><kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-700 font-mono">Cmd+R</kbd> / <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-700 font-mono">Ctrl+R</kbd> <span className="text-gray-400 ml-2">Run script</span></div>
              <div><kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-700 font-mono">Cmd+S</kbd> / <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-700 font-mono">Ctrl+S</kbd> <span className="text-gray-400 ml-2">Save checkpoint (clears dirty dot)</span></div>
            </div>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1.5">Editor tabs</h3>
            <p className="text-gray-600">
              <strong>main.py</strong> is your script. <strong>conf.py</strong> and <strong>metacog.py</strong> show the library source code
              and can be edited live. Changes are reloaded into Pyodide when you click Run. Use the Reset button to
              restore original library code.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function VariablesPanel({ variables }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="border-b border-gray-700 flex-shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 w-full cursor-pointer hover:bg-gray-800/50"
      >
        <svg
          className={`w-2.5 h-2.5 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 10 10"
          fill="currentColor"
        >
          <path d="M3 1l5 4-5 4z" />
        </svg>
        <span className="text-xs text-gray-400 uppercase font-medium">
          Variables
        </span>
        <span className="text-xs text-gray-500">({variables.length})</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 max-h-36 overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <tbody>
              {variables.map((v) => (
                <tr key={v.name} className="group">
                  <td className="pr-2 py-0.5 text-blue-300 whitespace-nowrap">{v.name}</td>
                  <td className="pr-2 py-0.5 text-gray-500 whitespace-nowrap">{v.type}</td>
                  <td className="py-0.5 text-gray-400 truncate max-w-[200px]" title={v.repr}>{v.repr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ExtraDatasetLoader({ engine, currentDatasetId, loadedExtras, onLoaded }) {
  const { data: allDatasets } = useDatasets()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [dfVar, setDfVar] = useState('df2')
  const [dataVar, setDataVar] = useState('data2')
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const usedVarNames = useMemo(() => {
    const names = new Set(['df', 'data'])
    loadedExtras.forEach((e) => { names.add(e.dfVar); names.add(e.dataVar) })
    return names
  }, [loadedExtras])

  const filteredDatasets = useMemo(() => {
    if (!allDatasets) return []
    const q = search.toLowerCase()
    return allDatasets
      .filter((d) => d.id !== currentDatasetId)
      .filter((d) => {
        if (!q) return true
        return (
          d.id.toLowerCase().includes(q) ||
          (d.paper_author || '').toLowerCase().includes(q) ||
          (d.paper_title || '').toLowerCase().includes(q)
        )
      })
      .slice(0, 30)
  }, [allDatasets, search, currentDatasetId])

  const selectedDataset = useMemo(
    () => allDatasets?.find((d) => d.id === selectedId),
    [allDatasets, selectedId]
  )

  const varNameValid = (name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
  const dfVarOk = varNameValid(dfVar) && !usedVarNames.has(dfVar)
  const dataVarOk = varNameValid(dataVar) && !usedVarNames.has(dataVar)
  const canLoad = selectedId && dfVarOk && dataVarOk && dfVar !== dataVar && engine.status === 'ready' && !loading

  const handleLoad = async () => {
    if (!canLoad) return
    setLoading(true)
    try {
      const csvUrl = buildCsvUrl(selectedId)
      await engine.loadExtraDataset(csvUrl, dfVar, dataVar)
      onLoaded({ datasetId: selectedId, dfVar, dataVar, author: selectedDataset?.paper_author, year: selectedDataset?.paper_year })
      // Auto-increment variable names for next load
      const nextNum = loadedExtras.length + 3
      setDfVar(`df${nextNum}`)
      setDataVar(`data${nextNum}`)
      setSelectedId('')
      setSearch('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-2 space-y-2">
      <div className="flex items-start gap-3 flex-wrap">
        {/* Dataset picker */}
        <div className="relative flex-1 min-w-[200px]" ref={dropdownRef}>
          <label className="block text-[10px] text-gray-400 uppercase mb-0.5">Dataset</label>
          <input
            type="text"
            placeholder="Search datasets..."
            value={selectedId ? `${selectedId}` : search}
            onChange={(e) => { setSearch(e.target.value); setSelectedId(''); setDropdownOpen(true) }}
            onFocus={() => setDropdownOpen(true)}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400 bg-white"
          />
          {selectedId && (
            <button
              onClick={() => { setSelectedId(''); setSearch('') }}
              className="absolute right-2 top-5 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <svg className="w-3 h-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l4 4M7 3l-4 4" />
              </svg>
            </button>
          )}
          {dropdownOpen && !selectedId && (
            <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-gray-200 rounded shadow-lg">
              {filteredDatasets.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">No datasets found</div>
              ) : (
                filteredDatasets.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setSelectedId(d.id)
                      setSearch('')
                      setDropdownOpen(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 cursor-pointer flex items-center gap-2"
                  >
                    <span className="font-medium text-gray-700 truncate">{d.id}</span>
                    <span className="text-gray-400 truncate">
                      {d.paper_author}{d.paper_year ? ` (${d.paper_year})` : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Variable name inputs */}
        <div className="w-28">
          <label className="block text-[10px] text-gray-400 uppercase mb-0.5">DataFrame var</label>
          <input
            type="text"
            value={dfVar}
            onChange={(e) => setDfVar(e.target.value)}
            className={`w-full px-2.5 py-1.5 text-xs border rounded font-mono focus:outline-none ${
              dfVarOk || !dfVar ? 'border-gray-300 focus:border-blue-400' : 'border-red-300 focus:border-red-400'
            }`}
            placeholder="df2"
          />
        </div>
        <div className="w-28">
          <label className="block text-[10px] text-gray-400 uppercase mb-0.5">ConfData var</label>
          <input
            type="text"
            value={dataVar}
            onChange={(e) => setDataVar(e.target.value)}
            className={`w-full px-2.5 py-1.5 text-xs border rounded font-mono focus:outline-none ${
              dataVarOk || !dataVar ? 'border-gray-300 focus:border-blue-400' : 'border-red-300 focus:border-red-400'
            }`}
            placeholder="data2"
          />
        </div>

        {/* Load button */}
        <div className="pt-3.5">
          <button
            onClick={handleLoad}
            disabled={!canLoad}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
      </div>

      {/* Loaded extras list */}
      {loadedExtras.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {loadedExtras.map((extra, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <span className="font-mono font-medium">{extra.dfVar}</span>
              <span className="text-blue-400">/</span>
              <span className="font-mono font-medium">{extra.dataVar}</span>
              <span className="text-blue-400">←</span>
              <span>{extra.datasetId}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, message, dark }) {
  if (status === 'idle') return null

  const colors = dark
    ? {
        loading: 'bg-yellow-900/60 text-yellow-300',
        ready: 'bg-green-900/60 text-green-300',
        running: 'bg-blue-900/60 text-blue-300',
      }
    : {
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
