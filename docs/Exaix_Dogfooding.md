# Exaix Dogfooding Guide

Dogfooding means using Exaix to develop Exaix itself — running the daemon locally,
creating structured requests against the Exaix codebase, reviewing machine-generated
plans, and tracking every change through the full trace_id audit trail.

This guide covers the **hybrid dogfooding model**: you author the plan and acceptance
criteria (the "what" and "why"), the daemon agent executes the mechanical work (the
"how"), and you review the result before it reaches the main branch.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
1. [Quick Start](#2-quick-start)
1. [The Dogfooding Loop](#3-the-dogfooding-loop)
   - [3.4 Generating Step Requests from a Plan](#34-generating-step-requests-from-a-plan)
1. [Writing Requests](#4-writing-requests)
1. [Skills & Plans](#5-skills--plans)
1. [Headless Delegation](#6-headless-delegation)
   - [6.7 Bounded Context Supplement](#67-bounded-context-supplement-dogfoodcontext)
   - [6.8 Session-Bound MCP Context Queries](#68-session-bound-mcp-context-queries)
1. [Configuration](#7-configuration)
1. [When to Dogfood vs Interactive](#8-when-to-dogfood-vs-interactive)
1. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

- **Git** — for worktree creation (isolates agent changes from the live checkout)
- **Deno 2.x** — runtime for the Exaix daemon and scripts
- **LLM provider** — Ollama (default, free, no API key), or an API key for
  Anthropic, OpenAI, or Google. Set `EXA_LLM_PROVIDER` to switch.
- **OpenCode CLI** (optional) — for headless agent delegation (`opencode run`)
- **Claude Code** (optional) — for headless delegation on a Claude Pro/Max subscription
- Unix-like OS (Linux or macOS). Windows is not yet supported.

---

## 2. Quick Start

Choose the cycle before creating a sandbox. The default bootstrap configuration uses
the governed **session-delegate cycle** with OpenCode. For a Claude Code subscription,
replace the generated configuration with the Claude template in step 3a below:

| Need                                                                     | Flow                    | Delegate configuration                                                           |
| ------------------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| Execute a prepared, multi-step plan with checkpointing and a review gate | `dogfood-meta-workflow` | `configs/dogfood.toml` (OpenCode) or `configs/dogfood.claude.toml` (Claude Code) |
| Run the simpler implement-then-review flow through a native CLI          | `dogfood-loop`          | `configs/dogfood.opencode.stock.toml` or `configs/dogfood.claude.stock.toml`     |

The commands below create an isolated worktree and leave the repository checkout unchanged.
Run them from the Exaix repository root.

```bash
# 1. Pick paths that do not already exist. The bootstrap script creates the worktree.
export DOGFOOD_SANDBOX="$HOME/exa-dogfood"
export DOGFOOD_WORKTREE="$HOME/exaix-dogfood-worktree"

# 2. Bootstrap an external sandbox and isolated worktree.
deno run -A scripts/dogfood_bootstrap.ts \
  --dir "$DOGFOOD_SANDBOX" \
  --worktree "$DOGFOOD_WORKTREE"

# 2a. Give the newly created worktree its own branch before any agent can edit it.
git -C "$DOGFOOD_WORKTREE" switch -c feature/health-endpoint

# 3. Use the generated default configuration.
export EXA_CONFIG_PATH=$DOGFOOD_SANDBOX/workspace/exa.config.toml

# 3a. Optional: use Claude Code through its logged-in subscription instead.
# This must happen before starting the daemon. It replaces the default OpenCode template
# while preserving the sandbox-specific paths created above.
export DOGFOOD_CONFIG_TEMPLATE="$PWD/configs/dogfood.claude.toml"
deno eval --allow-read --allow-write --allow-env '
const template = Deno.env.get("DOGFOOD_CONFIG_TEMPLATE")!;
const config = Deno.env.get("EXA_CONFIG_PATH")!;
const root = Deno.env.get("DOGFOOD_SANDBOX")!;
const worktree = Deno.env.get("DOGFOOD_WORKTREE")!;
const source = await Deno.readTextFile(template);
await Deno.writeTextFile(
  config,
  source.replaceAll("__DOGFOOD_ROOT__", root).replaceAll("__WORKTREE_PATH__", worktree),
);
'

# 4. Start the daemon and wait for readiness.
deno task dogfood
deno run -A scripts/wait_for_daemon.ts $DOGFOOD_SANDBOX/workspace

# 5. Write a request. An unquoted heredoc deliberately expands the UUID and timestamp.
cat > "$DOGFOOD_SANDBOX/workspace/Workspace/Requests/add-health-endpoint.md" <<REQUEST
---
trace_id: "$(deno eval 'console.log(crypto.randomUUID())')"
created: "$(date -Iseconds)"
status: pending
priority: 5
agent_role: senior-coder
skills: [tdd-methodology, exaix-conventions]
portal: "exaix-self"
target_branch: "feature/health-endpoint"
tags: ["feature", "phase-121"]
flow: "dogfood-loop"
---
# Add health endpoint to daemon

Implement a `/health` HTTP endpoint on the daemon's monitoring server
that returns `{ "status": "ok" }` and a 200 status code.

## Acceptance — tests

- `GET /health` returns 200
- Response body contains `"status": "ok"`
- Endpoint is wired in `apps/daemon/main.ts`

## Acceptance — outcomes

- `deno task check clean`
- `deno task test` passes
REQUEST

# 6. Wait for the plan, then review it before authorizing any work.
ls $DOGFOOD_SANDBOX/workspace/Workspace/Plans/
deno run -A apps/exactl/main.ts plan list
deno run -A apps/exactl/main.ts plan show <plan-id>
deno run -A apps/exactl/main.ts plan approve <plan-id>

# 7. Inspect the final diff and context capture. Stop the daemon when finished.
git -C "$DOGFOOD_WORKTREE" status
git -C "$DOGFOOD_WORKTREE" diff
deno run -A apps/exactl/main.ts request inspect <trace-id>
deno task dogfood:stop
```

This one-off example uses `dogfood-loop`. Its stock loop delegates both implementation
and review to the selected native CLI. Use `dogfood-meta-workflow` only for an already
approved phase plan with a usable `plan_context_ref`; it is the governed plan cycle and
not a drop-in replacement for an ordinary request.

### Where the sandbox lives

A sandbox is always created **outside the repo tree** so it never leaks runtime state
(`.exa/journal.db`, `logs/`, git worktrees) into your working copy:

- **Dogfooding (`dogfood_bootstrap.ts`, above):** the sandbox location is **always explicit** — you
  pass `--dir` (e.g. `~/exa-dogfood`), which is **required** (the script errors if omitted). Dogfooding
  does **not** auto-pick a sibling directory and does not read `EXA_SANDBOX_BASE`.
- **Scenario-framework runs** (`tests/scenario_framework/`, used for e2e validation and
  `exactl eval run`): this is a **separate mechanism**. When no `--workspace` is passed, the runner
  deploys a fresh per-run sandbox at a **sibling of the repo** by default —
  `<parent-of-repo>/exaix-sandboxes/<run-id>/` (e.g. `~/git/exaix-sandboxes/<run-id>/`). Override the
  base with `EXA_SANDBOX_BASE`; the runner refuses to use the repo root itself. Locate these with
  `tests/scenario_framework/bin/sandbox` (`list` for all, no arg for the latest). See the Scenario
  Framework README §2.4 and §6 (Debugging) for details.

---

## 3. The Dogfooding Loop

The dogfooding workflow follows a **Brief → Execute → Review** cycle:

```text
┌─────────────────────────────────────┐
│        1. Author a brief             │
│  (request file with frontmatter,     │
│   skills, acceptance criteria)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│        2. Daemon generates plan      │
│  (RequestProcessor → AgentRunner     │
│   → PlanWriter → Workspace/Plans/)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   3. Human reviews the plan          │
│  (approve, reject, or request        │
│   clarification)                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   4. Agent executes the plan         │
│  (FILE edits, git commits,           │
│   CI validation)                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   5. Human reviews the changeset     │
│  (git diff, CI results,              │
│   journal audit trail)               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   6. Close the loop                  │
│  (merge, or revise brief and         │
│   restart the cycle)                 │
└─────────────────────────────────────┘
```

### Before each execution

Use this checklist in order. It separates decisions a person must make from work the
daemon can safely automate:

1. Confirm the worktree is isolated: `git -C "$DOGFOOD_WORKTREE" status` must not be
   the checkout you use for day-to-day development.
1. Choose a flow deliberately. Use `dogfood-loop` for one bounded change; use
   `dogfood-meta-workflow` only when an approved plan supplies `plan_context_ref`.
1. State the scope, non-goals, and observable acceptance checks in the request. Do not
   ask the agent to infer a task from a title alone.
1. Wait for `daemon.ready` before submitting a request after any daemon start or restart.
   A started process is not necessarily listening to the request queue yet.
1. Review the generated plan and approve only the intended plan ID. Approval is the
   human gate that authorizes execution; it is not a formality.
1. When the flow finishes, inspect the worktree diff and focused checks before merging
   anything. For a context-enabled delegate, also inspect the capture by trace ID.

### 3.1 Authoring a Plan (the `/plan` skill)

Before writing a request, use the `/plan` skill to create a phase planning document:

```bash
# The /plan skill is loaded via your AI agent (OpenCode TUI, Claude Code, etc.)
# It produces a phase-NN-*.md with structured steps:

## Fields a good plan step has:
# - Actions: what files to change and why
# - Architecture Notes: dependency injection, patterns, rationale
# - Planned Tests: test names in RED (failing first)
# - Success Criteria: measurable outcomes
# - step-manifest: YAML block for machine-convertibility
```

Each step in the plan becomes a request. The step manifest (`step`, `agent_role`,
`skills`, `portal`, `target_branch`, `depends_on`, `acceptance`) maps directly
to the request frontmatter, making plan-to-request conversion mechanical.

### 3.2 From Plan Step to Request

A step's manifest fields:

| Manifest field     | Request frontmatter   | Purpose                            |
| ------------------ | --------------------- | ---------------------------------- |
| `step`             | `tags: [step-N]`      | Request queue ordering             |
| `depends_on`       | `priority` / ordering | Step N+1 waits for N               |
| `agent_role`       | `agent_role`          | Which agent persona executes       |
| `skills`           | `skills`              | Pinned rigor (tdd, security, etc.) |
| `portal`           | `portal`              | Which workspace the agent uses     |
| `target_branch`    | `target_branch`       | Feature branch isolation           |
| `acceptance.tests` | Body "Acceptance"     | Machine-verifiable test names      |

### 3.3 Request Queue with `depends_on`

For multi-step features, chain requests so step N+1 starts only after N is approved:

```yaml
---
trace_id: "step-1-uuid"
agent_role: "senior-coder"
priority: 5
tags: ["phase-121", "step-1"]
portal: "exaix-self"
target_branch: "feature/health-endpoint"
---
# Step 1: Add health endpoint constant

Add `HEALTH_ENDPOINT_PATH = "/health"` to `packages/core/src/types/constants.ts`.
```

```yaml
---
trace_id: "step-2-uuid"
agent_role: "senior-coder"
priority: 6
tags: ["phase-121", "step-2"]
portal: "exaix-self"
target_branch: "feature/health-endpoint"
depends_on: ["step-1-uuid"]
---
# Step 2: Implement health handler

Wire the `/health` endpoint in `apps/daemon/main.ts`.
```

The queue processor skips step 2 until step 1's plan is approved and executed.

---

## 4. Writing Requests

Requests are markdown files with YAML frontmatter placed in
`Workspace/Requests/`. The full field reference:

```yaml
---
trace_id: "a-unique-uuid"           # Required. UUID linking all artifacts.
created: "2026-06-18T12:00:00Z"     # Required. ISO timestamp.
status: pending                      # Required. Must be "pending".
priority: 5                          # Optional. 1–10 (default: 5).
agent_role: senior-coder               # Required. Agent persona.
source: dogfood                      # Optional. Origin of request.
created_by: developer                # Optional. Who created it.
skills: [tdd-methodology]            # Optional. Skills to pin.
portal: "exaix-self"                 # Optional. Portal for context.
target_branch: "feature/my-thing"   # Optional. Feature branch.
tags: ["feature", "phase-121"]      # Optional. Categorization.
depends_on: ["step-1-uuid"]          # Optional. Prior dependency.
flow: "my-flow"                      # Optional. Flow ID (mutually
                                     #          exclusive with agent_role).
---
# Title

Describe what you want the agent to do.

## Acceptance — tests

Specific test names the agent must write first (TDD).

## Acceptance — outcomes

CI gates and other measurable outcomes.
```

### Skills Reference

Define skills by name in the `skills` frontmatter field. Each skill
auto-injects its instructions into the agent's prompt:

| Skill               | What it enforces                                    |
| ------------------- | --------------------------------------------------- |
| `tdd-methodology`   | RED→GREEN→REFACTOR cycle; tests before code         |
| `exaix-conventions` | Code style, import rules, DI patterns               |
| `security-first`    | OWASP Top 10 checks; path traversal, injection      |
| `portal-grounding`  | Portal-aware path resolution via `PathResolver`     |
| `code-review`       | Systematic correctness, security, coverage review   |
| `gap-analysis`      | Pre-implementation plan validation against codebase |
| `step-execution`    | TDD step-by-step workflow with CI gates per step    |

Skills live in `Blueprints/Skills/<name>.skill.md` (source) and
`Memory/Skills/global/<name>.json` (runtime, loaded by `SkillsService`).
Runtime JSON skills are validated against `SkillSchema`.

### 3.4 Generating Step Requests from a Plan

Instead of writing each request manually, use the `plan_to_requests.ts` generator to
convert a phase planning document into a queue of request files:

```bash
# Generate request files for dogfooding phase E (default: Workspace/Requests/)
deno run -A scripts/plan_to_requests.ts exaix-dev-docs/planning/phase-122-dogfooding-e.md

# Preview without writing
deno run -A scripts/plan_to_requests.ts exaix-dev-docs/planning/phase-122-dogfooding-e.md --dry-run

# Write to the sandbox's request queue (external sandbox root)
deno run -A scripts/plan_to_requests.ts exaix-dev-docs/planning/phase-122-dogfooding-e.md --out-dir "$DOGFOOD_SANDBOX/workspace/Workspace/Requests/"
```

The generator reads fenced YAML step-manifests (the `# step-manifest` blocks in
phase-NN-*.md documents). Each manifest maps to a request file with:

- `agent_role` from the manifest's `agent_role` field (defaults to `senior-coder`)
- `priority` clamped to 0–10 (earlier steps higher priority)
- `skills` merged with the agent role's `default_skills` by `agent_runner`
- `trace_id` generated as a UUID

**Prerequisite:** the plan file must use `## Step N` or `### Step N` headings.
Steps without manifests fall back to heading scraping (`**Actions:**`, `**Architecture Notes:**`,
`**Planned Tests:**`, `**Success Criteria:**`).

---

## 5. Skills & Plans

### The /plan Skill

The `/plan` skill produces structured phase planning documents
(`phase-NN-*.md`) with:

- **Per-step manifests** — machine-readable YAML blocks beside the prose
- **TDD-First format** — Actions, Architecture Notes, Planned Tests, Success Criteria
- **Dependency graph** — `depends_on` chains between steps
- **Acceptance criteria** — both test names and outcome gates

Output example:

````markdown
### Step 3: Wire health endpoint in daemon main

**Actions:**

- `apps/daemon/main.ts`: Add `/health` route registration in the
  `createServer()` setup block, after the existing config watcher.

**Architecture Notes:**

- The endpoint does not need auth — it is a liveness probe.
- Use the existing `Router` instance from `@exaix/serve`.

**Planned Tests:**

- `GET /health returns 200` — integration test with mock server.
- `[regression] existing routes still respond correctly` — ensures no
  route collision.

**Success Criteria:**

- `deno task check clean`
- `deno task test --filter health` passes

```yaml
# step-manifest
step: 3
title: Wire health endpoint in daemon main
agent_role: senior-coder
skills: [tdd-methodology]
portal: exaix-self
target_branch: feature/health-endpoint
depends_on: [2]
acceptance:
  tests:
    - "GET /health returns 200"
  outcomes:
    - "deno task check clean"
```

### Using the /plan Skill

```bash
# Load the plan skill in your AI agent session:
#   /plan
# Describe the feature at a high level.
# The skill produces a full phase-NN-*.md document.

# Then convert each step to a request file:
#   - Copy the step manifest fields to request frontmatter
#   - Copy Actions/Acceptance to request body
#   - Drop into Workspace/Requests/
```
````

---

## 6. Headless Delegation

For steps that need stronger reasoning than Ollama provides, delegate
execution to OpenCode CLI or Claude Code as a headless subprocess.

### 6.1 OpenCode CLI (`opencode run`)

Requires: [OpenCode CLI](https://opencode.ai) installed and configured.

The daemon can spawn `opencode run` as a headless agent inside the worktree:

```bash
opencode run --format json \
  --dir /path/to/worktree \
  --agent dogfood-developer \
  "Implement the health endpoint as specified in Session/abc-123/brief.json"
```

**Key flags for dogfooding:**

| Flag                             | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `--format json`                  | Machine-parseable JSON events to stdout       |
| `--dir <path>`                   | Isolate to worktree (never sees live repo)    |
| `--agent <name>`                 | Agent with pinned tool permissions            |
| `--file <path>`                  | Attach context files (brief, acceptance)      |
| `-m provider/model`              | Override model per step                       |
| `-c / --continue`                | Resume interrupted session                    |
| `--dangerously-skip-permissions` | Skip approval prompts (use with pinned agent) |

**Recommended agent config** (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "agent": {
    "dogfood-developer": {
      "permission": {
        "*": "deny",
        "read": "allow",
        "edit": "allow",
        "glob": "allow",
        "grep": "allow",
        "bash": {
          "*": "deny",
          "git status *": "allow",
          "git diff *": "allow",
          "git add *": "allow",
          "git commit *": "allow",
          "deno task *": "allow",
          "deno test *": "allow",
          "deno check *": "allow",
          "deno fmt --check *": "allow",
          "grep *": "allow"
        }
      }
    }
  }
}
```

### 6.2 Claude Code (`claude -p`)

Requires: Claude Code Pro/Max subscription.

```bash
claude -p "Implement the health endpoint" \
  --output-format json \
  --permission-mode acceptEdits
```

Note: Claude Code runs on your subscription, not your API key. The daemon
strips provider env vars before spawning to avoid auth confusion.

### 6.3 The Brief → Launch → Return → Reconcile Cycle

When the daemon delegates to a headless agent:

1. **Brief** — The daemon writes `Session/{traceId}/brief.json` with
   the objective, scope, and acceptance criteria from the request.
1. **Launch** — The daemon spawns `opencode run` or `claude -p` inside
   the worktree, passing the brief as context.
1. **Work** — The headless agent plans, edits files, and runs commands
   inside the isolated worktree.
1. **Return** — The daemon parses the JSON event stream, computes the
   `git diff`, and synthesizes `return.json`.
1. **Reconcile** — The daemon runs a path-scope check (only worktree
   files were touched), attributes costs, and presents the changeset
   for human review.

This implements session delegation (shipped — see `exaix-dev-docs/planning/phase-111-session-delegation-runtime-and-e2e.md`).
Without it, the daemon uses its in-process agent (`ReActLoopStrategy`) which works identically
but runs on the daemon's own provider.

**Faithful delegate briefs.** The delegate now receives the
full step content (`objective`) and any `successCriteria` (`acceptanceCriteria`),
replacing the placeholder `"Execute step N"`. A contentless-brief guard rejects
empty or placeholder objectives with a journal event
(`session.delegate.contentless_brief`) and returns `"abandoned"`, preventing
silent no-ops. See `packages/core/tests/planning/contentless_brief_guard_test.ts`.

### 6.4 Config Presets (multi-delegate provider routing)

The repository ships templates for two distinct mechanisms. Do not mix them:

| Intended use                | Tool                     | Template                              | What it delegates                      |
| --------------------------- | ------------------------ | ------------------------------------- | -------------------------------------- |
| Governed plan cycle         | OpenCode                 | `configs/dogfood.toml`                | `session_delegate` `code_changes` gate |
| Governed plan cycle         | Claude Code subscription | `configs/dogfood.claude.toml`         | `session_delegate` `code_changes` gate |
| Stock implement/review flow | OpenCode                 | `configs/dogfood.opencode.stock.toml` | Each `dogfood-loop` CLI-delegate step  |
| Stock implement/review flow | Claude Code subscription | `configs/dogfood.claude.stock.toml`   | Each `dogfood-loop` CLI-delegate step  |

Bootstrap always starts from `configs/dogfood.toml`; it does not select a template.
Use the replacement command in [Quick Start](#2-quick-start) with the template that
matches the flow and CLI you intend to run. For Claude Code subscription mode, first
verify the client is installed and logged in:

```bash
claude --version
claude -p "Reply with OK only" --output-format json
```

Subscription mode does **not** require `ANTHROPIC_API_KEY`. The daemon removes provider
credentials from the child environment, so setting that key does not create a fallback
to a metered Anthropic API call.

The `[session_delegate.provider]` block (multi-delegate provider routing) declares which API gateway a tool
should use. When present, the daemon reads the key from `key_env` and injects it into
the child process **after** the default environment sanitisation (so secrets from the
parent are never leaked, but the delegate gets exactly the keys it needs):

```toml
[session_delegate.provider]
name = "openrouter"          # "openrouter" | "anthropic" | "ollama"
key_env = "OPENROUTER_API_KEY"
base_url = "https://openrouter.ai/api"
```

Per-tool environment injection:

| `name`       | `tool=opencode`                 | `tool=claude-code`                                                   |
| ------------ | ------------------------------- | -------------------------------------------------------------------- |
| `openrouter` | `OPENROUTER_API_KEY=<key>`      | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY=""` |
| `anthropic`  | `ANTHROPIC_API_KEY=<key>`       | `ANTHROPIC_API_KEY=<key>`                                            |
| `ollama`     | native localhost (no env added) | n/a (warn)                                                           |

Claude Code + OpenRouter requires the three-environment-variable trio:
`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<your OpenRouter key>`,
and `ANTHROPIC_API_KEY=""`. This is because Claude Code's OpenRouter support uses
the Anthropic-compatible endpoint with an auth token rather than the standard
API-key header. The return is parsed from the single `{type:"result"}` JSON object
that `claude --output-format json` emits.

### 6.5 Running the `provider_live` delegate matrix (maintainer verification)

The four presets above are exercised end-to-end by a single parametrized scenario,
`tests/scenario_framework/scenarios/provider_live/session_delegate_matrix_live.yaml`. It iterates the
`tool × provider` cross-product; **each cell selects its provider realm by its `config` preset** (not
an env var) and runs only when its binary + auth are present, otherwise it **skips cleanly** (no false
reds). The pack is tagged `provider-live`, so it is omitted from CI auto-runs and executed on demand.

Run the matrix (only the cells your environment supports will execute):

```bash
deno run -A tests/scenario_framework/runner/main.ts \
  --scenario session-delegate-matrix-live \
  --workspace /tmp/exa-matrix-ws --output /tmp/exa-matrix-out --mode auto
```

Per-cell requirements — a cell **skips** unless **all** of its predicates hold:

| Cell (tool / provider)   | Binary on `PATH` | Required env / auth                                                      |
| ------------------------ | ---------------- | ------------------------------------------------------------------------ |
| opencode / direct        | `opencode`       | `EXA_MATRIX_OPENCODE=1` (opt-in; OpenCode auth lives in its `auth.json`) |
| opencode / openrouter    | `opencode`       | `EXA_MATRIX_OPENCODE=1` **+** `OPENROUTER_API_KEY`                       |
| claude-code / direct     | `claude`         | `ANTHROPIC_API_KEY` (legacy provider-routing matrix requirement)         |
| claude-code / openrouter | `claude`         | `OPENROUTER_API_KEY` (injected as the Anthropic-compatible trio above)   |

> **Why the OpenCode opt-in?** OpenCode authenticates via its own `auth.json`, so there is no
> API-key env var Exaix can probe to know auth is configured. Set `EXA_MATRIX_OPENCODE=1` to assert
> "OpenCode is logged in" and enable its cells. This particular historical routing matrix still
> gates its Claude direct cell on `ANTHROPIC_API_KEY`; use the subscription-backed
> `dogfood-context-live` Claude cells for validating the native CLI path without an API key.
>
> **Live token-spend.** The deterministic matrix (parse + per-cell RUN/SKIP resolution) is proven and
> CI-safe; a present cell additionally **spends provider tokens** when it boots a real delegate. The
> end-to-end `session.delegate.reconciled` journal proof is run on demand (tracked as the LIVE-RT item
> in the delegate provider live matrix plan). A clean cell journals `session.delegate.reconciled`; an out-of-scope edit
> journals `session.delegate.scope_violation` (asserted by the negative scenario).

### 6.6 Delegate Permission Hardening

When `[session_delegate].harden_permissions = true`, the daemon generates a per-tool pre-flight
permission config from the brief's `permitted_paths` before launching the delegate:

**OpenCode** — generates an `opencode.jsonc` at runtime with an `agent.<dogfood-developer>`
permission block:

```jsonc
{
  "agent": {
    "dogfood-developer": {
      "permission": {
        "edit": { "*": "deny", "src/**": "allow" },
        "external_directory": { "**": "deny" },
        "bash": { "*": "deny" }
      }
    }
  }
}
```

The config path is injected via the `OPENCODE_CONFIG` environment variable. The delegate can
only edit paths in its `permitted_paths` — the tool enforces this pre-flight, before the
post-hoc `checkScope` runs.

**Claude Code** — appends `--permission-mode acceptEdits` and a scoped `--allowedTools` list
(e.g. `Read,Edit,Bash(git *)`) to the launch args. Path confinement for Claude Code relies on
the worktree checkout boundary + post-hoc `checkScope` — Claude Code has no per-path edit
allowlist flag, so the pre-flight grant is weaker than OpenCode's.

**Version probe:** `probeDelegateVersion` checks the binary version before launch and warns
if below the minimum (OpenCode ≥ 1.0.0, Claude Code ≥ 2.0.0).

**Agent role reconciliation:** the agent key in the generated config (`dogfood-developer`) is asserted
against `Blueprints/Agents/dogfood-developer.md:agent_role` by a drift test, so the two cannot
diverge.

**E2E scenario:** `session-delegate-hardening-active-live` in `tests/scenario_framework/scenarios/provider_live/`
validates the pre-flight guard structurally. Source wiring is complete; run against a real daemon
on demand (requires sandbox deployment, tagged `provider-live`).

### 6.7 Bounded Context Supplement (`dogfood.context`)

Both delegate paths — the cycle handler (§6.3) and the stock `dogfood-loop` CLI-delegate
strategy — can compose a small, scoped supplement onto the objective before launch: a
few relevant portal-knowledge chunks and memory items, appended after the original
prompt text (the original objective/acceptance criteria are always preserved verbatim,
never trimmed or replaced). This is disabled by default and additive — every other
caller and every non-dogfood execution path is unaffected.

**Enabling it:** set `[dogfood.context] enabled = true` (the `configs/dogfood.toml`
template does this) plus a portal in `[[portals]]` whose `alias` matches
`dogfood.context.portal_alias` (default `"exaix-self"`) — exactly one match is required,
or the daemon refuses to start.

```toml
[dogfood.context]
enabled = true
# portal_alias, portal_top_k, portal_tokens, memory_top_k, memory_tokens,
# max_input_tokens, output_reserve_tokens, retention_days, and the query/record byte
# ceilings all have documented defaults — override only what you need to change.
```

**What it does:** on each launch/turn, the daemon queries the configured portal's cached
knowledge index and the portal-scoped memory bank, fits the results into a small token
budget (skipping anything that doesn't fit rather than truncating it), strips terminal
control bytes and redacts any known configured credential value, then captures an
immutable JSON record of the exact bytes sent under
`Memory/Execution/<trace>/context/<recordId>.json` before the child ever launches — a
capture failure aborts the launch. Records older than `retention_days` (default 7) are
pruned at daemon startup and once a day.

**Known limitations, stated plainly:**

- **Activation is config-gated, not flow-verified.** The daemon checks
  `dogfood.context.enabled` and the portal-alias binding, but does not yet verify the
  calling flow/role is actually `dogfood-loop`/`dogfood-coder` — treat this as scoped to
  trusted dogfood sandbox configuration, not a general per-request authorization check.
- **Live child-query is now available on supported native clients** — see §6.8. The
  initial bounded supplement above is still the only context sent automatically; the
  child must actively call one of the three granted MCP tools to ask for more.
- **Inspection covers Exaix-owned submissions only.** `exactl request inspect` reads the
  immutable capture without repeating retrieval. It cannot expose a native CLI's hidden
  system prompt, retained conversation history, compaction, or unrelated tool schemas.
- Budget composition is a fixed per-source token ceiling from config, not derived from
  `PromptBudgetAllocator`'s six-section allocation.

---

### 6.8 Session-Bound MCP Context Queries

When `dogfood.context` is enabled, each launch/turn also starts a small, private MCP
server (`DogfoodContextServer`) bound to `127.0.0.1` on an OS-assigned port, gated by a
random per-connection bearer capability. It grants the delegated child exactly three
read-only tools:

| Tool                  | Arguments                                  | Returns                                                        |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `query_relationships` | `from` (layer/path), `kind?` (edge filter) | Forward edges from the bound portal's cached knowledge graph   |
| `who_depends_on`      | `path`                                     | Reverse edges into that path                                   |
| `search_memory`       | `query`, `limit?`                          | Scored project/global memory items, scoped to the bound portal |

The server never triggers portal analysis/indexing — it reads only the knowledge
snapshot already cached at launch time. Every call is subject to a per-connection call
count, cumulative output budget, single-in-flight limit, and connection TTL; the
connection is revoked on completion, failure, cancellation, timeout, or daemon shutdown,
and no credential or connection config survives a daemon restart (leftover config from a
prior process lifetime is removed at boot).

**Native client wiring** (both launch paths — the governed cycle handler and the
CLI-delegate strategy — receive the same connection):

- **Claude Code:** a generated `--mcp-config <path> --strict-mcp-config` JSON file with an
  `mcpServers.exaix_context` HTTP entry; the three tool names are added to the existing
  `--allowedTools` grant (`mcp__exaix_context__<tool>`), never a competing second flag.
- **OpenCode:** an `mcp.exaix_context` fragment merged into the same generated permission
  config (`edit`/`external_directory`/`bash` restrictions are unchanged), supplied via
  `OPENCODE_CONFIG`.
- **Codex** (governed cycle only — the CLI-delegate strategy never spawns codex):
  per-invocation `-c mcp_servers.exaix_context.*` overrides naming the URL, the bearer
  env-var name, and the three enabled tool IDs; the existing `--sandbox` flag is
  untouched.

In every case, only an **env-var reference** (`${EXAIX_CONTEXT_BEARER}` /
`{env:EXAIX_CONTEXT_BEARER}` / `bearer_token_env_var="EXAIX_CONTEXT_BEARER"`) is written
to config or argv — the actual credential value reaches the child exclusively through its
explicit launch environment, the same channel provider API keys already use.

**Known limitations, stated plainly:**

- No live MCP round-trip preflight is performed before returning the launch handle —
  `DogfoodContextServer.start()` binding successfully and returning its three tool
  definitions is treated as sufficient evidence the endpoint is live, since both outcomes
  derive from the same in-process call.
- The CLI-delegate strategy has no `PathResolver`/`@Runtime` access, so its native config
  files live under a per-turn `Deno.makeTempDir()` cleaned up when the turn ends, rather
  than the governed path's `@Runtime/<trace>/context-client/` convention.
- Cursor and VS Code (advisory-only session tools) receive no MCP wiring — the feature
  targets the three headless-capable CLIs only.

### 6.9 Inspection and cutover evidence

Use `exactl request inspect <trace-id>` to list captures for a governing trace and its
child launches. Add `--record <record-id>` for one record, `--json` for machine-readable
output, or `--raw` to redirect the exact captured `promptText` bytes. Raw output refuses
an interactive terminal, and missing, expired, or legacy captures return exit code 3
instead of reconstructing current context. See the
[User Guide](Exaix_User_Guide.md#exactl-request-inspect--read-only-dogfood-context-inspection)
for the complete command contract.

The deterministic cutover suite proves both launch paths, cross-portal isolation,
supplement bounds, disabled/non-dogfood parity, second-query nonce discovery, and capture
read-back. Provider-live evidence is intentionally narrower: as of 2026-09-09,
`cycle-claude` completed a real daemon/delegate/reconciliation/inspection run, and
`stock-claude` completed its direct implement and review launches. The latter is not an
authoritative full-matrix pass because its scenario report did not refresh. Treat these as
two client-path checks, not proof that OpenCode, Codex, or every matrix cell has cut over.

---

## 7. Configuration

### Environment Variables

| Variable           | Default         | Description                           |
| ------------------ | --------------- | ------------------------------------- |
| `EXA_LLM_PROVIDER` | `ollama`        | LLM provider (`ollama`, `mock`, etc.) |
| `EXA_LLM_MODEL`    | `ollama/llama3` | Model name                            |
| `EXA_LLM_BASE_URL` | —               | Provider API base URL                 |
| `EXA_CONFIG_PATH`  | —               | Config file path (set by bootstrap)   |
| `DOGFOOD_ROOT`     | —               | Override sandbox root (testing)       |

### Config Preset

The dogfood config template at `configs/dogfood.toml` uses sentinel values
replaced by the bootstrap script:

- `system.root = "__DOGFOOD_ROOT__"` → replaced with `~/exa-dogfood`
- `ai.provider = "ollama"` — overridable via `EXA_LLM_PROVIDER`
- `[[portals]]` — worktree portal `exaix-self` with `execution_strategy = "worktree"`,
  enforced in code by `FlowWorktreeCoordinator` for both a strategy-routed `cli_delegate`
  flow step and a `session_delegate_cycle` step (Phase 194) — a per-trace worktree is
  created regardless of what `target_path` itself points at, not merely declared
- `quality_gate.enabled = false` — disabled for development workflows

The final config is written to `<sandbox>/workspace/exa.config.toml`.

### Daemon Commands

| Command                                 | Purpose                           |
| --------------------------------------- | --------------------------------- |
| `EXA_CONFIG_PATH=... deno task dogfood` | Start daemon                      |
| `deno task dogfood:stop`                | Gracefully stop                   |
| `deno task dogfood:status`              | Check if running                  |
| `deno task dogfood:log`                 | Last 50 log lines                 |
| `deno task dogfood:bootstrap`           | Bootstrap sandbox (legacy)        |
| `deno task dogfood:clean`               | Remove the sandbox root (guarded) |

#### Cleaning / resetting the sandbox

`deno task dogfood:clean` removes the configured **external** sandbox root
(resolved from `DOGFOOD_ROOT` or the `root` field in `configs/dogfood.toml` — the
sandbox lives outside the repo, e.g. `~/exa-dogfood`) so you can start a loop from
scratch. It is deliberately conservative:

- It only removes the **realpath-equal configured root** — a symlinked root, a
  `..`-bearing path, or any `--path` that does not resolve to the configured
  root is refused (no `rm -rf` of an arbitrary directory).
- It **refuses while the daemon is running** (live PID), and re-checks liveness
  immediately before removal.
- Add `--force` to skip the confirmation prompt (useful in CI):
  `deno task dogfood:clean --force`.

A typical reset is `deno task dogfood:stop && deno task dogfood:clean --force`.

---

## 8. When to Dogfood vs Interactive

| Scenario                                | Dogfood | Interactive |
| --------------------------------------- | ------- | ----------- |
| Hardened plan with well-scoped steps    | ✅      | ⚠️          |
| Trivial one-line fix                    | ❌      | ✅          |
| Complex refactor with clear acceptance  | ✅      | ⚠️          |
| Investigating a flaky test              | ❌      | ✅          |
| New feature from a known spec           | ✅      | ⚠️          |
| Spiking a new library / pattern         | ❌      | ✅          |
| Cross-cutting rename across 40 files    | ✅      | ⚠️          |
| Interactive debugging / quick iteration | ❌      | ✅          |
| Onboarding a new contributor            | ✅      | ⚠️          |
| Security review of a changeset          | ✅      | ❌          |

**The sweet spot:** Author a plan with the `/plan` skill (interactive),
convert steps to requests, let the daemon execute each step's
RED→GREEN→commit loop, then review the diff and CI result. The daemon
handles the mechanical work; you handle architecture decisions and
final sign-off.

---

## 9. Troubleshooting

| Symptom                    | Likely Cause                | Fix                                  |
| -------------------------- | --------------------------- | ------------------------------------ |
| Daemon exits immediately   | Config validation error     | Run `deno task dogfood:log`          |
| Request not processed      | FileWatcher debounce        | Wait 2–3 seconds after writing       |
| Plan not generated         | Provider not available      | Check Ollama or API key              |
| Portal knowledge empty     | Empty or new repo           | `exactl portal analyze exaix-self`   |
| Permission errors on start | Missing `--allow-*` flags   | Use `deno task dogfood` (sets flags) |
| Worktree creation fails    | Dirty index / branch exists | Manual `git worktree prune`          |

---

## See Also

- `exaix-dev-docs/dev/Exaix_Dogfooding_Analysis.md` — Full analysis of dogfooding readiness, gaps, and future phases
- `exaix-dev-docs/planning/phase-120-dogfooding-a-c.md` — dogfood infrastructure implementation plan (config, bootstrap, docs)
- [Exaix User Guide](Exaix_User_Guide.md) — General usage and deployment
- [Exaix Evaluation Guide](Exaix_Evaluation.md) — Scenario framework and `exactl eval`
- `TOOLS.md` — All agent-accessible MCP tools
- `CODE_STYLE.md` — Coding standards and conventions
- `.copilot/skills/` — Available agent skills for plans and execution
- `docs/Reference_Data.md` — Event taxonomy, edition matrix, module index
