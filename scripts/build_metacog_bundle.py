#!/usr/bin/env python3
"""Build metacog_bundle.py from the source modules in libraries/python/metacog/.

Reads raw.py, meta_d.py, ideal.py, model_based.py, summary.py in order,
strips per-file imports, deduplicates them into a unified import block,
renames top-level functions with a `_` prefix, and appends the `class metacog:`
namespace wrapper.

Outputs:
  - libraries/python/metacog_bundle.py   (source of truth)
  - frontend/public/metacog_bundle.py    (served by Vite)

Usage:
  python scripts/build_metacog_bundle.py
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
METACOG_DIR = ROOT / "libraries" / "python" / "metacog"
OUT_BUNDLE = ROOT / "libraries" / "python" / "metacog_bundle.py"
OUT_PUBLIC = ROOT / "frontend" / "public" / "metacog_bundle.py"

# Modules in dependency order
MODULES = [
    {
        "file": "raw.py",
        "label": "raw.py — Gamma, Phi, ΔConf",
        "renames": {
            "gamma": "_gamma",
            "phi": "_phi",
            "delta_conf": "_delta_conf",
        },
    },
    {
        "file": "meta_d.py",
        "label": "meta_d.py — meta-d' MLE",
        "renames": {
            "prepare_ratings": "_prepare_ratings",
            "fit_meta_d_MLE": "_fit_meta_d_MLE",
            "meta_d": "_meta_d",
        },
    },
    {
        "file": "ideal.py",
        "label": "ideal.py — SDT ideal observer expected values",
        "renames": {
            "sdt_expected": "_sdt_expected",
        },
    },
    {
        "file": "model_based.py",
        "label": "model_based.py — meta-noise and meta-uncertainty",
        "renames": {
            "meta_noise_fit": "_meta_noise_fit",
            "meta_uncertainty_fit": "_meta_uncertainty_fit",
            # Cross-module reference from meta_d.py
            "prepare_ratings": "_prepare_ratings",
        },
    },
    {
        "file": "summary.py",
        "label": "summary.py — Compute all measures and format output",
        "renames": {
            "compute_all": "_compute_all",
            "print_summary": "_print_summary",
            # Cross-module references that were renamed in earlier modules
            "gamma": "_gamma",
            "phi": "_phi",
            "delta_conf": "_delta_conf",
            "meta_d": "_meta_d",
            "sdt_expected": "_sdt_expected",
            "meta_noise_fit": "_meta_noise_fit",
            "meta_uncertainty_fit": "_meta_uncertainty_fit",
        },
    },
]

# Unified imports at the top of the bundle
UNIFIED_IMPORTS = """\
import sys
import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import minimize
from scipy.integrate import quad
from tqdm import tqdm"""

HEADER = """\
# metacog_bundle.py — Auto-generated single-file bundle for Pyodide injection
# Built from libraries/python/metacog/ by scripts/build_metacog_bundle.py
# DO NOT EDIT — modify the source modules and re-run the build script.
#
# Metacognitive measures (Shekhar & Rahnev, 2025)
# Assumes `conf` class is already available in global scope.
#
# Usage inside the sandbox:
#   results = metacog.compute_all(data)
#   metacog.print_summary(results)
"""

# The class metacog: wrapper exposes all functions under a clean namespace.
METACOG_CLASS = '''\

# ---------------------------------------------------------------------------
# Public namespace — all functions accessible as metacog.xxx()
# ---------------------------------------------------------------------------

class metacog:
    """Namespace for metacognitive measure functions."""

    # Raw measures
    gamma = staticmethod(_gamma)
    phi = staticmethod(_phi)
    delta_conf = staticmethod(_delta_conf)

    # meta-d\'
    prepare_ratings = staticmethod(_prepare_ratings)
    meta_d = staticmethod(_meta_d)

    # SDT expected values
    sdt_expected = staticmethod(_sdt_expected)

    # Model-based
    meta_noise = staticmethod(_meta_noise_fit)
    meta_uncertainty = staticmethod(_meta_uncertainty_fit)

    # Summary
    compute_all = staticmethod(_compute_all)
    print_summary = staticmethod(_print_summary)
'''

# Lines that should be stripped from module bodies (import dedup)
IMPORT_PATTERN = re.compile(
    r"^(?:import |from \S+ import )"
)

# Cross-module relative imports to strip
RELATIVE_IMPORT_PATTERN = re.compile(
    r"^from \.\w+ import "
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
        end_line = tree.body[0].end_lineno
        lines = source.splitlines(keepends=True)
        return "".join(lines[end_line:])
    return source


def strip_imports(source: str) -> str:
    """Remove import lines from source."""
    lines = source.splitlines(keepends=True)
    result = []
    for line in lines:
        stripped = line.strip()
        if IMPORT_PATTERN.match(stripped):
            continue
        if RELATIVE_IMPORT_PATTERN.match(stripped):
            continue
        result.append(line)
    return "".join(result)


def apply_renames(source: str, renames: dict) -> str:
    """Rename top-level functions using word-boundary replacement."""
    for old_name, new_name in renames.items():
        # Replace function definitions
        source = re.sub(
            rf"\bdef {re.escape(old_name)}\b",
            f"def {new_name}",
            source,
        )
        # Replace calls/references (avoid inside strings, methods, and already-prefixed)
        source = re.sub(
            rf"(?<!\.)(?<!_)(?<!['\"])\b{re.escape(old_name)}\b(?!['\"])(?!\s*=\s*)",
            new_name,
            source,
        )
    return source


def process_module(module_info: dict) -> str:
    """Read a source module and return its processed body."""
    filepath = METACOG_DIR / module_info["file"]
    source = filepath.read_text()

    body = strip_module_docstring(source)
    body = strip_imports(body)
    body = body.lstrip("\n")
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

    sections.append(METACOG_CLASS)

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

    if not validate_bundle(bundle):
        sys.exit(1)

    OUT_BUNDLE.parent.mkdir(parents=True, exist_ok=True)
    OUT_PUBLIC.parent.mkdir(parents=True, exist_ok=True)

    OUT_BUNDLE.write_text(bundle)
    OUT_PUBLIC.write_text(bundle)

    line_count = bundle.count("\n") + 1
    print(f"Built metacog_bundle.py ({line_count} lines)")
    print(f"  -> {OUT_BUNDLE}")
    print(f"  -> {OUT_PUBLIC}")

    # Sanity check: verify class references resolve
    missing = []
    for match in re.finditer(r"staticmethod\((\w+)\)", bundle):
        name = match.group(1)
        if name not in bundle.split("class metacog:")[0]:
            if f"class {name}" not in bundle and f"def {name}" not in bundle:
                missing.append(name)
    if missing:
        print(f"  WARNING: unresolved references: {missing}", file=sys.stderr)
    else:
        print("  All references OK")


if __name__ == "__main__":
    main()
