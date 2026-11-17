# Requests, Plans and Reviews

Create requests, clarify them, approve plans, review agent output and inspect git history. Part of the [Exaix User Guide](README.md).

## Requests

A request tells Exaix what you want done. You describe the work in plain language, and you can name an agent role or a flow, a portal and acceptance criteria. Exaix scores the request, asks questions when it is unclear, writes a plan, waits for your approval, runs the agents and hands you the result as a review.

> **Recommended:** Create requests with `exactl request create`. Do not create files in `Workspace/Requests/` by hand, because that bypasses validation.

| Aspect         | Manual File Creation     | `exactl request create`    |
| -------------- | ------------------------ | -------------------------- |
| Frontmatter    | Must write YAML manually | Auto-generated             |
| Trace ID       | Must generate UUID       | Auto-generated             |
| Validation     | None until daemon reads  | Immediate                  |
| Audit trail    | Not logged               | Logged to Activity Journal |
| Error handling | Silent failures          | Clear error messages       |
| Speed          | ~30 seconds              | ~2 seconds                 |

### The path of a request

1. **Create.** `exactl request create "<what you want>"` writes the request file, assigns a trace ID and logs the action. For a long description, use `--file <path>`.
1. **Quality gate.** Exaix scores the request before an agent runs. It lets the request proceed, enriches it, or asks clarifying questions that you answer with `exactl request clarify`. See [Request Quality Gate](#request-quality-gate--how-scoring-works).
1. **Plan.** The agent writes a plan, and `exactl plan list` shows plans that wait for your review. See [Plans](#plans).
1. **Execute.** When you approve the plan, the daemon detects it, runs it, and records every step in the Activity Journal under the trace ID.
1. **Review.** You review the result and approve it or reject it. See [Reviews](#reviews).

`exactl request list` shows the status of each request, for example `pending`, `needs_clarification` or `planned`, and `exactl request show <trace-id>` shows one request.

### Choosing how a request runs

- **Agent or flow.** `--agent <role>` selects an agent role, and `--flow <name>` selects a multi-agent flow. The two exclude each other.
- **Project.** `--portal <alias>` runs the request against a project, and `--target-branch <branch>` sets the branch that the review merges into. See [Portals](portals.md).
- **Priority.** `--priority` takes `low`, `normal`, `high` or `critical`.
- **Skills.** `--skills documentation-driven` injects skills into the agent, for example when a role needs a skill it does not have.
- **Acceptance criteria.** `--acceptance-criteria` and `--expected-outcome` are repeatable. Explicit criteria improve request quality in three ways: they raise the analyzer's confidence about what success looks like, they feed directly into downstream evaluation, and they reduce clarification churn for borderline requests.

### Choosing the model

Without options, Exaix picks the model for you. Four flags steer the choice: `--model-size S|M|L|XL`, `--thinking`, `--effort low|medium|high|auto` and `--characteristic cheapest|fastest`. The flag `--preferred-provider <provider>` narrows the providers.

```bash
# A hard design task: a large model with extended reasoning
exactl request create "Design authentication architecture" --model-size L --thinking --effort high

# A small, cheap task
exactl request create "Format all files" --model-size S --characteristic cheapest
```

The resolver turns these flags into one provider and model, records the reason, and journals a `model.resolved` event. [Model Resolution](../Model_Resolution.md#2-how-the-choice-gets-made) explains the order of the rules, the reasons and the fixed client of daemon execution, and [section 3](../Model_Resolution.md#3-curating-your-preferred-providers) shows how to curate the preferred providers.

### Previewing and scripting

- `--dry-run` shows what would be created without writing it, and `--dry-run-context` prints a projected input-token breakdown.
- `--analyze` runs an immediate intent analysis, and `--engine heuristic|llm|hybrid` chooses the engine. `exactl request analyze <id>` analyzes a request that exists.
- `--json` prints machine-readable output for scripts.

Every option is in the [request command reference](../cli/request.md).

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

## Plans

A plan is the agent's proposal for how to do a request. Nothing runs until you approve it.

1. `exactl plan list` shows the plans that wait for review, and `--status review` filters the list. `exactl plan show <plan-id>` shows one plan.
1. `exactl plan approve <plan-id>` approves it. The plan moves to `Workspace/Active/`, where the daemon detects it, parses it and runs it. See [Architecture](../../ARCHITECTURE.md#plan-execution-flow) for the flow.
1. `exactl plan reject <plan-id> --reason "..."` rejects it with a reason, and `exactl plan revise <plan-id> --comment "..."` asks for changes. Repeat `--comment` for each point.

A running plan can pause when it needs a structural change. [Security and Safety](security-and-safety.md) describes plan amendments, which you approve in the same way. Every option is in the [plan command reference](../cli/plan.md).

## Reviews

A review is the result of an executed plan: a git branch with code changes, or an artifact. You decide what happens to it.

1. `exactl review list` shows the reviews that wait for you, and `--status pending` filters the list.
1. `exactl review show <request-id>` shows the diff for code, or the content for an artifact.
1. `exactl review approve <request-id>` merges the branch into the review's base branch, or marks the artifact approved.
1. `exactl review reject <request-id> --reason "..."` deletes the branch, or marks the artifact rejected.

When the portal declares post-execution checks, `exactl review show` also prints their result. See [Portals](portals.md#post-execution-verification-portalsverification). Every option is in the [review command reference](../cli/review.md).

### Cleanup behavior (code reviews)

- **Reject:** Deletes the feature branch (best-effort cleanup if the branch is checked out in a worktree).
- **Approve:** Merges into the review’s recorded base branch (often `main`).
  - If the review was executed in an **isolated worktree**, Exaix also removes the worktree checkout and its pointer at `Memory/Execution/{trace-id}/worktree`, and then deletes the feature branch.
  - If the review was executed on a normal branch checkout, Exaix merges but does not automatically delete the feature branch.
- **Merge conflict on approve (worktree reviews):** Exaix attempts `git merge --abort` and removes the worktree checkout + pointer to avoid leaving orphaned worktrees. The feature branch is kept so a human can resolve and re-merge.

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

## Git history by trace ID

Every branch and commit that agents create carries the trace ID of its request, so you can find the work of one request in the repository.

- `exactl git branch list` lists the branches with their trace metadata, and `--pattern "feat/*"` finds the branches that agents created.
- `exactl git status` shows the status of the repository.
- `exactl git log --trace <trace-id>` shows all commits of one request.

Every option is in the [git command reference](../cli/git.md).

## Daily and weekly routine

**Daily.** Start with the work that waits for you: `exactl plan list` and `exactl review list`. Read each plan before you approve it, and review each change before you merge it. At the end of the day, check that the daemon is healthy with `exactl daemon status`, as [Operations](operations.md) describes.

**Weekly.** Stop the daemon and back up the workspace, as [Operations](operations.md) describes, then remove the feature branches that you no longer need and restart the daemon.
