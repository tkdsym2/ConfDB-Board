#!/usr/bin/env python3
"""Build conf_bundle.py from the source modules in libraries/python/conf/.

Reads loader.py, sdt.py, metacognition.py, viz.py in order, strips per-file
imports, deduplicates them into a unified import block, renames top-level
functions with a `_` prefix to keep the global namespace clean, and appends
the `class conf:` namespace wrapper.

Outputs:
  - libraries/python/conf_bundle.py   (source of truth)
  - frontend/public/conf_bundle.py    (served by Vite)

Usage:
  python scripts/build_conf_bundle.py
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONF_DIR = ROOT / "libraries" / "python" / "conf"
OUT_BUNDLE = ROOT / "libraries" / "python" / "conf_bundle.py"
OUT_PUBLIC = ROOT / "frontend" / "public" / "conf_bundle.py"

# Modules in dependency order
MODULES = [
    {
        "file": "loader.py",
        "label": "loader.py \u2014 Column detection and ConfData wrapper",
        "renames": {
            "detect_columns": "_detect_columns",
            "load": "_load",
        },
    },
    {
        "file": "sdt.py",
        "label": "sdt.py \u2014 Signal Detection Theory",
        "renames": {
            "dprime": "_dprime",
        },
    },
    {
        "file": "metacognition.py",
        "label": "metacognition.py \u2014 Type 2 ROC and AUC",
        "renames": {
            "type2_roc": "_type2_roc",
            "type2_auc": "_type2_auc",
        },
    },
    {
        "file": "viz.py",
        "label": "viz.py \u2014 Visualization helpers",
        "renames": {
            "plot_confidence_accuracy": "_plot_confidence_accuracy",
            "plot_dprime_distribution": "_plot_dprime_distribution",
            "plot_rt_distribution": "_plot_rt_distribution",
        },
    },
]

# Unified imports at the top of the bundle (order matters for matplotlib.use)
UNIFIED_IMPORTS = """\
import re
import numpy as np
import pandas as pd
from scipy.stats import norm
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt"""

HEADER = """\
# conf_bundle.py — Auto-generated single-file bundle for Pyodide injection
# Built from libraries/python/conf/ by scripts/build_conf_bundle.py
# DO NOT EDIT — modify the source modules and re-run the build script.
#
# Usage inside the sandbox:
#   data = conf.load(df)
#   print(data.describe())
#   result = conf.dprime(data)
#   conf.plot_dprime_distribution(result)
"""

# The class conf: wrapper exposes all functions under a clean namespace.
CONF_CLASS = '''\

# ---------------------------------------------------------------------------
# Public namespace — all functions accessible as conf.xxx()
# ---------------------------------------------------------------------------

class conf:
    """Namespace for all conf library functions."""

    # Loader
    load = staticmethod(_load)
    detect_columns = staticmethod(_detect_columns)
    ConfData = ConfData

    # Signal Detection Theory
    dprime = staticmethod(_dprime)

    # Metacognition
    type2_roc = staticmethod(_type2_roc)
    type2_auc = staticmethod(_type2_auc)

    # Visualization
    plot_confidence_accuracy = staticmethod(_plot_confidence_accuracy)
    plot_dprime_distribution = staticmethod(_plot_dprime_distribution)
    plot_rt_distribution = staticmethod(_plot_rt_distribution)
'''

# Lines that should be stripped from module bodies (import dedup)
IMPORT_PATTERN = re.compile(
    r"^(?:import |from \S+ import )"
)
# matplotlib.use('Agg') is also an import-time statement to strip
MATPLOTLIB_USE_PATTERN = re.compile(
    r"^matplotlib\.use\(['\"]Agg['\"]\)\s*$"
)


def strip_module_docstring(source: str) -> str:
    """Remove the module-level docstring from source code."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    if (
        tree.body
        and isinstance(tree.body[0], ast.Expr)
        and isinstance(tree.body[0].value, (ast.Constant, ast.Str))
    ):
        # Find the end line of the docstring
        end_line = tree.body[0].end_lineno
        lines = source.splitlines(keepends=True)
        return "".join(lines[end_line:])
    return source


def strip_imports(source: str) -> str:
    """Remove import lines and matplotlib.use('Agg') from source."""
    lines = source.splitlines(keepends=True)
    result = []
    for line in lines:
        stripped = line.strip()
        if IMPORT_PATTERN.match(stripped):
            continue
        if MATPLOTLIB_USE_PATTERN.match(stripped):
            continue
        result.append(line)
    return "".join(result)


def apply_renames(source: str, renames: dict) -> str:
    """Rename top-level functions using word-boundary replacement."""
    for old_name, new_name in renames.items():
        # Replace function definitions: def name( -> def _name(
        source = re.sub(
            rf"\bdef {re.escape(old_name)}\b",
            f"def {new_name}",
            source,
        )
        # Replace calls/references to the function (word boundary)
        # Use negative lookbehind for '.' to avoid renaming method calls,
        # negative lookbehind for '_' to avoid double-prefixing,
        # and negative lookbehind/lookahead for quotes to avoid renaming
        # inside string literals (e.g. dictionary keys like 'dprime')
        source = re.sub(
            rf"(?<!\.)(?<!_)(?<!['\"])\b{re.escape(old_name)}\b(?!['\"])(?!\s*=\s*)",
            new_name,
            source,
        )
    return source


def process_module(module_info: dict) -> str:
    """Read a source module and return its processed body."""
    filepath = CONF_DIR / module_info["file"]
    source = filepath.read_text()

    # Strip docstring, imports
    body = strip_module_docstring(source)
    body = strip_imports(body)

    # Remove leading blank lines
    body = body.lstrip("\n")

    # Apply function renames
    body = apply_renames(body, module_info["renames"])

    return body


def build_bundle() -> str:
    """Build the complete bundle string."""
    sections = [HEADER, UNIFIED_IMPORTS, ""]

    for module_info in MODULES:
        label = module_info["label"]
        body = process_module(module_info)

        sections.append("")
        sections.append(f"# {'-' * 75}")
        sections.append(f"# {label}")
        sections.append(f"# {'-' * 75}")
        sections.append("")
        sections.append(body.rstrip())
        sections.append("")

    sections.append(CONF_CLASS)

    return "\n".join(sections)


def validate_bundle(source: str) -> bool:
    """Check the bundle for Python syntax errors."""
    try:
        ast.parse(source)
        return True
    except SyntaxError as e:
        print(f"SYNTAX ERROR in generated bundle: {e}", file=sys.stderr)
        return False


def main():
    bundle = build_bundle()

    # Validate
    if not validate_bundle(bundle):
        sys.exit(1)

    # Write to both destinations
    OUT_BUNDLE.parent.mkdir(parents=True, exist_ok=True)
    OUT_PUBLIC.parent.mkdir(parents=True, exist_ok=True)

    OUT_BUNDLE.write_text(bundle)
    OUT_PUBLIC.write_text(bundle)

    # Summary
    line_count = bundle.count("\n") + 1
    print(f"Built conf_bundle.py ({line_count} lines)")
    print(f"  -> {OUT_BUNDLE}")
    print(f"  -> {OUT_PUBLIC}")

    # Quick sanity check: verify conf class references resolve
    # by checking all staticmethod targets exist in the bundle
    missing = []
    for match in re.finditer(r"staticmethod\((\w+)\)", bundle):
        name = match.group(1)
        if name not in bundle.split("class conf:")[0]:
            # Check if it's a class (ConfData) rather than a function
            if f"class {name}" not in bundle and f"def {name}" not in bundle:
                missing.append(name)
    if missing:
        print(f"  WARNING: unresolved references: {missing}", file=sys.stderr)
    else:
        print("  All references OK")


if __name__ == "__main__":
    main()
