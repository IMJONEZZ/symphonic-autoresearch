#!/usr/bin/env python3
"""
Generate data tables and publication figures for the Symphonic Autoresearch paper.

Evidence classes:
- Verified: derived directly from the checked-out repositories.
- Repository-reported: present in the local Symphonic README, but not backed here
  by checked-in raw experiment logs such as results.tsv or run.log.
"""

from __future__ import annotations

import csv
import html
import os
import subprocess
import textwrap
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
import matplotlib.patheffects as pe


ROOT = Path("/Users/bentaylor/Code/ChrisB")
BASELINE = ROOT / "autoresearch"
SYMPHONIC = ROOT / "symphonic-autoresearch"
PAPER = SYMPHONIC / "paper"
DATA = PAPER / "data"
FIGS = PAPER / "figures"

COLORS = {
    "ink": "#1C2430",
    "baseline": "#6B7280",
    "symphonic": "#0F766E",
    "accent": "#C2410C",
    "gold": "#B8891E",
    "link": "#0B5CAD",
    "grid": "#D8DEE7",
    "panel": "#F6F7F8",
    "panel_alt": "#EEF3F7",
    "soft_teal": "#E6F4F1",
    "soft_orange": "#FCEFE6",
    "soft_blue": "#EAF1FB",
    "soft_gray": "#F3F4F6",
    "white": "#FFFFFF",
}


def configure_style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": COLORS["white"],
            "axes.facecolor": COLORS["white"],
            "savefig.facecolor": COLORS["white"],
            "font.family": "serif",
            "font.serif": ["STIX Two Text", "STIXGeneral", "Times New Roman", "Times", "DejaVu Serif"],
            "mathtext.fontset": "stix",
            "axes.edgecolor": COLORS["ink"],
            "axes.labelcolor": COLORS["ink"],
            "xtick.color": COLORS["ink"],
            "ytick.color": COLORS["ink"],
            "text.color": COLORS["ink"],
            "axes.titlesize": 14,
            "axes.titleweight": "semibold",
            "axes.labelsize": 10.5,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9,
            "legend.fontsize": 9,
            "axes.grid": False,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
        }
    )


def wrap(text: str, width: int) -> str:
    return "\n".join(textwrap.fill(part, width=width) for part in text.split("\n"))


def ensure_dirs() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    FIGS.mkdir(parents=True, exist_ok=True)


def count_lines(path: Path) -> int:
    with path.open("r", encoding="utf-8") as f:
        return sum(1 for _ in f)


def iter_repo_files(repo: Path, pattern: str):
    for path in repo.rglob(pattern):
        if "paper" in path.parts:
            continue
        yield path


def repo_file_counts(repo: Path) -> dict[str, int]:
    return {
        "python_files": len(list(iter_repo_files(repo, "*.py"))),
        "typescript_files": len(list(iter_repo_files(repo, "*.ts"))),
        "markdown_files": len(list(iter_repo_files(repo, "*.md"))),
        "test_files": sum(1 for _ in iter_repo_files(repo / "test", "*.ts")) if (repo / "test").exists() else 0,
        "docker_files": sum(
            1
            for path in repo.rglob("*")
            if "paper" not in path.parts and path.name in {"Dockerfile", "docker-compose.yml", "entrypoint.sh"}
        ),
    }


def repo_loc_counts(repo: Path) -> dict[str, int]:
    def loc(glob_pat: str) -> int:
        return sum(count_lines(p) for p in iter_repo_files(repo, glob_pat))

    return {
        "python_loc": loc("*.py"),
        "typescript_loc": loc("*.ts"),
        "test_loc": sum(count_lines(p) for p in iter_repo_files(repo / "test", "*.ts")) if (repo / "test").exists() else 0,
        "markdown_loc": loc("*.md"),
    }


def extract_reported_metrics() -> list[dict[str, str]]:
    readme = (SYMPHONIC / "README.md").read_text(encoding="utf-8").splitlines()
    rows: list[dict[str, str]] = []
    in_table = False
    for line in readme:
        if "| Karpathy's Run (H100) | Symphonic (DGX Spark) |" in line:
            in_table = True
            continue
        if not in_table:
            continue
        if not line.startswith("|"):
            break
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) != 3:
            continue
        metric, karpathy, symphonic = parts
        if metric == "---" or metric.startswith("---"):
            continue
        rows.append(
            {
                "metric": metric,
                "karpathy_h100": karpathy,
                "symphonic_dgx_spark": symphonic,
            }
        )
    return rows


def write_tsv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def generate_data() -> None:
    baseline_counts = repo_file_counts(BASELINE)
    symphonic_counts = repo_file_counts(SYMPHONIC)
    baseline_loc = repo_loc_counts(BASELINE)
    symphonic_loc = repo_loc_counts(SYMPHONIC)

    write_tsv(
        DATA / "feature_matrix.tsv",
        ["feature", "autoresearch", "symphonic_autoresearch", "evidence"],
        [
            {"feature": "Core five-minute training loop", "autoresearch": "yes", "symphonic_autoresearch": "yes", "evidence": "baseline README and vendored autoresearch files"},
            {"feature": "Python training core changed", "autoresearch": "n/a", "symphonic_autoresearch": "no", "evidence": "prepare.py identical; train.py usage string differs only"},
            {"feature": "Crash recovery and restart loop", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "src/agent/agent-runner.ts and src/orchestrator/orchestrator.ts"},
            {"feature": "Real-time dashboard", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "src/server/dashboard.ts and src/server/routes.ts"},
            {"feature": "Hardware telemetry", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "src/monitor/hardware-monitor.ts"},
            {"feature": "Operator instruction injection", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "instruction API and workspace instruction file delivery"},
            {"feature": "Optional cross-session memory", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "src/knowledge/*"},
            {"feature": "Hot-reloadable workflow config", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "src/config/watcher.ts and example.WORKFLOW.md"},
            {"feature": "Container deployment path", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "Dockerfile, docker-compose.yml, entrypoint.sh"},
            {"feature": "Unit-tested control plane", "autoresearch": "no", "symphonic_autoresearch": "yes", "evidence": "test/unit/*.test.ts"},
        ],
    )

    write_tsv(
        DATA / "implementation_footprint.tsv",
        [
            "system",
            "python_files",
            "typescript_files",
            "markdown_files",
            "test_files",
            "docker_files",
            "python_loc",
            "typescript_loc",
            "test_loc",
            "markdown_loc",
        ],
        [
            {"system": "autoresearch", **baseline_counts, **baseline_loc},
            {"system": "symphonic_autoresearch", **symphonic_counts, **symphonic_loc},
        ],
    )

    write_tsv(
        DATA / "reported_readme_metrics.tsv",
        ["metric", "karpathy_h100", "symphonic_dgx_spark"],
        extract_reported_metrics(),
    )

    write_tsv(
        DATA / "benchmark_summary.tsv",
        [
            "system",
            "hardware",
            "experiments",
            "kept_improvements",
            "crashes",
            "baseline_val_bpb",
            "best_val_bpb",
            "improvement_percent",
            "raw_run_artifacts_available",
            "provenance",
        ],
        [
            {
                "system": "Karpathy autoresearch",
                "hardware": "H100",
                "experiments": 126,
                "kept_improvements": 23,
                "crashes": "not reported",
                "baseline_val_bpb": 0.9979,
                "best_val_bpb": 0.9697,
                "improvement_percent": 2.8,
                "raw_run_artifacts_available": "no",
                "provenance": "Locally checked-in Symphonic README comparison table",
            },
            {
                "system": "Symphonic Autoresearch",
                "hardware": "DGX Spark",
                "experiments": 52,
                "kept_improvements": 22,
                "crashes": 1,
                "baseline_val_bpb": 1.3944,
                "best_val_bpb": 1.1818,
                "improvement_percent": 15.3,
                "raw_run_artifacts_available": "no",
                "provenance": "Locally checked-in Symphonic README comparison table",
            },
        ],
    )

    write_tsv(
        DATA / "reported_progress_proxy.tsv",
        ["system", "experiment_index", "val_bpb", "point_label"],
        [
            {"system": "Karpathy autoresearch", "experiment_index": 0, "val_bpb": 0.9979, "point_label": "baseline"},
            {"system": "Karpathy autoresearch", "experiment_index": 126, "val_bpb": 0.9697, "point_label": "best_reported"},
            {"system": "Symphonic Autoresearch", "experiment_index": 0, "val_bpb": 1.3944, "point_label": "baseline"},
            {"system": "Symphonic Autoresearch", "experiment_index": 52, "val_bpb": 1.1818, "point_label": "best_reported"},
        ],
    )

    write_tsv(
        DATA / "reliability_summary.tsv",
        ["system", "total_experiments", "kept", "not_kept", "crashes_reported", "notes"],
        [
            {"system": "Karpathy autoresearch", "total_experiments": 126, "kept": 23, "not_kept": 103, "crashes_reported": "NR", "notes": "not_kept aggregates discards and any unreported crashes"},
            {"system": "Symphonic Autoresearch", "total_experiments": 52, "kept": 22, "not_kept": 30, "crashes_reported": 1, "notes": "README states one recovered crash"},
        ],
    )

    write_tsv(
        DATA / "telemetry_visibility.tsv",
        ["capability", "autoresearch", "symphonic_autoresearch"],
        [
            {"capability": "Terminal summary output", "autoresearch": 1, "symphonic_autoresearch": 1},
            {"capability": "Tracked experiment table", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "Live step/loss trace", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "VRAM parsing", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "GPU utilization", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "GPU temperature", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "Power draw", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "System RAM", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "Agent event trace", "autoresearch": 0, "symphonic_autoresearch": 1},
            {"capability": "Async human instruction channel", "autoresearch": 0, "symphonic_autoresearch": 1},
        ],
    )

    write_tsv(
        DATA / "causal_mechanisms.tsv",
        ["infrastructure_addition", "verified_mechanism", "failure_mode_addressed", "plausible_research_effect", "claim_status"],
        [
            {
                "infrastructure_addition": "Crash recovery and restart loop",
                "verified_mechanism": "Service relaunches failed OpenCode sessions with bounded backoff",
                "failure_mode_addressed": "Agent session termination ends unattended run prematurely",
                "plausible_research_effect": "Higher experiment continuity and fewer lost overnight opportunities",
                "claim_status": "mechanism verified, effect plausible",
            },
            {
                "infrastructure_addition": "Dashboard and parsed training telemetry",
                "verified_mechanism": "run.log is parsed into live BPB, loss, throughput, and trace views",
                "failure_mode_addressed": "Opaque runs are hard to debug or steer while active",
                "plausible_research_effect": "Faster diagnosis and more informed operator intervention",
                "claim_status": "mechanism verified, effect plausible",
            },
            {
                "infrastructure_addition": "Instruction queue",
                "verified_mechanism": "Human guidance is written into the workspace between experiment steps",
                "failure_mode_addressed": "Changing course requires killing or restarting the run manually",
                "plausible_research_effect": "Mid-course corrections without losing run momentum",
                "claim_status": "mechanism verified, effect plausible",
            },
            {
                "infrastructure_addition": "Knowledge store and search interception",
                "verified_mechanism": "Optional embedding-backed memory persists prior web-fetched notes",
                "failure_mode_addressed": "Repeated searches and repeated mistakes across sessions",
                "plausible_research_effect": "Less redundant exploration and better cross-session recall",
                "claim_status": "mechanism verified, effect plausible",
            },
            {
                "infrastructure_addition": "Containerized deployment and workspace manager",
                "verified_mechanism": "Docker, workspace hooks, and copied training files make runs more repeatable",
                "failure_mode_addressed": "Environment drift and unsafe manual workspace handling",
                "plausible_research_effect": "More stable long-running execution and cleaner experiment isolation",
                "claim_status": "mechanism verified, effect plausible",
            },
        ],
    )

    write_tsv(
        DATA / "hero_comparison.tsv",
        ["dimension", "autoresearch", "symphonic_autoresearch", "research_significance"],
        [
            {
                "dimension": "Core experiment logic",
                "autoresearch": "Single-agent Python loop editing train.py under a five-minute budget",
                "symphonic_autoresearch": "Same Python loop, vendored into a managed workspace",
                "research_significance": "Controls for algorithmic drift and isolates the systems contribution",
            },
            {
                "dimension": "Failure handling",
                "autoresearch": "Agent handles crashes inside the active terminal session",
                "symphonic_autoresearch": "Host service detects failure and restarts with bounded backoff",
                "research_significance": "Turns a fragile interactive loop into an unattended service",
            },
            {
                "dimension": "Observability",
                "autoresearch": "Terminal output only",
                "symphonic_autoresearch": "Dashboard, event trace, experiment table, and hardware telemetry",
                "research_significance": "Makes long runs inspectable and steerable in real time",
            },
            {
                "dimension": "Human control surface",
                "autoresearch": "Manual prompt edits and restarts",
                "symphonic_autoresearch": "Asynchronous instruction injection between experiment steps",
                "research_significance": "Supports corrective steering without tearing down the run",
            },
            {
                "dimension": "Deployment model",
                "autoresearch": "Manual local execution",
                "symphonic_autoresearch": "Dockerized service with workflow configuration and cache mounting",
                "research_significance": "Improves repeatability and operational readiness",
            },
        ],
    )

    write_tsv(
        DATA / "evidence_manifest.tsv",
        ["artifact", "type", "status", "derived_from"],
        [
            {"artifact": "feature_matrix.tsv", "type": "code-grounded", "status": "verified", "derived_from": "local repo inspection"},
            {"artifact": "implementation_footprint.tsv", "type": "code-grounded", "status": "verified", "derived_from": "local file inventories and line counts"},
            {"artifact": "telemetry_visibility.tsv", "type": "code-grounded", "status": "verified", "derived_from": "local repo inspection"},
            {"artifact": "causal_mechanisms.tsv", "type": "mechanism mapping", "status": "verified/plausible split", "derived_from": "local repo inspection plus explicit causal interpretation"},
            {"artifact": "hero_comparison.tsv", "type": "synthesis", "status": "verified/plausible split", "derived_from": "local repo inspection and README-derived benchmark summary"},
            {"artifact": "benchmark_summary.tsv", "type": "reported metrics", "status": "not reproduced", "derived_from": "local Symphonic README table"},
            {"artifact": "reported_progress_proxy.tsv", "type": "reported metrics", "status": "not reproduced", "derived_from": "local Symphonic README table"},
            {"artifact": "reliability_summary.tsv", "type": "reported metrics", "status": "not reproduced", "derived_from": "local Symphonic README table"},
        ],
    )

    write_tsv(
        DATA / "documentation_discrepancies.tsv",
        ["topic", "checked_in_prose", "checked_in_code", "paper_handling"],
        [
            {
                "topic": "Training dataset",
                "checked_in_prose": "README, program, and research config mention FineWeb-Edu",
                "checked_in_code": "prepare.py downloads karpathy/climbmix-400b-shuffle",
                "paper_handling": "Treat dataset identity as code-grounded only; avoid claiming FineWeb-Edu as verified input",
            },
            {
                "topic": "Quantitative benchmark evidence",
                "checked_in_prose": "README reports comparative H100 vs DGX Spark results",
                "checked_in_code": "No results.tsv or run.log artifacts are present in either checked-out repo",
                "paper_handling": "Label benchmark numbers as repository-reported, not independently reproduced",
            },
        ],
    )


def style_axes(ax, grid_axis: str = "y") -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(COLORS["ink"])
    ax.spines["bottom"].set_color(COLORS["ink"])
    if grid_axis:
        ax.grid(axis=grid_axis, color=COLORS["grid"], linewidth=0.8)
        ax.set_axisbelow(True)


def save_figure(fig, path: Path) -> None:
    fig.tight_layout()
    fig.savefig(path, format="eps", dpi=300, bbox_inches="tight")
    fig.savefig(path.with_suffix(".pdf"), format="pdf", dpi=300, bbox_inches="tight")
    plt.close(fig)


def save_dot_figure(stem: str, source: str) -> None:
    dot_path = FIGS / f"{stem}.dot"
    pdf_path = FIGS / f"{stem}.pdf"
    eps_path = FIGS / f"{stem}.eps"
    dot_path.write_text(source, encoding="utf-8")
    subprocess.run(["dot", "-Tpdf", str(dot_path), "-o", str(pdf_path)], check=True)
    subprocess.run(["dot", "-Teps", str(dot_path), "-o", str(eps_path)], check=True)


def save_svg_figure(stem: str, source: str) -> None:
    svg_path = FIGS / f"{stem}.svg"
    pdf_path = FIGS / f"{stem}.pdf"
    eps_path = FIGS / f"{stem}.eps"
    svg_path.write_text(source, encoding="utf-8")
    subprocess.run(["rsvg-convert", "-f", "pdf", "-o", str(pdf_path), str(svg_path)], check=True)
    subprocess.run(["pdftops", "-eps", str(pdf_path), str(eps_path)], check=True)


def box(ax, xy, width, height, title, body, facecolor, title_color=None, body_width=28, align="left"):
    patch = FancyBboxPatch(
        xy,
        width,
        height,
        boxstyle="round,pad=0.018,rounding_size=0.028",
        linewidth=1.4,
        facecolor=facecolor,
        edgecolor=COLORS["ink"],
    )
    patch.set_path_effects(
        [
            pe.withSimplePatchShadow(offset=(2.0, -2.0), shadow_rgbFace="#d9dee6", alpha=0.7),
            pe.Normal(),
        ]
    )
    ax.add_patch(patch)
    if align == "center":
        tx = xy[0] + width / 2
        ha = "center"
    else:
        tx = xy[0] + 0.024
        ha = "left"
    ax.text(
        tx,
        xy[1] + height - 0.044,
        wrap(title, max(16, int(body_width * 0.75))),
        ha=ha,
        va="top",
        fontsize=11.5,
        fontweight="semibold",
        color=title_color or COLORS["ink"],
    )
    ax.text(
        tx,
        xy[1] + height - 0.108,
        wrap(body, body_width),
        ha=ha,
        va="top",
        fontsize=9.2,
        linespacing=1.32,
        color=COLORS["ink"],
    )


def arrow(ax, start, end, color=None):
    ax.add_patch(
        FancyArrowPatch(
            start,
            end,
            arrowstyle="-|>",
            mutation_scale=14,
            linewidth=1.3,
            color=color or COLORS["ink"],
            connectionstyle="arc3,rad=0.0",
        )
    )


def generate_architecture_figure() -> None:
    dot = f"""
digraph Architecture {{
  graph [
    ranksep="0.72 equally",
    nodesep="0.42",
    pad=0.18,
    margin=0.06,
    splines=ortho,
    bgcolor="white",
    fontname="Times-Roman"
  ];
  node [
    shape=box,
    style="rounded,filled",
    fontname="Times-Roman",
    fontsize=17,
    penwidth=1.7,
    color="{COLORS['ink']}",
    margin="0.20,0.12"
  ];
  edge [
    arrowsize=0.8,
    penwidth=1.6,
    color="{COLORS['ink']}"
  ];

  subgraph cluster_baseline {{
    label="Baseline loop";
    labelloc="t";
    fontsize=28;
    fontname="Times-Bold";
    fontcolor="{COLORS['baseline']}";
    style="rounded,filled";
    color="#E6EAF1";
    fillcolor="#F5F7FB";
    penwidth=0.0;

    b_program [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>program.md</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Single-agent instructions for</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">autonomous code editing</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_blue']}"];
    b_train [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>train.py</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Model, optimizer, and</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">five-minute training loop</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">edited by the agent</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_teal']}"];
    b_prepare [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>prepare.py</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Tokenizer, dataloader, dataset URL,</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">and BPB evaluation harness</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_orange']}"];
    b_note [shape=plain, style="", color="white", fillcolor="white", margin=0.0, label=<
      <FONT POINT-SIZE="15" COLOR="{COLORS['baseline']}"><B>Minimal interactive research loop</B><BR/>edit, run, inspect, keep or revert</FONT>
    >];

    b_program -> b_train;
    b_train -> b_prepare;
    b_prepare -> b_note [style=invis];
  }}

  subgraph cluster_service {{
    label="Symphonic service layer";
    labelloc="t";
    fontsize=28;
    fontname="Times-Bold";
    fontcolor="{COLORS['symphonic']}";
    style="rounded,filled";
    color="#E6F1EF";
    fillcolor="#F7FBFA";
    penwidth=0.0;

    s_config [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>Workflow and config</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">WORKFLOW.md hot reload</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_blue']}"];
    s_core [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><FONT COLOR="{COLORS['symphonic']}"><B>Python core preserved</B></FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">prepare.py and train.py</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">copied into workspace</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_teal']}"];
    s_session [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>OpenCode session manager</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Launches and supervises the</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">long-running agent session</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['panel_alt']}"];
    s_orch [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><FONT COLOR="{COLORS['symphonic']}"><B>Orchestrator</B></FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Restart, retry, parse results,</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">snapshot state, dispatch logic</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_orange']}"];
    s_obs [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>Observability</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Dashboard, SSE trace,</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">step/loss progress, experiment table</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_blue']}"];
    s_ops [label=<
      <TABLE BORDER="0" CELLBORDER="0" CELLPADDING="4">
        <TR><TD ALIGN="LEFT"><B>Operations</B></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">Hardware monitor, instruction queue,</FONT></TD></TR>
        <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13">memory store</FONT></TD></TR>
      </TABLE>
    >, fillcolor="{COLORS['soft_gray']}"];
    s_note [shape=plain, style="", color="white", fillcolor="white", margin=0.0, label=<
      <FONT POINT-SIZE="15" COLOR="{COLORS['ink']}"><B>Contribution boundary</B><BR/>learning algorithm fixed; reliability, visibility, and steerability move into the control plane</FONT>
    >];

    {{rank=same; s_config; s_core;}}
    {{rank=same; s_session; s_orch;}}
    {{rank=same; s_obs; s_ops;}}

    s_config -> s_session [color="{COLORS['symphonic']}"];
    s_core -> s_orch [color="{COLORS['symphonic']}"];
    s_session -> s_orch;
    s_session -> s_obs [color="{COLORS['symphonic']}"];
    s_orch -> s_ops [color="{COLORS['symphonic']}"];
    s_obs -> s_note [style=invis];
  }}
}}
"""
    save_dot_figure("architecture_comparison", dot)


def generate_lifecycle_figure() -> None:
    width = 1450
    height = 400
    stroke = COLORS["ink"]
    arrow_color = "#B87866"

    def esc(text: str) -> str:
        return html.escape(text)

    def wrap_lines(text: str, width_chars: int) -> list[str]:
        lines: list[str] = []
        for part in text.split("\n"):
            lines.extend(textwrap.wrap(part, width=width_chars) or [""])
        return lines

    def node(
        x: int,
        y: int,
        w: int,
        h: int,
        fill: str,
        title: str,
        body: str,
        title_size: int = 22,
        body_size: int = 15,
        title_wrap: int = 30,
        body_wrap: int = 34,
    ) -> str:
        title_lines = wrap_lines(title, title_wrap)
        body_lines = wrap_lines(body, body_wrap)
        title_y = y + 46
        parts = [
            '<g filter="url(#shadow)">',
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="40" ry="40" fill="{fill}" stroke="{stroke}" stroke-width="3"/>',
        ]
        for i, line in enumerate(title_lines):
            yy = title_y + i * (title_size + 4)
            parts.append(
                f'<text x="{x + 44}" y="{yy}" font-family="STIX Two Text, Times New Roman, serif" font-size="{title_size}" font-weight="700" fill="{stroke}">{esc(line)}</text>'
            )
        body_y = title_y + len(title_lines) * (title_size + 6) + 10
        for i, line in enumerate(body_lines):
            yy = body_y + i * (body_size + 5)
            parts.append(
                f'<text x="{x + 44}" y="{yy}" font-family="STIX Two Text, Times New Roman, serif" font-size="{body_size}" font-weight="500" fill="{stroke}">{esc(line)}</text>'
            )
        parts.append("</g>")
        return "\n".join(parts)

    def arrow(path_d: str, color: str = arrow_color) -> str:
        return f'<path d="{path_d}" fill="none" stroke="{color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrowhead)"/>'

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#D6DCE5" flood-opacity="0.75"/>
    </filter>
    <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6.2" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L7,3.5 L0,7 z" fill="{arrow_color}"/>
    </marker>
  </defs>

  <rect width="100%" height="100%" fill="white"/>
  {node(35, 112, 260, 132, "#DDE9F8", "1. Validate\nworkflow", "Read WORKFLOW.md,\nresolve paths, check environment", 22, 15, 28, 31)}
  {node(330, 112, 295, 132, "#DEEFD9", "2. Prepare\nworkspace", "Create or reuse workspace;\ncopy preserved Python core", 22, 15, 28, 31)}
  {node(665, 112, 320, 132, "#F4E8A6", "3. Launch agent\nsession", "Start OpenCode with dynamic\nprompt and run budget", 22, 15, 28, 31)}
  {node(1025, 112, 300, 132, "#FACB9E", "4. Parse and\ndecide", "Parse run.log, update traces,\nappend results, continue", 22, 15, 28, 31)}

  {node(805, 18, 275, 92, "#D7EAFB", "Human guidance", "Queue operator instructions\nbetween experiments", 19, 13, 26, 28)}
  {node(1120, 18, 260, 92, "#DDF0D9", "Live state", "Dashboards, traces, and\nmetrics remain visible", 19, 13, 26, 28)}
  {node(340, 258, 400, 118, "#FFFDFC", "Failure recovery", "If the session exits or stalls,\nretry with bounded backoff\nand preserved context", 21, 14, 26, 30)}

  {arrow("M295 178 C308 178, 318 178, 330 178")}
  {arrow("M625 178 C638 178, 650 178, 665 178")}
  {arrow("M985 178 C998 178, 1010 178, 1025 178")}
  {arrow("M942 110 C942 104, 942 100, 942 96")}
  {arrow("M1220 110 C1208 124, 1185 137, 1150 152")}
  {arrow("M825 244 C825 284, 812 315, 740 334")}
  {arrow("M1260 244 C1260 320, 1030 344, 740 344")}
  {arrow("M540 258 C540 246, 540 240, 540 234")}
</svg>
'''
    save_svg_figure("autoresearch_lifecycle", svg)


def generate_progress_figure() -> None:
    fig, ax = plt.subplots(figsize=(8.2, 4.9))

    series = {
        "Karpathy autoresearch": {
            "x": [0, 126],
            "y": [0.9979, 0.9697],
            "color": COLORS["baseline"],
            "marker": "o",
        },
        "Symphonic Autoresearch": {
            "x": [0, 52],
            "y": [1.3944, 1.1818],
            "color": COLORS["symphonic"],
            "marker": "D",
        },
    }

    for name, cfg in series.items():
        ax.plot(cfg["x"], cfg["y"], linewidth=2.8, marker=cfg["marker"], markersize=7.5, color=cfg["color"])
        ax.scatter(cfg["x"], cfg["y"], s=58, color=cfg["color"], zorder=3)
        ax.text(cfg["x"][0] + 2, cfg["y"][0] + (0.018 if name.startswith("Karpathy") else 0.03), f"{name}\nbaseline {cfg['y'][0]:.4f}", fontsize=8.8, color=cfg["color"])
        ax.text(cfg["x"][1] - 18, cfg["y"][1] - (0.028 if name.startswith("Karpathy") else 0.038), f"best {cfg['y'][1]:.4f}", fontsize=8.8, color=cfg["color"], ha="left")

    style_axes(ax, "y")
    ax.set_xlabel("Repository-reported experiment index")
    ax.set_ylabel("Validation BPB (lower is better)")
    ax.set_title("Reported frontier endpoints visible in the checked-out workspace")
    ax.set_xlim(-5, 135)
    ax.set_ylim(0.93, 1.45)
    ax.text(
        0.01,
        0.03,
        "This figure intentionally visualizes only the locally available summary endpoints.\nPer-experiment result histories are not present in either checked-out repository.",
        transform=ax.transAxes,
        fontsize=8.4,
        va="bottom",
        color=COLORS["ink"],
    )
    save_figure(fig, FIGS / "reported_bpb_progress.eps")


def generate_reliability_figure() -> None:
    fig, ax = plt.subplots(figsize=(8.2, 4.8))
    systems = ["Karpathy\nautoresearch", "Symphonic\nAutoresearch"]
    total = [126, 52]
    kept = [23, 22]
    not_kept = [103, 30]
    x = [0, 1]
    width = 0.23

    ax.bar([i - width for i in x], total, width=width, color=COLORS["baseline"], label="Total experiments")
    ax.bar(x, kept, width=width, color=COLORS["symphonic"], label="Kept improvements")
    ax.bar([i + width for i in x], not_kept, width=width, color=COLORS["accent"], label="Not kept")

    ax.set_xticks(x, systems)
    ax.set_ylabel("Count")
    ax.set_title("Repository-reported operational outcomes")
    style_axes(ax, "y")
    ax.legend(frameon=False, ncol=3, loc="upper right")

    ax.text(x[0] + width, not_kept[0] + 4, "Crash count not reported", ha="center", fontsize=8.3, color=COLORS["accent"])
    ax.text(x[1] + width, not_kept[1] + 4, "1 recovered crash", ha="center", fontsize=8.3, color=COLORS["accent"])
    save_figure(fig, FIGS / "reliability_summary.eps")


def generate_telemetry_figure() -> None:
    capabilities = [
        "Terminal summary output",
        "Tracked experiment table",
        "Live step/loss trace",
        "VRAM parsing",
        "GPU utilization",
        "GPU temperature",
        "Power draw",
        "System RAM",
        "Agent event trace",
        "Instruction channel",
    ]
    baseline = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    symphonic = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]

    fig, ax = plt.subplots(figsize=(8.4, 5.4))
    y = list(range(len(capabilities)))
    ax.scatter(baseline, y, s=120, marker="o", color=COLORS["baseline"], label="Autoresearch", zorder=3)
    ax.scatter(symphonic, y, s=120, marker="s", color=COLORS["symphonic"], label="Symphonic", zorder=3)
    ax.set_yticks(y, capabilities)
    ax.set_xticks([0, 1], ["Absent", "Present"])
    ax.set_xlim(-0.25, 1.25)
    ax.invert_yaxis()
    style_axes(ax, "x")
    ax.set_title("Observability and control surface, derived directly from the codebase")
    ax.legend(frameon=False, loc="lower right")
    save_figure(fig, FIGS / "telemetry_visibility.eps")


def generate_mechanism_figure() -> None:
    fig, ax = plt.subplots(figsize=(11.0, 4.9))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    ax.text(0.17, 0.94, "Infrastructure addition", fontsize=13, fontweight="semibold", ha="center", color=COLORS["symphonic"])
    ax.text(0.50, 0.94, "Failure mode addressed", fontsize=13, fontweight="semibold", ha="center", color=COLORS["accent"])
    ax.text(0.83, 0.94, "Plausible research effect", fontsize=13, fontweight="semibold", ha="center", color=COLORS["gold"])

    rows = [
        ("Restart loop", "Session crashes end unattended progress", "More experiment continuity"),
        ("Live telemetry", "Opaque runs are harder to debug or steer", "Faster diagnosis and intervention"),
        ("Instruction queue", "Changing course requires manual restart", "Mid-course correction without reset"),
        ("Memory store", "Repeated search and repeated mistakes", "Better cross-session recall"),
    ]
    ys = [0.76, 0.57, 0.38, 0.19]
    for (left, mid, right), y in zip(rows, ys):
        box(ax, (0.03, y - 0.07), 0.24, 0.13, left, "verified in code", COLORS["soft_teal"])
        box(ax, (0.38, y - 0.07), 0.24, 0.13, mid, "observed operational risk", COLORS["soft_orange"])
        box(ax, (0.73, y - 0.07), 0.24, 0.13, right, "plausible outcome pathway", COLORS["soft_blue"])
        arrow(ax, (0.27, y), (0.38, y), COLORS["ink"])
        arrow(ax, (0.62, y), (0.73, y), COLORS["ink"])

    save_figure(fig, FIGS / "mechanism_map.eps")


def main() -> None:
    configure_style()
    ensure_dirs()
    generate_data()
    generate_architecture_figure()
    generate_lifecycle_figure()
    generate_progress_figure()
    generate_reliability_figure()
    generate_telemetry_figure()
    generate_mechanism_figure()
    print(f"Generated data in {DATA}")
    print(f"Generated EPS figures in {FIGS}")


if __name__ == "__main__":
    main()
