---
# Autoresearch Configuration
# Change these values to run experiments with different models and datasets.
# After changing, restart symphony to pick up the new config.

# Base model architecture (currently: karpathy's GPT from scratch)
# Future: specify a HuggingFace model ID to fine-tune instead
base_model: gpt-from-scratch

# Training dataset
# Currently uses FineWeb-Edu (hardcoded in prepare.py)
# Future: specify a HuggingFace dataset ID
dataset: HuggingFaceFW/fineweb-edu

# Training time budget per experiment (seconds)
time_budget: 300

# OpenCode model for the AI researcher agent
agent_model: lmstudio/minimax-m2.5-mlx@4bit

# Hardware target
hardware: dgx-spark
gpu_memory_gb: 128

# Experiment tracking
run_tag: auto
---

# Autoresearch Configuration

This file controls what model architecture and dataset the autoresearch loop
experiments with. Currently replicating karpathy/autoresearch exactly:

- **Model**: GPT from scratch (defined in `train.py`)
- **Dataset**: FineWeb-Edu (downloaded by `prepare.py`)
- **Budget**: 5 minutes per experiment
- **Metric**: val_bpb (validation bits per byte, lower is better)

## Changing Models and Datasets

To switch to a different base model or dataset, update the YAML front matter
above and modify `prepare.py` and `train.py` accordingly. The goal is to make
this a simple config change in future iterations.

## Current Limitations

- `prepare.py` downloads FineWeb-Edu specifically (hardcoded)
- `train.py` defines a GPT architecture from scratch
- To use a HuggingFace pretrained model, both files need adaptation
