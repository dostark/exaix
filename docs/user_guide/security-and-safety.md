# Security and Safety

Security features, the network allowlist, plan amendments, approvals and human-in-the-loop governance. Part of the [Exaix User Guide](README.md).

## Human decisions in one place

Exaix stops and waits for a person at several points. Each kind of item has an owner command, and `exactl approval list` shows every pending item in one table. The `act` column names the command that decides each row.

| Pending item                  | Decided with                             |
| ----------------------------- | ---------------------------------------- |
| Plan, review, clarification   | `exactl plan`, `exactl review`           |
| Plan amendment                | `exactl plan amendment`                  |
| Memory proposal, draft skill  | `exactl memory proposal`, `exactl skill` |
| Wait state, tool confirmation | `exactl approval`                        |

Draft skills show in the list only when you give no portal. Use `exactl skill list --portal <alias>` for the drafts of a portal. Every option of every command is in the generated [approval reference](../cli/approval.md), [plan reference](../cli/plan.md) and [review reference](../cli/review.md).

## Approvals

Durable wait states come from session delegation gates, which pause until an operator resolves them. A failing flow quality gate does not create one: it halts the run with `gate_halted`. A tool that needs human approval waits as a pending tool confirmation.

Every item has a typed id: `wait:<resume-token>` for a wait state and `tool:<confirmation-id>` for a tool confirmation. A bare id works when exactly one of the two holds it. Ids of other kinds (`plan:`, `review:`, `proposal:`, `skill:`, `amendment:`, `clarification:`) exit with code 2 and print the command of the noun that owns them, such as `exactl plan approve <id>`.

`exactl approval list` selects kinds with `--kind` and wait states of another status with `--status`. A `--status` filter lists no other kind. `exactl approval show <ref>` prints one item.

### Wait states

A wait state accepts four decisions. The wait state keeps the decision as its status.

| Command   | Resulting status | Flow behavior                                      |
| --------- | ---------------- | -------------------------------------------------- |
| `approve` | `fulfilled`      | Resumes flow execution from the last checkpoint    |
| `reject`  | `rejected`       | Flow halts — gate decision stands as rejected      |
| `amend`   | `amended`        | Original wait is replaced by a successor amendment |
| `expire`  | `expired`        | Wait is closed without resumption                  |

`exactl approval cancel` also closes a wait state that nobody needs any more.

Every wait decision records an actor: the `--resolved-by` value, or your user identity when you give none. The decision journals a `wait_state.command_resolved` row with the wait state id, the action, the status and who decided. The row never holds the resume token.

Wait states are persisted as JSON files at `{workspace}/WaitStates/{traceId}/{waitStateId}.json` and can be inspected manually if needed.

### Tool confirmations

A tool that needs human approval, such as a write outside the workspace or a dangerous config change, waits as a pending tool confirmation. `exactl approval approve tool:<confirmation-id>` lets the tool run. `exactl approval reject tool:<confirmation-id>` denies it. Pending confirmations also show in the journal: `exactl log list --filter tool.confirmation_pending`.

A tool confirmation takes one decision:

- A second `approve` or `reject` exits with code 4 and changes nothing.
- An unknown id exits with code 3, and a malformed id exits with code 2.
- A daemon timeout never overwrites a decision that a person made.

A tool decision writes a `tool_confirmation.decided` journal row with the confirmation id, the tool, the step, the outcome, the reason and who decided.

## Plan amendments

The Plan Amendment Safety Gate lets an agent propose a structural change to a plan in the middle of a mission. The agent proposes an amendment when:

- **Environmental drift:** The workspace changed since the plan was created.
- **Tool failures:** A critical tool fails in a way that makes later steps impossible.
- **Low confidence:** The confidence of the agent falls below the configured threshold.

The workflow has four stages:

1. **Pause:** Execution stops at once and a checkpoint is saved.
1. **Proposal:** The agent writes a plan amendment patch with a summary of the changes. The plan status becomes `amendment_pending`.
1. **Review:** `exactl plan amendment list` shows the plans that wait. `exactl plan amendment show <plan-id>` shows the proposed added, updated and removed steps.
1. **Decision:** `exactl plan amendment approve <plan-id>` applies the changes and resumes the plan. `exactl plan amendment reject <plan-id> --reason "<text>"` aborts it.

An amendment that nobody decides does not wait forever. After `expiryMs` the daemon applies `on_timeout`: `abort`, `reject` or `approve`. Review a proposal before you approve it, because an approved amendment changes what the agent does next.

### Configuration

The safety gate is off by default. Set it in `exa.config.toml`:

```toml
[amendment]
enabled = true             # Enable the safety gate (default: false)
threshold = 60             # Confidence threshold, 0-100 (default: 60)
expiryMs = 86400000        # How long an amendment can stay pending (default: 24h)
hitl_timeout_ms = 300000   # Time a person has to review an amendment (default: 5 min)
on_timeout = "abort"       # abort, reject or approve (default: abort)
```

## Security

Exaix is built with a "Safety First" architecture, focusing on local execution and explicit permissions.

### Key security features

- **Sandboxing:** File system access is strictly scoped to your Workspace and configured Portals. Path traversal attempts are blocked.
- **API Keys:** Keys are loaded from environment variables (`ANTHROPIC_API_KEY`, etc.) and never stored in the database or logs.
- **Human-in-the-Loop:** Critical actions (plan approval, file writes via generic agents) require explicit human confirmation unless configured otherwise.
- **Git Safety:** Automated commits are signed with detailed trace IDs.
- **Least-privilege daemon spawn:** The `exactl daemon start` launcher spawns the daemon with a minimal, scoped permission set — not blanket `--allow-all`.

### Outbound network allowlist (`[system].allow_net`)

The daemon launcher constructs its `--allow-net` flag from `[system].allow_net`:

```toml
[system]
# Omitted  → default hosts (api.anthropic.com, api.openai.com, localhost:11434)
# []       → outbound network is BLOCKED entirely
# explicit → only these hosts are reachable
allow_net = ["api.anthropic.com"]
```

| `allow_net` value          | Effect                                              |
| -------------------------- | --------------------------------------------------- |
| omitted (`undefined`)      | `--allow-net=<default host list>`                   |
| `[]` (empty array)         | no `--allow-net` flag — **all outbound is blocked** |
| `["host", "host:port", …]` | `--allow-net=host,host:port` (only these)           |

Setting `allow_net = []` is the strongest posture: the daemon cannot make any outbound connection (use it for fully offline/local-model setups). An empty list is **never** silently widened to `--allow-all` — only a genuine config-read error falls back to full permissions, and that fallback is logged as a warning so you can fix the config.

Write access is scoped to the daemon's data root; read, FFI (sqlite), dynamic import, and env are granted because the daemon genuinely needs them. The `exactl daemon` launcher and the dogfood launcher share one run-binary allowlist so the two paths cannot drift.

#### How `allow_net` is enforced (two layers)

`allow_net` is enforced at two layers, so it holds no matter how the daemon was started:

1. **Launcher flag (primary).** When you start the daemon via `exactl daemon start` or the dogfood launcher, the launcher bakes the computed `--allow-net` into the spawned daemon process. Deno enforces it at the OS level — the narrowing applies to specific hosts.

1. **Startup self-check (defence-in-depth).** Some launch paths cannot read `allow_net` at startup — most importantly the **compiled `exaix` binary** (its `--allow-*` flags are frozen at `deno compile` time) and `deno task dev` (flags are fixed in the task). For these, the daemon performs a startup check: if `allow_net = []` (block all) but the process was nonetheless granted network access, **the daemon refuses to start** (fail-closed) and logs the reason. This guarantees the strict-block policy is honoured even by the compiled binary.

   > **Caveat (host allowlists, not strict block):** A _non-empty_ host allowlist (e.g. `["api.anthropic.com"]`) can only be enforced by the launcher's `--allow-net=<hosts>` flag, because the OS reports network permission at the blanket level, not per-host. If you run the **compiled binary** or `deno task dev` directly, a host allowlist is **not** narrowed — only the strict block (`allow_net = []`) is self-enforced. For per-host narrowing, launch via `exactl daemon start`, or rebuild the binary with the desired `--allow-net=<hosts>` flag.

### Best practices

1. **Review Plans:** Always inspect the diffs (`exactl plan show`) before approving.
1. **Audit Logs:** Use `exactl log list` to audit agent activity.
1. **Keep Keys Private:** Never commit your `.env` or `exa.config.toml` if it contains secrets (though it shouldn't).

### Adversarial robustness and gate-bypass attribution

Exaix's own gates (scope enforcement, approval, quality gate) are themselves measured under hostile input via the `adversarial` and `interactive` evaluation packs (`exactl eval report --view robustness`, `exactl eval report --view interactive`). See [Adversarial and Interactive Evaluation](../evaluation-framework.md#18-adversarial--interactive-evaluation) for the full methodology, vector catalogue, and personas. Two production mechanisms exist specifically to make this measurable:

- **Actor attribution on gate resolution.** `exactl approval approve/reject/amend/expire/cancel` on a `wait:` ref accept an optional `--resolved-by <actor>` value, merged into the wait-state's metadata and journalled as a `wait_state.command_resolved` event — so an audit can distinguish a gate resolved through the intended CLI/API surface from any other write that flips its status.
- **Canary-only injection content.** Every "sensitive" artifact used to test whether an agent leaks or acts on hostile content is a fixture canary (`CANARY-<uuid>`-shaped), never a real credential, and injection stays inside the sandboxed worktree/portal for the run — see [Canary and sandbox safety model](../evaluation-framework.md#186-canary-and-sandbox-safety-model).

These numbers describe one provider and one point in time, not a standing guarantee — see [Founding results](../evaluation-framework.md#185-founding-results-claude-code-cell-2026-09-05) before citing a robustness or adherence figure.

## Per-action HITL governance

> **This is a Team/Enterprise Edition feature.** It is off by default and only activates when `EXAIX_EDITION=team` and `config.hitl.enabled=true`.

Per-action HITL adds a **third human checkpoint** (alongside plan approval and amendment approval) that pauses individual tool invocations based on per-argument policy rules.

**Blueprint authors** declare which tool calls need secondary approval via the YAML frontmatter:

```yaml
hitl:
  require_secondary_approval:
    - tool: git_commit
      path_pattern: "**/migrations/**"
      reason: "Migrations require secondary approval"
    - tool: run_command
      command_pattern: "*rm -rf*"
      reason: "Destructive commands require secondary approval"
    - tool: write_file
      path_pattern: "**/.env*"
      reason: "Env file writes require secondary approval"
```

**Administrators** declare non-bypassable rules in `exa.config.toml`:

```toml
[hitl]
enabled = true
mandatory_rules = [
  { tool = "run_command", command_pattern = "*rm -rf*", reason = "Admin: no destructive rm" }
]
```

A mandatory rule applies to **all** blueprints and cannot be overridden. If no approver is available (e.g. CLI mode without a confirmation interceptor), the tool is **denied** (fail-closed). Blueprint-only rules degrade gracefully (tool proceeds without interruption).

**Read-only tools** (e.g. `read_file`, `search_files`) are never automatically paused — HITL must be explicitly configured to gate them. This is recommended only for sensitive-path confidentiality (secrets, PII), not for routine reads, to avoid stalling the agent's reasoning loop.

## Concurrent guardrail runner

The concurrent guardrail runner screens each ReAct iteration's generated output against configurable policies using a fast-slot LLM. It runs **in parallel** with the primary agent loop and never blocks execution.

### Configuration

The guardrail is configured via an optional `[guardrail]` block in `exa.config.toml`:

```toml
[guardrail]
enabled = false                         # opt-in, disabled by default
check_interval_iterations = 1           # screen every Nth iteration (1 = every)
screen_final_output = true              # also screen output before Review gate

[[guardrail.policies]]
policy_id = "safety-policy"
description = "Detect harmful content in agent output"
blueprint = "guardrail/safety"
severity = "block"                      # "warn" (logs only) or "block" (halts)
```

### Behaviour

- **Fire-and-forget**: `screen()` is called after each iteration but never awaited on the critical path.
- **Fail-open**: If the screening model errors or times out, the error is journaled as `guardrail.screen.error` and execution continues.
- **Blocking violations**: A `block`-severity violation halts the loop via the Plan Amendment gate (`guardrail_violation` trigger). The pre-execution Quality Gate remains the hard gate.
- **Zero overhead when disabled**: With `enabled = false`, no runner is constructed and no code path changes.

### Edition

**Team/Enterprise only.** In Solo builds, the guardrail runner is never constructed even if `enabled = true`. See `ARCHITECTURE.md` for the architecture overview.
