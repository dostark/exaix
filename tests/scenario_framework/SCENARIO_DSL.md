# Scenario DSL — Structure, Step Types & Criteria Reference

> The declarative authoring language of the Exaix Scenario Framework. Scenarios live under
> `tests/scenario_framework/scenarios/<pack>/<scenario-id>.yaml`, are validated by the Zod
> schemas in `tests/scenario_framework/schema/`, and are executed by the runner in
> `tests/scenario_framework/runner/`. This document is the complete tutorial + reference.
>
> Companion docs: [`README.md`](./README.md) (framework roles & sandboxing),
> [`AUTHORING.md`](./AUTHORING.md) (swe_tasks benchmark task authoring),
> [`docs/Exaix_Evaluation.md`](../../docs/Exaix_Evaluation.md) (eval workflow, scoring,
> `exactl eval` CLI).

---

## 1. Overview

A scenario is a YAML file describing **one evaluation or validation run**: a sequence of
steps against a workspace, each producing typed evidence that is scored against declared
**criteria**. Scenarios are fully declarative — no shell logic lives in the YAML; every
operation is a typed step the framework understands.

The DSL has three layers:

1. **Scenario header** — who/what/when + how it runs (packs, modes, portals, matrix).
2. **Steps** — the ordered actions (`exactl`, `wait-for-file`, `write-file`, `journal-assert`,
   `judge`, …).
3. **Criteria** — the assertions (`input_criteria` before a step, `output_criteria` after)
   that decide pass/fail and produce the step score.

This document is the **language reference**. For how to run scenarios, the scoring model, and
the `exactl eval` CLI, see the [`README.md`](./README.md) quick reference and
[`docs/Exaix_Evaluation.md`](../../docs/Exaix_Evaluation.md).

Validation happens at load time. A scenario that violates the schema (unknown field, a
step missing a required field, a `shell` step, …) is rejected before any step executes.

---

## 2. Scenario Structure (Top-Level Fields)

```yaml
schema_version: "1.0.0"
id: "my-scenario" # required, unique within the pack
title: "My Scenario title" # required, human-readable
pack: "my_pack" # required, directory under scenarios/
tags: ["smoke", "subsystem:my-area"] # required; smoke / provider-live / manual-only / subsystem:*
request_fixture: "fixtures/requests/my_pack/my.md" # required, framework-relative
mode_support: ["auto"] # required: auto | step | manual-checkpoint
portals: [] # required; portal mounts (see §2.1)
steps: [...] # required; the ordered step list (see §4)

# --- optional header fields ---
flow_fixture: "fixtures/flows/my_pack/my.flow.yaml" # staged into Blueprints/Flows/<id>.flow.yaml
matrix: { cells: [...] } # expand into one run per cell (see §3)
scoring: "gated" # opt-in: zero the suite when a class:security criterion fails
edition: "team" # solo | team | enterprise — filters by EXAIX_EDITION
description: "Why this scenario exists"
risk: "What could go wrong / what it guards"
ci_profile: "ci-core"
cleanup: ["Workspace/Requests"] # workspace-relative paths removed after the run
expected_artifacts: ["**/*_plan.md"] # globs the run must produce
metadata: { owner: "team-x", created_at: "2026-08-06T00:00:00Z" }
```

**Schema invariants** (enforced at load):

- `id` must be unique within a file; portal `alias` values must be unique.
- `mode_support` must include at least one of `auto` / `step` / `manual-checkpoint`.
- `scoring: gated` zeroes the whole suite if any `class: security` criterion fails
  (Harness-Bench security semantics) — absent means additive, byte-identical to pre-gating.

### 2.1 Portals

Portals mount a source repository (or fixture) into the workspace so steps operate on real
code. `source_path` is framework-relative; `target_path` is workspace-relative.

```yaml
portals:
  - alias: "todo-app" # referenced by steps / criteria
    source_path: "$FRAMEWORK_HOME/fixtures/portals/todo_app"
    target_path: "$WORKSPACE_ROOT/todo-app" # clean-staged copy (never shared state)
    git_init: true # init a repo with an initial commit
```

With `target_path`, the runner **clean-stages** the fixture (removes any prior target, stale
worktrees, stale symlinks) and copies — so an evaluated repo can never leak a previous
scenario's/cell's changes. `source_path` alone mounts the path directly.

### 2.2 Matrix Cells

A `matrix` block expands a scenario into one run per cell. Each cell can pick a different
tool, provider, config, and binary. Cells set `$CELL_PROVIDER` / `$CELL_MODEL` (see §3).

```yaml
matrix:
  cells:
    - tool: "claude-code"
      provider: "$CELL_PROVIDER"
      config: "configs/claude-cli-delegate-all.toml"
      requires_bin: "claude"
    - tool: "opencode"
      provider: "$CELL_PROVIDER"
      config: "configs/opencode-cli-delegate-all.toml"
      requires_bin: "opencode"
```

---

## 3. Runtime Variables & Environment

The runner defines these `$VAR` names for every step (expanded at load time unless noted):

| Variable            | Meaning                                                              | Resolved at |
| ------------------- | -------------------------------------------------------------------- | ----------- |
| `$REQUEST_FIXTURE`  | Absolute path of the scenario's request fixture                      | load        |
| `$FLOW_FIXTURE`     | Absolute path of `flow_fixture` (only when declared)                 | load        |
| `$WORKSPACE_ROOT`   | The sandbox workspace root                                           | load        |
| `$EXA_SYSTEM_ROOT`  | Alias of `$WORKSPACE_ROOT`                                           | load        |
| `$FRAMEWORK_HOME`   | Absolute path of the scenario framework (`tests/scenario_framework`) | load        |
| `$EXA_CONFIG_PATH`  | Workspace `exa.config.toml` path                                     | load        |
| `$CELL_PROVIDER`    | Current matrix cell's provider (per-cell)                            | load        |
| `$CELL_MODEL`       | Current matrix cell's model (per-cell)                               | load        |
| `$WORKTREE`         | Newest execution worktree (as a step `cwd`)                          | execution   |
| `$TRACE_ID`         | Current request's trace (first `request.created` above baseline)     | execution   |
| `$REQUEST_ID`       | `request-<trace[0:8]>` — review/plan approve key                     | execution   |
| `$JOURNAL_BASELINE` | The scenario's journal rowid baseline                                | execution   |

Environment the runner injects into every step subprocess: `REQUEST_FIXTURE`,
`WORKSPACE_ROOT`, `EXA_SYSTEM_ROOT`, `FRAMEWORK_HOME`, `EXA_CONFIG_PATH`,
`EXA_SCENARIO_ID`, `EXA_STEP_ID`, plus the current process env (so `EXA_LLM_PROVIDER`,
`EXA_EVAL_LLM_*`, API keys, … flow through).

**Judge model** (never hardcoded in a scenario — run configuration):

- `EXA_EVAL_LLM_PROVIDER` / `EXA_EVAL_LLM_MODEL` — dedicated judge model (can differ from the
  scenario's own model). Highest precedence.
- `EXA_LLM_PROVIDER` / `EXA_LLM_MODEL` — the scenario's own execution model (fallback).
- `EXA_EVAL_LLM_MOCK` — `pass` (auto-pass self-tests) / `false` (require real endpoint) /
  unset (judge criteria are `SKIPPED`).
- `EXA_EVAL_MODEL_SIZE` — model fallback when only a provider is set.

---

## 4. Steps

Every step is a YAML object with `id` and `type`. Common fields:

| Field                 | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `id`                  | Required; unique within the scenario                                  |
| `type`                | Required; one of the step types in §5                                 |
| `name`                | Human-readable description shown in reports                           |
| `command`             | For `exactl`: the subcommand. For `run-script`/`test-run`: the binary |
| `args`                | Array of string arguments                                             |
| `cwd`                 | Working dir (workspace-relative, or `$WORKTREE`). Default: workspace  |
| `env`                 | Map of env vars for the step's subprocess                             |
| `timeout_sec`         | Step timeout (defaults per step type)                                 |
| `failure_glob`        | `wait-for-file`: a glob that fails the step immediately on match      |
| `input_criteria`      | Pre-execution assertions                                              |
| `output_criteria`     | Post-execution assertions (scored)                                    |
| `step_weight`         | Weight of this step in the suite score (0–1)                          |
| `step_pass_threshold` | Min step score to count the step passed (default 1.0)                 |
| `continue_on_failure` | Keep running later steps even if this one fails (default false)       |
| `expect_failure`      | The step is expected to fail (exit non-zero) and passes if it does    |

**Schema-enforced step rules:**

- `exactl` steps require `command`.
- `manual-review` steps require `instructions`.
- `trajectory-assert` steps require `source_step` and a non-empty `expected_sequence`.
- `llm-judge` criteria require either `preset` or `rubric`.
- A `file-exists` / `file-not-exists` / `text-contains` / `text-matches` criterion without a
  `path` requires the step to declare `file_pattern`.

---

## 5. Step Types

### 5.1 `exactl` — run a native Exaix CLI command

The most common step type. Runs `exactl <command> <args>` against the workspace (no shell).

```yaml
- id: "start-daemon"
  type: "exactl"
  command: "daemon"
  args: ["start"]
  env:
    EXA_LLM_PROVIDER: "mock"
    EXA_CI_MODE: "1"
  output_criteria:
    - id: "daemon-started"
      kind: "command-output-contains"
      contains: ["daemon.started"]
```

Examples: `exactl request --identity <id> --plan-only --file $REQUEST_FIXTURE`,
`exactl review approve $REQUEST_ID`, `exactl journal wait --event daemon.ready --since-rowid $JOURNAL_BASELINE`,
`exactl flow validate <flow-id>`.

### 5.2 `wait-for-file` — poll until a file appears (or timeout)

Glob-matched against the step's `cwd` (default workspace root, so `**` descends into
worktrees). `failure_glob` fails fast when a known-bad outcome (e.g. a rejected plan) means
the file will never appear.

```yaml
- id: "wait-for-plan"
  type: "wait-for-file"
  args: ["**/Plans/*_plan.md"]
  timeout_sec: 180
  failure_glob: "Workspace/Rejected/*_rejected.md"
  output_criteria:
    - id: "plan-produced"
      kind: "file-found"
      path_pattern: "**/Plans/*_plan.md"
```

### 5.3 `file-contains` — wait for + assert file content

Polls until `min_matches` files match the glob(s), then asserts content via
`text-matches` / `text-contains` criteria.

```yaml
- id: "verify-plan-has-steps"
  type: "file-contains"
  file_pattern: "Workspace/Plans/*_plan.md"
  output_criteria:
    - id: "plan-has-execution-steps"
      kind: "text-matches"
      matches: ["## Execution Steps", "## Step 1"]
```

### 5.4 `journal-assert` — declarative activity-journal assertion

The successor to raw SQL journal queries. Filters activity rows and asserts a count, sum, or
payload substring — the framework builds the SQL. `trace_scoped: true` scopes to the current
request's trace (never an earlier scenario's rows in a shared sandbox).

```yaml
# Assert the run made NO dynamic tool calls for this trace
- id: "assert-no-dynamic-tool-calls"
  type: "journal-assert"
  action_type: "dynamic_tool_call"
  trace_scoped: true
  expect_count: 0

# Assert the agent changed at least one file
- id: "assert-files-changed"
  type: "journal-assert"
  action_type: "agent.execution_completed"
  trace_scoped: true
  expect_sum:
    path: "files_changed"
    gt: 0
```

**Filter fields:** `action_type` (exact), `action_types` (IN list), `action_type_prefix`
(e.g. `guardrail.`), `trace_scoped`, `payload_equals` (`[{path, value}]`),
`payload_contains`, `payload_not_contains`, `latest_only`.

**Projection / aggregation:** `project` (`{col: "action_type"|"trace_id"|"rowid"|"payload.<path>"}`)
emits rows for json-query criteria; `sums` (`{col: "<payload path>"}`) emits one aggregate row.

**Assertion contract (one of):** `expect_count` (rows == N), `expect_sum` (`{path, gt}`),
`expect_contains` (latest row's payload contains every substring), or default = ≥1 matching row.

### 5.5 `patch-blueprint` — add capabilities to an identity's blueprint

```yaml
- id: "grant-tool"
  type: "patch-blueprint"
  blueprint: "senior-coder"
  add_capabilities: ["exaix_create_request"]
```

### 5.6 `prepare-evidence` — copy a file for the judge

Copies a cwd-relative `source` to a workspace-relative `target`
(default `llm-judge-input.txt`) so the `llm-judge` criterion can read it.

```yaml
- id: "prepare-evidence"
  type: "prepare-evidence"
  cwd: "todo-app"
  source: "src/api.ts"
  target: "llm-judge-input.txt"
```

### 5.7 `write-file` — write (or append) a file

`$WORKSPACE_ROOT` in `content` is expanded. `append: true` appends instead of overwriting.

```yaml
- id: "create-artifact"
  type: "write-file"
  path: "artifacts/result.txt"
  content: "important data"
```

### 5.8 `remove-files` — delete files

```yaml
- id: "clear-stale"
  type: "remove-files"
  args: ["**/*.tmp"]
```

### 5.9 `run-script` — invoke a framework helper

A semantic wrapper for helper invocations via `deno` (or `exactl`) — never raw shell.
The validator rejects `run-script` with any other binary.

```yaml
- id: "probe-sse"
  type: "run-script"
  command: "deno"
  args: ["run", "-A", "$FRAMEWORK_HOME/scripts/probe_sse_liveness.ts"]
```

### 5.10 `test-run` — run the repo's tests

Runs `deno test` (or the declared command) in the step's `cwd`.

```yaml
- id: "run-tests"
  type: "test-run"
  cwd: "todo-app"
  args: ["test", "src/"]
  output_criteria:
    - id: "tests-pass"
      kind: "command-exit-code"
      equals: 0
```

### 5.11 `judge` — virtual step hosting `llm-judge` criteria

The `judge` step runs no subprocess itself; it carries the `llm-judge` output criteria that
are evaluated by the LLM-as-judge. The judge model comes from env (`EXA_EVAL_LLM_*`), never
from the scenario.

```yaml
- id: "judge-quality"
  type: "judge"
  step_pass_threshold: 0.8
  env:
    EXA_EVAL_LLM_MOCK: "false"
  output_criteria:
    - id: "llm-judge-quality"
      kind: "llm-judge"
      preset: "GOAL_ALIGNED_REVIEW"
      evidence_path: "llm-judge-input.txt"
      context_path: "$REQUEST_FIXTURE"
      score_threshold: 0.5
      score_weight: 0.3
```

### 5.12 `json-assert` — assert a file's JSON shape

Evaluates `json-path-*` / `json-query` criteria against `file_pattern`-matched files.

```yaml
- id: "validate-plan"
  type: "json-assert"
  file_pattern: "**/*_plan.md"
  output_criteria:
    - id: "has-steps"
      kind: "json-path-exists"
      path: "$.steps[0]"
```

### 5.13 `trajectory-assert` — assert the tool call trajectory

Checks the recorded tool-call sequence of a `source_step` against an `expected_sequence`.
`order_matters` (default true) / `allow_extra_tools` / `partial_credit` refine matching.

```yaml
- id: "verify-search-selected"
  type: "trajectory-assert"
  source_step: "submit-request"
  expected_sequence:
    - tool: "search_files"
  order_matters: false
  allow_extra_tools: true
```

### 5.14 `manual-review` — human checkpoint

Requires `instructions`; pauses the run (in `manual-checkpoint` mode) for human sign-off.

```yaml
- id: "review-clarification"
  type: "manual-review"
  checkpoint: "clarification-needed"
  instructions: "Review the clarification prompts and confirm the request stays blocked."
```

### 5.16 Retired / reserved step types

- **`shell`** — forbidden. Every `type: shell` step is a validator violation
  (`deno task check:scenario-declarative`); migrate to typed steps.
- **`wait-for-journal-event`** — retired in favor of
  `exactl journal wait --event <type> --since-rowid $JOURNAL_BASELINE`.
- **`wait-for-status`, `wait-for-json-field`, `frontmatter-assert`, `cleanup`** — reserved
  `ScenarioStepType` enum entries with no scenario usage and no dedicated executor; the
  executor treats them as criteria-only virtual steps. Don't author new scenarios with them.

---

## 6. Criteria

Every criterion has `id` and `kind`, plus optional `score_weight` (0–1, default equal) and
`class: "security"` (gates the suite under `scoring: gated`). Criteria live in a step's
`input_criteria` (checked before execution) or `output_criteria` (after).

### File / content

| kind              | fields                                      | asserts                            |
| ----------------- | ------------------------------------------- | ---------------------------------- |
| `file-exists`     | `path` (or step `file_pattern`)             | the file exists                    |
| `file-not-exists` | `path` (or step `file_pattern`)             | the file does NOT exist            |
| `file-found`      | `path_pattern`                              | at least one file matches the glob |
| `dir-exists`      | `path`                                      | the directory exists               |
| `text-contains`   | `path`, `contains`, `similarity_threshold?` | file text contains the string      |
| `text-matches`    | `path`, `matches: []`, `flags?`             | file text matches every regex      |

### JSON

| kind                   | fields                                                                                             | asserts                       |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| `json-path-exists`     | `path`, `target_file?`                                                                             | the JSON path resolves        |
| `json-path-equals`     | `path`, `equals`, `similarity_threshold?`, `target_file?`                                          | path equals a value           |
| `json-path-equals-any` | `path`, `values: []`, `target_file?`                                                               | path equals one of the values |
| `json-query`           | `query`, `equals?`, `contains?`, `not_empty?`, `min?`, `max?`, `unique_count_min?`, `target_file?` | the JSON query holds          |

### Frontmatter

| kind                       | fields                                                     | asserts                               |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `frontmatter-field-exists` | `field`, `target_file?`                                    | the markdown frontmatter field exists |
| `frontmatter-field-equals` | `field`, `equals`, `similarity_threshold?`, `target_file?` | the field equals a value              |

### Journal

| kind                   | fields                                                                | asserts                                                                      |
| ---------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `journal-event-exists` | `event_type`, `journal_file?`, `payload_absent?`, `payload_includes?` | an activity event of that type exists (optionally with/without payload keys) |

### Command output

| kind                          | fields             | asserts                             |
| ----------------------------- | ------------------ | ----------------------------------- |
| `command-exit-code`           | `equals` (int)     | the subprocess exit code            |
| `command-output-contains`     | `contains: []`     | stdout contains every string        |
| `command-output-not-contains` | `not_contains: []` | stdout contains none of the strings |

### Environment / state

| kind                                             | fields                                      | asserts                     |
| ------------------------------------------------ | ------------------------------------------- | --------------------------- |
| `status-equals`                                  | `equals`                                    | a step status string        |
| `portal-mounted`                                 | `alias`                                     | the portal alias is mounted |
| `env-var-present`                                | `env_var`                                   | the env var is set          |
| `version-equals` / `version-gte` / `version-lte` | `version`, `source` (`binary`\|`workspace`) | a version comparison        |

### LLM judge

| kind        | fields                                                                                                        | asserts                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `llm-judge` | `preset`\|`rubric`, `evidence_path?`, `evidence_diff_path?`, `context_path?`, `score_threshold` (default 0.7) | an LLM grades the evidence against the preset/rubric |

`evidence_path` reads a file (e.g. `llm-judge-input.txt`); `evidence_diff_path` computes the
git diff of a tracked file against its repo's root commit; `context_path` supplies the judge
with the request context (so a `GOAL_ALIGNED_REVIEW` preset can score goal alignment it was
actually shown).

---

## 7. Scoring Model

Criterion scores are continuous 0–1 (LLM-judge reports a fractional score; others derive from
status: `PASSED`=1, else 0); a **step score** is the weighted sum of its criteria
(`score_weight`), a **suite score** the weighted sum of its steps (`step_weight`), and
`scoring: gated` zeroes the suite on any `class: security` criterion failure. The exact
formulas and thresholds live in [`docs/Exaix_Evaluation.md`](../../docs/Exaix_Evaluation.md);
only the DSL knobs are listed here:

| DSL knob                        | Effect                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `score_weight` (criterion)      | weight of a criterion within its step                                                                               |
| `step_weight` (step)            | weight of a step within the suite                                                                                   |
| `step_pass_threshold` (step)    | min step score for the step to count as passed (e.g. on a `judge` step, the judge's fractional score must clear it) |
| `scoring: gated` (header)       | any `class: security` criterion failure zeroes the whole suite                                                      |
| `class: "security"` (criterion) | marks a criterion whose failure gates the suite under `scoring: gated`                                              |

---

## 8. Tutorial — Building a Scenario

Let's author a scenario that mounts the `todo_app` fixture, starts a mock daemon, submits a
plan-only request as the `senior-coder` identity, waits for the plan, asserts its structure,
and has an LLM judge grade it.

**File:** create it as `tests/scenario_framework/scenarios/<pack>/<scenario-id>.yaml` — a new
pack directory `my_pack` and the file `todo-plan.yaml` in it (the `<...>` markers are
placeholders; see §10 for the directory layout):

```yaml
schema_version: "1.0.0"
id: "todo-plan"
title: "Senior Coder produces a structured plan for todo_app"
pack: "my_pack"
tags: ["smoke", "subsystem:planning"]
request_fixture: "fixtures/requests/my_pack/todo.md"
mode_support: ["auto"]
portals:
  - alias: "todo-app"
    source_path: "$FRAMEWORK_HOME/fixtures/portals/todo_app"
    target_path: "$WORKSPACE_ROOT/todo-app"
    git_init: true
steps:
  - id: "start-daemon"
    type: "exactl"
    command: "daemon"
    args: ["start"]
    env:
      EXA_LLM_PROVIDER: "mock"
      EXA_CI_MODE: "1"
    output_criteria:
      - id: "daemon-started"
        kind: "command-output-contains"
        contains: ["daemon.started"]

  - id: "wait-for-daemon-ready"
    type: "exactl"
    command: "journal"
    args: ["wait", "--event", "daemon.ready", "--since-rowid", "$JOURNAL_BASELINE", "--timeout", "30"]

  - id: "submit-request"
    type: "exactl"
    command: "request"
    args: ["--identity", "senior-coder", "--plan-only", "--file", "$REQUEST_FIXTURE"]
    output_criteria:
      - id: "request-submitted"
        kind: "command-exit-code"
        equals: 0

  - id: "wait-for-plan"
    type: "wait-for-file"
    args: ["**/Plans/*_plan.md"]
    timeout_sec: 120
    output_criteria:
      - id: "plan-produced"
        kind: "file-found"
        path_pattern: "**/Plans/*_plan.md"

  - id: "verify-plan-structure"
    type: "file-contains"
    file_pattern: "Workspace/Plans/*_plan.md"
    output_criteria:
      - id: "plan-has-steps"
        kind: "text-matches"
        matches: ["## Execution Steps", "## Step 1"]

  - id: "judge-quality"
    type: "judge"
    env:
      EXA_EVAL_LLM_MOCK: "false"
    output_criteria:
      - id: "llm-judge-quality"
        kind: "llm-judge"
        preset: "GOAL_ALIGNED_REVIEW"
        evidence_path: "llm-judge-input.txt"
        context_path: "$REQUEST_FIXTURE"
        score_threshold: 0.7

  - id: "stop-daemon"
    type: "exactl"
    command: "daemon"
    args: ["stop"]
    output_criteria:
      - id: "daemon-stopped"
        kind: "command-exit-code"
        equals: 0
```

**Run it** (see the README quick reference for the runner CLI; the judge model is set purely by
env, see §3):

```bash
# Mock provider (structural criteria only; judge criteria SKIPPED unless EXA_EVAL_LLM_MOCK=pass)
EXA_EVAL_LLM_MOCK=pass deno run -A tests/scenario_framework/runner/main.ts \
  --scenario todo-plan --workspace /tmp/ws --output /tmp/ws/out --verbose

# Real judge model, distinct from the scenario model
EXA_EVAL_LLM_MOCK=false EXA_EVAL_LLM_PROVIDER=anthropic EXA_EVAL_LLM_MODEL=claude-sonnet-4-5 \
  deno run -A tests/scenario_framework/runner/main.ts \
  --scenario todo-plan --workspace /tmp/ws --output /tmp/ws/out
```

**Authoring checklist:**

1. Put the file under the right `pack` directory with a unique `id`.
2. Add `tags` (include `smoke` to make it a ci-core representative for its subsystem).
3. Declare `portals` for any real code the scenario touches.
4. Every step: `id` + `type` + the fields that type needs.
5. Assert what matters with criteria — don't rely on step exit code alone.
6. Run with `--dry-run` first to catch schema errors, then `--verbose` to watch.
7. Check the scenario with `deno task check:scenario-declarative` (no `shell` steps, no raw
   SQL, no hardcoded worktree globs).

---

## 9. Running & Validation Commands

For running scenarios (`exactl eval`, the direct runner, CI profiles, subsystem tiers) see the
[`README.md`](./README.md) quick reference. The one DSL-specific check is declarative purity:

```bash
deno task check:scenario-declarative   # no shell steps, no raw SQL, no hardcoded worktree globs
```

---

## 10. Where Things Live

The DSL-relevant files only — for the full framework directory map see
[`README.md`](./README.md#4-directory-structure).

| What                             | Path                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| Scenario header schema           | `tests/scenario_framework/schema/scenario_schema.ts`        |
| Step / criterion / portal schema | `tests/scenario_framework/schema/step_schema.ts`            |
| Step executor                    | `tests/scenario_framework/runner/step_executor.ts`          |
| Criterion evaluation             | `tests/scenario_framework/runner/assertions.ts`             |
| Matrix expansion                 | `tests/scenario_framework/runner/matrix_expander.ts`        |
| Starter template                 | `tests/scenario_framework/templates/scenario_template.yaml` |
