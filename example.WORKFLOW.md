---
mode: autoresearch

workspace:
  root: ~/symphonic-autoresearch-workspaces

hooks:
  after_create: |
    git init .
  before_run: null
  after_run: null
  before_remove: null
  timeout_ms: 120000

agent:
  max_concurrent_agents: 1
  max_turns: 100
  max_retry_backoff_ms: 30000
  max_concurrent_agents_by_state: {}

opencode:
  command: opencode
  model: your-model-here
  agent: ""
  run_timeout_ms: 0
  stall_timeout_ms: 0

autoresearch:
  program_md: ./autoresearch/program.md
  prepare_py: ./autoresearch/prepare.py
  train_py: ./autoresearch/train.py
  pyproject_toml: ./autoresearch/pyproject.toml
  run_tag: auto
  restart_on_crash: true
  max_crash_restarts: 20
  
  # Knowledge persistence (optional)
  # Enable to store web search results in a vector database for cross-session memory
  knowledge_enabled: false
  embedding_endpoint: null
  embedding_model: ""
  
  # Web search endpoint (optional)
  # Set to your SearXNG instance if available, or leave as null
  searxng_endpoint: null

  # --- Generic retargeting (all optional; omit for nanochat defaults) ---
  # See specific_tailoring.md for retargeting to your own pipeline.
  #
  # workspace_name: autoresearch
  # instruction_filename: .symphonic-autoresearch-user-instructions.md
  # knowledge_query: "techniques to improve val_bpb transformer pretraining"
  #
  # # Replaces prepare_py/train_py/pyproject_toml. Each entry is {src, dest}.
  # files:
  #   - { src: ./autoresearch/prepare.py,    dest: prepare.py }
  #   - { src: ./autoresearch/train.py,      dest: train.py }
  #   - { src: ./autoresearch/pyproject.toml, dest: pyproject.toml }
  #
  # # Data bootstrap: skip if all check_paths exist, else run `command`.
  # # Set to null to disable bootstrap entirely.
  # bootstrap:
  #   check_paths:
  #     - ~/.cache/autoresearch/data
  #     - ~/.cache/autoresearch/tokenizer/tokenizer.pkl
  #   command: "python prepare.py"
  #   timeout_ms: 300000
  #
  # # Declare the metrics your pipeline prints; dashboard renders these verbatim.
  # metrics:
  #   primary:
  #     name: val_bpb            # field in run.log summary block
  #     direction: minimize      # "minimize" | "maximize"
  #     label: "val_bpb"
  #     format: "%.6f"
  #   summary_fields:
  #     - { name: peak_vram_mb,   type: float, label: "Peak VRAM (MB)" }
  #     - { name: mfu_percent,    type: float, label: "MFU %" }
  #     - { name: total_tokens_M, type: float, label: "Tokens (M)" }
  #     - { name: num_steps,      type: int,   label: "Steps" }
  #     - { name: num_params_M,   type: float, label: "Params (M)" }
  #   progress_line:
  #     - { name: step,          pattern: "step\\s+(\\d+)",         type: int }
  #     - { name: progress_pct,  pattern: "\\(([\\d.]+)%\\)",        type: float }
  #     - { name: loss,          pattern: "loss:\\s+([\\d.]+)",     type: float }
  #     - { name: lrm,           pattern: "lrm:\\s+([\\d.]+)",      type: float }
  #     - { name: dt_ms,         pattern: "dt:\\s+(\\d+)ms",         type: int }
  #     - { name: tok_per_sec,   pattern: "tok\\/sec:\\s+([\\d,]+)", type: int_commas }
  #     - { name: mfu_pct,       pattern: "mfu:\\s+([\\d.]+)%",      type: float }
  #     - { name: remaining_sec, pattern: "remaining:\\s+(\\d+)s",   type: int }
  #
  # # TSV schema for results.tsv.
  # results_schema:
  #   columns: [commit, val_bpb, final_loss, memory_gb, status, description]
  #   metric_column: val_bpb
  #   status_column: status
  #   description_column: description
  #   keep_status: keep
  #   discard_statuses: [discard, crash]

server:
  port: 8080
---

You are an autonomous ML researcher running experiments on a GPU.
Follow the instructions in program.md exactly.
