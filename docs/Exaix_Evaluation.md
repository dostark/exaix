# Exaix Evaluation Guide

- **Version:** 1.2.0
- **Date:** 2026-08-05

## 1. Introduction

The Exaix Evaluation Framework turns the scenario testing infrastructure into a
production-grade measurement tool. It lets you score agent behaviour quantitatively,
track scores over time, compare runs, and gate CI on quality thresholds.

**What it evaluates:**

| Component            | Covered by pack           |
| -------------------- | ------------------------- |
| Agent flows          | `agent_flows`             |
| Tool execution       | `mcp_tools_extended`      |
| Routing              | `dynamic_execution`       |
| Provider behaviour   | `provider_live`           |
| Framework health     | `smoke`, `framework_test` |
| End-to-end workflows | `integration_e2e`         |
| Blueprint quality    | `blueprint-eval`          |
| Eval self-test       | `eval-smoke`              |

Packs are also tagged by the **subsystem** they measure — `subsystem:tools`, `subsystem:mcp-server`,
`subsystem:mcp-client`, `subsystem:identities`, `subsystem:skills`, `subsystem:flows` — which is the
axis `eval report --group-by subsystem` aggregates and the one the cadence tiers select on. See
[§12 Subsystem Evaluation](#12-subsystem-evaluation).

---

## 2. Quick Start

```bash
# Run all smoke scenarios with evaluation metrics
exactl eval run --tag smoke

# Run a specific pack with a score threshold
exactl eval run --pack blueprint-eval --score-threshold 0.7

# Run with multiple trials for reliability metrics
exactl eval run --pack smoke --trials 5

# View run history
exactl eval history --last 10

# Compare two runs
exactl eval compare --run-a <run-id> --run-b <run-id>

# Bound a live run's spend and read the value-for-money view
exactl eval run --pack swe_tasks --max-cost-usd 0.5
exactl eval report --view frontier
```

**Exit codes:** `0` = all scenarios passed threshold; `1` = one or more failed.

---

## 3. CLI Reference

### 3.1 `exactl eval run`

Execute scenarios with scoring and history recording.

**Usage:**

```bash
exactl eval run [options]
```

**Options:**

| Flag                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `-P, --pack <name>`      | Run all scenarios in a pack (repeatable)     |
| `-t, --tag <tag>`        | Filter by tag (repeatable)                   |
| `-s, --scenario <id>`    | Run a single named scenario (repeatable)     |
| `--score-threshold <n>`  | Minimum suite score to pass (default: 0.5)   |
| `--trials <N>`           | Number of trials per scenario (default: 1)   |
| `--history-format <fmt>` | Storage: `sqlite+jsonl` (default) or `jsonl` |
| `--max-cost-usd <n>`     | Stop scheduling at the cost cap (see below)  |
| `-v, --verbose`          | Show detailed output                         |

**Examples:**

```bash
# Run a single scenario
exactl eval run --scenario workspace-health-smoke

# Run all scenarios in a pack with high threshold
exactl eval run --pack agent_flows --score-threshold 0.8

# Run by tag with multi-trial
exactl eval run --tag eval --trials 3 --score-threshold 0.6

# Bound a live run's spend: stop scheduling after $0.50 of tracked cost
exactl eval run --pack swe_tasks --max-cost-usd 0.5

# Run multiple packs
exactl eval run --pack smoke --pack framework_test
```

`--max-cost-usd` is the phase's budget discipline for unattended runs. The cap is checked
**between scenarios**, never mid-task: once the accumulated tracked cost reaches the cap, the
remaining scenarios are skipped (reported as `skipped: budget`) and the run finishes on the
completed scenarios' scores. A budget stop is not an infrastructure error, so the exit code is
the normal `0`/`1` verdict; `budget_stopped: true` is recorded in the suite report (§9.5).

### 3.2 `exactl eval history`

Query evaluation run history.

**Usage:**

```bash
exactl eval history [options]
```

**Options:**

| Flag              | Description                          |
| ----------------- | ------------------------------------ |
| `-l, --last <N>`  | Show last N entries                  |
| `--scenario <id>` | Filter by scenario ID                |
| `--pack <name>`   | Filter by pack name                  |
| `--since <date>`  | Filter to runs since date (ISO 8601) |
| `--format <fmt>`  | Output: `table` (default) or `json`  |

**Examples:**

```bash
# Show last 5 runs
exactl eval history --last 5

# Show history for a specific scenario as JSON
exactl eval history --scenario workspace-health-smoke --format json

# Show runs since a date for a pack
exactl eval history --pack smoke --since 2026-06-01
```

### 3.3 `exactl eval compare`

Compare two evaluation runs side-by-side.

**Usage:**

```bash
exactl eval compare --run-a <id> --run-b <id>
```

**Example:**

```bash
# Compare two runs by their run IDs
exactl eval compare --run-a aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa \
                     --run-b bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb
```

Output shows per-step score differences and overall score delta.

### 3.4 `exactl eval report`

Render a comparison over recorded history, grouped by `cell_id`/`provider`/`model`. The view
is selected with `--view`; the current views are `cost` (default), `families`, `lift`,
`ablation`, `frontier`, and `failures`. Report views read the same tracked-cost, score, and cell
fields the history rows carry (§9), and `--format json` renders machine-readable rows for CI
trend jobs.

**Usage:**

```bash
exactl eval report [--view <view>] [--scenario <id>] [--last <n>] [--pack <name>] [--format json]
```

#### `--view cost` (default)

A cross-cell timing/token/tracked-cost comparison table. Output shows, per cell, mean
wall-clock `duration_ms`, mean LLM-call `llm_duration_ms`, total prompt/completion tokens, and
total/mean **tracked** cost (`tracked_cost_usd`) — see §9.4 for what "tracked" means. A
cell whose every run had no tracked cost (e.g. a pure direct-API cell, which only ever
produces a _predicted_ cost estimate) renders `—` for cost columns, never `0` and never a
predicted figure relabeled as tracked.

```bash
exactl eval report --view cost --scenario fix-bug-null-guard-cli-all
```

#### `--view families`

Per-task-family aggregate (mean score, pass@1, reconcile rate, duration) over the `task:` tag —
the readout behind §12's subsystem reporting, narrowed to task families.

#### `--view lift` — harness lift

The core question "does Exaix add anything over running the raw CLI tool directly?" A **bare
delegate cell** (`cell_id: bare/<tool>/<provider>`) runs the same pinned task with the raw
delegate CLI (Claude Code, opencode, …) — no daemon, no pipeline — scored on the same outcome
criteria as the Exaix cell. For each task family the lift view pairs the Exaix cell against its
bare baseline and reports `meanDelta` (Exaix minus bare), `stdevDelta`, and a `noEffect` verdict
when the delta is indistinguishable from noise — with an explicit basis (run ids, task count),
never a bare point delta.

```bash
exactl eval report --view lift [--scenario <id>] [--pack <name>]
```

#### `--view ablation` — feature contribution

What does each subsystem actually contribute? An **ablation cell**
(`cell_id: ablate-<subsystem>/<tool>/<provider>`) runs the full loop with exactly one subsystem
toggled off via a config preset (`configs/eval-ablate-skills.toml`,
`eval-ablate-quality-gate.toml`, `eval-ablate-portal-knowledge.toml`; the presets are
byte-identical except their one toggle each). The view pairs each full-config cell against its
`ablate-<subsystem>` sibling and reports per-subsystem `meanDelta`/`stdevDelta`/`noEffect` — the
feature contribution, with basis and the same no-effect honesty as lift.

```bash
exactl eval report --view ablation [--scenario <id>] [--pack <name>]
```

#### `--view frontier` — accuracy vs cost

Per cell, a point of (mean score, mean cost) plus `cost_per_solved` (Σ tracked cost ÷ passed
tasks). Cells that are **Pareto-dominant** — no other cell is both better-scored and no more
expensive — are marked. A cell with no cost data is left out of the dominance comparison and
rendered with `—` for cost, never a made-up `0`.

```bash
# The efficiency readout adopters actually ask for
exactl eval report --view frontier

# Machine-readable rows for a CI trend job
exactl eval report --view frontier --format json
```

#### `--view failures` — why runs fail

Every run that failed records _why_ (§9.6). This view aggregates those failure classes across
history: per-class counts with the family × cell breakdown, and the **top class per cell** — so
you can see at a glance whether a cell keeps dying on one specific failure mode. Supports
`--format json`.

```bash
exactl eval report --view failures
exactl eval report --view failures --format json
```

---

## 4. Scoring Model

### 4.1 Criterion Weights

Each criterion can carry a `score_weight` (0.0–1.0). When omitted, all criteria
weigh equally (1.0 each).

```yaml
output_criteria:
  - id: "critical-check"
    kind: "file-exists"
    path: "important/file.txt"
    score_weight: 0.7
  - id: "nice-to-have"
    kind: "dir-exists"
    path: "optional/dir"
    score_weight: 0.3
```

**Step score formula:**

```text
step_score = sum(criterion.score_weight for passed criteria) / sum(all score_weights)
```

### 4.2 Step Weights

Steps can carry `step_weight` to control their contribution to the overall suite score.

```yaml
steps:
  - id: "core-step"
    type: "shell"
    command: "do-something"
    step_weight: 0.8
    output_criteria: [...]
```

**Suite score formula:**

```text
suite_score = sum(step.score * step.step_weight) / sum(all step_weights)
```

### 4.3 Backward Compatibility

Scenarios without any `score_weight` fields produce binary scores:

- `suite_score: 1.0` if all criteria pass
- `suite_score: 0.0` if any fail

This matches the pre-scoring behaviour exactly.

### 4.4 Score Threshold

The `--score-threshold` flag gates the exit code (eval mode only). Exit codes:

- **0**: All scenarios scored at or above threshold
- **1**: One or more scenarios scored below threshold or failed
- **2**: Infrastructure error (catalog load failure, runner exception outside
  step execution)

Default threshold is `0.5`.

```bash
# Exit 1 if any scenario scores below 0.8
exactl eval run --pack smoke --score-threshold 0.8
```

### 4.5 Security-Gated Scoring (opt-in)

The weighted mean in §4.1–4.2 lets a security violation count as just one bad check among many.
The `swe_tasks` corpus (§14) opts into a harsher, Harness-Bench-style rule: **a task whose
`class: security` criterion fails scores 0 for the whole suite, no matter how well the rest of
the work went.**

Two markers opt a scenario in:

```yaml
scoring: "gated" # scenario level — the mode
...
output_criteria:
  - id: "no-dynamic-tool-calls"
    kind: "command-exit-code"
    equals: 0
    class: "security" # criterion level — the security check
```

- **`scoring: "gated"`** switches the scenario to multiplicative scoring: the additive suite
  score is multiplied by a gate that is `0` exactly when any `class: security` criterion
  FAILED, and `1` otherwise. A passed security check, or no security check at all, leaves the
  additive score untouched.
- Absent the field, scoring stays **additive** and is byte-identical to pre-gating behaviour —
  gating is strictly opt-in.
- Every run records which mode it used (`scoring_mode`, default `additive`), so old baselines
  are never mistaken for gated runs; the mode is shown as the SCORING column in
  `exactl eval history` (§9).

The `swe_tasks` corpus runs gated and tags its scope-violation, path-escape, and approval-bypass
checks (`no-dynamic-tool-calls`, `plan-approved`, `review-approved`) as `class: security` — a
real run that fails approval now scores 0, matching what Harness-Bench would do.

---

## 5. Writing Evaluation Scenarios

### 5.1 Basic Structure

```yaml
schema_version: "1.0.0"
id: "my-evaluation"
title: "Evaluate my feature"
pack: "my_pack"
tags: ["eval", "quality"]
request_fixture: "fixtures/requests/my_pack/request.md"
mode_support: ["auto"]
portals: []
steps:
  - id: "run-command"
    type: "shell"
    command: "sh"
    args: ["-c", "echo hello > output.txt"]
    output_criteria:
      - id: "file-created"
        kind: "file-exists"
        path: "output.txt"
```

### 5.2 Available Criterion Kinds

| Kind                       | What it checks                            |
| -------------------------- | ----------------------------------------- |
| `file-exists`              | File exists at path                       |
| `file-found`               | Glob pattern matches a file               |
| `file-not-exists`          | File does not exist                       |
| `text-contains`            | File contains substring                   |
| `text-matches`             | File matches all regex patterns           |
| `json-path-exists`         | JSON path exists in file                  |
| `json-path-equals`         | JSON path equals expected value           |
| `json-query`               | Complex JSON query with filters           |
| `command-exit-code`        | Step exit code                            |
| `command-output-contains`  | Combined stdout+stderr contains substring |
| `dir-exists`               | Directory exists                          |
| `frontmatter-field-exists` | YAML frontmatter field exists             |
| `frontmatter-field-equals` | Frontmatter field equals value            |
| `journal-event-exists`     | Journal contains event type               |
| `status-equals`            | Step stdout equals value                  |
| `portal-mounted`           | Portal alias is mounted                   |
| `env-var-present`          | Environment variable is set               |
| `version-equals`           | Binary/workspace version equals           |
| `version-gte`              | Version >= required                       |
| `version-lte`              | Version <= required                       |
| `llm-judge`                | LLM-graded rubric evaluation              |

---

## 6. LLM-as-Judge Evaluation

The `llm-judge` criterion kind uses Exaix's 14 built-in evaluation criteria to
score agent output. It can use a named **preset** or an inline **rubric**.

### 6.1 Using a Preset

```yaml
output_criteria:
  - id: "blueprint-quality"
    kind: "llm-judge"
    preset: "goal_alignment"
    evidence_path: "Workspace/Active/plan.md"
    score_threshold: 0.8
    score_weight: 2.0
```

Available presets: `goal_alignment`, `task_fulfillment`, `code_correctness`,
`code_completeness`, `has_tests`, `follows_conventions`, `no_security_issues`,
`error_handling`, `clarity`, `accuracy`, `relevance`, `conciseness`,
`documentation_quality`, `api_consistency`, `performance_considerations`,
`scalability`, `request_understanding`.

### 6.2 Using an Inline Rubric

```yaml
output_criteria:
  - id: "custom-eval"
    kind: "llm-judge"
    rubric: "Check that the response addresses all three requirements:
      1) explains the architecture, 2) lists trade-offs,
      3) recommends a decision"
    score_threshold: 0.7
```

### 6.3 Mock Mode

In test/CI environments without an LLM endpoint, all `llm-judge` criteria return
`SKIPPED` (excluded from scoring) by default. To force the old auto-pass behaviour
for framework self-tests only:

```bash
EXA_EVAL_LLM_MOCK=pass exactl eval run --pack my-pack
```

To require a real endpoint:

```bash
EXA_EVAL_LLM_MOCK=false exactl eval run --pack my-pack
```

The LLM provider is resolved via the `ModelResolver` path (see `ARCHITECTURE.md`).
Configure via `EXA_LLM_PROVIDER` (e.g. `anthropic`, `openai`, `google`, `openrouter`, `ollama`)
and `EXA_LLM_MODEL`. Each provider reads its own API key from its standard env var. Unset
`EXA_LLM_PROVIDER` defaults to the Mock provider (no external call).

---

## 7. Trajectory Evaluation

The `trajectory-assert` step type validates the agent's tool-call sequence
during a scenario step. It reads the journal to capture the actual tool calls
and compares them to an expected sequence.

### 7.1 Basic Trajectory Assert

Trajectory capture reads the daemon's journal (`activity` table) for
`action_type = "dynamic_tool_call"` rows within the source step's execution rowid
window. Each matched row's `payload.tool` and `payload.args` are compared against
the expected sequence. `arg_contains`/`min_args`/`max_args` are enforced against
the serialised `args` payload.

```yaml
steps:
  - id: "submit-request"
    type: "exactl"
    command: "plan submit --file $REQUEST_FIXTURE"
  - id: "check-trajectory"
    type: "trajectory-assert"
    source_step: "submit-request"
    expected_sequence:
      - tool: "read_file"
        args_contains: ["config.ts"]
      - tool: "edit_file"
    order_matters: true
    allow_extra_tools: false
    partial_credit: true
```

### 7.2 Configuration Fields

| Field               | Default  | Description                         |
| ------------------- | -------- | ----------------------------------- |
| `source_step`       | required | Step ID whose execution to analyze  |
| `expected_sequence` | required | Ordered list of expected tool calls |
| `order_matters`     | `true`   | Enforce sequence ordering           |
| `allow_extra_tools` | `false`  | Tolerate unexpected tools           |
| `partial_credit`    | `true`   | Score partial matches > 0           |

### 7.3 Scoring

- **Order matters, exact match** → score 1.0
- **Order matters, wrong order** → partial via Levenshtein distance
- **Order doesn't matter** → multiset (bag-of-tools) comparison
- **Partial credit disabled** → binary 1.0/0.0
- **Extra tools allowed** → not penalised

---

## 8. Multi-Trial Mode

Run each scenario multiple times to measure reliability, not just a single score.

```bash
# Run each smoke scenario 5 times
exactl eval run --pack smoke --trials 5 --score-threshold 0.7
```

**Metrics reported:**

| Metric       | Meaning                                         |
| ------------ | ----------------------------------------------- |
| `mean`       | Average score across trials                     |
| `min`        | Worst-case floor                                |
| `max`        | Best-case ceiling                               |
| `stdev`      | Consistency measure                             |
| `pass_at_1`  | Fraction of trials passing threshold            |
| `pass_pow_k` | Probability all N i.i.d. trials pass: `(c/n)^n` |

The legacy `pass_k` column is retained for schema compatibility but is not
written (always NULL in new runs).

**Example interpretation:**

```text
--trials 5, scores: [0.95, 0.88, 0.45, 0.92, 0.90]
mean: 0.82, min: 0.45, max: 0.95, stdev: 0.19
pass_at_1: 0.8 (4/5 passed threshold 0.7)
pass_pow_k: 0.32768 ((4/5)^5)
```

---

## 9. History & Storage

### 9.1 JSONL Format

Every eval run appends to `tests/scenario_framework/output/history/eval-history.jsonl`.
Each line is a self-contained JSON object:

```json
{
  "run_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  "scenario_id": "workspace-health-smoke",
  "pack": "smoke",
  "outcome": "success",
  "mode": "auto",
  "suite_score": 0.95,
  "passed": true,
  "scoring_mode": "additive",
  "failure_classes": ["execution.failed"],
  "step_count": 3,
  "step_results": [
    {
      "step_id": "step-1",
      "score": 1.0,
      "criteria_passed": 2,
      "criteria_total": 2,
      "duration_ms": 1200,
      "llm_duration_ms": 900,
      "tokens_prompt": 1500,
      "tokens_completion": 400,
      "tokens_cache_read": 200,
      "tokens_cache_creation": 50,
      "tracked_cost_usd": 0.02
    },
    { "step_id": "step-2", "score": 0.85, "criteria_passed": 1, "criteria_total": 2 }
  ],
  "total_llm_duration_ms": 900,
  "total_tokens_prompt": 1500,
  "total_tokens_completion": 400,
  "total_tokens_cache_read": 200,
  "total_tokens_cache_creation": 50,
  "total_tracked_cost_usd": 0.02,
  "timestamp": "2026-06-09T12:00:00.000Z",
  "component_versions": {
    "binary_version": "1.0.3",
    "schema_version": "1.5.0"
  }
}
```

Timing, token, and tracked-cost fields are optional and only present when the
underlying journal payloads carried them for that step (see §9.4). `step-2`
above has none — a shell-only step with no LLM call in its execution window
carries no such fields, not zeroed ones.

`scoring_mode` is `"additive"` (the default, applied to every pre-existing row) or `"gated"`
for a scenario that opted into security-gated scoring (§4.5) — history always records which
rule produced the score.

`failure_classes` is the run's failure taxonomy (§9.6) — the distinct anomaly event types from
the run's trace plus the `execution-alignment` class. Absent for runs with no classified
failures.

### 9.2 SQLite Storage

By default, runs are also stored in SQLite with indexed tables
(`eval_runs`, `eval_run_steps`, `eval_criteria_results`) — the criteria
results table is now populated with criterion-level scores, status, and
judge provenance. This enables efficient queries and cross-run comparison.

The DB path is resolved via `resolveEvalDbPath()`, which uses the workspace
root by default, overridable via `EXA_EVAL_DB_PATH`. Previously the path was
a CWD-relative `.exa/eval.db` that could disagree with the runner's own path;
both the runner and `exactl eval history` now use the same resolution rule.

Opt out of SQLite with:

```bash
exactl eval run --pack smoke --history-format jsonl
```

View history from SQLite (default) or fall back to JSONL:

```bash
exactl eval history --last 10
exactl eval history --source jsonl --last 10
```

### 9.3 Querying with `exactl eval history`

```bash
# Latest 5 runs
exactl eval history --last 5

# Filter by scenario
exactl eval history --scenario workspace-health-smoke

# Filter by date range
exactl eval history --since 2026-06-01

# Machine-readable output
exactl eval history --last 10 --format json | jq '[.[] | {id: .run_id, score: .suite_score}]'
```

### 9.4 Tracked vs. Predicted Cost

Exaix distinguishes two kinds of `cost_usd` figure:

- **Predicted** — a rate-based estimate Exaix computes itself
  (`calculateCost()`) from a token count, before any provider or tool has
  reported a real figure. Used by direct-API strategies (ReAct, legacy).
- **Tracked** — a real dollar figure a provider or CLI tool actually reported
  in its own response (e.g. Claude Code's `total_cost_usd`, opencode's
  `part.cost`). Used by CLI-delegate and session-delegate strategies.

Every journaled usage payload carries a `cost_source: "tracked" | "predicted"`
tag making this distinction explicit and machine-checkable. **Every
`tracked_cost_usd`/`total_tracked_cost_usd` field in eval history and the
`report --view cost` output is sourced exclusively from `cost_source:
"tracked"` rows** — a step or run whose LLM calls were all predicted-cost
produces `tracked_cost_usd: undefined` (omitted from JSON, `—` in the report
table), never a predicted number silently relabeled as tracked spend. Cost
prediction itself is unaffected by this distinction and remains available via
the existing `cost_usd` field wherever it was already surfaced.

### 9.5 Suite Report & Budget Flag

In eval mode the runner writes `eval-report.json` to the output directory with the run verdict,
the aggregate score, and — when a `--max-cost-usd` cap stopped scheduling (§3.1) —
`"budget_stopped": true`:

```json
{
  "threshold": 0.5,
  "runVerdict": { "allPassed": true, "infraError": false, "scenarios": [] },
  "aggregateScore": 0.82,
  "budgetStopped": true,
  "timestamp": "2026-06-09T12:00:00.000Z"
}
```

A budget stop is a scheduling decision, not a failure: `budget_stopped` is a fact about the run,
and the scenarios that did run are scored and judged normally.

### 9.6 Failure Classes

Every eval run records **why it failed**. `failure_classes` is the run's failure taxonomy: the
distinct anomaly event types found in the run's journal trace — with **recovered** findings
excluded (a failure that was later succeeded on the same target is not a lasting failure mode) —
plus the eval-only `execution-alignment` class.

`execution-alignment` means "plausible work, failed verification": the delegate's work was
accepted/reconciled (`session.delegate.reconciled` appears in the run's trace) but the outcome
score came in below the pass threshold. The agent did something — just not the right thing. A
reconciled run that passed is not flagged.

No new detector was built — the classes come from the existing anomaly projection over the
run's trace. Read the taxonomy with `exactl eval report --view failures` (§3.4).

---

## 10. Comparing Runs

Compare two evaluation runs to see per-step score deltas:

```bash
# Get run IDs from history
exactl eval history --last 5 --format json

# Compare two runs
exactl eval compare --run-a aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa \
                     --run-b bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb
```

Example output:

```text
Comparing run A (aaaa...) vs run B (bbbb...):
  Score delta: +0.15
  Run A: scenario=workspace-health-smoke, score=0.80
  Run B: scenario=workspace-health-smoke, score=0.95

Steps comparison:
  step-1: 1.00 → 1.00 (+0.00)
  step-2: 0.50 → 0.85 (+0.35)
  step-3: 1.00 → 1.00 (+0.00)
```

---

## 11. CI Integration

### 11.1 Pre-merge Gate

```bash
#!/bin/bash
# Fail the build if any scenario scores below 0.8
exactl eval run --tag smoke --score-threshold 0.8
if [ $? -ne 0 ]; then
  echo "Evaluation failed: one or more scenarios below threshold"
  exit 1
fi
```

### 11.2 Sandbox Deploy + Full Evaluation (CI Job)

For packs that require a running daemon and mounted portal (`agent_flows`,
`integration_e2e`, `dynamic_execution`, etc.), deploy a sandbox first:

```bash
#!/bin/bash
# CI job: deploy sandbox → run all non-live packs with eval scoring

export EXAIX_VALIDATION_ROOT="$HOME/exa-validation-sandbox"

# Deploy sandbox (mock provider — no API keys needed)
deno run -A scripts/setup_sandbox.ts \
  --dir "$EXAIX_VALIDATION_ROOT" \
  --provider "mock" \
  --model "test"

export PATH="$EXAIX_VALIDATION_ROOT/bin:$PATH"
export EXA_CONFIG_PATH="$EXAIX_VALIDATION_ROOT/workspace/exa.config.toml"

# Start daemon
exactl daemon start

# Mount portal (Exaix dev repo for flow fixtures)
exactl portal add "$PWD" portal-exaix
exactl daemon stop && exactl daemon start

# Run evaluation with scoring
exactl eval run --pack agent_flows \
  --pack dynamic_execution \
  --pack framework_test \
  --pack integration_e2e \
  --pack mcp_tools_extended \
  --pack smoke \
  --pack triggers-basic \
  --score-threshold 0.5 \
  --trials 1
```

For the full sandbox setup reference, see
`tests/scenario_framework/README.md` §2 (Validation).

> **Sandbox location.** The CI job above deploys a sandbox at an explicit path
> (`EXAIX_VALIDATION_ROOT`). When you instead run scenarios through the framework runner without
> passing `--workspace`, the runner creates an **isolated sandbox per run** at a **sibling of the
> repo** by default — `<parent-of-repo>/exaix-sandboxes/<run-id>/` — never inside the repo tree (so it
> can't leak `.exa/journal.db` or `logs/` into your working copy). Override the base directory with
> **`EXA_SANDBOX_BASE`**. Locate run sandboxes with `tests/scenario_framework/bin/sandbox` and inspect
> a failed run's journal with `tests/scenario_framework/bin/journal` (see README §2.4 and §6).

### 11.3 Nightly Regression

```bash
#!/bin/bash
# Run full core suite with history
exactl eval run --profile ci-core --score-threshold 0.6 --trials 3

# Archive history
cp -r tests/scenario_framework/output/history/ archive/$(date +%Y-%m-%d)/
```

### 11.4 Trend Detection

```bash
#!/bin/bash
# Compare last two smoke runs for regression detection
LAST_TWO=$(exactl eval history --pack smoke --last 2 --format json | \
  jq -r '.[].run_id' | tr '\n' ' ')
RUN_A=$(echo $LAST_TWO | cut -d' ' -f2)
RUN_B=$(echo $LAST_TWO | cut -d' ' -f1)

exactl eval compare --run-a $RUN_A --run-b $RUN_B | grep "delta"
```

---

## 12. Subsystem Evaluation

Packs are organised by _which subsystem they measure_, not only by which directory they live in. A
scenario carries a `subsystem:` tag, and the six subsystems together are the coverage contract: if a
subsystem has no green scenario, nothing in this framework is measuring it.

| Subsystem tag          | What it measures                                       | Edition |
| ---------------------- | ------------------------------------------------------ | ------- |
| `subsystem:tools`      | MCP tool round-trips through the real server           | all     |
| `subsystem:mcp-server` | the external-client contract over stdio                | Team    |
| `subsystem:mcp-client` | dynamic-step execution and tool selection              | all     |
| `subsystem:identities` | identity resolution and its effect on the written plan | all     |
| `subsystem:skills`     | skill matching, pinning and injection into the prompt  | all     |
| `subsystem:flows`      | flow blueprints end to end, request through plan       | all     |

A second axis, `entity:<name>`, narrows to one tool, identity, skill or flow — that is what
`eval report --group-by entity` aggregates.

### Cadence tiers

| Tier            | Command                          | Selects                                                        |
| --------------- | -------------------------------- | -------------------------------------------------------------- |
| **ci-smoke**    | `--profile ci-smoke`             | `smoke`-tagged scenarios                                       |
| **ci-core**     | `deno task eval:subsystems:core` | the `smoke` subset — one or more representatives per subsystem |
| **ci-core**     | `deno task test:parity`          | the catalog/flow/identity/skill/tool parity gates              |
| **ci-extended** | `deno task eval:subsystems`      | every mock-tier scenario across all six subsystems             |
| **nightly**     | see below                        | the `provider-live` tier, against a real model                 |

> **These tasks are run by hand.** None is attached to a GitHub Actions job, to `scripts/ci.ts`, or
> to the pre-commit gates. Wiring a tier into CI is a separate, deliberate decision — `eval:subsystems`
> spawns daemons across ~70 scenarios, and the nightly tier spends provider budget.

Selection is CI-safe by default: an explicit `--tag` or `--pack` drops `provider-live` and
non-`auto` scenarios, because they cannot pass without a real model and would otherwise depress
every baseline. Asking for an excluded tag turns that filter off — which is how the nightly tier is
selected — and an excluded tag never widens the selection into other packs.

### Reading a subsystem report

```bash
exactl eval report --group-by subsystem
```

```text
Name                    Tasks  Passed   Mean    Delta    Pass@1
subsystem:flows         21     21/21    —       +0.000   1.000
subsystem:identities    15     15/15    —       —        1.000
```

Two columns deserve care:

- **`Mean` shows `—` for contract packs.** Most subsystem scenarios ask yes/no questions: the pinned
  skill reached the prompt or it did not. A mean over binary assertions is the pass rate wearing
  three decimal places, and reading a drop from 1.000 to 0.971 as "97% healthy" is how a dead
  feature once looked fine. A mean appears only when some score falls strictly between 0 and 1 —
  that is, when the criteria are genuinely graded, as with an LLM judge.
- **`Delta` shows `—` on a first observation**, not `+0.000`. "No comparison" and "no change" are
  different facts.

### The contributor rule

**Adding a tool, identity, skill or flow requires an eval scenario — or a reasoned parity
exclusion.** The parity gates (`deno task test:parity`) compare each catalog against the scenarios
that reference it and fail on anything uncovered. To exclude something deliberately, add it to
`tests/eval/parity_exclusions.json` with a reason; an unexplained gap is a failure, not a default.

### A green pack means something only if it is known to go red

Every subsystem declares at least one mutation that must turn its pack red, in
`tests/scenario_framework/runner/pack_mutations.ts`. This exists because packs in this codebase have
repeatedly been unable to fail for the right reason: one sat at mean 0.714 with three "green"
scenarios while asserting nothing at all, and fourteen identity smokes asserted a frontmatter field
that is stamped unconditionally — so every one would have passed with the _wrong_ identity.

`pack_mutation_coverage_test.ts` verifies each mutation's anchor still resolves in its source file,
so a refactor cannot silently retire a pack's only evidence of sensitivity.

Related: setup and teardown steps carry no weight in the suite score. A step-weighted mean over
every step made the score really "the fraction of steps that passed", and most steps are harness
plumbing — a total failure of the mechanism under test still scored 0.800 against a 0.7 gate.

### Recorded fixtures raise mechanics fidelity, not quality

The `flow_blueprints` pack chains step responses — a step's output is the next step's input —
which makes it the one pack where the mock's own regex guesses can be mistaken for a product
defect. Recorded fixtures replace those guesses with replayed real LLM exchanges
(`MockLLMProvider`'s `recorded` strategy), addressed by **call site** (scenario id, step id, call
index) rather than by
matching the prompt's content — so an edited system prompt reports as drift on the affected
fixtures instead of invalidating the whole set. See
[`tests/scenario_framework/README.md` § "Recorded Mock Fixtures"](../tests/scenario_framework/README.md#recorded-mock-fixtures-phase-157)
for how to capture, replay, and refresh them.

**A replayed response is identical whether or not an artefact helped.** Capturing and replaying a
fixture raises the pack's _mechanics_ fidelity — the pipeline runs on a real model's response
shapes instead of a regex's guess of what one looks like — and says **nothing** about whether a
skill, blueprint change, or prompt edit made the response _better_. A green `flow_blueprints` run
on recorded fixtures means the real model's shapes flow through the pipeline correctly; it does
not mean, and was never designed to mean, that any particular artefact improved the outcome.
Whether an artefact helps is a provider-live question — value evaluation runs against a real model
every time, in every arm, which recorded fixtures structurally cannot substitute for.

Only `flow_blueprints` uses fixtures. `identity_eval` and `skill_eval` assert against frontmatter
fields and journal payloads — what the daemon _did_ with a request, not what the model _said_ —
so they do not depend on response content and gain nothing from replaying real exchanges; the
mock's pattern-dispatch fallback is sufficient and unaffected by the fixture-replay wiring above.

---

## 13. Extending the Framework

See `tests/scenario_framework/README.md` for architectural documentation,
schema contracts, extension patterns, and validation sandbox setup.

---

## 14. swe_tasks Benchmark Pack

The `swe_tasks` pack (`tests/scenario_framework/scenarios/swe_tasks/`) is a
repeatable benchmark of typical software engineering tasks organized by
family (defect, constructive, behaviour-preserving, judgment) against the
`todo_app` fixture portal.

### Task Corpus (21 scenarios)

| Family        | Tasks | Example                                                                                |
| ------------- | ----- | -------------------------------------------------------------------------------------- |
| Bug-fix       | 4     | fix-bug-null-guard, async-ordering-bug, injection-sanitisation, path-traversal-storage |
| Feature       | 4     | add-feature-endpoint, add-search-feature, add-batch-operations                         |
| Refactor      | 4     | extract-sort-utility, rename-priority-type, rename-done-to-completed                   |
| Test          | 4     | write-tests-uncovered, write-coverage-for-priority, write-regression-test-for-summary  |
| Comprehension | 2     | explain-request-flow, map-dependencies                                                 |
| Documentation | 2     | write-api-readme, docstring-storage-module                                             |

Each task has a `task.json` (metadata + base_ref), `TASK.md` (brief),
`reference.patch` (reference solution), and scenario YAML.

### Scoring Channels

- **Plan quality** (weighted): plan produced (`file-found`), review approved
  (`command-output-contains`), execution completed (`file-found` archive)
- **Functional correctness** (0.3): `command-exit-code` on `deno test`
- **Security** (0.2): no dynamic tool calls (`sqlite3 COUNT(*)`)
- **Output quality** (0.4): LLM-as-judge (`GOAL_ALIGNED_REVIEW` preset)

Suite score = weighted mean of all steps. Unexecuted steps score 0 rather than
being excluded from the mean.

**The corpus runs gated.** Every `swe_tasks` scenario declares `scoring: "gated"` (§4.5) and
tags its security checks — `no-dynamic-tool-calls`, `plan-approved`, `review-approved` — as
`class: "security"`. A run where the agent escaped the sandbox or skipped approval scores 0
for the whole task, not a slightly-reduced weighted mean. Recorded baselines from before this
predate gating; history labels each run's mode (`scoring_mode`) so the two are never compared
as if they were the same measurement.

**The comparison views apply here.** Running a task on a bare-delegate cell (raw CLI, no Exaix)
and on the ablation cells (one subsystem off) feeds `--view lift` and `--view ablation`, the
per-cell `--view frontier` turns the corpus's tracked cost into the accuracy-vs-cost readout, and
`--view failures` answers why runs fail per family and cell (§3.4).

### Running

```bash
# CLI-delegate on opencode Go tier (no API key required)
exactl eval run --scenario scenarios/swe_tasks/fix-bug-null-guard.yaml \
  --cell opencode --eval-mode --score-threshold 0.3

# All swe_tasks scenarios via catalog
exactl eval run --pack swe-tasks --cell opencode --eval-mode

# View family-level report
exactl eval report --pack swe-tasks --format table

# Compare providers
exactl eval report --pack swe-tasks --cell opencode --cell claude-code
```

### Configuration

Cells are configured in `configs/eval-cells.toml`. The opencode Go tier
(`opencode-go/deepseek-v4-flash`) is the default opencode cell. The claude-code
cell requires the `claude` CLI binary on PATH.

### Extending

Add a new task:

1. Create `tests/scenario_framework/fixtures/swe_tasks/<task-id>/` with
   `task.json`, `TASK.md`, `reference.patch`
2. Create the request fixture in `fixtures/requests/swe_tasks/`
3. Generate the scenario YAML via `renderSweTaskTemplate`
4. Validate with `deno test tests/scenario_framework/tests/unit/task_contract_schema_test.ts`

See `tests/scenario_framework/AUTHORING.md` for the full authoring workflow.

---

## 15. Artefact Value Evaluation

Every pack described above — `identity_eval`, `skill_eval`, `flow_blueprints`, and §14's
`swe_tasks` on its own — answers "does the artefact reach the run and execute?" None of them
answers "does the artefact make the outcome better?" A skill whose instructions actively degrade
the model's output still passes `skill_eval` as long as it is injected; a flow that produces a
worse plan than no flow at all still passes `flow_blueprints` as long as it writes its files. The
value tier exists to close that gap, by running the same task twice — once with an artefact,
once without — and reporting the difference.

### What this tier answers, and what it costs

|          | Mechanics packs (§12, `identity_eval`/`skill_eval`/`flow_blueprints`) | Value tier (this section)                                            |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Question | Does the artefact reach the run and execute?                          | Does the artefact improve the outcome?                               |
| Tier     | Mock — canned responses chosen by prompt regex                        | Provider-live                                                        |
| Verdict  | Pass/fail per scenario                                                | A paired delta, with its variance and its token cost                 |
| Cost     | Seconds, every PR                                                     | Model spend, deliberately scheduled                                  |
| Catches  | The pinned skill never arrived; the flow was never loadable           | The artefact is injected correctly and still makes the outcome worse |

**A green mechanics pack is a precondition for a value result, not a substitute for one.** Before
the mock tier's own scoring fix landed, every pinned skill was silently dropped before reaching
the daemon — an ablation run over that window would have measured Δ = 0 for every skill, and the
honest-looking reading would have been "skills do not work, delete the subsystem." The validity
gate below exists so that a value result can never be published without a same-commit mechanics
result standing behind it.

### Arms: how a run varies without editing the catalog

An **arm** is a named configuration delta applied to one scenario run — never a change to
`Blueprints/` on disk, since an arm that rewrites the catalog cannot run concurrently with its own
control and corrupts the working tree on failure.

| Arm kind          | Control                          | Treatment                                   | Mechanism                                                                                            |
| ----------------- | -------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `skill-ablation`  | resolved skill set minus skill S | resolved set as normal                      | `EXA_EVAL_SUPPRESS_SKILLS` (comma-separated skill ids), read inside `AgentRunner`'s skill resolution |
| `skill-version`   | skill S at version _a_           | skill S at version _b_                      | `EXA_EVAL_SKILL_OVERLAY_DIR`, a directory shadowing `Memory/Skills/` for the run                     |
| `identity-swap`   | identity A handles the request   | identity B handles the request              | request frontmatter `identity:`, one value per arm                                                   |
| `identity-config` | identity A as shipped            | identity A with a modified `default_skills` | `EXA_EVAL_IDENTITY_OVERLAY_DIR`, a directory shadowing `Blueprints/Identities/` for the run          |
| `flow-ablation`   | request executed without a flow  | request executed under flow F               | request frontmatter `flow:`, present or absent                                                       |
| `flow-swap`       | flow F                           | flow G                                      | request frontmatter `flow:`, one value per arm                                                       |

Every overlay directory is validated through `PathResolver` before it is prepended to a search
path, and both `Blueprints/` and the generated `Memory/Skills/` tree are asserted byte-identical
after a run — an arm that leaves a mark on the catalog it reads from is a bug, not a side effect.
See `tests/scenario_framework/README.md` for the authoring walkthrough and the exact commands.

### Pre-registration, pairing, and the no-effect rule

Before any trial runs, an arm comparison is declared — arm id, kind, control/treatment config, the
task set, the trial count, and which single metric will be scored — and persisted in the run
manifest. Requesting a metric or a task outside that declaration is rejected, not silently scored;
this is what stops a task set or a metric from being picked after the results are already in,
which is the most likely way this tier would otherwise produce confident nonsense.

Both arms run the **same tasks**, with the **same trial count**, under the **same judge**. Per
task, the delta is `treatment.mean − control.mean`; those per-task deltas are then aggregated into
a mean, a population standard deviation, and a count of tasks whose delta sign disagrees with the
aggregate's.

**A delta smaller than the trial-level standard deviation is reported as no effect, not as a small
effect**, and this is enforced by the harness (`computePairedComparison`'s `noEffect` field) —
never left for a reader to eyeball off a report. Two real deltas from the same 2026-08-04 run make
the distinction concrete:

| Skill               | Mean Δ | Stdev Δ                   | Verdict                                          |
| ------------------- | ------ | ------------------------- | ------------------------------------------------ |
| `response-contract` | +0.557 | (n=3, sign-consistent)    | a real effect — kept                             |
| `exaix-conventions` | −0.006 | larger than abs(Δ) at n=1 | no effect — kept anyway, without a quality claim |

The second row is not "a slightly negative skill." It is a skill whose measured effect cannot be
told apart from run-to-run noise on that cell, and the report says so plainly rather than implying
precision the sample size doesn't support.

### Reading a report: deltas, never absolute scores

The value tier never publishes an absolute score for an artefact — only the paired delta. An
absolute number invites comparing two tasks of different difficulty as if a shared scale meant the
same thing on both, and the paired delta is the only quantity that is actually stable across the
corpus. `value-per-1k-tokens` (`deltaScore / (deltaPromptTokens / 1000)`) turns the delta into a
cost-adjusted number: a skill that adds +0.02 quality for +3000 prompt tokens is a worse trade than
one that adds +0.02 for free, and a report that only showed the raw delta would rank them the
same. A zero-token-cost positive delta is a free win and ranks above every finite value (`+∞`,
never a large finite number, so it can never lose a ranking to a merely-large one).

### The validity gate and the placebo arm

A value result is inadmissible unless the artefact's mechanics scenario (§12) is **green at
the same commit** — `evaluateValidityGate`/`assertValidityGate` check the binding and reject the
run otherwise, with the reason recorded alongside the (withheld) result. Every value run also
carries a **placebo arm**: a deliberately harmful artefact (e.g. a skill that forbids the plan
contract it's supposed to help satisfy), which must produce a detectable negative delta
(`assertPlaceboDetected`). This is not a one-time design proof — it runs **every time**, so a
value run demonstrates the pipeline can detect an effect on the day it actually ran, not merely
that it once could.

### Reproducing a report from real data

Every function this section describes — `computePairedComparison`, `computeValuePerToken`,
`evaluateValidityGate`, `assertValidityGate`, `assertPlaceboDetected`, plus the
skill/identity/flow reporting layer (`computeSkillReachability`, `planFullTrials`,
`buildSkillValueReport`, `assertSkillDecisionsRecorded`, `groupDeltasByTaskType`,
`interpretPruneVerdict`, `computeFlowReachability`, `buildFlowValueReport`) and judge
calibration (`computeJudgeCalibration`) — is real, reusable computation, not a one-off. A
2026-08-04 post-implementation review found all of them had zero production call-sites: six
Reachability Ledger rows in this phase's plan doc had been marked closed on narrative evidence
alone, meaning the published live-run numbers were never actually run through the code built to
compute them.

`scripts/run_value_comparison_report.ts` is the fix: an operator-run CLI (same class as
`scripts/check_artefact_decision_coverage.ts` above — not wired into CI) that reads a JSON file
and calls every one of these functions for real:

```bash
deno run -A scripts/run_value_comparison_report.ts scripts/run_value_comparison_report.example.json
```

**The input schema is deliberately generic — it names no artefact.** A section for arm
comparisons, one for validity gates, one for placebo arms, and one each for skill/identity/flow
reporting and judge calibration; whichever a real live run collects flows straight through. This
was a considered design choice, not an oversight: the first draft of the fix proposed transcribing
phase-158's own historical numbers into a checked-in fixture to "reproduce" them — but those
numbers are unclean, retry-heavy measurements (a free tier that ran out mid-screening, a judge
provider that silently fell back to a timing-out default, single-trial screening), and encoding
them as a permanent fixture would have laundered that noise into something that reads as validated
ground truth. The tool's own test suite and its committed example input use only clearly-synthetic,
illustrative numbers — proof that the code is reachable, not a claim about any specific historical
run. Reachability and trustworthiness are different questions; this tool answers only the first
one, on purpose.

### Every artefact needs a decision, or a reason it has none yet

`assertArtefactDecisionCoverage` (`tests/scenario_framework/runner/artefact_decision_coverage.ts`)
requires every artefact in the real `Blueprints/` catalog to carry either a recorded decision
(`keep` / `revise` / `remove`, each with a non-empty rationale) or a stated non-coverage reason.
Run it against the live catalog with:

```bash
deno run -A scripts/check_artefact_decision_coverage.ts
```

**A flow decision carries one extra rule the other two artefact kinds do not.** A flow cannot be
recorded `keep`/`revise`/`remove` unless its measurement is flagged `cleanMeasurement: true` — a
flow-ablation result confounded by something other than the flow itself (see the next section)
can only ever back an `awaiting-remeasurement` status, never a verdict.

**Contributor rule:** a new identity, skill, or flow ships with either a value result or a stated
reason it cannot be measured yet (see the "Contributor rule: value evidence" section in each of
`Blueprints/Skills/README.md`, `Blueprints/Identities/README.md`, `Blueprints/Flows/README.md`).

### A worked example of a confounded result: `feature-development`

The one flow-ablation result this tier has produced compared flow-orchestrated execution
(suite 0.750) against direct execution (suite 0.996) on the same task. Read at face value, that
looks like a flow-quality finding. It is not, and the reason is instructive: at the time the arm
ran, a flow step had no way to request the `cli_delegate` execution strategy the direct-execution
control used — it fell back to a ReAct loop instead. The comparison therefore varied **two axes at
once** (flow orchestration _and_ execution strategy), not one, so the delta cannot be attributed to
flow orchestration alone. It is recorded `awaiting-remeasurement`, not `keep`/`revise`/`remove`,
pending a controlled re-run once flow steps can opt into `strategy: "cli_delegate"` — see
`exaix-dev-docs/planning/phase-159-flow-step-execution-strategy.md`. The lesson generalizes: an
arm that appears to isolate one variable can still be confounded by something the comparison
didn't hold fixed, and the honest response is to withhold the verdict, not round it off.

### Where results live

Live-run records — the actual arm results, per-skill/identity/flow decisions, and founding
baselines for trend comparison — are recorded directly in
`exaix-dev-docs/planning/phase-158-artefact-value-evaluation.md`, dated per run. This tier is
provider-live and deliberately scheduled (never a CI gate, never a pre-commit hook); running a
screening pass or a full-trial arm is an operator action, the same class as §12's fixture capture.

---

## 16. Harness-Lift & Cost Evaluation (Phase 143)

This section ties together the comparison machinery built across the phase: measuring **what
Exaix adds over running the raw CLI tool directly**, **what each subsystem contributes**, **at
what cost**, and **why runs fail**. The four report views (§3.4), gated scoring (§4.5), and the
budget cap (§3.1/§9.5) are the tools; this section is the methodology.

### The cell taxonomy

A "cell" is one configuration of the harness running one task. The comparison views pair cells
that differ in exactly one thing:

| Cell kind                          | `cell_id`                              | What differs from the Exaix cell                      |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Exaix cell                         | `<tool>-<provider>`                    | — (the baseline configuration)                        |
| **Bare-delegate cell** (§3.4 lift) | `bare/<tool>/<provider>`               | No Exaix at all — the raw CLI runs the same task      |
| **Ablation cells** (§3.4 ablation) | `ablate-<subsystem>/<tool>/<provider>` | Exactly one subsystem toggled off via a config preset |

The three ablation presets (`configs/eval-ablate-skills.toml`,
`eval-ablate-quality-gate.toml`, `eval-ablate-portal-knowledge.toml`) are byte-identical except
their one toggle each, so a contribution delta is attributable to exactly one subsystem. The
memory-injection toggle does not exist in config (it is constructor-gated), so the ablation set
ships with **three** factors, not four.

### Metric semantics

- **Outcome-channel only for lift.** A bare cell has no daemon and no process channel, so the
  lift comparison scores both sides on the **outcome channel alone** (the verify-tests check) —
  process-criteria that only an Exaix run could satisfy are excluded from both sides. A delta
  over fewer than a handful of tasks is reported with its `noEffect` verdict, never presented as
  a confident number.
- **Single-factor ablation.** Each ablation flips one toggle; a contribution is
  `mean(full-config) − mean(ablate)`. If an arm varies more than one thing, its delta is
  confounded and is withheld, not rounded off.
- **Gated scoring** (§4.5) applies to the corpus: a `class: security` failure zeroes the task.
- **Cost is tracked, not predicted** (§9.4); the frontier (§3.4) marks Pareto-dominant cells.

### Running the grid

The full harness-value grid runs the `swe_tasks` corpus across every cell kind on one provider,
budget-capped, with gating on:

```bash
# The five cell kinds, one provider, within a spend bound
exactl eval run --pack swe_tasks --cell <tool> --max-cost-usd 2.0 --eval-mode \
  --score-threshold 0.5          # Exaix cell
# ... plus the bare cell and the three ablation cells (bare/ablate variants), then:
exactl eval report --view lift --pack swe_tasks
exactl eval report --view ablation --pack swe_tasks
exactl eval report --view frontier --pack swe_tasks
exactl eval report --view failures --pack swe_tasks
```

The grid mechanics are guarded in CI token-free by `harness_grid_pipeline_test.ts` (scripted
delegates, synthetic history). The live grid run and its founding tables are operator-triggered
and provider-live — never a CI gate.

### What the numbers mean — and what they don't

A harness-lift number is **per-provider, per-corpus, per-date**. It answers "on this task set,
with this model, this day, did the Exaix harness beat the raw CLI — and by how much (or was the
difference noise)?" It is **not** a context-free "Exaix adds N points" claim that survives being
lifted onto a different corpus, provider, or week. The same discipline applies to feature
contributions and the frontier: read each number with its basis (cells, run ids, task count)
and its `noEffect` verdict, and treat a lift near zero or negative as a real finding — the
corpus may simply ceiling near 1.0 for capable models.
