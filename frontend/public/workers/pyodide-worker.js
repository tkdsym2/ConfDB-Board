/* Pyodide WebWorker — runs Python code in a sandboxed thread */

let pyodide = null

async function initPyodide() {
  postMessage({ type: 'status', status: 'loading', message: 'Loading Pyodide...' })

  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js')

  pyodide = await loadPyodide()

  postMessage({ type: 'status', status: 'loading', message: 'Installing packages...' })

  await pyodide.loadPackage('micropip')
  const micropip = pyodide.pyimport('micropip')
  await micropip.install(['pandas', 'scipy', 'matplotlib', 'tqdm'])

  // Pre-import common packages so first execution is faster
  await pyodide.runPythonAsync(`
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# Disable tqdm monitor thread (not supported in WebWorker)
import tqdm
tqdm.tqdm.monitor_interval = 0
`)

  // Load the conf library bundle
  postMessage({ type: 'status', status: 'loading', message: 'Loading conf library...' })
  const confResponse = await fetch('/conf_bundle.py')
  const confCode = await confResponse.text()
  await pyodide.runPythonAsync(confCode)

  // Load the metacog library bundle (metacognitive measures)
  postMessage({ type: 'status', status: 'loading', message: 'Loading metacog library...' })
  const metacogResponse = await fetch('/metacog_bundle.py')
  const metacogCode = await metacogResponse.text()
  await pyodide.runPythonAsync(metacogCode)

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

  // Capture baseline globals for user variable tracking
  await pyodide.runPythonAsync(`
__baseline_globals__ = set(globals().keys())
__baseline_globals__.add('__baseline_globals__')
`)

  postMessage({ type: 'status', status: 'ready' })
}

async function loadExtraDataset(csvUrl, dfVar, dataVar) {
  postMessage({ type: 'status', status: 'loading', message: `Loading into ${dfVar}...` })

  const response = await fetch(csvUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`)
  }
  const csvText = await response.text()

  pyodide.globals.set('__csv_text__', csvText)
  pyodide.globals.set('__df_var__', dfVar)
  pyodide.globals.set('__data_var__', dataVar)
  await pyodide.runPythonAsync(`
import pandas as pd
from io import StringIO
globals()[__df_var__] = pd.read_csv(StringIO(__csv_text__))
globals()[__data_var__] = conf.load(globals()[__df_var__])
_shape = globals()[__df_var__].shape
_data = globals()[__data_var__]
print(f"{__df_var__}: shape={_shape}")
print(f"{__data_var__}: detected columns:")
for role, col_name in _data.columns.items():
    if col_name:
        print(f"  {role:18s} -> {col_name}")
del __csv_text__, __df_var__, __data_var__, _shape, _data
`)

  postMessage({ type: 'stdout', text: `Extra dataset loaded as ${dfVar} / ${dataVar}\n` })
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

  // Set up live stdout (streams to main thread immediately) and captured stderr
  await pyodide.runPythonAsync(`
import sys, js
from io import StringIO
from pyodide.ffi import to_js

def _post(msg_type, text):
    js.postMessage(to_js({'type': msg_type, 'text': text}, dict_converter=js.Object.fromEntries))

class _LiveStdout:
    """Streams stdout to the main thread line-by-line via postMessage.
    Handles \\r (carriage return) for tqdm progress bar updates."""
    def __init__(self):
        self._buffer = ''
        self._cr_pending = False
    def write(self, text):
        if not text:
            return
        self._buffer += text
        while True:
            idx_n = self._buffer.find('\\n')
            idx_r = self._buffer.find('\\r')
            if idx_n < 0 and idx_r < 0:
                break
            if idx_r >= 0 and (idx_n < 0 or idx_r < idx_n):
                self._buffer = self._buffer[idx_r + 1:]
                self._cr_pending = True
            elif idx_n >= 0:
                line = self._buffer[:idx_n]
                self._buffer = self._buffer[idx_n + 1:]
                msg_type = 'stdout-cr' if self._cr_pending else 'stdout'
                _post(msg_type, line + '\\n')
                self._cr_pending = False
    def flush(self):
        if self._buffer:
            msg_type = 'stdout-cr' if self._cr_pending else 'stdout'
            _post(msg_type, self._buffer)
            self._buffer = ''

__stderr_capture__ = StringIO()
sys.stdout = _LiveStdout()
sys.stderr = __stderr_capture__
`)

  let success = true
  try {
    await pyodide.runPythonAsync(code)
  } catch (err) {
    success = false
    postMessage({ type: 'stderr', text: err.message + '\n' })
  }

  // Flush remaining stdout and collect stderr
  pyodide.runPython('sys.stdout.flush()')
  const stderr = pyodide.runPython('__stderr_capture__.getvalue()')

  // Restore original stdout/stderr and plt.show
  await pyodide.runPythonAsync(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
del __stderr_capture__
plt.show = _original_show
del _original_show
`)

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

  // Collect user-defined globals
  try {
    const userVarsJson = pyodide.runPython(`
import json as _json, types as _types
_uv = []
if '__baseline_globals__' in globals():
    for _n in sorted(globals().keys()):
        if _n.startswith('_') or _n in __baseline_globals__:
            continue
        _v = globals()[_n]
        if isinstance(_v, _types.ModuleType):
            continue
        _t = type(_v).__name__
        if hasattr(_v, 'shape'):
            _r = f"shape={_v.shape}"
        elif isinstance(_v, (list, dict, set, tuple)):
            _r = f"len={len(_v)}"
        elif isinstance(_v, (int, float, bool, type(None))):
            _r = repr(_v)
        elif isinstance(_v, str):
            _s = repr(_v)
            _r = _s if len(_s) <= 50 else _s[:47] + "...'"
        else:
            try:
                _r = repr(_v)
                if len(_r) > 60:
                    _r = _r[:57] + '...'
            except:
                _r = _t
        _uv.append({'name': _n, 'type': _t, 'repr': _r})
_json.dumps(_uv)
`)
    postMessage({ type: 'globals', variables: JSON.parse(userVarsJson) })
  } catch (_) {
    // ignore errors in globals collection
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
    } else if (type === 'load-extra-dataset') {
      await loadExtraDataset(e.data.csvUrl, e.data.dfVar, e.data.dataVar)
    } else if (type === 'reload-conf') {
      await pyodide.runPythonAsync(e.data.code)
      postMessage({ type: 'status', status: 'ready' })
    } else if (type === 'reload-metacog') {
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
