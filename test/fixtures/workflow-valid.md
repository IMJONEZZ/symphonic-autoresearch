---
mode: linear

tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled

polling:
  interval_ms: 15000

workspace:
  root: /tmp/test_workspaces

agent:
  max_concurrent_agents: 5
  max_turns: 10
  max_retry_backoff_ms: 60000

opencode:
  command: opencode
  model: your-model-here
  run_timeout_ms: 1800000
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

{% if attempt %}This is retry attempt {{ attempt }}.{% endif %}

Labels: {% for label in issue.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% endfor %}
