# Symphonic Autoresearch

A production-grade orchestration platform for autonomous ML research. Wrap your AI agents around Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) and run experiments overnight—with crash recovery, real-time dashboards, and persistent memory.

## What This Does

Give an AI agent access to a small LLM training setup. It runs experiments continuously:

1. **Modifies** `train.py` with experimental changes
2. **Trains** for 5 minutes (fixed time budget)
3. **Evaluates** validation loss (`val_bpb`)
4. **Keeps or reverts** based on results
5. **Repeats forever**

Wake up to ~100 experiments and (hopefully) a better model.

## How This Differs From Karpathy's Original

| Feature | Karpathy's Autoresearch | Symphonic Autoresearch |
|---------|------------------------|------------------------|
| Crash recovery | Agent exits on error | Auto-restart with exponential backoff |
| Visibility | Terminal scrollback only | Real-time web dashboard (SSE) |
| Monitoring | None | GPU temp/memory/power metrics |
| Memory | Context window only | Optional knowledge persistence |
| Deployment | Manual `uv run` | Docker Compose one-command startup |
| Configuration | Edit files directly | YAML frontmatter in WORKFLOW.md |

**When to use which:**

- **Original**: You want radical simplicity, 5 files total, learning how it works
- **This**: You want reliability overnight, remote monitoring, crash resilience

## Quick Start

### Prerequisites

1. **NVIDIA GPU** with CUDA support (compute capability 8.0+ for Flash Attention 3)

2. **Docker** with NVIDIA Container Toolkit:
   ```bash
   # Verify NVIDIA Docker runtime works
   docker run --rm --gpus all nvidia/cuda:12-base nvidia-smi
   
   # If this fails, install nvidia-docker or NVIDIA Container Toolkit
   # See: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/
   ```

3. **OpenCode CLI** (required):
   ```bash
   # Install OpenCode following instructions at opencode.ai
   mkdir -p ~/.opencode/bin
   # ... install steps per platform
   
   # Verify installation
   ~/.opencode/bin/opencode --version
   ```
   
   The Docker container mounts `~/.opencode` and expects the binary at this location.

4. **OpenCode configuration**:
   ```bash
   # Required: provider definitions for your model(s)
   ~/.config/opencode/opencode.json
   
   # Optional: agent rules and instructions
   ~/.config/opencode/AGENTS.md
   ```
   
   See `example.WORKFLOW.md` for how to configure the model in WORKFLOW.md.

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/symphonic-autoresearch.git
cd symphonic-autoresearch

# Create your configuration from the example
cp example.WORKFLOW.md WORKFLOW.md
# Edit WORKFLOW.md with your model and preferences

# Build and run
docker compose up --build
```

### Access the Dashboard

Open http://localhost:8080 to see:
- Live training progress (loss, tok/s, MFU)
- Experiment history from `results.tsv`
- GPU metrics (temperature, VRAM, power draw)
- Agent trace with expandable JSON events

![Dashboard showing real-time training progress](./docs/dashboard.png)

## Configuration

All settings live in `WORKFLOW.md`:

```yaml
---
mode: autoresearch

workspace:
  root: ~/symphonic-autoresearch-workspaces

opencode:
  command: opencode
  model: your-model-here  # e.g., lmstudio/glm-5@q4_k_xl

autoresearch:
  program_md: ./autoresearch/program.md
  prepare_py: ./autoresearch/prepare.py
  train_py: ./autoresearch/train.py
  restart_on_crash: true
  max_crash_restarts: 20
  
server:
  port: 8080
---
```

See `example.WORKFLOW.md` for all available options.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ Symphonic Autoresearch                    ● Running        │
├─────────────────────────────────────────────────────────────┤
│ Orchestrator spawns OpenCode with program.md prompt         │
│     ↓                                                       │
│ Agent reads results.tsv, modifies train.py                  │
│     ↓                                                       │
│ Training runs for 5 minutes (TIME_BUDGET)                   │
│     ↓                                                       │
│ val_bpb extracted, logged to results.tsv                    │
│     ↓                                                       │
│ If improved → keep changes; if worse → git reset            │
│     ↓                                                       │
│ Repeat forever (or until crash → auto-restart)              │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
symphonic-autoresearch/
├── src/
│   ├── orchestrator/      # Main loop, state management, retry logic
│   ├── agent/             # OpenCode client wrapper, prompt building
│   ├── server/            # HTTP + SSE dashboard server
│   ├── workspace/         # Git workspace management
│   ├── monitor/           # Hardware metrics (GPU)
│   └── knowledge/         # Optional vector store for memory
├── autoresearch/
│   ├── prepare.py         # Data download, tokenizer (from Karpathy)
│   ├── train.py           # Model + training loop (agent modifies this)
│   └── program.md         # Agent instructions
├── WORKFLOW.md            # Your configuration (gitignored)
├── example.WORKFLOW.md    # Configuration template
└── docker-compose.yml     # One-command deployment
```

## License

See [LICENSE](./LICENSE) for details. Free to use; revenue sharing applies for commercial deployments.

## Credits

Built on top of [Karpathy's autoresearch](https://github.com/karpathy/autoresearch). The core training loop and model architecture are his work—this project adds production infrastructure around it.
