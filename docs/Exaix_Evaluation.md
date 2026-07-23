# Exaix Evaluation Guide

- **Version:** 1.0.0
- **Date:** 2026-06-09

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
| `-v, --verbose`          | Show detailed output                         |

**Examples:**

```bash
# Run a single scenario
exactl eval run --scenario workspace-health-smoke

# Run all scenarios in a pack with high threshold
exactl eval run --pack agent_flows --score-threshold 0.8

# Run by tag with multi-trial
exactl eval run --tag eval --trials 3 --score-threshold 0.6

# Run multiple packs
exactl eval run --pack smoke --pack framework_test
```

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

Render a cross-cell timing/token/tracked-cost comparison table, grouped by
`cell_id`/`provider`/`model`. `--view cost` is the only view in this phase.

**Usage:**

```bash
exactl eval report --view cost [--scenario <id>] [--last <n>]
```

**Example:**

```bash
exactl eval report --view cost --scenario fix-bug-null-guard-cli-all
```

Output shows, per cell, mean wall-clock `duration_ms`, mean LLM-call
`llm_duration_ms`, total prompt/completion tokens, and total/mean
**tracked** cost (`tracked_cost_usd`) — see §9.4 for what "tracked" means. A
cell whose every run had no tracked cost (e.g. a pure direct-API cell, which
only ever produces a _predicted_ cost estimate) renders `—` for cost columns,
never `0` and never a predicted figure relabeled as tracked.

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

## 12. Extending the Framework

See `tests/scenario_framework/README.md` for architectural documentation,
schema contracts, extension patterns, and validation sandbox setup.

---

## 13. swe_tasks Benchmark Pack

The `swe_tasks` pack (`tests/scenario_framework/scenarios/swe_tasks/`) is a
repeatable benchmark of typical software tasks (fix-bug, add-feature,
refactor, write-tests) against the `todo_app` fixture portal. It exercises
all three criterion families: deterministic weighted criteria
(`command-exit-code`, `file-found`), trajectory-assert on expected tool
sequences, and LLM-as-judge (`preset: GOAL_ALIGNED_REVIEW`).

Each scenario has two variants:

- **Provider-live** (e.g. `fix-bug-null-guard.yaml`): runs through the
  configured `IModelProvider` (e.g. Anthropic) for both request analysis
  and execution — requires `ANTHROPIC_API_KEY`.
- **CLI-delegate** (e.g. `fix-bug-null-guard-cli-all.yaml`): runs entirely
  through a headless `claude`/`opencode` CLI subprocess via
  `CliDelegateStrategy`, authenticated against a flat-rate subscription.
  Zero API key needed. Use `--cell claude-code` or `--cell opencode` to
  select the tool explicitly.

```bash
# CLI-delegate path (cost-preferred, no API key)
exactl eval run --scenario scenarios/swe_tasks/fix-bug-null-guard-cli-all.yaml \
  --cell claude-code --eval-mode --score-threshold 0.6

# Direct-API path (metered, requires ANTHROPIC_API_KEY)
exactl eval run --scenario scenarios/swe_tasks/fix-bug-null-guard.yaml \
  --eval-mode --score-threshold 0.6
```

See `tests/scenario_framework/README.md` §Headless CLI execution for
`--cell` selection and config setup.
