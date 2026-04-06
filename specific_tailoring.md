# Retargeting Symphonic Autoresearch to Any Pipeline

This guide documents how to point Symphonic Autoresearch at an arbitrary
pipeline instead of Karpathy's nanochat LLM training loop. No TypeScript
edits are required — everything is configured through `WORKFLOW.md`.

> Scenario assumed throughout: you have one or more Python files that produce
> **some scalar metric** (accuracy, F1, latency, RMSE, throughput, …). You
> want the agent to continuously modify the pipeline, re-run it, and
> keep/revert based on whether the metric improved.

---

## 1. Mental model: what the agent loop needs

Every concrete piece reduces to one of four contracts:

| Contract | What it is | Where it lives |
|---|---|---|
| **A. Instructions** | Markdown prompt telling the agent what to optimize, what files it may edit, and how to log results | `program.md` (path set in config) |
| **B. Code payload** | The file(s) copied into the agent's workspace at startup | Declared in `autoresearch.files` |
| **C. Append-only log** | TSV file the agent writes one row to per experiment; orchestrator parses it for context + dashboard | `results.tsv` (inside workspace) |
| **D. Run log** | The stdout/stderr of each experiment run, tailed for live dashboard metrics | `run.log` (inside workspace) |

Symphony never runs your pipeline itself — it (1) copies files into a git
workspace, (2) hands the agent the instructions, (3) restarts the agent on
crash, (4) parses the TSV/log for the dashboard.

---

## 2. Step-by-step: config-driven retargeting

### 2.1. Pick your metric

Choose **one scalar number** the agent optimizes. Decide the direction:

- `minimize` — lower is better (loss, error rate, latency)
- `maximize` — higher is better (accuracy, F1, throughput)

You declare this in config; the dashboard, context builder, and best-experiment
tracking all respect the direction automatically.

### 2.2. Define your TSV schema

The agent writes `results.tsv` with one row per experiment. You define the
columns in `WORKFLOW.md`. At minimum you need `commit`, a metric column, a
status column, and a description column:

```yaml
results_schema:
  columns: [commit, accuracy, runtime_s, status, description]
  metric_column: accuracy
  status_column: status
  description_column: description
  keep_status: keep
  discard_statuses: [discard, crash]
```

The orchestrator uses `metric_column` for best-experiment tracking,
`status_column` for kept/discarded counts, and `description_column` for the
"experiments to avoid repeating" list injected into the agent's context.

### 2.3. Declare your files

List every file the agent needs in its workspace. Each entry has a `src`
(path on the host) and `dest` (filename inside the workspace):

```yaml
files:
  - { src: ./my-pipeline/pipeline.py,    dest: pipeline.py }
  - { src: ./my-pipeline/stages.py,      dest: stages.py }
  - { src: ./my-pipeline/eval.py,        dest: eval.py }
  - { src: ./my-pipeline/requirements.txt, dest: requirements.txt }
```

There is no limit on the number of files. Paths are resolved relative to the
process cwd.

> **Back-compat note:** if you omit `files:`, the config layer synthesizes
> the list from the legacy `prepare_py`/`train_py`/`pyproject_toml` fields.
> Existing WORKFLOW.md files keep working with zero edits.

### 2.4. Configure the data bootstrap (optional)

If your pipeline needs a one-time data preparation step (downloading a
dataset, tokenizing, etc.), declare it:

```yaml
bootstrap:
  check_paths:
    - ~/.cache/my-pipeline/data
    - ~/.cache/my-pipeline/vocab.json
  command: "python pipeline.py --prepare-only"
  timeout_ms: 300000
```

The bootstrap command runs only if any `check_paths` entry is missing. Set
`bootstrap: null` to disable it entirely if your pipeline has no prep step.

### 2.5. Declare your metrics

This is how the dashboard knows what to display and how to parse your
training logs.

```yaml
metrics:
  primary:
    name: accuracy           # field name in the run.log summary block
    direction: maximize      # "minimize" or "maximize"
    label: "Accuracy"        # dashboard display label
    format: "%.4f"           # printf-style format for the dashboard

  # Fields parsed from the summary block at the end of run.log
  # (lines matching "field_name: value")
  summary_fields:
    - { name: runtime_s,     type: float, label: "Runtime (s)" }
    - { name: peak_memory_mb, type: float, label: "Peak Memory (MB)" }
    - { name: num_epochs,    type: int,   label: "Epochs" }

  # Fields parsed per-line from run.log during training (live dashboard)
  progress_line:
    - { name: epoch,         pattern: "epoch\\s+(\\d+)",         type: int,   label: "Epoch" }
    - { name: train_loss,    pattern: "loss:\\s+([\\d.]+)",      type: float, label: "Loss" }
    - { name: lr,            pattern: "lr:\\s+([\\d.]+)",        type: float }
    - { name: samples_per_sec, pattern: "samples/sec:\\s+([\\d,]+)", type: int_commas, label: "Samples/s" }
```

Fields with a `label` appear as chips on the dashboard's training status
bar. Fields without a `label` are parsed but not displayed (useful for
internal tracking).

The `type` controls how values are parsed:
- `int` — integer
- `float` — decimal number
- `int_commas` — integer with comma separators (e.g. `12,345`)

Every `progress_line` entry's `pattern` must be a valid regex with exactly
one capture group.

### 2.6. Write `program.md`

This is the agent's system prompt — the most important file. Start from the
existing `autoresearch/program.md` and adapt it. A good retargeted
`program.md` has these sections:

1. **Header** — one paragraph: "this is an experiment to have an LLM improve
   `<your pipeline>`."
2. **Setup** — branch naming (`autoresearch/<tag>`), files to read, how to
   verify inputs exist, initialize `results.tsv` header row matching your
   `results_schema.columns`.
3. **On Startup / Restart** — ALWAYS: read `results.tsv`, check `git log`,
   never re-run baselines, never repeat discarded experiments, sanity-check
   metric ranges.
4. **Experimentation** — what CAN / CANNOT be edited. Declare which files
   are read-only (eval harness) and which are freely editable.
5. **Goal** — one sentence, e.g. "get the highest accuracy on the held-out
   set."
6. **Output format** — the exact summary block format your pipeline prints.
   Show the agent a complete example. The agent won't guess the format.
7. **Logging results** — the TSV schema with an example row. Emphasize the
   **append-only** invariant (bold, repeat it — models sometimes rewrite
   prior rows).
8. **The experiment loop** — the LOOP FOREVER steps. Change the grep targets
   to match your summary block field names.
9. **Checking user instructions** — use the `{{INSTRUCTION_FILE}}` placeholder.
   At runtime, the orchestrator substitutes your configured filename. Keep
   the read+delete pattern exactly:
   ```
   Check if `{{INSTRUCTION_FILE}}` exists. If so, read it, follow the
   instructions, then delete it.
   ```
10. **Timeout / Crashes / NEVER STOP** — copy verbatim from the existing
    `program.md`. These are behavioral guardrails that apply to any domain.
11. **Research via web search** — keep this section with the
    `{{SEARXNG_ENDPOINT}}` placeholder if you have a SearXNG instance.
    The orchestrator strips the entire section automatically if
    `searxng_endpoint` is null.

**Watch out for**: stale nanochat-specific numerics ("val_bpb around 1.0–
1.2", "50M params", "VRAM"). Replace every one with ranges appropriate to
your pipeline. Leaving stale ranges causes the agent to anchor its sanity
checks to irrelevant numbers.

### 2.7. Set remaining config

```yaml
workspace_name: my-research          # workspace directory name (default: "autoresearch")
instruction_filename: .my-inbox.md   # async instruction file (default: .symphonic-autoresearch-user-instructions.md)
knowledge_query: "techniques to improve accuracy on image classification"
```

### 2.8. Complete WORKFLOW.md example

Here's a full `WORKFLOW.md` for a hypothetical image classification pipeline
that maximizes accuracy:

```yaml
---
mode: autoresearch

workspace:
  root: ~/symphonic-workspaces

hooks:
  after_create: |
    git init .
  timeout_ms: 120000

agent:
  max_concurrent_agents: 1
  max_turns: 100

opencode:
  command: opencode
  model: your-provider/your-model

autoresearch:
  program_md: ./my-pipeline/program.md
  run_tag: imgclass
  restart_on_crash: true
  max_crash_restarts: 20
  workspace_name: imgclass-research
  instruction_filename: .operator-notes.md
  knowledge_query: "techniques to improve image classification accuracy"

  files:
    - { src: ./my-pipeline/train.py,         dest: train.py }
    - { src: ./my-pipeline/eval.py,          dest: eval.py }
    - { src: ./my-pipeline/requirements.txt, dest: requirements.txt }

  bootstrap:
    check_paths:
      - ~/.cache/imgclass/data
    command: "python train.py --download-data"
    timeout_ms: 120000

  metrics:
    primary:
      name: accuracy
      direction: maximize
      label: "Accuracy"
      format: "%.4f"
    summary_fields:
      - { name: runtime_s,      type: float, label: "Runtime (s)" }
      - { name: peak_memory_mb, type: float, label: "Peak Mem (MB)" }
    progress_line:
      - { name: epoch,           pattern: "epoch\\s+(\\d+)",     type: int,   label: "Epoch" }
      - { name: train_loss,      pattern: "loss:\\s+([\\d.]+)",  type: float, label: "Loss" }

  results_schema:
    columns: [commit, accuracy, runtime_s, status, description]
    metric_column: accuracy
    status_column: status
    description_column: description
    keep_status: keep
    discard_statuses: [discard, crash]

  searxng_endpoint: null

server:
  port: 8080
---

You are an autonomous ML researcher running experiments.
Follow the instructions in program.md exactly.
```

### 2.9. Run it

```bash
docker compose up --build
```

Open `http://<host>:8080`. The dashboard will show your metric name, your
columns, and your progress chips — all driven by config.

---

## 3. What your pipeline must print

The orchestrator parses your pipeline's stdout/stderr (`run.log`) using the
regexes you declared in `metrics`. Your pipeline must print output that
matches these patterns.

**Summary block** (printed once at the end of a run):

```
accuracy:       0.9142
runtime_s:      45.3
peak_memory_mb: 2048.0
```

Each line must match `field_name:\s+value`. The field names must exactly
match the `name` values in `metrics.primary` and `metrics.summary_fields`.

**Progress lines** (printed during training, one per step/epoch):

```
epoch 1 | loss: 2.3145 | lr: 0.001 | samples/sec: 1,234
epoch 2 | loss: 1.8721 | lr: 0.001 | samples/sec: 1,312
```

Each regex in `metrics.progress_line` is matched independently against every
line. The first capture group is extracted as the value.

---

## 4. Pre-staging extra files via hooks

If your pipeline needs files beyond what's listed in `files:` — fixture
data, pre-trained weights, a `.env`, etc. — use the `hooks:` section:

```yaml
hooks:
  after_create: |
    git init .
    cp -r /path/to/fixtures ./fixtures
    ln -s /data/pretrained-weights ./weights
  timeout_ms: 120000
```

`after_create` runs once when the workspace is first created. Delete the
workspace directory under `workspace.root` to force re-creation.

---

## 5. Deciding on a time budget

Nanochat uses a fixed 5-minute wall-clock budget per experiment. This is
optional but recommended: it bounds iteration time and makes crash vs.
slow-progress unambiguous.

For your pipeline, either:
- **Fixed budget**: enforce a wall-clock timeout inside your training script
  so every experiment finishes in roughly the same time.
- **Fixed work unit**: set an epoch/step count so runs converge within a
  known window.

Document whichever you pick in `program.md` and mention a hard kill-switch
timeout (e.g. "If a run exceeds 10 minutes, kill it and treat it as a
failure").

---

## 6. Checklist

- [ ] Picked a single scalar metric and its direction (minimize/maximize)
- [ ] Defined `results_schema` columns matching what the agent will write
- [ ] Listed all pipeline files in `autoresearch.files`
- [ ] Configured `bootstrap` (or set to `null` if no prep needed)
- [ ] Declared `metrics.primary`, `summary_fields`, and `progress_line`
      matching your pipeline's stdout format
- [ ] Wrote a `program.md` with: goal, CAN/CANNOT list, summary-block
      example, TSV schema example, append-only invariant, NEVER STOP,
      `{{INSTRUCTION_FILE}}` check, LOOP FOREVER
- [ ] Replaced all nanochat-specific numeric ranges in `program.md`
- [ ] Set `workspace_name`, `instruction_filename`, `knowledge_query`
- [ ] Updated `WORKFLOW.md` with all config sections
- [ ] Decided on `searxng_endpoint` (null strips the web-search section)
- [ ] Dry-ran once, confirmed `results.tsv` got a baseline row and the
      dashboard shows your metric labels

---

## 7. Debugging the first run

- **Agent hangs immediately**: check that `opencode` is on PATH and
  `~/.config/opencode/opencode.json` has a provider matching WORKFLOW.md's
  `opencode.model`. Model names must match *exactly* between your LLM
  provider config and the `name` field.
- **Dashboard shows wrong labels**: confirm `metrics.primary.label` and
  `summary_fields[].label` are set. The dashboard renders these verbatim.
- **Dashboard stays at "No results"**: your pipeline isn't printing a
  summary block matching the configured regexes. Check
  `workspaces/<workspace_name>/run.log` for lines matching your
  `metrics.primary.name` pattern.
- **"Best" picks the wrong experiment**: check `metrics.primary.direction`.
  `minimize` picks the lowest value; `maximize` picks the highest.
- **Agent writes then rewrites `results.tsv`**: your `program.md`'s
  append-only language isn't strong enough. Add a second paragraph warning
  against it, in caps, with an example of the wrong behavior.
- **Agent keeps trying the same discarded experiment**: the context builder
  uses `results_schema.discard_statuses` to build the "avoid repeating"
  list. Make sure the agent writes those exact status strings.
- **Bootstrap runs every time**: the `bootstrap.check_paths` aren't being
  created by your command. Verify the paths exist after the command runs.
- **Crash-restart thrashes**: lower `max_crash_restarts` temporarily and
  inspect the dashboard's crash events. The orchestrator injects
  `lastCrashError` (first 500 chars) into the next prompt automatically.
- **Validation errors on startup**: the config validator checks that all
  `files[].src` paths exist, all `progress_line[].pattern` entries compile
  as valid regexes, and `results_schema` columns include the required
  marker columns. Read the error messages — they name the offending field.
