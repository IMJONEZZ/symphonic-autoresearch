#!/bin/bash
set -e

echo "=== Symphony Autoresearch Entrypoint ==="

# 1. Verify GPU access
echo "Checking GPU..."
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}, Device: {torch.cuda.get_device_name(0)}')"

# 2. Verify OpenCode is accessible
if command -v opencode &> /dev/null; then
    echo "OpenCode: $(opencode --version)"
else
    echo "WARNING: opencode not found on PATH. Make sure ~/.opencode/bin is in PATH."
    echo "Current PATH: $PATH"
fi

# 3. Run prepare.py if data doesn't exist yet
CACHE_DIR="/root/.cache/autoresearch"
if [ ! -d "$CACHE_DIR/data" ] || [ ! -f "$CACHE_DIR/tokenizer/tokenizer.pkl" ]; then
    echo "Autoresearch data not found. Running prepare.py (~2 min)..."
    python autoresearch/prepare.py
else
    echo "Autoresearch data already prepared at $CACHE_DIR"
fi

# 4. Start symphonic-autoresearch
echo "Starting Symphonic Autoresearch in autoresearch mode..."
exec node dist/index.js ./WORKFLOW.md --port 8080
