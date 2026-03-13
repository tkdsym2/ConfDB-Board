# Confidence Database Analysis Platform

## Project Overview

Web platform for exploring and analyzing the Confidence Database (Rahnev et al., 2020, Nature Human Behaviour). Users browse 180 behavioral datasets, select analysis templates, and run Python code in-browser via Pyodide.

- Paper: https://www.nature.com/articles/s41562-019-0813-1
- Data: https://osf.io/s46pr/ (CC0 license)
- 180 datasets, 11,653 participants, 5.3M trials

## Tech Stack

- **Frontend**: React 19 + Vite 7 + TailwindCSS v4 (`@tailwindcss/vite`) + React Router v7
- **State**: TanStack Query v5 (data fetching), Zustand v5 (installed, not yet used)
- **Backend**: Supabase (PostgreSQL + Storage + Edge Functions) — fully populated
- **Code Editor**: Monaco Editor (`@monaco-editor/react`)
- **Execution**: Pyodide v0.27.4 in WebWorker (micropip → pandas, scipy, matplotlib, tqdm)
- **Email**: Resend API (via Supabase Edge Function)
- **Deployment**: render.com Static Site (free tier)

## Directory Structure

```
ConfDBBoard/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Layout.jsx           # Nav bar (Datasets, Analyses, Feedback, GitHub) + Outlet
│   │   ├── hooks/
│   │   │   ├── useDatasets.js        # useDatasets, useTagCounts, useDataset, useDatasetWithTags, useDatasetTags
│   │   │   ├── useAnalyses.js        # useAnalyses, useAnalysis, getAnalysisTagIds, datasetSupportsAnalysis
│   │   │   └── useEngine.js          # Pyodide worker lifecycle (idle→loading→ready→running), userGlobals tracking
│   │   ├── lib/
│   │   │   └── supabase.js           # Supabase client + supabaseUrl export
│   │   ├── pages/
│   │   │   ├── Home.jsx              # Landing: featured datasets (random 6), Pyodide test, about/contact
│   │   │   ├── Datasets.jsx          # Catalog: search + domain/task/tag filters, two-row layout per dataset
│   │   │   ├── DatasetDetail.jsx     # Metadata, paper title/DOI link, tags, download/sandbox buttons
│   │   │   ├── Analyses.jsx          # Analysis-first entry: cards with compatible datasets
│   │   │   ├── Sandbox.jsx           # Dual-tab editor + split output + template/custom scripts + multi-dataset loader + manual
│   │   │   └── Feedback.jsx          # Feedback form with subject dropdown, sidebar, Resend email
│   │   ├── App.jsx                   # Data router (createBrowserRouter + RouterProvider)
│   │   ├── main.jsx                  # Entry: QueryClientProvider wrapping App
│   │   └── index.css                 # @import "tailwindcss"
│   ├── public/
│   │   ├── conf_bundle.py            # Auto-generated conf library for Pyodide
│   │   ├── metacog_bundle.py          # Auto-generated metacog library for Pyodide
│   │   ├── favicon.svg               # Lightbulb favicon (replaces vite.svg)
│   │   ├── og-image.svg              # OG image source (SVG)
│   │   ├── og-image.png              # OG image for social sharing (1200x630)
│   │   ├── vite.svg                  # Original Vite icon (unused)
│   │   └── workers/
│   │       └── pyodide-worker.js     # Pyodide WebWorker
│   ├── index.html                    # Entry HTML with OG/Twitter meta tags, favicon
│   ├── .env                          # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (gitignored)
│   ├── .env.example
│   ├── package.json
│   ├── eslint.config.js
│   └── vite.config.js
├── libraries/python/
│   ├── conf/                         # Source modules for conf library
│   │   ├── __init__.py
│   │   ├── loader.py                 # Column detection + ConfData wrapper
│   │   ├── sdt.py                    # d' and criterion (Signal Detection Theory)
│   │   ├── metacognition.py          # Type 2 ROC and AUC
│   │   └── viz.py                    # Plotting helpers
│   ├── metacog/                      # Source modules for metacog library (metacognitive measures)
│   │   ├── __init__.py
│   │   ├── raw.py                    # Gamma, Phi, ΔConf
│   │   ├── meta_d.py                 # meta-d' MLE
│   │   ├── ideal.py                  # SDT ideal observer expected values
│   │   ├── model_based.py            # meta-noise, meta-uncertainty
│   │   └── summary.py               # compute_all + print_summary
│   ├── conf_bundle.py               # Auto-generated bundle (source of truth copy)
│   └── metacog_bundle.py             # Auto-generated bundle (source of truth copy)
├── scripts/
│   ├── build_conf_bundle.py          # Bundles conf/ modules → conf_bundle.py
│   ├── build_metacog_bundle.py       # Bundles metacog/ modules → metacog_bundle.py
│   ├── extract_paper_info.py         # Extracts paper titles/DOIs from readme files → paper_info.csv
│   ├── seed_analyses.mjs             # Seeds 4 analyses + analysis_tags into Supabase
│   ├── seed_paper_info.mjs           # Populates paper_title/paper_doi in datasets table
│   ├── seed_paper_info.sql           # SQL: adds paper_title/paper_doi columns, recreates view
│   ├── update_analyses.mjs           # Updates python_template to use conf library
│   ├── update_analyses.sql           # SQL version of template updates
│   ├── seed_analyses.sql             # SQL version of seed data
│   └── ingest_to_supabase.py         # Original data ingestion script
├── datasheet/
│   ├── dataset_catalog.csv
│   ├── dataset_tags.csv
│   ├── tag_definitions.csv
│   ├── column_mapping.csv
│   ├── paper_info.csv                # Extracted paper titles/DOIs (183 datasets)
│   ├── analysis_report.txt
│   └── main.py
├── conf_db_data/                     # Raw CSVs + readme files (~243MB, gitignored)
│   ├── Confidence Database/          # 180 data CSVs + 180 readme files
│   └── Database_Information.xlsx     # Master spreadsheet (authors, journal, year, stimuli, etc.)
├── supabase/
│   └── functions/
│       └── send-feedback/
│           └── index.ts              # Edge Function: feedback form → Resend email (Deno)
├── .env                              # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for scripts)
├── .env.example
├── .gitignore
├── .python-version
├── pyproject.toml
├── uv.lock
├── README.md
└── CLAUDE.md
```

## Environment Variables

**`frontend/.env`** (for Vite/browser):
```
VITE_SUPABASE_URL=https://lgcmgbovzcyxtbvfdggr.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

**Root `.env`** (for scripts only):
```
SUPABASE_URL=https://lgcmgbovzcyxtbvfdggr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>
```

## Supabase Edge Functions

### send-feedback

Location: `supabase/functions/send-feedback/index.ts` (Deno runtime)

Receives feedback form submissions and sends email via Resend API. Deployed with `--no-verify-jwt` (public endpoint, no auth required).

**Endpoint**: `POST {SUPABASE_URL}/functions/v1/send-feedback`

**Request body**: `{ name, email, subject, message }` (all required strings)

**Behavior**:
- CORS: allows all origins, handles OPTIONS preflight
- Validates all fields present, email format
- HTML-escapes all user input (XSS prevention)
- Sends via Resend API with `reply_to` set to sender's email
- From: `ConfDB Feedback <onboarding@resend.dev>`
- Subject: `[ConfDB Feedback] {subject}`

**Secrets** (set via `supabase secrets set`):
- `RESEND_API_KEY` — Resend API key
- `FEEDBACK_TO` — recipient email (currently `kazuma.takada222@gmail.com`)

**Note**: Resend free tier only allows sending to the account owner's email. To send to other addresses, verify a custom domain at resend.com/domains.

**Deploy**: `supabase functions deploy send-feedback --no-verify-jwt`

## Supabase Schema

### Tables

**tags** (14 rows): `id(TEXT PK)`, `name`, `category`, `sort_order`
- IDs are slugs: `accuracy`, `mean_confidence`, `dprime`, `criterion`, `type2_roc`, etc.
- Categories: `basic`, `sdt`, `metacognition`, `rt`

**datasets** (180 rows): `id(TEXT PK)`, `paper_author`, `paper_year`, `paper_journal`, `paper_title`, `paper_doi`, `domain`, `task_type`, `task_description`, `n_participants`, `n_trials_total`, `confidence_scale`, `confidence_min`, `confidence_max`, `conf_is_discrete`, `conf_n_levels`, `has_rt`, `has_confidence_rt`, `rt_type`, `is_multi_task`, `has_condition`, `csv_filename`, `csv_size_bytes`, `storage_path`
- IDs are text like `"Adler_2018_Expt1"`, NOT integers
- `paper_title`: extracted from readme files (136 datasets have titles)
- `paper_doi`: DOI URL when available (62 datasets have DOIs)

**dataset_tags** (2,013 rows): `dataset_id(FK→datasets)`, `tag_id(FK→tags)`, `note`

**analyses** (5 rows): `id(INT PK)`, `name`, `description`, `category`, `difficulty`, `python_template`, `r_template`, `required_columns[]`, `sort_order`
- IDs 1-5, all difficulty `"basic"`, no auto-increment

**analysis_tags**: `analysis_id(FK→analyses)`, `tag_id(FK→tags)`, `is_primary`

### Views
- `datasets_with_tags`: datasets joined with aggregated `tag_ids[]` and `tag_names[]` arrays (includes paper_title, paper_doi)
- `tag_counts`: tag `id`/`name`/`category` with `dataset_count`

### Storage
- Bucket `csv-files` (public read): 180 CSVs
- URL pattern: `{SUPABASE_URL}/storage/v1/object/public/csv-files/data_{dataset_id}.csv`

## Analysis Templates (5 seeded)

| ID | Name | Required Tags |
|----|------|---------------|
| 1 | Basic Descriptive Statistics | mean_confidence |
| 2 | Signal Detection: d' and criterion | dprime |
| 3 | Confidence-Accuracy Correlation | confidence_accuracy |
| 4 | RT Distribution | rt_distribution |
| 5 | Metacognitive Measures | confidence_accuracy, dprime, type2_auc |

All templates use `conf.load(df)` for column detection. Compatibility is checked via tag_ids: `requiredTagIds.every(t => availableTagIds.includes(t))`.

Templates reference `data.raw` (not raw `df`) when accessing computed columns like `_accuracy`, since `conf.load()` may add them to a copy.

## conf Library API

Source: `libraries/python/conf/` → bundled to `conf_bundle.py`.

Available in Pyodide sandbox as the `conf` namespace:

```python
# Loader
data = conf.load(df)              # Returns ConfData with auto-detected columns
data.col('subject')               # Get actual column name for role
data.has('rt_decision')           # Check if role exists
data.get('confidence')            # Get column Series
data.raw                          # The wrapped DataFrame (may include computed columns like _accuracy)
data.subject_col                  # Shortcut properties
data.describe()                   # Print column mappings

# Signal Detection Theory
sdt_result = conf.dprime(data)    # Returns DataFrame: subject, dprime, criterion, hit_rate, fa_rate

# Metacognition
roc_df = conf.type2_roc(data)     # Type 2 ROC points per subject
auc_df = conf.type2_auc(data)     # Type 2 AUC per subject

# Visualization
conf.plot_confidence_accuracy(data)
conf.plot_dprime_distribution(sdt_result)
conf.plot_rt_distribution(data, n_subjects=6)
```

Column roles detected: `subject`, `stimulus`, `response`, `confidence`, `accuracy`, `rt_decision`, `rt_confidence`, `rt_combined`, `rt_generic`, `difficulty`, `condition`, `error`.

### conf_bundle.py Build Process

The build script (`scripts/build_conf_bundle.py`) bundles source modules into a single file:
- Strips per-module imports, deduplicates into a unified import block
- Renames top-level functions with `_` prefix (e.g. `dprime` → `_dprime`) to keep the global namespace clean
- The rename regex skips matches inside string literals (quoted with `'` or `"`) to avoid corrupting dictionary keys and column names
- Appends a `class conf:` wrapper that exposes all functions via `staticmethod()`
- Outputs to both `libraries/python/conf_bundle.py` and `frontend/public/conf_bundle.py`

## metacog Library API

Source: `libraries/python/metacog/` → bundled to `metacog_bundle.py`.

Available in Pyodide sandbox as the `metacog` namespace. Implements all 17 metacognitive measures (Shekhar & Rahnev, 2025).

```python
# Compute all 17 measures at once (verbose=True by default, shows tqdm progress bars)
results = metacog.compute_all(data)           # Returns DataFrame with all measures per subject
metacog.print_summary(results)                # Formatted console output

# Skip slower model-based measures (meta-noise, meta-uncertainty)
results = metacog.compute_all(data, include_model_based=False)

# Disable progress output
results = metacog.compute_all(data, verbose=False)

# Individual raw measures (verbose=False by default)
gamma_df = metacog.gamma(data)                # Goodman-Kruskal gamma
phi_df = metacog.phi(data)                    # Pearson correlation (confidence × accuracy)
dconf_df = metacog.delta_conf(data)           # Mean confidence: correct - incorrect

# meta-d' (MLE)
md_df = metacog.meta_d(data)                  # Returns: subject, meta_d, dprime, criterion

# SDT expected values (ideal observer simulation)
expected_df = metacog.sdt_expected(data, sdt_df)  # Expected AUC2, Gamma, Phi, ΔConf

# Model-based measures
mn_df = metacog.meta_noise(data)              # Noisy readout model σ
mu_df = metacog.meta_uncertainty(data)        # CASANDRE model σ

# All individual functions accept verbose=True to show tqdm progress per subject
md_df = metacog.meta_d(data, verbose=True)
```

**17 measures computed:**
- Raw (5): meta-d', AUC2, Gamma, Phi, ΔConf
- Ratio (5): M-Ratio, AUC2-Ratio, Gamma-Ratio, Phi-Ratio, ΔConf-Ratio
- Difference (5): M-Diff, AUC2-Diff, Gamma-Diff, Phi-Diff, ΔConf-Diff
- Model-based (2): meta-noise, meta-uncertainty

### metacog_bundle.py Build Process

Same approach as conf_bundle.py. Build script: `scripts/build_metacog_bundle.py`.
- Cross-module references are also renamed (e.g. summary.py calls `_gamma()` instead of `gamma()`)
- Assumes `conf` class is already loaded in global scope
- Unified imports include `sys`, `tqdm` (for progress bars) in addition to numpy/pandas/scipy
- Build: `cd frontend && npm run build:metacog` or `/usr/bin/python3 scripts/build_metacog_bundle.py`

### Progress Tracking (tqdm)

All per-subject computation functions accept a `verbose` parameter. When `verbose=True`, tqdm progress bars show per-subject progress (e.g. `meta-d':  60%|██████    | 15/25`). `compute_all()` defaults to `verbose=True`; individual functions default to `verbose=False`.

tqdm writes to `sys.stdout` with `\r` carriage returns for in-place updates. The Pyodide worker's `_LiveStdout` class detects `\r` and sends `stdout-cr` messages (instead of `stdout`) so the frontend can replace the previous line rather than appending. tqdm's monitor thread is disabled at init (`tqdm.tqdm.monitor_interval = 0`) since WebWorkers don't support threading.

## Pyodide Worker Protocol

Worker location: `frontend/public/workers/pyodide-worker.js`

**Inbound messages** (main → worker):
- `{ type: 'init' }` — load Pyodide, install packages, load conf_bundle.py and metacog_bundle.py
- `{ type: 'load-dataset', csvUrl }` — fetch CSV, create `df` and `data = conf.load(df)`, capture baseline globals
- `{ type: 'load-extra-dataset', csvUrl, dfVar, dataVar }` — fetch CSV into user-specified variable names (e.g. `df2`, `data2`)
- `{ type: 'reload-conf', code }` — re-execute conf library code (for live editing)
- `{ type: 'reload-metacog', code }` — re-execute metacog library code (for live editing)
- `{ type: 'execute', code }` — run user code with stdout/stderr/plot capture + collect user-defined globals

**Outbound messages** (worker → main):
- `{ type: 'status', status, message }` — status: `loading` | `ready` | `running`
- `{ type: 'stdout', text }` — captured print output (appended to console)
- `{ type: 'stdout-cr', text }` — carriage-return output (replaces last `stdout-cr` entry; used by tqdm progress bars)
- `{ type: 'stderr', text }` — errors
- `{ type: 'plot', data }` — base64 PNG string
- `{ type: 'globals', variables }` — array of `{name, type, repr}` for user-defined globals (after each execute)
- `{ type: 'result', success }` — execution complete

**Globals available to user code**: `df`, `data`, `conf`, `metacog`, `pd`, `np`, `plt`, `tqdm`

**Variable persistence**: Python globals persist across all `execute()` calls within a session. Variables defined in one script (e.g. Explore) are accessible when switching to another template (e.g. Basic Descriptive Statistics). After `loadDataset()`, the worker captures `__baseline_globals__`; after each `execute()`, it diffs current globals against the baseline to identify user-defined variables (filtering out `_`-prefixed names and modules) and sends them via the `globals` message.

**Initialization**: After installing packages, the worker pre-imports pandas/numpy/matplotlib and disables tqdm's monitor thread (`tqdm.tqdm.monitor_interval = 0`) to avoid WebWorker threading errors.

Plot capture: `plt.show()` is overridden per-execution to collect figures. After execution, all figures with axes are exported as base64 PNGs via `plt.get_fignums()`.

## Frontend Routes & Components

| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | Landing: featured datasets (random 6), Pyodide test, about/contact |
| `/datasets` | Datasets | Catalog with search, domain/task/tag filters, two-row layout |
| `/datasets/:id` | DatasetDetail | Metadata, paper title/DOI, tags, download CSV, open in sandbox |
| `/analyses` | Analyses | Analysis cards with compatible dataset lists |
| `/sandbox` | Sandbox | Editor + split output + multi-dataset loader + manual |
| `/feedback` | Feedback | Feedback form with subject dropdown, sidebar info, email via Resend |

Router uses `createBrowserRouter` + `RouterProvider` (data router pattern, required for `useBlocker`).

Sandbox accepts query params: `?dataset={id}&analysis={id}`

### Home Page Features

- **Featured Datasets**: 6 randomly selected dataset cards in a 2x3 grid (responsive). Shows skeleton loading placeholders while data loads.
- **Pyodide Test**: Explanation that analyses run client-side via Pyodide (linked), with a test button to verify browser compatibility.
- **About section**: Developer credits and contact info (X, email).
- **Copyright**: Footer with dynamic year.

### Datasets Catalog Features

- Search by ID, author, paper title, or description
- Filter by domain, task type, and tags (multi-select)
- **Two-row layout per dataset**: top row = metadata columns (ID, Author, Year, Paper, Domain, Task Type, N, Trials); bottom row = tags spanning full width
- Paper titles are clickable links when DOI is available
- Datasets separated by thicker borders (`border-b-2 border-gray-300`)

### DatasetDetail Features

- Header: dataset ID, author (year), journal, paper title with DOI link
- Metadata table: participants, trials, confidence scale, RT, multi-task, condition, CSV size
- Tags grouped by category
- Download CSV and Open in Sandbox buttons

### Feedback Page Features

- **Two-column layout**: form (2/3) + sidebar (1/3), stacks on mobile
- **Subject dropdown**: predefined topics (Bug Report, Feature Request, Dataset Issue, Analysis Question, General Feedback, Other)
- **Sidebar**: "What kind of feedback?" descriptions + "Other ways to reach us" (GitHub Issues, X, email)
- **Success state**: full-page confirmation with checkmark, "Send another" and "Back to Home" buttons
- **Loading state**: spinner animation on submit button
- **Error state**: inline error banner with icon, shows Resend API error detail
- POSTs JSON to `${VITE_SUPABASE_URL}/functions/v1/send-feedback` edge function

### Sandbox Features

**Top bar:**
- Dataset name, domain badge, "Change dataset" link
- Collapsible "Import additional dataset" section below dataset name (see Multi-dataset loader below)

**Editor panel (left 3/5):**
- File tabs: `main.py` (user script), `conf.py` (conf library source), and `metacog.py` (metacog library source)
- VS Code-style tab bar with blue top-border accent on active tab
- Amber dot indicator on modified tabs
- conf.py and metacog.py always viewable/editable; changes are reloaded in Pyodide on Run
- Reset button for conf.py/metacog.py to restore original
- **Action buttons in tab bar** (right side): Saved flash, StatusBadge (dark theme), Clear, Manual (book icon), Run — all styled for dark background

**Output panel (right 2/5):**
- Split into **Variables** (collapsible, user-defined globals) + **Console** (stdout/stderr/result) + **Plots** (base64 PNGs)
- Variables panel shows name, type, and brief repr for each user-defined global; updates after each execution
- Console takes full height when no plots; 50/50 split when plots exist
- Each section independently scrollable

**Template selector:**
- Built-in templates: Explore + analysis templates (shown when compatible with dataset)
- Custom scripts: flat list of user-created scripts, persisted in `localStorage` (`sandbox-custom-scripts`)
- `+` button creates a new script directly (inline name input → auto-selected in editor)
- Delete via `x` badge on hover (with confirmation)

**Multi-dataset loader:**
- Collapsible panel in top bar below dataset name
- Searchable dropdown to pick additional datasets (filters by ID, author, paper title)
- Two input fields for custom variable names (DataFrame var e.g. `df2`, ConfData var e.g. `data2`)
- Validates Python identifier syntax, prevents duplicate/conflicting names
- Auto-increments variable names after each load
- Loaded extras shown as compact badges; worker creates globals via `load-extra-dataset` message

**Sandbox Manual:**
- Book icon button in editor tab bar opens a modal
- Documents: pre-loaded globals, conf API, metacog API, importing datasets, variable persistence, plots, keyboard shortcuts, editor tabs
- Closes via Escape, clicking outside, or X button

**Keyboard shortcuts:**
- Cmd+S / Ctrl+S: saves checkpoint (clears dirty dot), prevents browser save dialog
- Cmd+R / Ctrl+R: runs script, prevents browser page reload
- `handleRunRef` pattern: ref always points to latest `handleRun` callback so the keyboard event listener doesn't re-register on every code change

**Script preservation:**
- `scriptsMapRef` stores code per built-in template; custom scripts stored in `customScripts` state
- Switching templates saves current code, restores previous edits
- For built-in templates: Cmd+S does NOT clear the leave guard (code still differs from original template)
- For custom scripts: Cmd+S updates the leave guard baseline (user owns the template)
- "Saved" flash indicator appears briefly in tab bar

**Navigation guards:**
- `beforeunload` event for browser reload/close
- `useBlocker` modal ("Leave this page?") for in-app navigation
- Both trigger when code differs from original template (`hasModifiedWork`)
- Two-layer dirty tracking:
  - `codeSaved` / `confSaved`: Cmd+S checkpoint (tab dirty dots)
  - `codeInitial` / `confInitial`: original template (leave guard)

**StatusBadge component:**
- Accepts `dark` prop for dark-themed tab bar variant (dark translucent backgrounds)
- Light variant used elsewhere (if needed)

## Paper Info Pipeline

Paper titles and DOIs are extracted from the readme files bundled with the original dataset:

1. **Extract**: `uv run python scripts/extract_paper_info.py` — parses `conf_db_data/Confidence Database/readme_*.txt` files, outputs `datasheet/paper_info.csv`
2. **Migrate**: Run `scripts/seed_paper_info.sql` in Supabase SQL Editor — adds `paper_title`/`paper_doi` columns, recreates `datasets_with_tags` view
3. **Seed**: `cd frontend && node ../scripts/seed_paper_info.mjs` — populates columns from CSV

Coverage: 136/180 datasets have paper titles, 62 have DOI links. Unpublished datasets (`_unpub` suffix) typically have no citation.

## Build & Development Commands

```bash
# Development
cd frontend && npm run dev          # Vite dev server

# Build frontend
cd frontend && npm run build        # Vite production build

# Rebuild conf library bundle (after editing libraries/python/conf/)
cd frontend && npm run build:conf   # Uses /usr/bin/python3 to bypass pyenv
# or directly:
/usr/bin/python3 scripts/build_conf_bundle.py

# Rebuild metacog library bundle (after editing libraries/python/metacog/)
cd frontend && npm run build:metacog
# or directly:
/usr/bin/python3 scripts/build_metacog_bundle.py

# Extract paper info from readme files
uv run python scripts/extract_paper_info.py

# Seed scripts (run from frontend/ for node_modules access)
cd frontend && node ../scripts/seed_analyses.mjs       # Seed analysis templates
cd frontend && node ../scripts/update_analyses.mjs     # Update python_template fields
cd frontend && node ../scripts/seed_paper_info.mjs     # Populate paper_title/paper_doi

# Deploy Supabase Edge Functions
supabase functions deploy send-feedback --no-verify-jwt
```

The build:conf script uses `/usr/bin/python3` explicitly because pyenv shims may interfere.

## Key Domain Concepts

### Domains (5)
Perception (119), Memory (28), Cognitive (17), Mixed (11), Motor (5)

### Task Types (5)
- `binary_classification` (158): 2AFC — supports d', accuracy, meta-d'
- `binary_response_graded_stimulus` (9): Graded stimulus + binary response — supports d'
- `ambiguous_binary` (3): No objective correct answer — limited analyses
- `multi_class` (5): 3+ categories — accuracy only, no d'
- `continuous_estimation` (5): Error-based metrics only

### Tags (14)
- basic: `accuracy`, `mean_confidence`, `mean_rt`
- sdt: `dprime`, `criterion`
- metacognition: `confidence_accuracy`, `type2_roc`, `type2_auc`, `meta_d_mle`, `m_ratio`, `estimation_error`, `confidence_error`
- rt: `rt_distribution`, `confidence_rt`

## Development Phases

- **Phase 1 (current)**: Frontend + Pyodide + basic analyses ← in progress
- **Phase 2**: webR support + R templates
- **Phase 3**: Server-side execution (FastAPI/Plumber) — optional
- **Phase 4**: Polish, export, deploy

## Code Style

- Functional React components with hooks
- TailwindCSS v4 for all styling (import-based, no config file, no CSS modules)
- Named exports for components/hooks, default exports for pages
- TanStack Query for all Supabase data fetching
- Plain JSX (no TypeScript)
- All hooks must be called before any conditional returns (Rules of Hooks)
