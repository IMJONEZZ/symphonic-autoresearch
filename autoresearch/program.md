# autoresearch

This is an experiment to have the LLM do its own research.

## Setup

To set up a new experiment, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar5`). The branch `autoresearch/<tag>` must not already exist — this is a fresh run.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master.
3. **Read the in-scope files**: The repo is small. Read these files for full context:
   - `README.md` — repository context.
   - `prepare.py` — fixed constants, data prep, tokenizer, dataloader, evaluation. Do not modify.
   - `train.py` — the file you modify. Model architecture, optimizer, training loop.
4. **Verify data exists**: Check that `~/.cache/autoresearch/` contains data shards and a tokenizer. If not, tell the human to run `python prepare.py`.
5. **Initialize results.tsv**: Create `results.tsv` with just the header row. The baseline will be recorded after the first run.
6. **Confirm and go**: Confirm setup looks good.

Once you get confirmation, kick off the experimentation.

## On Startup / Restart

When you begin (or resume after a restart), ALWAYS:
1. Check if `results.tsv` exists and read it to see what experiments have been run
2. Run `git log --oneline -10` to understand the current branch state
3. If experiments already exist, do NOT re-run the baseline — continue from the best result
4. Do NOT repeat experiments that are listed as "discard" or "crash" in results.tsv
5. Study the pattern of what worked (kept) vs what didn't (discarded) to inform your next idea
6. Sanity-check val_bpb values: a fresh GPT baseline on FineWeb-Edu should produce val_bpb around 1.0-1.2 after 5 minutes. If you see values below 0.5 for a small model, something is likely wrong with the attention masking or evaluation — investigate before continuing.

## Experimentation

Each experiment runs on a single GPU. The training script runs for a **fixed time budget of 5 minutes** (wall clock training time, excluding startup/compilation). You launch it simply as: `python train.py`.

**What you CAN do:**
- Modify `train.py` — this is the only file you edit. Everything is fair game: model architecture, optimizer, hyperparameters, training loop, batch size, model size, etc.

**What you CANNOT do:**
- Modify `prepare.py`. It is read-only. It contains the fixed evaluation, data loading, tokenizer, and training constants (time budget, sequence length, etc).
- Install new packages or add dependencies. You can only use what's already in `pyproject.toml`.
- Modify the evaluation harness. The `evaluate_bpb` function in `prepare.py` is the ground truth metric.

**The goal is simple: get the lowest val_bpb.** Since the time budget is fixed, you don't need to worry about training time — it's always 5 minutes. Everything is fair game: change the architecture, the optimizer, the hyperparameters, the batch size, the model size. The only constraint is that the code runs without crashing and finishes within the time budget.

**VRAM** is a soft constraint. Some increase is acceptable for meaningful val_bpb gains, but it should not blow up dramatically.

**Simplicity criterion**: All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Conversely, removing something and getting equal or better results is a great outcome — that's a simplification win. When evaluating whether to keep a change, weigh the complexity cost against the improvement magnitude. A 0.001 val_bpb improvement that adds 20 lines of hacky code? Probably not worth it. A 0.001 val_bpb improvement from deleting code? Definitely keep. An improvement of ~0 but much simpler code? Keep.

**The first run**: Your very first run should always be to establish the baseline, so you will run the training script as is.

## Output format

Once the script finishes it prints a summary like this:

```
---
val_bpb:          0.997900
training_seconds: 300.1
total_seconds:    325.9
peak_vram_mb:     45060.2
mfu_percent:      39.80
total_tokens_M:   499.6
num_steps:        953
num_params_M:     50.3
depth:            8
```

Note that the script is configured to always stop after 5 minutes, so depending on the computing platform of this computer the numbers might look different. You can extract the key metric from the log file:

```
grep "^val_bpb:" run.log
```

## Logging results

When an experiment is done, log it to `results.tsv` (tab-separated, NOT comma-separated — commas break in descriptions).

The TSV has a header row and 6 columns:

```
commit	val_bpb	final_loss	memory_gb	status	description
```

1. git commit hash (short, 7 chars)
2. val_bpb achieved (e.g. 1.234567) — use 0.000000 for crashes
3. final_loss: the last loss value from training (from the last training step line in run.log) — use 0.000000 for crashes
4. peak memory in GB, round to .1f (e.g. 12.3 — divide peak_vram_mb by 1024) — use 0.0 for crashes
5. status: `keep`, `discard`, or `crash`
6. short text description of what this experiment tried

Example:

```
commit	val_bpb	final_loss	memory_gb	status	description
a1b2c3d	0.997900	3.214567	44.0	keep	baseline
b2c3d4e	0.993200	3.189234	44.2	keep	increase LR to 0.04
c3d4e5f	1.005000	3.245678	44.0	discard	switch to GeLU activation
d4e5f6g	0.000000	0.000000	0.0	crash	double model width (OOM)
```

**CRITICAL: results.tsv is append-only.** NEVER modify or delete previous rows. Each experiment gets exactly one row appended when it finishes. Previous "keep" entries stay as "keep" even when a later experiment beats them — they represent the history of what was tried and what worked at the time. The `status` field records the decision made at the time of that experiment:
- `keep` = this experiment improved on the previous best *at the time it ran*
- `discard` = this experiment did NOT improve on the previous best *at the time it ran*
- `crash` = this experiment crashed before producing a val_bpb

## The experiment loop

The experiment runs on a dedicated branch (e.g. `autoresearch/mar5` or `autoresearch/mar5-gpu0`).

LOOP FOREVER:

1. Look at the git state: the current branch/commit we're on
2. Tune `train.py` with an experimental idea by directly hacking the code.
3. git commit
4. Run the experiment: `python train.py > run.log 2>&1` (redirect everything — do NOT use tee or let output flood your context)
5. Read out the results: `grep "^val_bpb:\|^peak_vram_mb:" run.log` and also capture the final loss value from the last training step line in run.log
6. If the grep output is empty, the run crashed. Run `tail -n 50 run.log` to read the Python stack trace and attempt a fix. If you can't get things to work after more than a few attempts, give up.
7a. Record the results in the tsv (NOTE: do not commit the results.tsv file, leave it untracked by git)
7b. **Check for user instructions**: After each experiment, check if `.symphonic-autoresearch-user-instructions.md` exists in the workspace. If it does:
    - Read it — it contains instructions from the human operator
    - Follow the instructions (they may redirect your next experiment, change strategy, etc.)
    - Delete the file after reading: `rm .symphonic-autoresearch-user-instructions.md`
    - Continue the experiment loop incorporating the new instructions
8. If val_bpb improved (lower), you "advance" the branch, keeping the git commit
9. If val_bpb is equal or worse, you git reset back to where you started

**Important**: When you "discard" an experiment, that means you git reset and log it as "discard" in results.tsv. Do NOT go back and change previous "keep" entries to "discard". The status reflects the decision at the time of each experiment.

The idea is that you are a completely autonomous researcher trying things out. If they work, keep. If they don't, discard. And you're advancing the branch so that you can iterate. If you feel like you're getting stuck in some way, you can rewind but you should probably do this very very sparingly (if ever).

**Timeout**: Each experiment should take ~5 minutes total (+ a few seconds for startup and eval overhead). If a run exceeds 10 minutes, kill it and treat it as a failure (discard and revert).

**Crashes**: If a run crashes (OOM, or a bug, or etc.), use your judgment: If it's something dumb and easy to fix (e.g. a typo, a missing import), fix it and re-run. If the idea itself is fundamentally broken, just skip it, log "crash" as the status in the tsv, and move on.

**NEVER STOP**: Once the experiment loop has begun (after the initial setup), do NOT pause to ask the human if you should continue. Do NOT ask "should I keep going?" or "is this a good stopping point?". The human might be asleep, or gone from a computer and expects you to continue working *indefinitely* until you are manually stopped. You are autonomous. If you run out of ideas, think harder — search the web for recent techniques, read papers referenced in the code, re-read the in-scope files for new angles, try combining previous near-misses, try more radical architectural changes. The loop runs until the human interrupts you, period.

## Research via web search

You have access to a SearXNG instance at **{{SEARXNG_ENDPOINT}}**. Use `webfetch` to search it. This is a powerful tool — use it proactively, not just when you're stuck.

**When to search:**
- Before trying a new technique — search for recent results, best practices, or known pitfalls (e.g. "efficient transformer training techniques 2025", "muon optimizer improvements")
- When you plateau — search for ideas you haven't tried yet (e.g. "low-budget language model pretraining tricks", "improving bpb small transformers")
- When an experiment fails unexpectedly — search for known issues (e.g. "OOM flash attention batch size", "NaN loss transformer training")
- Periodically (every 5-10 experiments) — search for the latest advances in efficient pretraining, architecture innovations, optimizer research, etc.

**How to search:**
```
webfetch {{SEARXNG_ENDPOINT}}/search?q=YOUR+QUERY+HERE&format=json
```

The JSON response contains a list of results with titles, URLs, and snippets. If a result looks promising, `webfetch` the URL directly to read the full content (paper abstracts, blog posts, GitHub READMEs, etc.).

**Good search topics:**
- New attention mechanisms (linear attention, differential attention, multi-scale attention)
- Optimizer improvements (Schedule-Free, SOAP, Muon variants, Cautious optimizers)
- Architecture innovations (mixture of experts, state space models, hybrid architectures)
- Training efficiency (gradient checkpointing, mixed precision tricks, kernel fusion)
- Regularization and normalization techniques
- Learning rate schedule research
- Embedding tricks (weight tying, factored embeddings)
- Recent arXiv papers on efficient LLM pretraining

**Important:** Don't spend too long reading — skim for the core idea, then try it. A 5-minute experiment is the best way to validate whether a technique works in this setting. If a paper describes something complex, try a simplified version first.

As an example use case, a user might leave you running while they sleep. If each experiment takes you ~5 minutes then you can run approx 12/hour, for a total of about 100 over the duration of the average human sleep. The user then wakes up to experimental results, all completed by you while they slept!
