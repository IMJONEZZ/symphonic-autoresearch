#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

python3 "$ROOT/generate_assets.py"

cd "$ROOT"
pdflatex -interaction=nonstopmode -halt-on-error symphonic_autoresearch_ieee.tex
pdflatex -interaction=nonstopmode -halt-on-error symphonic_autoresearch_ieee.tex
