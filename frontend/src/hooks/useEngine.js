import { useState, useRef, useCallback } from 'react'

export function useEngine() {
  const workerRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | loading | ready | running
  const [statusMessage, setStatusMessage] = useState('')
  const [output, setOutput] = useState([])

  // Resolves when current operation completes
  const pendingRef = useRef(null)

  const handleMessage = useCallback((e) => {
    const msg = e.data

    if (msg.type === 'status') {
      setStatus(msg.status)
      setStatusMessage(msg.message || '')
      // Resolve pending promise when transitioning to 'ready' after an operation
      if (msg.status === 'ready' && pendingRef.current) {
        pendingRef.current.resolve()
        pendingRef.current = null
      }
    } else if (msg.type === 'stdout') {
      setOutput((prev) => [...prev, { type: 'stdout', text: msg.text }])
    } else if (msg.type === 'stderr') {
      setOutput((prev) => [...prev, { type: 'stderr', text: msg.text }])
    } else if (msg.type === 'plot') {
      setOutput((prev) => [...prev, { type: 'plot', data: msg.data }])
    } else if (msg.type === 'result') {
      setOutput((prev) => [...prev, { type: 'result', success: msg.success }])
    }
  }, [])

  const waitForReady = useCallback(() => {
    return new Promise((resolve, reject) => {
      pendingRef.current = { resolve, reject }
    })
  }, [])

  const init = useCallback(async () => {
    // Terminate existing worker if any
    if (workerRef.current) {
      workerRef.current.terminate()
    }

    const worker = new Worker('/workers/pyodide-worker.js')
    worker.onmessage = handleMessage
    workerRef.current = worker

    setStatus('loading')
    setStatusMessage('Loading Pyodide...')
    setOutput([])

    worker.postMessage({ type: 'init' })
    await waitForReady()
  }, [handleMessage, waitForReady])

  const loadDataset = useCallback(async (datasetId, csvUrl) => {
    if (!workerRef.current) throw new Error('Engine not initialized')

    setStatus('loading')
    setStatusMessage('Loading dataset...')

    workerRef.current.postMessage({ type: 'load-dataset', datasetId, csvUrl })
    await waitForReady()
  }, [waitForReady])

  const reloadConf = useCallback(async (code) => {
    if (!workerRef.current) throw new Error('Engine not initialized')
    workerRef.current.postMessage({ type: 'reload-conf', code })
    await waitForReady()
  }, [waitForReady])

  const reloadMetacog = useCallback(async (code) => {
    if (!workerRef.current) throw new Error('Engine not initialized')
    workerRef.current.postMessage({ type: 'reload-metacog', code })
    await waitForReady()
  }, [waitForReady])

  const execute = useCallback(async (code) => {
    if (!workerRef.current) throw new Error('Engine not initialized')

    setStatus('running')
    workerRef.current.postMessage({ type: 'execute', code })
    await waitForReady()
  }, [waitForReady])

  const clearOutput = useCallback(() => {
    setOutput([])
  }, [])

  return { status, statusMessage, output, init, loadDataset, reloadConf, reloadMetacog, execute, clearOutput }
}
