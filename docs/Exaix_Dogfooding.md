# Exaix Dogfooding Guide

Dogfooding means using Exaix to develop Exaix itself — submitting requests against the
Exaix codebase through daemon-agent pipelines, reviewing plans, and tracking the
full trace_id audit trail.

## Prerequisites

- Git (for worktree creation)
- Deno 2.x
- A running [Ollama](https://ollama.ai) instance (default) or an API key for
  Anthropic, OpenAI, or Google. The config preset defaults to `ollama`; set
  `EXA_LLM_PROVIDER` to switch.
- Unix-like OS (Linux or macOS). Windows is not yet supported for dogfooding.

## Quick Start

```bash
# 1. Create a git worktree (isolated working copy for agent changes)
deno task dogfood:bootstrap /path/to/worktree

# 2. Start the daemon with the dogfood config preset
deno task dogfood

# 3. Write a request file
cat > .dogfood/Workspace/Requests/my-task.md << 'EOF'
---
trace_id: "$(uuidgen)"
created: "$(date -Iseconds)"
status: pending
priority: 5
identity: senior-coder
source: dogfood
created_by: developer
---
Add a comment explaining the ConfigService.load() method
EOF

# 4. Wait for the plan to appear in .dogfood/Workspace/Plans/
ls .dogfood/Workspace/Plans/

# 5. Review and approve the plan
deno run -A apps/exactl/main.ts plan list
deno run -A apps/exactl/main.ts plan approve <plan-id>

# 6. Stop the daemon when done
deno task dogfood:stop
```

## Detailed Setup

### Step 1: Bootstrap a Worktree

The bootstrap script creates a git worktree, registers it as a portal, and
replaces the `__WORKTREE_PATH__` placeholder in `configs/dogfood.toml` with
the actual worktree path:

```bash
deno task dogfood:bootstrap /path/to/worktree
```

This:

1. Creates the worktree via `git worktree add`
1. Sets `target_path` in `configs/dogfood.toml` to the worktree path
1. Registers the portal as `exaix-self`
1. Waits for portal knowledge generation

> **Safety:** Always use a worktree — never point `target_path` at your live
> checkout. Worktrees isolate agent writes so the live repo never sees
> unapproved changes.

### Step 2: Start the Daemon

```bash
deno task dogfood
```

This launches the daemon as a background subprocess using the dogfood config
preset (`configs/dogfood.toml`). The daemon watches `Workspace/Requests/` for
new request files, processes them through `RequestProcessor`, and writes plans
to `Workspace/Plans/`.

Useful daemon commands:

| Command                    | Purpose                     |
| -------------------------- | --------------------------- |
| `deno task dogfood`        | Start daemon in background  |
| `deno task dogfood:stop`   | Gracefully stop the daemon  |
| `deno task dogfood:status` | Check if daemon is running  |
| `deno task dogfood:log`    | Print the last 50 log lines |

### Step 3: Write a Request

Requests are markdown files with YAML frontmatter placed in `Workspace/Requests/`:

```yaml
---
trace_id: "a-unique-uuid"
created: "2026-06-18T12:00:00.000Z"
status: pending
priority: 5
identity: senior-coder
source: dogfood
created_by: developer
portal: "exaix-self"
---
Describe what you want the agent to do here.
```

**Fields:**

| Field        | Required | Description                                |
| ------------ | -------- | ------------------------------------------ |
| `trace_id`   | Yes      | UUID linking all artifacts                 |
| `created`    | Yes      | ISO timestamp                              |
| `status`     | Yes      | Must be `pending`                          |
| `priority`   | No       | 1–10 (default: 5)                          |
| `identity`   | Yes      | Agent identity (e.g., `senior-coder`)      |
| `source`     | No       | Origin of request (e.g., `dogfood`, `cli`) |
| `created_by` | No       | Who created the request                    |
| `portal`     | No       | Portal alias for context                   |
| `tags`       | No       | Array of tag strings                       |

### Step 4: Review and Approve Plans

Once the daemon processes a request, a plan file appears in
`Workspace/Plans/`. Use `exactl` to review and approve:

```bash
# List plans
deno run -A apps/exactl/main.ts plan list

# Show a specific plan
deno run -A apps/exactl/main.ts plan show <plan-id>

# Approve a plan (triggers execution)
deno run -A apps/exactl/main.ts plan approve <plan-id>
```

### Step 5: Track Progress

Each request→plan→execution cycle is tracked in the Activity Journal:

```bash
# List recent activity
deno run -A apps/exactl/main.ts activity list --limit 10

# Show details for a specific trace
deno run -A apps/exactl/main.ts activity show <trace-id>
```

## Configuration

### Environment Variable Overrides

| Variable           | Default         | Description                     |
| ------------------ | --------------- | ------------------------------- |
| `EXA_LLM_PROVIDER` | `ollama`        | LLM provider (`ollama`, `mock`) |
| `EXA_LLM_MODEL`    | `ollama/llama3` | Model name                      |
| `EXA_LLM_BASE_URL` | —               | Provider API base URL           |
| `EXA_CONFIG_PATH`  | —               | Override config file path       |

### Config Preset

The dogfood config preset lives at `configs/dogfood.toml`. Key settings:

- `system.root = "./.dogfood"` — All workspace data goes under `.dogfood/`
- `ai.provider = "ollama"` — Default LLM provider (overridable)
- `[[portals]]` — Worktree portal `exaix-self` with `execution_strategy = "worktree"`
- `quality_gate.enabled = false` — Quality gate disabled for development workflows

## CI Gates

Before submitting any dogfooding-related changes, run:

```bash
deno task check clean
deno task test
```

All 14 pre-commit gates (fmt, lint, style, test-placement, magic, arch,
complexity, docs, event-strings) must pass.

## Safety Notes

1. **Always use a worktree.** The dogfood config preset sets
   `execution_strategy = "worktree"` and the bootstrap creates a dedicated
   worktree. Never point `target_path` at your live checkout.
1. **The config preset contains no secrets.** No API keys are committed.
   Provider credentials are supplied via `EXA_LLM_*` environment variables.
1. **Mock provider for testing.** Use `EXA_LLM_PROVIDER=mock` to test the
   pipeline without a real LLM — no API call is made and no network is needed.

## Troubleshooting

| Symptom                    | Likely Cause              | Fix                                    |
| -------------------------- | ------------------------- | -------------------------------------- |
| Daemon exits immediately   | Config validation error   | Run `deno task dogfood:log` for error  |
| Request not processed      | Debounce timer            | Wait 2–3 seconds after writing         |
| Plan not generated         | Provider not available    | Check Ollama or API key                |
| Portal knowledge empty     | Empty or new repo         | Run `exactl portal analyze exaix-self` |
| Permission errors on start | Missing `--allow-*` flags | Use `deno task dogfood` (sets flags)   |

## See Also

- `configs/dogfood.toml` — Dogfood config preset
- `scripts/dogfood_daemon.ts` — Daemon lifecycle script
- `scripts/dogfood_bootstrap.ts` — Worktree bootstrap script
- `tests/integration/dogfood_e2e_test.ts` — End-to-end integration test
- `tests/integration/dogfood_smoke_test.ts` — In-process request→plan test
- [Exaix User Guide](Exaix_User_Guide.md) — General usage documentation
