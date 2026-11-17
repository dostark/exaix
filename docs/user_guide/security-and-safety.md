# Security and Safety

Security features, the network allowlist, plan amendments, approvals and human-in-the-loop governance. Part of the [Exaix User Guide](README.md).

## **Plan Amendment Commands** - Manage paused executions

The Plan Amendment Safety Gate allows agents to propose structural changes to an execution plan mid-mission. This is triggered when the agent detects environmental drift or tool failures.

```bash
# List all plans awaiting amendment approval
exactl plan amendment list

# Show proposed changes for a specific plan
exactl plan amendment show <plan-id>

# Approve amendment and resume execution
exactl plan amendment approve <plan-id>

# Reject amendment and abort execution
exactl plan amendment reject <plan-id> --reason "Incorrect approach"
```

**Workflow:**

1. **Trigger**: Agent detects drift and pauses execution. Status becomes `amendment_pending`.
1. **Review**: You review the proposal using `plan amendment show`.
1. **Decision**: You approve to apply changes and resume, or reject to abort.

For more details, see the **Safety Gates** section.

**Example workflow:**

```bash
# 1. Check what's pending
$ exactl plan list
📋 Plans (2):

🔍 implement-auth
   Status: review
   Trace: 550e8400...

⚠️ refactor-db
   Status: needs_revision
   Trace: 7a3c9b12...

# 2. Review a plan
$ exactl plan show implement-auth

# 3. Approve or request changes
$ exactl plan approve implement-auth
✓ Plan 'implement-auth' approved
  Moved to: Workspace/Active/implement-auth.md
  Status: Plan detected and parsed (agent-driven execution in development)

  Note: Currently, approved plans are detected and validated. Future: agents
  will have portal access to create reviews directly. Agent-driven execution
  (Step 5.12.3-5.12.6) is in development.
```

## **Approval Commands** - Resolve wait states and tool confirmations

Durable wait states come from session delegation gates, which pause until an
operator resolves them. A failing flow quality gate does not create one: it
halts the run with `gate_halted`. A tool that needs human approval waits as a
pending tool confirmation. `exactl approval list` shows every pending human decision: plans, amendments,
reviews, clarifications, memory proposals, draft skills, wait states and tool confirmations. Draft skills
show only without a portal. Use `exactl skill list --portal <alias>` for a portal draft. `exactl approval`
decides wait states and tool confirmations. The `act` column of each row names the command that decides it.

Every item has a typed id: `wait:<resume-token>` for a wait state and `tool:<confirmation-id>`
for a tool confirmation. A bare id works when exactly one of the two holds it. Ids of other
kinds (`plan:`, `review:`, `proposal:`, `skill:`, `amendment:`, `clarification:`) exit with
code 2 and print the command of the noun that owns them, such as `exactl plan approve <id>`.

```bash
# List every pending human decision, with the command that decides each
exactl approval list

# Only some kinds: plan, amendment, review, clarification, proposal, skill, wait, tool
exactl approval list --kind plan,tool

# Select wait states of another status (lists no other kind)
exactl approval list --status fulfilled

# Show one item
exactl approval show wait:<resume-token>

# Approve a wait state (flow resumes from last checkpoint) or a tool confirmation
exactl approval approve wait:<resume-token> --message "Approved after review"
exactl approval approve tool:<confirmation-id>

# Reject a wait state or deny a tool confirmation
exactl approval reject wait:<resume-token> --reason "Does not meet criteria"
exactl approval reject tool:<confirmation-id> --reason "Not needed"

# Wait states only: amend, expire and cancel
exactl approval amend wait:<resume-token> --message "Please revise approach"
exactl approval expire wait:<resume-token> --message "Timed out"
exactl approval cancel wait:<resume-token> --message "No longer needed"
```

A tool confirmation takes one decision. A second `approve` or `reject` exits with code 4 and changes nothing, an unknown id exits with code 3, and a malformed id exits with code 2. A daemon timeout never overwrites a decision that a person made. A wait decision journals a `wait_state.command_resolved` row with the wait state id, the action, the status and who decided, and it never writes the resume token.

Every wait decision records an actor: the `--resolved-by` value, or your user identity when you give
none. A tool decision writes a `tool_confirmation.decided` journal row with the confirmation id, the tool,
the step, the outcome, the reason and who decided.

**Wait state lifecycle:**

| Command   | Resulting status | Flow behavior                                      |
| --------- | ---------------- | -------------------------------------------------- |
| `approve` | `fulfilled`      | Resumes flow execution from the last checkpoint    |
| `reject`  | `rejected`       | Flow halts — gate decision stands as rejected      |
| `amend`   | `amended`        | Original wait is replaced by a successor amendment |
| `expire`  | `expired`        | Wait is closed without resumption                  |

Wait states are persisted as JSON files at `{workspace}/WaitStates/{traceId}/{waitStateId}.json`
and can be inspected manually if needed.

---

## **Tool Confirmations** - Resolve pending tool confirmations

When a tool requires human approval (e.g., writing to a file outside the workspace,
or a dangerous config change), it enters a pending confirmation state. Use `approval`
commands to review and resolve these.

```bash
# List all pending approvals, tool confirmations included
exactl approval list

# Approve a pending confirmation by id
exactl approval approve tool:<confirmation-id>

# Deny a pending confirmation by id
exactl approval reject tool:<confirmation-id>
```

Pending confirmations are also visible through the journal (`exactl log list --action tool.confirmation_pending`).

---

## Security

Exaix is built with a "Safety First" architecture, focusing on local execution and explicit permissions.

### Key Security Features

- **Sandboxing:** File system access is strictly scoped to your Workspace and configured Portals. Path traversal attempts are blocked.
- **API Keys:** Keys are loaded from environment variables (`ANTHROPIC_API_KEY`, etc.) and never stored in the database or logs.
- **Human-in-the-Loop:** Critical actions (plan approval, file writes via generic agents) require explicit human confirmation unless configured otherwise.
- **Git Safety:** Automated commits are signed with detailed trace IDs.
- **Least-privilege daemon spawn:** The `exactl daemon start` launcher spawns the
  daemon with a minimal, scoped permission set — not blanket `--allow-all`.

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

Setting `allow_net = []` is the strongest posture: the daemon cannot make any
outbound connection (use it for fully offline/local-model setups). An empty list
is **never** silently widened to `--allow-all` — only a genuine config-read error
falls back to full permissions, and that fallback is logged as a warning so you
can fix the config.

Write access is scoped to the daemon's data root; read, FFI (sqlite), dynamic
import, and env are granted because the daemon genuinely needs them. The
`exactl daemon` launcher and the dogfood launcher share one run-binary allowlist
so the two paths cannot drift.

#### How `allow_net` is enforced (two layers)

`allow_net` is enforced at two layers, so it holds no matter how the daemon was
started:

1. **Launcher flag (primary).** When you start the daemon via `exactl daemon
   start` or the dogfood launcher, the launcher bakes the computed `--allow-net`
   into the spawned daemon process. Deno enforces it at the OS level — the
   narrowing applies to specific hosts.

1. **Startup self-check (defence-in-depth).** Some launch paths cannot read
   `allow_net` at startup — most importantly the **compiled `exaix` binary** (its
   `--allow-*` flags are frozen at `deno compile` time) and `deno task dev` (flags
   are fixed in the task). For these, the daemon performs a startup check: if
   `allow_net = []` (block all) but the process was nonetheless granted network
   access, **the daemon refuses to start** (fail-closed) and logs the reason.
   This guarantees the strict-block policy is honoured even by the compiled
   binary.

   > **Caveat (host allowlists, not strict block):** A _non-empty_ host
   > allowlist (e.g. `["api.anthropic.com"]`) can only be enforced by the
   > launcher's `--allow-net=<hosts>` flag, because the OS reports network
   > permission at the blanket level, not per-host. If you run the **compiled
   > binary** or `deno task dev` directly, a host allowlist is **not** narrowed —
   > only the strict block (`allow_net = []`) is self-enforced. For per-host
   > narrowing, launch via `exactl daemon start`, or rebuild the binary with the
   > desired `--allow-net=<hosts>` flag.

### Best Practices

1. **Review Plans:** Always inspect the diffs in the TUI (`exactl plan show`) before approving.
1. **Audit Logs:** Use `exactl log list` to audit agent activity.
1. **Keep Keys Private:** Never commit your `.env` or `exa.config.toml` if it contains secrets (though it shouldn't).

### Adversarial robustness and gate-bypass attribution

Exaix's own gates (scope enforcement, approval, quality gate) are themselves measured under
hostile input via the `adversarial` and `interactive` evaluation packs
(`exactl eval report --view robustness`, `exactl eval report --view interactive`).
See `docs/Exaix_Evaluation.md` §18 for the full methodology, vector catalogue, and personas. Two
production mechanisms exist specifically to make this measurable:

- **Actor attribution on gate resolution.** `exactl approval approve/reject/amend/expire/cancel` on a `wait:` ref
  accept an optional `--resolved-by <actor>` value, merged into the wait-state's metadata and
  journalled as a `wait_state.command_resolved` event — so an audit can distinguish a gate
  resolved through the intended CLI/API surface from any other write that flips its status.
  Omitting `--resolved-by` leaves behavior exactly as before this existed.
- **Canary-only injection content.** Every "sensitive" artifact used to test whether an agent
  leaks or acts on hostile content is a fixture canary (`CANARY-<uuid>`-shaped), never a real
  credential, and injection stays inside the sandboxed worktree/portal for the run — see
  `docs/Exaix_Evaluation.md` §18.6.

These numbers describe one provider and one point in time, not a standing guarantee — see
`docs/Exaix_Evaluation.md` §18.5 before citing a robustness or adherence figure.

---

## Safety Gates & Plan Amendments

The **Plan Amendment Safety Gate** is a human-in-the-loop safeguard that allows the Exaix agent to propose structural changes to an execution plan mid-mission.

### When Amendments Trigger

An amendment is automatically proposed by the agent when:

- **Environmental Drift**: The workspace environment changed since the plan was created.
- **Tool Failures**: A critical tool fails in a way that makes downstream steps impossible.
- **Low Confidence**: The agent's reasoning confidence falls below the configured threshold.

### The Amendment Workflow

1. **Pause**: Execution is immediately paused. A checkpoint is saved.
1. **Proposal**: The agent generates a "Plan Amendment Patch" with a summary of changes.
1. **Wait**: The plan status becomes `amendment_pending`.
1. **Human Review**: Use CLI commands to review and decide:
   - `exactl plan amendment show` to see the proposed diff.
   - `exactl plan amendment approve` to apply and resume.
   - `exactl plan amendment reject` to abort the plan.

### Configuration

Configure the safety gate in `exa.config.toml`:

```toml
[amendment]
enabled = true             # Enable the safety gate (default: false)
threshold = 60            # Confidence threshold (0-100) (default: 60)
expiry_ms = 86400000       # How long an amendment can stay pending (default: 24h)
```

### Per-Action HITL Governance

> **This is a Team/Enterprise Edition feature.** It is off by default and only activates when
> `EXAIX_EDITION=team` and `config.hitl.enabled=true`.

Per-action HITL adds a **third human checkpoint** (alongside plan approval and amendment approval)
that pauses individual tool invocations based on per-argument policy rules.

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

A mandatory rule applies to **all** blueprints and cannot be overridden. If no approver is
available (e.g. CLI mode without a confirmation interceptor), the tool is **denied** (fail-closed).
Blueprint-only rules degrade gracefully (tool proceeds without interruption).

**Read-only tools** (e.g. `read_file`, `search_files`) are never automatically paused — HITL
must be explicitly configured to gate them. This is recommended only for sensitive-path
confidentiality (secrets, PII), not for routine reads, to avoid stalling the agent's reasoning loop.
