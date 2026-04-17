# Symphonic Autoresearch Paper Package

This directory contains the full local artifact package for the IEEE-style paper draft:

- `symphonic_autoresearch_ieee.tex`: monolithic manuscript source with inline bibliography.
- `symphonic_autoresearch_ieee.pdf`: compiled manuscript with a full-width abstract block and two-column body.
- `data/*.tsv`: evidence tables derived from the checked-out repos.
- `figures/*.eps`: publication figures generated from the local TSV package.
- `figures/*.pdf`: PDF mirrors of the EPS figures for local inspection and TeX compilation convenience.
- `figures/dashboard_screenshot.png`: repository screenshot copied from `../docs/dashboard.png` for the appendix.
- `generate_assets.py`: deterministic asset generator for the TSV and EPS outputs.
- `build_pdf.sh`: rebuild helper for the figures and the PDF manuscript.

## Evidence policy

This package separates two evidence classes:

1. `verified`:
   These artifacts are derived directly from the checked-out repositories by code inspection, file inventory, and line counting.
2. `not reproduced`:
   These artifacts come from the locally checked-in comparison table in `../README.md`. Neither repo contains `results.tsv`, `run.log`, or other raw benchmark histories, so those numbers are treated as repository-reported rather than independently reproduced.

See `data/evidence_manifest.tsv` for the authoritative status of each artifact.

## Regenerating the data and figures

Run:

```bash
python3 /Users/bentaylor/Code/ChrisB/symphonic-autoresearch/paper/generate_assets.py
```

This regenerates:

- `data/feature_matrix.tsv`
- `data/implementation_footprint.tsv`
- `data/benchmark_summary.tsv`
- `data/hero_comparison.tsv`
- `data/causal_mechanisms.tsv`
- `data/reported_progress_proxy.tsv`
- `data/reliability_summary.tsv`
- `data/telemetry_visibility.tsv`
- `data/documentation_discrepancies.tsv`
- `data/evidence_manifest.tsv`
- `figures/architecture_comparison.eps`
- `figures/autoresearch_lifecycle.eps`
- `figures/mechanism_map.eps`
- `figures/reported_bpb_progress.eps`
- `figures/reliability_summary.eps`
- `figures/telemetry_visibility.eps`

The figure generator applies a shared paper style rather than default plotting settings:

- serif typography aligned to the manuscript,
- a restrained baseline-vs-Symphonic color palette,
- lighter grids and thicker primary marks,
- direct annotations where possible, and
- both EPS and PDF outputs for every generated figure.

## Compilation

The manuscript is written for `IEEEtran` and expects a LaTeX installation with EPS support.

Suggested compile sequence once a TeX toolchain is available:

```bash
./build_pdf.sh
```

If `pdflatex` is not yet available on this machine, the source package is still complete and ready for compilation after the TeX CLI tools are installed or added to `PATH`.

## Layout and evidence notes

- The title page uses a controlled full-width abstract block below the title and author list, then switches immediately into two-column IEEE body text.
- The paper includes the public project link directly in the front matter:
  `https://github.com/IMJONEZZ/symphonic-autoresearch`
- The appendix includes a repo-backed dashboard screenshot, dependency discussion, license discussion, and runnable setup commands intended to make the project easier to adopt.
- Wide comparison tables are used where that materially improves readability over cramped single-column layouts.
- Numerical benchmark tables remain explicitly labeled as `repository-reported` unless they are backed by raw local result artifacts.

## Important limitations captured in the draft

- The checked-in prose refers to FineWeb-Edu in several places, but the checked-in `prepare.py` points to `karpathy/climbmix-400b-shuffle`.
- The reported benchmark summary in `../README.md` is locally visible, but raw experiment logs are not present in either checked-out repo.
- The draft paper is therefore careful to distinguish:
  code-grounded system claims,
  repository-reported benchmark claims,
  and still-missing reproduction artifacts.
