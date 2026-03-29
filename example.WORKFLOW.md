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

server:
  port: 8080
---

You are an autonomous ML researcher running experiments on a GPU.
Follow the instructions in program.md exactly.
