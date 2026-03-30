# Contributing

Thank you for your interest in contributing to Symphonic Autoresearch!

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/symphonic-autoresearch.git
cd symphonic-autoresearch
npm install
npm run build
npm test
```

### Requirements

- Node.js 22+
- Docker with NVIDIA Container Toolkit (for full testing)
- OpenCode CLI at `~/.opencode/bin/opencode`

## Project Structure

```
src/
├── agent/              # OpenCode client wrapper, prompt building
│   ├── agent-runner.ts    # Agent lifecycle management
│   ├── opencode-client.ts # Subprocess communication with OpenCode
│   └── context-builder.ts # Dynamic prompt construction
├── config/             # Configuration parsing and validation
│   ├── config-layer.ts    # ServiceConfig builder
│   ├── workflow-loader.ts # YAML frontmatter parser
│   ├── validation.ts      # Config validation logic
│   └── watcher.ts         # Hot reload support
├── knowledge/          # Optional vector store for persistent memory
│   ├── knowledge-store.ts # Embedding storage and retrieval
│   ├── embedding-client.ts# Embedding API client
│   └── search-interceptor.ts # SSE event parsing for web searches
├── monitor/            # Hardware monitoring
│   └── hardware-monitor.ts # GPU temp/memory/power via nvidia-smi
├── orchestrator/       # Main loop, state management
│   ├── orchestrator.ts    # Primary orchestration loop
│   ├── dispatch.ts        # Mode routing (linear/autoresearch)
│   ├── retry.ts           # Exponential backoff logic
│   └── reconciliation.ts  # State sync utilities
├── server/             # HTTP + SSE dashboard server
│   ├── server.ts          # Express app setup
│   ├── routes.ts          # API endpoints
│   └── dashboard.ts       # Real-time HTML dashboard
├── tracker/            # Issue tracker integration (Linear)
├── types/              # TypeScript type definitions
├── workspace/          # Git workspace management
└── utils/              # Shared utilities

autoresearch/
├── prepare.py          # Data download, tokenizer training
├── train.py            # Model + optimizer (agent modifies this)
├── program.md          # Agent instructions template
└── research-config.md  # Human-editable experiment config
```

## Code Style

- **TypeScript** with strict mode enabled
- **ES modules** (`type: "module"` in package.json)
- Prefer `const` over `let`, immutability where practical
- Add JSDoc comments for public functions:

```typescript
/**
 * Parses YAML frontmatter from a workflow file.
 * @param content - Raw file contents with optional --- delimiters
 * @returns Parsed YAML config and remaining prompt text
 */
export function parseFrontMatter(content: string): { config: WorkflowConfig; prompt: string } {
  // ...
}
```

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add knowledge persistence for web search results
fix: correct exponential backoff calculation in retry logic
docs: update README with Docker prerequisites
refactor: extract dashboard rendering to separate module
test: add unit tests for config validation
chore: bump dependencies
```

**Prefixes:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change without behavior change
- `test:` - Adding or fixing tests
- `chore:` - Build, deps, tooling

## Testing

Run the test suite before submitting PRs:

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode for development
```

Tests are located in `test/unit/` mirroring the `src/` structure.

## Pull Requests

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make focused changes** — one logical change per PR

3. **Add tests** for new functionality

4. **Update documentation** if changing behavior:
   - README.md for user-facing changes
   - JSDoc comments for API changes
   - This file for process changes

5. **Ensure CI passes** (once configured)

6. **Write a clear PR description**:
   - What problem does this solve?
   - How did you test it?
   - Any breaking changes?

## Adding New Features

### Adding a new configuration option

1. Add the type in `src/types/workflow.ts`
2. Parse it in `src/config/config-layer.ts`
3. Validate it in `src/config/validation.ts`
4. Document it in `example.WORKFLOW.md`

### Adding a new dashboard widget

1. Add data endpoint in `src/server/routes.ts`
2. Update SSE events in `src/orchestrator/orchestrator.ts`
3. Render in `src/server/dashboard.ts`

### Adding a new autoresearch mode hook

1. Define the hook in `src/types/workflow.ts`
2. Implement execution in `src/workspace/hooks.ts`
3. Document usage in README or jonezz-instructions.md

## Questions?

Open an issue with the `question` label for clarification on anything not covered here.
