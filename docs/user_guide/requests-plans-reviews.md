# Requests, Plans and Reviews

Create requests, clarify them, approve plans, review agent output and inspect git history. Part of the [Exaix User Guide](README.md).

## **Request Commands** - Primary Interface for Creating Requests

> **⚠️ RECOMMENDED:** Use `exactl request create` to create requests. Do NOT manually create files in `/Workspace/Requests/` — this is error-prone and bypasses validation.

The `exactl request create` command is the **primary interface** for submitting work to Exaix agents:

```bash
# Basic usage - just describe what you want
exactl request create "Implement user authentication for the API"

# With options
exactl request create "Add rate limiting" --agent senior_coder --priority high
exactl request create "Fix security bug" --priority critical --portal MyProject
exactl request create "Patch release branch" --portal MyProject --target-branch release_1.2
exactl request create "Build a web app" --flow web-development

# From file (for complex/long requests)
exactl request create --file ~/requirements.md
exactl request create --file ./feature-spec.md --agent architect

# List pending requests
exactl request list
exactl request list --status pending

# Show request details
exactl request show <trace-id>
exactl request show a1b2c3d4

# Dry run (see what would be created)
exactl request create "Test" --dry-run

# JSON output (for scripting)
exactl request create "Test" --json

# Inject skills to override agent limitations
exactl request create "Audit and write report" --agent security-expert --skills documentation-driven

# Trigger immediate intent analysis
exactl request create "Implement a new authentication flow" --analyze --engine llm
exactl request create "Update documentation" --analyze --engine heuristic

# Analyze an existing request
exactl request analyze a1b2c3d4
exactl request analyze "Existing Request Subject" --engine llm
```

**Options:**

| Option                  | Short | Description                                                                                                                                                  |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--agent`               |       | Target agent role blueprint (default: `default`, mutually exclusive with --flow)                                                                             |
| `--flow`                |       | Target multi-agent flow (mutually exclusive with --agent)                                                                                                    |
| `--priority`            | `-p`  | Priority: `low`, `normal`, `high`, `critical`                                                                                                                |
| `--portal`              |       | Portal alias for project context                                                                                                                             |
| `--target-branch`       |       | Target/base branch when working inside a portal (stored as `target_branch`)                                                                                  |
| `--skills`              |       | Comma-separated list of skills to inject (e.g., `documentation-driven,file-ops`)                                                                             |
| `--file`                | `-f`  | Read description from file                                                                                                                                   |
| `--acceptance-criteria` |       | Repeatable acceptance criterion; stored in frontmatter as `acceptance_criteria`                                                                              |
| `--expected-outcome`    |       | Repeatable expected outcome; stored in frontmatter as `expected_outcomes`                                                                                    |
| `--interactive`         | `-i`  | Interactive mode with prompts                                                                                                                                |
| `--dry-run`             |       | Preview without creating                                                                                                                                     |
| `--dry-run-context`     |       | Print a projected input-token breakdown (per-segment token estimates, budget, compaction trigger, cost) without writing a request file or calling a real LLM |
| `--json`                |       | Machine-readable output                                                                                                                                      |
| `--analyze`             |       | Trigger immediate intent analysis                                                                                                                            |
| `--engine`              | `-e`  | Analysis engine: `heuristic` (default), `llm`                                                                                                                |
| `--model-size`          |       | Capability tier: `S`, `M`, `L`, `XL` — maps to context/cost preset via ModelResolver (model resolution and intent)                                           |
| `--thinking`            |       | Extended thinking: bare `--thinking` means `true`; accepts `true`, `false`, or `auto` (model resolution and intent)                                          |
| `--effort`              |       | Reasoning token budget: `low`, `medium`, `high`, or `auto` — `auto` asks the system to decide per request (model resolution and intent)                      |
| `--characteristic`      |       | Soft ranking hint — `cheapest` or `fastest`. Scores providers, does not eliminate. Repeatable (model resolution and intent)                                  |
| `--preferred-provider`  |       | Narrow candidate pool to a specific provider, skips cross-provider scoring (model resolution and intent)                                                     |

**Example workflow:**

```bash
# 1. Create a request with one command
$ exactl request create "Add input validation to all API endpoints"
✓ Request created: request-a1b2c3d4.md
  Trace ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Priority: normal
  Agent: default
  Path: /home/user/Exaix/Workspace/Requests/request-a1b2c3d4.md
  Next: Daemon will process this automatically

# 2. Check if plan was generated
$ exactl plan list
📋 Plans (1):

🔍 add-validation-a1b2c3d4
   Status: review
   Trace: a1b2c3d4...

# 3. List your requests
$ exactl request list
📥 Requests (1):

🟢 a1b2c3d4
   Status: pending
   Agent: default
   Created: user@example.com @ 2025-11-27T10:30:00.000Z
```

**Structured criteria example:**

```bash
exactl request create "Implement file upload validation" \
  --agent senior-coder \
  --acceptance-criteria "All existing tests pass" \
  --acceptance-criteria "Payloads over 1MB are rejected" \
  --expected-outcome "Upload endpoint documents size limits"
```

Explicit criteria improve request quality in three ways: they raise the analyzer's confidence about what success looks like, they feed directly into downstream evaluation, and they reduce clarification churn for borderline requests.

**Model intent examples (model resolution and intent):**

```bash
# Large model with extended reasoning for complex tasks
exactl request create "Design authentication architecture" --model-size L --thinking --effort high

# Let the system decide the effort tier from task complexity (auto resolution)
exactl request create "Design authentication architecture" --effort auto

# Quick, cheap task — small model, no thinking
exactl request create "Format all files" --model-size S --characteristic cheapest

# Balanced: medium model, some reasoning, speed priority
exactl request create "Refactor utils module" --model-size M --thinking --effort low --characteristic fastest

# Pin to a specific provider but let ModelResolver pick the model
exactl request create "Audit dependencies" --model-size XL --preferred-provider anthropic
```

The resolver turns these flags into one provider and model, records the reason, and journals a `model.resolved` event. [Model Resolution](../Model_Resolution.md#2-how-the-choice-gets-made) explains the order of the rules, the reasons and the fixed client of daemon execution.

### `exactl model candidates` & `exactl model list` — Solo model curation (the curated model registry)

Curate the per-size preferred lists and inspect the Solo model floor without editing TOML by hand.
Curated lists are written back to `exa.config.toml` (`model_sizes.<SIZE>.candidates`) — the same
surface the resolver reads — so there is no separate database.

```bash
# Inspect the Solo model floor: one row per service that serves a model, with its author, route,
# price source, source URL, verified date, stale flag and per-Mtok prices
exactl model list

# Only the services that serve one model, as <author>/<model>
exactl model list --model anthropic/claude-sonnet-4

# Curate the preferred providers for size M (order matters — first healthy provider wins)
exactl model candidates --size M anthropic ollama

# Add a characteristic reorder hint (promotes ollama when --characteristic cheapest is used)
exactl model candidates --size M --characteristic cheapest ollama

# Show the current curated lists (unregistered providers are flagged "unconfigured")
exactl model candidates --list

# Clear a size's curated list (falls back to scoring)
exactl model candidates --size M --clear
```

Prices in `model list` are what Exaix assumes, not facts. The `Provenance` column says where a price came
from, `Source URL` and `Verified` say when it was last checked, and `Stale` reads `yes` when the price is older
than `model_registry.price_staleness_max_days` (default 90). The `Route` column is derived from the service
adapter: `*-cli` is `subscription`, `ollama`, `llamacpp` and `self-hosted` are `local`, `openrouter` is
`aggregator`, and every other service is `native`.

Notes:

- Entries are **provider names**, not `provider:model` pairs. An ambiguous bare name that matches a
  model owned by more than one provider is rejected with the qualifying options; an unknown
  provider is stored but flagged `unconfigured` (a pre-curation allowance).
- Pricing **provenance** is shown as `static` (a known, dated price) or `unknown`. A price older
  than 90 days is marked `(stale)`. The Solo floor is offline — there is **no `models refresh`**;
  a live, auto-refreshed catalog arrives with the Team edition (the Team edition model registry).

### Team: live model catalog (the Team edition model registry)

Enable the self-updating catalog with `model_registry.enabled = true`. [Team model registry](../Model_Settings.md#team-model-registry-live-catalog) lists every key of the `[model_registry]` block.

With the catalog enabled, `exactl model candidates` validates an explicit entry against the live
catalog (and auto-admits a real-but-unused model on first use, instead of Solo's pass-through),
and two more commands become available:

```bash
# Trigger/inspect the live refresh cycle
exactl model refresh

# Append an advisory benchmark-score column to the model list
exactl model list --benchmark swe_bench_verified
```

See [`docs/Model_Resolution.md`](../Model_Resolution.md) for the full explanation of what each
setting does — curation, characteristics (including the benchmark-driven `best`), the live
catalog, multi-route pricing, and cost accuracy.

See the **Model Registry** row of the edition comparison table in
[`docs/Reference_Data.md`](../Reference_Data.md#edition-model--component-availability) for how
this fits into the overall Solo / Team / Enterprise split.

**Why CLI instead of manual files?**

| Aspect         | Manual File Creation     | `exactl request create`    |
| -------------- | ------------------------ | -------------------------- |
| Frontmatter    | Must write YAML manually | Auto-generated             |
| Trace ID       | Must generate UUID       | Auto-generated             |
| Validation     | None until daemon reads  | Immediate                  |
| Audit trail    | Not logged               | Logged to Activity Journal |
| Error handling | Silent failures          | Clear error messages       |
| Speed          | ~30 seconds              | ~2 seconds                 |

## **`exactl request clarify` — Interactive Clarification**

When a request enters the **REFINING** or **NEEDS_CLARIFICATION** status the quality gate has determined that the request needs more detail before it can be executed. Use `exactl request clarify` to answer the pending questions:

```bash
# Show pending questions for a request
exactl request clarify <trace-id>

# Answer all questions interactively (prompts for each one)
exactl request clarify <request-id>

# Supply specific answers by question ID
exactl request clarify <trace-id> --answer r1q1="The users table" --answer r1q2="src/db/queries.ts"

# Force the request to proceed with the current specification
exactl request clarify <trace-id> --proceed

# Abandon clarification and revert to the original body
exactl request clarify <trace-id> --cancel
```

**Options:**

| Option          | Short | Description                                               |
| --------------- | ----- | --------------------------------------------------------- |
| `--interactive` | `-i`  | Prompt for each pending question sequentially             |
| `--answer`      |       | Supply an answer: `--answer <question-id>="<text"`        |
| `--proceed`     |       | Accept current specification and re-enter the pipeline    |
| `--cancel`      |       | Cancel refinement and revert to the original request body |

**Clarification workflow:**

```text
exactl request create "fix something"          # vague → quality gate detects low score
→ status: REFINING                       # gate saves session + questions
→ exactl request clarify <id>            # see the questions
→ exactl request clarify <id> -i        # answer interactively
→ status: NEEDS_CLARIFICATION           # awaiting further rounds or proceed
→ exactl request clarify <id> --proceed # inject final spec and re-queue
→ PENDING → PLANNED                     # agent runs against the specification
```

**Understanding quality gate statuses in `exactl request list`:**

| Status                | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `REFINING`            | Active Q&A loop in progress — use `exactl request clarify <id>`      |
| `NEEDS_CLARIFICATION` | Awaiting your response to the most recent round of questions         |
| `ENRICHING`           | Quality gate is auto-rewriting an underspecified request (transient) |

## **`exactl request cancel` — Cancel a Request**

Use `exactl request cancel` to stop a request that no execution has started:

```bash
exactl request cancel <trace-id>
exactl request cancel <trace-id> --reason "Duplicate of another request"
```

The command accepts a request in the `pending` or `needs_clarification` status. It sets `status: cancelled`, writes a `request.cancelled` journal row with the previous status, the reason and who cancelled it, and cancels a pending clarification wait state of the request. The id is a full trace id, a request file name or a trace id prefix of at least 8 characters.

Any other status exits with code 4 and the file stays as it was:

| Status                                              | Message and next step                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| `planned`                                           | Reject the plan instead: `exactl plan reject <plan-id>` |
| `analyzing`, `enriching`, `refining`, `in_progress` | The request is in flight. Retry when it settles         |
| `completed`, `failed`, `cancelled`                  | The request is already final                            |

A request in `needs_clarification` also cancels its pending clarification wait states, and each one writes a `wait_state.command_resolved` row with your user identity. A wait state that cannot be cancelled makes the command exit with code 1 and print `exactl approval cancel wait:<resume-token>` for it, and the request stays cancelled. The command refuses a request that started while it ran, and it exits with code 2 for a request file whose trace id is not a plain id. A request file whose status is not a request status exits with code 6. The TUI cancel and delete actions use the same path.

An empty, short or ambiguous id exits with code 2, and an unknown id exits with code 3. `exactl request clarify <trace-id> --cancel` is a different command: it abandons the clarification session and puts the request back in the queue.

## **Request Quality Gate — How Scoring Works**

Every request passes through a three-tier quality assessment before the agent runs:

| Score range | Level       | Recommendation                            |
| ----------- | ----------- | ----------------------------------------- |
| 70 – 100    | Good/Excel. | **Proceed** — agent runs immediately      |
| 50 – 69     | Acceptable  | **Auto-enrich** — gate rewrites the body  |
| 20 – 49     | Poor        | **Needs clarification** — Q&A loop starts |
| 0 – 19      | Very poor   | **Reject** — request returned to sender   |

**Tips for high-quality requests:**

- Include at least one action verb ("implement", "fix", "refactor", "add").
- Reference specific files, modules, or acceptance criteria.
- Specify scope: what **in** and what **out** of scope.
- Use `exactl request analyze` to preview the score before submitting.

**Auto-enrichment:** When a request scores in the _Acceptable_ range and `auto_enrich = true` is configured (default), the gate rewrites the request body into a more structured form. The original body is preserved in `originalBody` and never lost.

## **`exactl request inspect` — Read-Only Dogfood Context Inspection**

When Exaix delegates work to a headless native agent (Claude Code, OpenCode, Codex),
what that agent actually saw is captured immutably at launch time (source IDs, section
budgets, granted tool schemas, the exact post-redaction prompt text). `exactl request
inspect` reads those captures back — it never re-runs retrieval, never calls a model
provider, and never reconstructs a prompt that was never captured:

```bash
# Summaries of every captured record under a trace (or its child launches)
exactl request inspect <trace-id>

# Full detail for a specific captured record
exactl request inspect <trace-id> --record <record-id>

# Machine-readable detail/summary output
exactl request inspect <trace-id> --json

# Export the exact post-redaction bytes sent to the child (for diffing/auditing)
exactl request inspect <trace-id> --record <record-id> --raw > sent-prompt.txt
```

**Options:**

| Option     | Description                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--record` | Inspect one specific captured record by its UUID                                                                                      |
| `--json`   | Machine-readable summary/detail output                                                                                                |
| `--raw`    | Export the exact captured `promptText` bytes only — requires `--record` (or a single-record trace) and refuses to write to a terminal |

**Input/output scope:** `<trace-id>` and `--record <uuid>` accept full UUIDs only. With no
`--record`, a trace with exactly one captured record shows its detail automatically;
a trace with multiple records shows an ordered summary list instead. A parent
(governing) trace ID also finds records captured under its child launches. Native
`prompt`/`tools`/`history` visibility is always reported explicitly as `unknown` when a
client's own visibility state can't be observed. `--raw` is redirect-safe: nothing but
the captured bytes is written to stdout.

**Exit codes:**

| Code | Meaning                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| `0`  | Success — summary or detail printed                                                                    |
| `1`  | Read failure — the record exists but is corrupt or inaccessible                                        |
| `2`  | Invalid input — malformed UUID, `--json`+`--raw` together, ambiguous `--raw`, or `--raw` to a terminal |
| `3`  | No capture — legacy, expired, or never-captured trace/record (never reconstructs a prompt)             |

## **Plan Commands** - Review AI-generated plans

Review and approve plans before agents execute them:

> **⚠️ IMPLEMENTATION STATUS:** Plan approval moves plans to `Workspace/Active/` where they are detected and parsed (Steps 5.12.1-5.12.2 ✅). Automatic agent-driven execution (Steps 5.12.3-5.12.6) is in development. In the agent-driven model, LLM agents will have direct portal access through scoped tools (read_file, write_file, git_create_branch, git_commit) and will create reviews themselves. See [ARCHITECTURE.md](../../ARCHITECTURE.md#plan-execution-flow) for details.

```bash
# List all plans awaiting review
exactl plan list
exactl plan list --status review          # Filter by status

# Show plan details
exactl plan show <plan-id>

# Approve a plan (moves to Workspace/Active for detection and parsing)
exactl plan approve <plan-id>

# Reject a plan with reason
exactl plan reject <plan-id> --reason "Approach too risky"

# Request revisions with comments
exactl plan revise <plan-id> \
  --comment "Add error handling" \
  --comment "Include unit tests"
```

## **Review Commands** - Review agent-generated outputs

After agents execute plans and create git branches or artifacts, review their outputs:

```bash
# List all pending reviews (agent-created branches and artifacts)
exactl review list
exactl review list --status pending

# Show review details with diff (for code) or content (for artifacts)
exactl review show <request-id>
exactl review show feat/implement-auth-550e8400

# Approve review (merges branch to main or marks artifact approved)
exactl review approve <request-id>

# Reject review (deletes branch or marks artifact rejected)
exactl review reject <request-id> --reason "Failed code review"
```

**Cleanup behavior (code reviews):**

- **Reject:** Deletes the feature branch (best-effort cleanup if the branch is checked out in a worktree).
- **Approve:** Merges into the review’s recorded base branch (often `main`).
  - If the review was executed in an **isolated worktree**, Exaix also removes the worktree checkout and its pointer at `Memory/Execution/{trace-id}/worktree`, and then deletes the feature branch.
  - If the review was executed on a normal branch checkout, Exaix merges but does not automatically delete the feature branch.
- **Merge conflict on approve (worktree reviews):** Exaix attempts `git merge --abort` and removes the worktree checkout + pointer to avoid leaving orphaned worktrees. The feature branch is kept so a human can resolve and re-merge.

**Example workflow:**

```bash
# 1. See what code changes are ready
$ exactl review list
📋 Reviews (1):

📌 implement-auth (feat/implement-auth-550e8400)
   Files: 12
   Created: 2025-11-25 14:30:22
   Trace: 550e8400...

# 2. Review the changes
$ exactl review show implement-auth
📋 Review: implement-auth

Branch: feat/implement-auth-550e8400
Files changed: 12
Commits: 3

Commits:
  a3f21b89 - Add JWT authentication
  c4d8e123 - Add login endpoint
  f9a23c45 - Add auth middleware

Diff:
[full diff output...]

# 3. Approve or reject
$ exactl review approve implement-auth
✓ Review approved
  Branch: feat/implement-auth-550e8400
  Merged to main: 3b5f7a21
   Files changed: 12
```

### Execution Anomaly Surfacing

When you run `exactl review list`, reviews whose execution trace contains
anomaly-relevant events display a severity badge:

```text
⚠️ 1 anomaly (0 high, 1 medium, 0 low)
```

The badge appears only when there are live anomalies (high + medium + low > 0).
If all detected failures were later recovered by a successful retry on the same
target, the badge is suppressed entirely — only actionable signal is surfaced
at the list level.

**Severity meanings:**

| Severity   | Meaning                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| **high**   | Security violations, permission denials, execution failures, plan execution failures          |
| **medium** | Tool call failures, step failures, LLM call failures, validation failures, git audit failures |
| **low**    | Timeout warnings, context compaction events                                                   |

When you run `exactl review show`, an "Execution anomalies" section lists each
individual finding with its severity, target, and event type:

```text
📋 Review: implement-auth

...
Execution anomalies:
  medium  build-step  (execution.action_failed)
```

A recovered failure is annotated with `recovered: true`:

```text
medium  build-step  (execution.action_failed, recovered: true)
```

Recovered findings are excluded from the high/medium/low badge counts and are
instead summarized as a `(+N recovered)` tail on the badge when it is shown.
If all anomalies in a trace are recovered, the badge is hidden entirely — only
actionable signal is surfaced at the list level.

**How it works:** The system reads the Activity Journal (the same underlying
data that tracks execution progress) and projects a read-time classification of
anomaly-relevant event types. No separate detection, LLM call, or write path is
involved — events the system already emits are simply surfaced.

## **Git Commands** - Repository operations with trace_id

Query git history and track changes by trace_id:

```bash
# List all branches with trace metadata
exactl git branch list
exactl git branch list --pattern "feat/*"     # Filter pattern

# Show repository status
exactl git status

# Search commits by trace_id
exactl git log --trace <trace-id>
```

**Example workflow:**

```bash
# Find all branches created by agents
$ exactl git branch list --pattern "feat/*"
🌳 Branches (3):

  feat/implement-auth-550e8400
   Last commit: a3f21b89 (11/25/2025)
   Trace: 550e8400...

  feat/add-tests-7a3c9b12
   Last commit: b2c31a45 (11/24/2025)
   Trace: 7a3c9b12...

# Check workspace status
$ exactl git status
📊 Repository Status

Branch: main

Modified (2):
  M src/auth/handler.ts
  M src/shared/schemas/config.ts

# Find all commits for a specific request
$ exactl git log --trace 550e8400-e29b-41d4-a716-446655440000
📜 Commits for trace 550e8400...

a3f21b89 - Add JWT authentication
  Author: exaix-agent
  Date: 11/25/2025, 2:30:45 PM
```

## Common Workflows

**Daily Operations:**

```bash
# Morning: Check what's pending
exactl plan list
exactl review list

# Review and approve plans
exactl plan show <id>
exactl plan approve <id>

# Review and merge code
exactl review show <id>
exactl review approve <id>

# End of day: Check daemon health
exactl daemon status
```

**Weekly Maintenance:**

```bash
# Stop daemon for backup
exactl daemon stop

# Backup workspace (see section 5.1)
tar -czf exaix-backup-$(date +%Y%m%d).tar.gz ~/Exaix

# Clean up old branches
exactl git branch list | grep -v main | xargs git branch -d

# Restart daemon
exactl daemon start
```
