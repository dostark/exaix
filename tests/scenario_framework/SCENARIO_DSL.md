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
1. **Steps** — the ordered actions (`exactl`, `wait-for-file`, `write-file`, `journal-assert`,
   `judge`, …).
1. **Criteria** — the assertions (`input_criteria` before a step, `output_criteria` after)
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
matrix: { from_catalog: ["self-hosted-fixture"] } # one run per cell; or `cells:` (see §2.2)
bindings: { default: { service: mock, model: mock/mock-model } } # per-step bindings (see §2.3)
catalog: { models: { "mock/mock-model": { model_provider: mock } } } # entries bindings may name (§2.3)
pin: [{ selector: default, fields: [service], reason: capability-gate, note: "why it is frozen" }] # (§2.3)
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
    verification: # optional: post-execution checks written into the sandbox config
      checks:
        - kind: "deno_task"
          task: "test" # test | lint | check | fmt
          path: "src/" # relative to the worktree, default "."
      max_repair_attempts: 2 # default 2; hard cap 5
```

With `target_path`, the runner **clean-stages** the fixture (removes any prior target, stale
worktrees, stale symlinks) and copies — so an evaluated repo can never leak a previous
scenario's/cell's changes. `source_path` alone mounts the path directly.

A mount's `verification` block is appended to the sandbox config after that portal's
`portal add` succeeds, so the daemon runs those checks after execution and journals
`verification_status` on `execution.completed`. A verification-bearing mount that fails to
mount fails the setup step.

### 2.2 Matrix Cells

A `matrix` block expands a scenario into one run per cell. Each cell can pick a different
tool, provider, config, and binary. Cells set `$CELL_PROVIDER` / `$CELL_MODEL` (see §3).
A matrix carries exactly one of `cells` (hand-listed, below) or `from_catalog` (presets, §2.3);
`MatrixSchema` rejects both and rejects neither. The retired `axes` map no longer exists:
`MatrixSchema` rejects it, so list cells or name presets instead.

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

Each cell is identified as `${tool}-${provider}` (for example `exactl-anthropic`) in reports,
evidence files and `--cell` filters. The provider part is the cell config's `[ai].provider` when the
config sets one, and the cell's own `provider` label otherwise. A preset keeps the same id form, so
migrating a hand-listed matrix to `from_catalog` does not rename a cell. `MatrixCellSchema` also accepts optional `bindings`
and `catalog` blocks, which land in the cell layer of the overlay order in §2.3.

### 2.3 Bindings, Presets and Pins

A scenario chooses which provider, model and service each flow step uses without editing a TOML
file. The runner turns these blocks into overlay files and passes them to the daemon as
`--overlay` arguments of every `exactl request` step. `ScenarioSchema` carries the three
scenario-level blocks. An `exactl request` step accepts its own `bindings:` block for that one request,
and the schema rejects `bindings:` on any other step, where the runner would ignore it.

```yaml
bindings: # BindingsTable: selector -> binding fields
  default: { service: deepseek, model: deepseek/deepseek-v4-pro }
  "flow:research/step:explore-*": { service: self-hosted-fixture, model: fixture/compat-fixture-v1 }
  judge: { service: claude-cli, model: anthropic/claude-sonnet-5 }
catalog: # services and models the bindings above may name
  models:
    "fixture/compat-fixture-v1": { model_provider: fixture }
pin:
  - selector: default
    fields: [service, model]
    reason: provider-qualification
    note: "Phase 155 DeepSeek live leg"
matrix:
  from_catalog: [self-hosted-fixture] # presets from configs/eval-cells.toml
```

**Binding fields.** An entry sets any of `service`, `model_provider`, `model`, `service_model_id`,
`transport`, `interface`, `effort` and `thinking`. Selectors are `default`, `role:<agent-role>`,
`flow:<flow-id>`, `flow:<flow-id>/step:<step-id-or-glob>`, and the judge selectors below.

**Presets.** `matrix.from_catalog` names `[tool.<name>]` rows in `configs/eval-cells.toml`. A preset
(`ICatalogPreset`) is a base `config` plus optional `bindings` and `catalog` tables and the same
`requires_bin`, `requires_key` and `requires_optin` predicates a hand-listed cell carries. A model
variant is therefore a new preset row, not a copied config file. A preset whose `requires_optin`
variable is unset records a skipped cell instead of failing.

**Pins.** `pin:` is a list. Each entry has a `selector`, a non-empty `fields` list (any binding field
except `effort` and `thinking`), a `reason` and a required `note` of at most 200 characters. Two pins
may not share a selector. The reason is one of `provider-qualification`, `wire-compat-regression`,
`pricing-table`, `capability-gate` or `compliance`. A pinned field keeps the value the scenario and
cell layers give it at the pin's selector. A pin whose field neither layer sets at that selector fails
with `pin_invalid`.

**Layer order.** From lowest to highest, every layer reaches the daemon as an `--overlay` argument in
this order:

1. Flow YAML `binding:` and the cell config's `[bindings]` (the daemon's own `flow` and `config` layers).
1. Scenario `bindings:` and `catalog:` (`10-scenario.json`).
1. Matrix cell or preset `bindings` and `catalog` (`20-cell.json`).
1. The `exactl request` step's own `bindings:`, passed to that request only (`25-step-<step-id>.json`).
1. Operator `--overlay` files, in the order given (copied to `30-operator-<n>.<ext>`, with original path and sha256 recorded).
1. Operator `--bind` entries (`40-operator-bind.json`).

Two layers that set the same selector and field resolve to the later layer, so an operator
`--overlay` that repeats a selector the scenario already used simply wins, and the run does not fail
with `ambiguous_selector`. The rule is per selector. It does not weaken `ambiguous_selector` for two
distinct equally-specific selectors: two different globs of equal specificity that set one field to
different values are still rejected. `loadBindingLayers` applies the collapse in load order.

**How a pin is enforced.** A pinned field is protected by removing it from operator entries before
the runner writes them. Precedence alone cannot protect a pin, because `--bind` entries sit in the
`cli` layer above every `--overlay`, so no overlay can override a `--bind`. An entry is compared with
a pin only when one step could match both selectors. A sibling step of a pinned step is therefore
free to change, while `default`, a `role:` selector or a matching glob can reach the pinned step and
is compared. For each operator entry that can reach a pinned step and sets a pinned field to a
different value:

- A selector at least as specific as the pin's selector is refused before `start-daemon` with the
  code `pinned`, and the pin's reason appears in the issue detail.
- A broader selector is allowed with the pinned field stripped from that entry. The evidence records
  `pin_kept` for every stripped field and names the entry it came from.

This is why no `--bind` can change a pinned field. A scenario or cell binding more specific than a pin,
or any request step's own binding at or below the pin's selector, that can reach the pinned step and
sets a pinned field to a different value is an authoring error (`pinned`, at load). Flow pins (`pin:`
inside a flow step) are enforced by the daemon.

**Judge selectors.** A scenario judge binds through `judge` (every judge step) and
`judge:<step-id>` (one `judge` step) only. `default`, `role:` and `flow:` do not apply to a scenario
judge: they bind flow steps, and a broad `default` must not silently move a grader. A flow **gate**
judge is a different mechanism. It runs inside the flow (`kind: "gate"`) and resolves through
`default`, `role:` and `flow:`, so an author must not expect the two to behave alike. With no `judge`
binding the judge uses `EXA_EVAL_LLM_*` as before, and `EXA_EVAL_LLM_MOCK` stays the only switch
between a mock and a live judge. A bound judge is validated like a flow step: its credential, opt-in,
endpoint and network grant must hold, and a `cli` service is allowed while a `cli-delegate` is not. A
judge binding that fails to resolve or validate refuses the run before `start-daemon`, with each issue
in the error. A named judge is never swapped silently for the environment's judge.

**Request scope.** A judge resolves through the same ordered overlay list as the request it grades
(the layer order above), never through a pool of every step's overlay. A judge that is itself an
`exactl request` step uses that request's layer; a later grading step uses the nearest preceding
executed request. A future or skipped request's own `bindings:` never enters the stack, and a judge
with no preceding request sees only the scenario, cell and operator layers.

A judge that grades with the system under test's own service and model is allowed and flagged
`judgeSharesSut` in the evidence. The flag compares the judge's catalog service and model with every
step the daemon bound in that run. With no bound step, it compares the judge's adapter and wire model
with the cell config's `[ai]` provider and model.

**Operator controls.** The scenario runner accepts the same flags as `exactl request`:

```bash
deno run -A tests/scenario_framework/runner/main.ts --scenario research-split \
  --overlay ~/overlays/local-explorers.json \
  --bind 'judge=service=openrouter,model=deepseek/deepseek-v4-pro'
```

`--overlay` is repeatable. The file must be a regular JSON file within the operator overlay byte
ceiling, never a symlink. `--bind` uses the `selector=field=value[,field=value]` grammar, and two
`--bind` flags on one selector merge per field, the later flag winning, as `exactl request --bind`
does.

**Selecting Ollama.** Select the built-in Ollama service by an explicit binding and declare the
canonical model in `catalog.models`; the built-in preference map has no `meta` or `qwen` key, so
a model-only entry cannot route there:

```yaml
bindings:
  default: { service: ollama-chat, model: meta/llama3.1:8b }
catalog:
  models:
    "meta/llama3.1:8b": { model_provider: meta }
```

In a TOML preset the same selection reads `service = "ollama-chat"` under
`[tool.<name>.bindings.default]`.

**Trust boundary.** The runner writes overlay files to a per-invocation directory under the run's
output directory (`<output>/bindings/<run-id>/`), outside the sandbox, so an agent cannot edit the
layers that route its own steps. The runner resolves that directory's physical location and refuses
an output or `bindings` symlink that points into the sandbox before it writes. `exactl request
--overlay` rejects a symlink, a non-regular file and a file above `BINDING_OVERLAY_MAX_BYTES` before
parsing (`loadOverlays`). The residual risk is a CLI delegate started with `--no-sandbox`, which can
still write outside the sandbox by absolute path and so can reach those files.

**Fixture network rule.** A service introduced by a run-time `--overlay` or preset catalog is not in
the daemon's start-time `--allow-net` grant. A fixture-backed service therefore needs its host in
the base config's explicit `allow_net` (for example `127.0.0.1:__COMPAT_FIXTURE_PORT__`, the
Phase 155 pattern), and a host outside that list fails as `needs_restart`.

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
| `$STEP_BASELINE`    | The current step's barrier baseline (rowid before the previous step) | execution   |

Environment the runner injects into every step subprocess: `REQUEST_FIXTURE`,
`WORKSPACE_ROOT`, `EXA_SYSTEM_ROOT`, `FRAMEWORK_HOME`, `EXA_CONFIG_PATH`,
`EXA_SCENARIO_ID`, `EXA_STEP_ID`, plus the current process env (so `EXA_LLM_PROVIDER`,
`EXA_EVAL_LLM_*`, API keys, … flow through).

**Judge model.** A `judge` binding (§2.3) wins over everything below. Without one, the judge is
run configuration, never hardcoded in a scenario:

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

Examples: `exactl request --agent-role <id> --plan-only --file $REQUEST_FIXTURE`,
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

### 5.5 `patch-blueprint` — add capabilities to an agent role's blueprint

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
are evaluated by the LLM-as-judge. The judge model comes from a `judge` or `judge:<step-id>`
binding (§2.3) when the scenario or a preset declares one, otherwise from env (`EXA_EVAL_LLM_*`).

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

| kind                   | fields                                                                                                   | asserts                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `journal-event-exists` | `event_type`, `journal_file?`, `payload_absent?`, `payload_includes?`, `payload_equals?`, `trace_scope?` | an activity event of that type exists (optionally with/without payload keys, equal scalars, or restricted to the current request's trace) |

**`payload_equals`** (additive, Step 15): a record of dotted-path keys to scalar
values (e.g. `effort_basis: "heuristic"`, `heuristic_inputs.complexity_source:
"analysis"`). A matching event must carry, at EVERY key, a scalar equal to the given
value — a MISSING key fails (a value assertion, unlike the presence-only bare match).

**`trace_scope: "current"`** (additive, Step 15): restricts matches to the CURRENT
scenario request's trace — the first `request.created` above the scenario's journal
baseline (the per-step barrier baseline rises above the request and resolves to nothing).
A globally-found event is NOT evidence the request under test emitted it; use
`trace_scope: current` when the scenario drives a single request, and value-distinct
`payload_equals`/`payload_includes` when a scenario drives several sequential requests.
When `trace_scope` is absent the criterion keeps its original global semantics.

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
plan-only request as the `senior-coder` agent role, waits for the plan, asserts its structure,
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
    args: ["--agent-role", "senior-coder", "--plan-only", "--file", "$REQUEST_FIXTURE"]
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
1. Add `tags` (include `smoke` to make it a ci-core representative for its subsystem).
1. Declare `portals` for any real code the scenario touches.
1. Every step: `id` + `type` + the fields that type needs.
1. Assert what matters with criteria — don't rely on step exit code alone.
1. Run with `--dry-run` first to catch schema errors, then `--verbose` to watch.
1. Check the scenario with `deno task check:scenario-declarative` (no `shell` steps, no raw
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
