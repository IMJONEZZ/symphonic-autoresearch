FROM nvcr.io/nvidia/pytorch:26.01-py3

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js (LTS) for symphonic-autoresearch
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install git (needed for autoresearch experiment tracking)
RUN apt-get update && apt-get install -y git curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Configure git defaults for autoresearch
RUN git config --global user.email "symphonic-autoresearch@autoresearch.local" && \
    git config --global user.name "Symphonic Autoresearch" && \
    git config --global init.defaultBranch master

# Install autoresearch Python dependencies (DO NOT install torch - container has it)
RUN pip install --no-cache-dir \
    "kernels>=0.11.7" \
    "matplotlib>=3.10.8" \
    "numpy>=2.2.6" \
    "pandas>=2.3.3" \
    "pyarrow>=21.0.0" \
    "requests>=2.32.0" \
    "rustbpe>=0.1.0" \
    "tiktoken>=0.11.0"

# Set up symphonic-autoresearch
WORKDIR /workspace

# Copy symphonic-autoresearch source and install deps
COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json vitest.config.ts ./
COPY src/ src/

# Build symphonic-autoresearch
RUN npx tsc

# Copy autoresearch files
COPY autoresearch/ autoresearch/

# Copy workflow config and entrypoint
COPY WORKFLOW.md ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# OpenCode is mounted as a volume from the host at /root/.opencode
# OpenCode config is mounted from host at /root/.config/opencode
# The PATH will include /root/.opencode/bin via environment

# Expose dashboard port
EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
