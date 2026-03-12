/* Pyodide WebWorker — runs Python code in a sandboxed thread */

let pyodide = null

async function initPyodide() {
  postMessage({ type: 'status', status: 'loading', message: 'Loading Pyodide...' })

  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js')

  pyodide = await loadPyodide()

  postMessage({ type: 'status', status: 'loading', message: 'Installing packages...' })

  await pyodide.loadPackage('micropip')
  const micropip = pyodide.pyimport('micropip')
  await micropip.install(['pandas', 'scipy', 'matplotlib'])

  // Pre-import common packages so first execution is faster
  await pyodide.runPythonAsync(`
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
`)

  // Load the conf library bundle
  postMessage({ type: 'status', status: 'loading', message: 'Loading conf library...' })
  const confResponse = await fetch('/conf_bundle.py')
  const confCode = await confResponse.text()
  await pyodide.runPythonAsync(confCode)

  postMessage({ type: 'status', status: 'ready' })
}

async function loadDataset(csvUrl) {
  postMessage({ type: 'status', status: 'loading', message: 'Loading dataset...' })

  const response = await fetch(csvUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`)
  }
  const csvText = await response.text()

  // Load CSV text into pandas DataFrame
  pyodide.globals.set('__csv_text__', csvText)
  await pyodide.runPythonAsync(`
import pandas as pd
from io import StringIO
df = pd.read_csv(StringIO(__csv_text__))
del __csv_text__
`)

  // Auto-create conf data wrapper with column detection
  await pyodide.runPythonAsync(`
data = conf.load(df)
print(f"Shape: {df.shape}")
print("Detected columns:")
for role, col_name in data.columns.items():
    if col_name:
        print(f"  {role:18s} -> {col_name}")
`)

  const shape = pyodide.runPython('str(df.shape)')
  postMessage({ type: 'stdout', text: `Dataset loaded: df.shape = ${shape}\n` })
  postMessage({ type: 'status', status: 'ready' })
}

async function execute(code) {
  postMessage({ type: 'status', status: 'running' })

  // Reset matplotlib and override plt.show() to capture figures
  await pyodide.runPythonAsync(`
import matplotlib.pyplot as plt
plt.close('all')

__captured_figures__ = []
_original_show = plt.show
def _capture_show(*args, **kwargs):
    for fig_num in plt.get_fignums():
        __captured_figures__.append(plt.figure(fig_num))
plt.show = _capture_show
`)

  // Set up stdout/stderr capture
  await pyodide.runPythonAsync(`
import sys
from io import StringIO
__stdout_capture__ = StringIO()
__stderr_capture__ = StringIO()
sys.stdout = __stdout_capture__
sys.stderr = __stderr_capture__
`)

  let success = true
  try {
    await pyodide.runPythonAsync(code)
  } catch (err) {
    success = false
    postMessage({ type: 'stderr', text: err.message + '\n' })
  }

  // Collect captured stdout/stderr
  const stdout = pyodide.runPython('__stdout_capture__.getvalue()')
  const stderr = pyodide.runPython('__stderr_capture__.getvalue()')

  // Restore original stdout/stderr and plt.show
  await pyodide.runPythonAsync(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
del __stdout_capture__
del __stderr_capture__
plt.show = _original_show
del _original_show
`)

  if (stdout) {
    postMessage({ type: 'stdout', text: stdout })
  }
  if (stderr) {
    postMessage({ type: 'stderr', text: stderr })
  }

  // Collect ALL matplotlib figures
  try {
    const nPlots = pyodide.runPython(`
import matplotlib.pyplot as plt
import base64
from io import BytesIO

__plot_results__ = []
fig_nums = plt.get_fignums()
for fn in fig_nums:
    fig = plt.figure(fn)
    if fig.get_axes():
        buf = BytesIO()
        fig.savefig(buf, format='png', dpi=100, bbox_inches='tight', facecolor='white')
        buf.seek(0)
        __plot_results__.append(base64.b64encode(buf.read()).decode('utf-8'))
plt.close('all')
len(__plot_results__)
`)
    if (nPlots > 0) {
      const plotList = pyodide.runPython('__plot_results__').toJs()
      for (const plotData of plotList) {
        postMessage({ type: 'plot', data: plotData })
      }
    }
    pyodide.runPython('del __plot_results__\ndel __captured_figures__')
  } catch (_) {
    // matplotlib not used or not imported — ignore
  }

  postMessage({ type: 'result', success })
  postMessage({ type: 'status', status: 'ready' })
}

onmessage = async function (e) {
  const { type } = e.data

  try {
    if (type === 'init') {
      await initPyodide()
    } else if (type === 'load-dataset') {
      await loadDataset(e.data.csvUrl)
    } else if (type === 'reload-conf') {
      await pyodide.runPythonAsync(e.data.code)
      postMessage({ type: 'status', status: 'ready' })
    } else if (type === 'execute') {
      await execute(e.data.code)
    }
  } catch (err) {
    postMessage({ type: 'stderr', text: `Worker error: ${err.message}\n` })
    postMessage({ type: 'result', success: false })
    postMessage({ type: 'status', status: 'ready' })
  }
}
