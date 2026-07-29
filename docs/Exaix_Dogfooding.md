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
2. [Quick Start](#2-quick-start)
3. [The Dogfooding Loop](#3-the-dogfooding-loop)
   - [3.4 Generating Step Requests from a Plan](#34-generating-step-requests-from-a-plan)
4. [Writing Requests](#4-writing-requests)
5. [Skills & Plans](#5-skills--plans)
6. [Headless Delegation](#6-headless-delegation)
7. [Configuration](#7-configuration)
8. [When to Dogfood vs Interactive](#8-when-to-dogfood-vs-interactive)
9. [Troubleshooting](#9-troubleshooting)

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

```bash
# 1. Bootstrap a dogfood sandbox (external directory, not inside the repo)
deno run -A scripts/dogfood_bootstrap.ts \
  --dir ~/exa-dogfood \
  --worktree /path/to/worktree

# 2. Start the daemon pointing at the sandbox
export DOGFOOD_SANDBOX=~/exa-dogfood
export EXA_CONFIG_PATH=$DOGFOOD_SANDBOX/workspace/exa.config.toml
deno task dogfood

# 3. Wait for daemon readiness
deno run -A scripts/wait_for_daemon.ts $DOGFOOD_SANDBOX/workspace

# 4. Write a structured request
cat > $DOGFOOD_SANDBOX/workspace/Workspace/Requests/add-health-endpoint.md << 'REQUEST'
---
trace_id: "$(uuidgen)"
created: "$(date -Iseconds)"
status: pending
priority: 5
identity: senior-coder
skills: [tdd-methodology, exaix-conventions]
portal: "exaix-self"
target_branch: "feature/health-endpoint"
tags: ["feature", "phase-121"]
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

# 4. Wait for the plan to appear
ls $DOGFOOD_SANDBOX/workspace/Workspace/Plans/

# 5. Review and approve the plan
deno run -A apps/exactl/main.ts plan list
deno run -A apps/exactl/main.ts plan show <plan-id>
deno run -A apps/exactl/main.ts plan approve <plan-id>

# 6. Stop the daemon when done
deno task dogfood:stop
```

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

Each step in the plan becomes a request. The step manifest (`step`, `identity`,
`skills`, `portal`, `target_branch`, `depends_on`, `acceptance`) maps directly
to the request frontmatter, making plan-to-request conversion mechanical.

### 3.2 From Plan Step to Request

A step's manifest fields:

| Manifest field     | Request frontmatter   | Purpose                            |
| ------------------ | --------------------- | ---------------------------------- |
| `step`             | `tags: [step-N]`      | Request queue ordering             |
| `depends_on`       | `priority` / ordering | Step N+1 waits for N               |
| `identity`         | `identity`            | Which agent persona executes       |
| `skills`           | `skills`              | Pinned rigor (tdd, security, etc.) |
| `portal`           | `portal`              | Which workspace the agent uses     |
| `target_branch`    | `target_branch`       | Feature branch isolation           |
| `acceptance.tests` | Body "Acceptance"     | Machine-verifiable test names      |

### 3.3 Request Queue with `depends_on`

For multi-step features, chain requests so step N+1 starts only after N is approved:

```yaml
---
trace_id: "step-1-uuid"
identity: "senior-coder"
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
identity: "senior-coder"
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
identity: senior-coder               # Required. Agent persona.
source: dogfood                      # Optional. Origin of request.
created_by: developer                # Optional. Who created it.
skills: [tdd-methodology]            # Optional. Skills to pin.
portal: "exaix-self"                 # Optional. Portal for context.
target_branch: "feature/my-thing"   # Optional. Feature branch.
tags: ["feature", "phase-121"]      # Optional. Categorization.
depends_on: ["step-1-uuid"]          # Optional. Prior dependency.
flow: "my-flow"                      # Optional. Flow ID (mutually
                                     #          exclusive with identity).
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

- `identity_id` from the manifest's `identity` field (defaults to `senior-coder`)
- `priority` clamped to 0–10 (earlier steps higher priority)
- `skills` merged with the identity's `default_skills` by `agent_runner`
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
identity: senior-coder
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
2. **Launch** — The daemon spawns `opencode run` or `claude -p` inside
   the worktree, passing the brief as context.
3. **Work** — The headless agent plans, edits files, and runs commands
   inside the isolated worktree.
4. **Return** — The daemon parses the JSON event stream, computes the
   `git diff`, and synthesizes `return.json`.
5. **Reconcile** — The daemon runs a path-scope check (only worktree
   files were touched), attributes costs, and presents the changeset
   for human review.

This implements session delegation (shipped — see `exaix-dev-docs/planning/phase-111-session-delegation-runtime-and-e2e.md`).
Without it, the daemon uses its in-process agent (`ReActLoopStrategy`) which works identically
but runs on the daemon's own provider.

**Phase 150 (2026-07): Faithful delegate briefs.** The delegate now receives the
full step content (`objective`) and any `successCriteria` (`acceptanceCriteria`),
replacing the placeholder `"Execute step N"`. A contentless-brief guard rejects
empty or placeholder objectives with a journal event
(`session.delegate.contentless_brief`) and returns `"abandoned"`, preventing
silent no-ops. See `packages/core/tests/planning/contentless_brief_guard_test.ts`.

### 6.4 Config Presets (multi-delegate provider routing)

The daemon ships four `[session_delegate]` presets:

| Preset                   | Tool          | Provider   | File                                                                     |
| ------------------------ | ------------- | ---------- | ------------------------------------------------------------------------ |
| OpenCode (default)       | `opencode`    | direct     | `configs/dogfood.toml`                                                   |
| Claude Code (direct)     | `claude-code` | direct     | `configs/dogfood.claude.toml`                                            |
| OpenCode + OpenRouter    | `opencode`    | openrouter | `configs/dogfood.openrouter.toml`                                        |
| Claude Code + OpenRouter | `claude-code` | openrouter | `configs/dogfood.claude.openrouter.toml` (delegate provider live matrix) |

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

### 6.5 Running the `provider_live` delegate matrix (delegate provider live matrix)

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
| claude-code / direct     | `claude`         | `ANTHROPIC_API_KEY`                                                      |
| claude-code / openrouter | `claude`         | `OPENROUTER_API_KEY` (injected as the Anthropic-compatible trio above)   |

> **Why the OpenCode opt-in?** OpenCode authenticates via its own `auth.json`, so there is no
> API-key env var Exaix can probe to know auth is configured. Set `EXA_MATRIX_OPENCODE=1` to assert
> "OpenCode is logged in" and enable its cells. The claude-code cells gate on the real provider key.
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

**Identity reconciliation:** the agent key in the generated config (`dogfood-developer`) is asserted
against `Blueprints/Identities/dogfood-developer.md:identity_id` by a drift test, so the two cannot
diverge.

**E2E scenario:** `session-delegate-hardening-active-live` in `tests/scenario_framework/scenarios/provider_live/`
validates the pre-flight guard structurally. Source wiring is complete; run against a real daemon
on demand (requires sandbox deployment, tagged `provider-live`).

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
- `[[portals]]` — worktree portal `exaix-self` with `execution_strategy = "worktree"`
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
