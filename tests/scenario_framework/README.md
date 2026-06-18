# Scenario Framework — Evaluation Engine & Validation Tool

The Scenario Framework is the execution engine behind **`exactl eval`** (primary)
and the Exaix integration test runner (secondary). This document covers both roles.

For **user-facing evaluation workflow, CLI reference, scoring model, and tutorials**,
see **[`docs/Exaix_Evaluation.md`](../docs/Exaix_Evaluation.md)**.

---

## Table of Contents

1. [Evaluation (Primary Role)](#1-evaluation-primary-role)
2. [Validation (Secondary Role)](#2-validation-secondary-role)
   - [Automated Sandbox Setup](#21-automated-sandbox-setup)
   - [Manual Sandbox Setup](#22-manual-sandbox-setup)
   - [Run Validation Scenarios](#23-run-validation-scenarios)
3. [Architecture & Extension](#3-architecture--extension)
4. [Directory Structure](#4-directory-structure)
5. [Quick Reference](#5-quick-reference)

---

## 1. Evaluation (Primary Role)

The framework's primary purpose is **quantitative evaluation** of Exaix components.
It provides weighted scoring, history tracking, LLM-as-judge, trajectory evaluation,
and multi-trial metrics.

### Quick Start

```bash
# Run self-contained evaluation packs (no sandbox needed)
exactl eval run --pack blueprint-eval --score-threshold 0.5

# Run with multi-trial reliability metrics
exactl eval run --pack eval-smoke --trials 5

# View history
exactl eval history --last 10
```

**Self-contained eval packs** (`blueprint-eval`, `eval-smoke`) use only shell
commands and temp files — no running daemon, no portals, no LLM providers.
They work in any workspace, including CI pre-push hooks.

### Eval-Specific Concepts

- **Weighted scoring**: Criteria carry `score_weight` (0.0–1.0). Step and suite
  scores are computed as weighted averages, enabling partial credit.
- **Trajectory assert**: A step type that validates the agent's tool-call sequence,
  not just output artifacts.
- **LLM-as-judge**: A criterion kind that uses Exaix's 14 built-in evaluation
  criteria to score agent output via an LLM.
- **Multi-trial metrics**: `--trials N` reports mean, min, max, stdev, Pass@k.
- **History**: SQLite (default) + JSONL dual-write per run.

See **[`docs/Exaix_Evaluation.md`](../docs/Exaix_Evaluation.md)** for the full
CLI reference, scoring formulas, scenario authoring guide, and CI integration.

### LLM Provider Configuration

The llm-judge criterion dispatches to different providers via the `EXA_LLM_PROVIDER` env var. Each provider reads its own API key and allows endpoint/model overrides:

| Provider       | `EXA_LLM_PROVIDER` | API Key Env Var      | Default Model               | Default Endpoint                                |
| -------------- | ------------------ | -------------------- | --------------------------- | ----------------------------------------------- |
| Anthropic      | `anthropic`        | `ANTHROPIC_API_KEY`  | `claude-haiku-4-5-20251001` | `https://api.anthropic.com/v1/messages`         |
| OpenAI         | `openai`           | `OPENAI_API_KEY`     | `gpt-4o-mini`               | `https://api.openai.com/v1/chat/completions`    |
| Google Gemini  | `google`           | `GOOGLE_API_KEY`     | `gemini-2.0-flash`          | `https://generativelanguage.googleapis.com/...` |
| OpenRouter     | `openrouter`       | `OPENROUTER_API_KEY` | `openrouter/auto`           | `https://openrouter.ai/api/v1/chat/completions` |
| Ollama (local) | `ollama`           | _(none)_             | `llama3`                    | `http://127.0.0.1:11434/api/generate`           |

Override the endpoint or model for any provider via `EXA_LLM_BASE_URL` and `EXA_LLM_MODEL`. Backward compatibility: `EXA_LLM_ENDPOINT` is mapped to `EXA_LLM_BASE_URL` if the latter is unset. Unset `EXA_LLM_PROVIDER` defaults to the Mock provider (no external call).

```bash
# Example: test with OpenAI
export EXA_LLM_PROVIDER=openai
export OPENAI_API_KEY="sk-..."
exactl eval run --pack eval-edge-cases

# Example: test with Google Gemini
export EXA_LLM_PROVIDER=google
export GOOGLE_API_KEY="..."
export EXA_LLM_MODEL=gemini-1.5-flash
exactl eval run --pack eval-smoke
```

---

## 2. Validation (Secondary Role)

The framework can also run **integration-test scenarios** against a deployed Exaix
sandbox. These scenarios exercise real agent flows, portals, routing, and provider
behaviour. They require a fully configured Exaix workspace with a running daemon.

### 2.1 Automated Sandbox Setup

The `setup_sandbox.ts` script handles workspace deployment, provider configuration,
database initialization, portal mounting, and framework deployment in one step:

```bash
# From the Exaix repository root
cd "$HOME/git/Exaix"

# Set your sandbox root
export EXAIX_VALIDATION_ROOT="$HOME/exa-validation-sandbox"

# Fast local testing (mock provider, no API keys needed)
deno run -A scripts/setup_sandbox.ts \
  --dir "$EXAIX_VALIDATION_ROOT" \
  --provider "mock" \
  --model "test"

# Or with a real LLM provider:
# export GOOGLE_API_KEY="your-key"
# deno run -A scripts/setup_sandbox.ts \
#   --dir "$EXAIX_VALIDATION_ROOT" \
#   --provider "google" \
#   --model "gemini-1.5-flash"

# Export sandbox paths
export PATH="$EXAIX_VALIDATION_ROOT/bin:$PATH"
export EXA_CONFIG_PATH="$EXAIX_VALIDATION_ROOT/workspace/exa.config.toml"

# Start the daemon
exactl daemon start
```

### 2.2 Manual Sandbox Setup

For fine-grained control over each step:

```bash
# 1. Prepare directories
export EXAIX_VALIDATION_ROOT="$HOME/exa-validation-sandbox"
export WORKSPACE_DIR="$EXAIX_VALIDATION_ROOT/workspace"
export FRAMEWORK_DIR="$EXAIX_VALIDATION_ROOT/framework"
export EVIDENCE_DIR="$EXAIX_VALIDATION_ROOT/evidence"
export EXA_BIN_PATH="$EXAIX_VALIDATION_ROOT/bin"
export EXA_CONFIG_PATH="$WORKSPACE_DIR/exa.config.toml"
mkdir -p "$EXAIX_VALIDATION_ROOT"

# 2. Deploy workspace (from repo root)
deno run -A ./scripts/deploy_workspace.ts "$WORKSPACE_DIR"
export PATH="$EXA_BIN_PATH:$PATH"

# 3. Configure LLM provider
cd "$WORKSPACE_DIR"
cp exa.config.sample.toml exa.config.toml
# Edit exa.config.toml to set [ai] provider and model

# 4. Start daemon
exactl daemon start

# 5. Mount target portal (e.g., Exaix repo itself)
exactl portal add "$HOME/git/Exaix" portal-exaix
exactl daemon stop && exactl daemon start

# 6. Deploy scenario framework into sandbox (from repo root)
cd "$HOME/git/Exaix"
./tests/scenario_framework/bin/deploy-framework \
  --destination "$FRAMEWORK_DIR" \
  --workspace "$WORKSPACE_DIR" \
  --output "$EVIDENCE_DIR"
```

### 2.3 Run Validation Scenarios

From the deployed framework directory:

```bash
cd "$FRAMEWORK_DIR/scenario_framework"

# Framework smoke test (validates the framework itself)
./bin/run-scenarios --scenario framework-smoke-validation --verbose

# Agent flow validations (requires running daemon + mounted portal)
./bin/run-scenarios --pack agent_flows --verbose

# All smoke scenarios
./bin/run-scenarios --tag smoke --verbose

# Full CI core suite
./bin/run-scenarios --profile ci-core --verbose
```

All 10 packs (37 scenarios) are available in deployed mode. Packs that require
a sandbox deploy:

| Pack                 | Requires        | Scenarios |
| -------------------- | --------------- | --------- |
| `agent_flows`        | Daemon + portal | 8         |
| `dynamic_execution`  | Daemon          | 1         |
| `framework_test`     | Framework       | 1         |
| `integration_e2e`    | Daemon + portal | 2         |
| `mcp_tools_extended` | Daemon          | 2         |
| `provider_live`      | Real LLM        | 2         |
| `smoke`              | Daemon          | 1         |
| `triggers-basic`     | Daemon          | 1         |
| `blueprint-eval`     | None            | 2         |
| `eval-smoke`         | None            | 1         |

---

## 3. Architecture & Extension

### Execution Modes

1. **`auto` (Default)**: Runs all steps non-interactively. Fails fast on the first
   error. Best for CI and regression.
2. **`step`**: Pauses after every step, waiting for user confirmation. Good for
   debugging.
3. **`manual-checkpoint`**: Pauses only at steps with `checkpoint: true` in YAML.

### Authoring Scenarios

Scenarios are YAML files under `scenarios/<pack>/`:

```yaml
id: my-new-scenario
title: Validate custom behaviour
pack: my_pack
tags: [smoke, quality]
request_fixture: fixtures/requests/my_pack/request.md
mode_support: [auto, step]
portals:
  - alias: my-repo
    source_path: /absolute/path/to/repo
steps:
  - id: start-request
    type: exactl
    args: [request, start, --path, "$REQUEST_FIXTURE"]
    output_criteria:
      - id: check-plan
        kind: file-found
        pattern: "**/_plan.md"
```

**Key rules:**

- **No embedded prompts**: Always use `request_fixture`.
- **Measurable criteria**: Use `input_criteria` / `output_criteria`.
- **Independence**: Scenarios should be independent but can be grouped in packs.

### Available Criterion Kinds

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

### Fuzzy Matching

Several criteria support Levenshtein-based similarity via `similarity_threshold`:

- `text-contains`: similarity check on file content rather than substring
- `json-path-equals`: compares string value at path using similarity
- `frontmatter-field-equals`: compares field value using similarity

```yaml
- id: check-goal-fuzzy
  kind: json-path-equals
  path: "$.goals[0]"
  equals: "Initialize the authentication module"
  similarity_threshold: 0.8
```

### Regex Matching

The `text-matches` criterion supports multiple patterns with custom flags:

```yaml
- id: check-readme-requirements
  kind: text-matches
  path: "README.md"
  flags: "si"
  matches:
    - "Project Title"
    - "\\[x\\] Task 1"
```

### Quality Pipeline Hardening

| Criterion                  | Exaix Artifact   | Purpose                                    |
| -------------------------- | ---------------- | ------------------------------------------ |
| `frontmatter-field-equals` | Request `.md`    | Enforce explicit user-defined acceptance   |
| `json-path-equals`         | `_analysis.json` | Validate LLM intent extraction             |
| `portal-mounted`           | Active Workspace | Ensure portal pre-conditions are met       |
| `journal-event-exists`     | `journal.ndjson` | Confirm quality pipeline executed          |
| `json-path-exists`         | `plan.yaml`      | Verify per-requirement fulfillment tracked |

---

## 4. Directory Structure

```
scenario_framework/
├── bin/              # Shell wrappers for runner and deployer
├── runner/           # Core execution (loader, executor, assertions, modes)
│   ├── main.ts       # CLI entry point
│   ├── synthetic_runner.ts
│   ├── scoring.ts    # Weighted scoring functions
│   ├── history_writer.ts / history_sqlite.ts
│   ├── trajectory_evaluator.ts
│   └── ...
├── scenarios/        # Declarative scenario definitions (YAML per pack)
├── schema/           # Zod schemas for scenarios, steps, manifests
├── fixtures/requests/ # Request prompt files
├── scripts/          # Deployment and auxiliary tasks
└── tests/            # Framework's own unit and integration tests
```

---

## 5. Quick Reference

| Task                                          | Command / Document                                        |
| --------------------------------------------- | --------------------------------------------------------- |
| Run eval (self-contained packs)               | `exactl eval run --pack blueprint-eval`                   |
| Run eval (with sandbox)                       | `exactl eval run --pack agent_flows`                      |
| Run validation scenarios (deployed framework) | `./bin/run-scenarios --profile ci-core`                   |
| Deploy sandbox (automated)                    | `scripts/setup_sandbox.ts` (see §2.1)                     |
| Deploy framework to sandbox                   | `./bin/deploy-framework` (see §2.2)                       |
| Full CLI reference                            | [`docs/Exaix_Evaluation.md`](../docs/Exaix_Evaluation.md) |
| Schema contracts                              | `schema/step_schema.ts`, `schema/scenario_schema.ts`      |

---

## 6. Developing Scenarios & Tests

### When to Use the Scenario Framework

| Concern                         | Use scenario framework                     | Use `tests/integration/`          |
| ------------------------------- | ------------------------------------------ | --------------------------------- |
| Quantitative scoring            | ✅ Built-in (weights, LLM-as-judge)        | ❌ No                             |
| Multi-trial reliability         | ✅ `--trials N` (mean, stdev, Pass@k)      | ❌ No                             |
| Trajectory analysis             | ✅ Tool-call sequence validation           | ❌ No                             |
| Declarative YAML scenarios      | ✅ Author in `.yaml`, no TypeScript needed | ❌ TypeScript required            |
| In-process pipeline testing     | ❌ Requires daemon + sandbox               | ✅ `TestEnvironment` + in-process |
| Rapid TDD (RED-GREEN-REFACTOR)  | ❌ Heavy setup                             | ✅ `deno test --watch`            |
| File watcher / daemon behaviour | ❌ Assumes daemon is running               | ✅ Subprocess + `null` pipes      |

**Rule of thumb:** If you need a score or multi-trial statistics, use the scenario
framework. If you need deterministic assertion of internal behaviour (pipeline
wiring, config loading, status updates), use `tests/integration/`.

### Authoring New Scenarios

Scenarios are YAML files in `scenarios/<pack>/`. Create a new file following
the existing patterns:

```yaml
schema_version: "1.0.0"
id: my-validation-scenario
title: Descriptive title for reports
pack: my_pack # matches the directory name
tags: [smoke, quality] # filters: --tag smoke
request_fixture: fixtures/requests/my_pack/my_request.md
mode_support: [auto] # auto (default) | step | manual-checkpoint
portals: [] # list of portals the scenario mounts
steps:
  - id: do-something
    type: exactl # exactl | shell | wait-for-file | json-assert | journal-assert
    command: "request" # exactl subcommand
    args: ["--file", "$REQUEST_FIXTURE"]
    input_criteria: [] # preconditions
    output_criteria:
      - id: check-exit-code
        score_weight: 0.7 # weight in overall score (0.0–1.0)
        kind: command-exit-code
        equals: 0
```

**Key rules:**

- **No embedded prompts.** Always use `request_fixture` pointing to a file under `fixtures/requests/`.
- **Reference existing packs.** Look at `scenarios/smoke/` for the simplest pattern,
  `scenarios/agent_flows/` for multi-step flows.
- **Scenarios should be independent.** Each scenario is a self-contained validation;
  use tags to group related scenarios for CI profiles.
- **All step types** available in §3 (file-exists, text-contains, json-path-equals,
  journal-event-exists, llm-judge, etc.)

### Running Scenarios Locally (before sandbox deploy)

The fastest local workflow uses the synthetic runner (`runner/synthetic_runner.ts`)
directly — no daemon, no sandbox. This validates your YAML syntax and criteria
configuration:

```bash
# Validate YAML + criteria wiring
deno run --allow-read tests/scenario_framework/runner/synthetic_runner.ts \
  --scenario tests/scenario_framework/scenarios/smoke/workspace-health-smoke.yaml

# Validate all scenarios in a pack
for f in tests/scenario_framework/scenarios/smoke/*.yaml; do
  deno run --allow-read tests/scenario_framework/runner/synthetic_runner.ts --scenario "$f"
done
```

For a full daemon-required run, deploy a sandbox first (see §2.1), then use
`./bin/run-scenarios` from the deployed directory.

### Framework's Own Tests

The framework's internal logic is tested via standard Deno tests in `tests/`:

| Test file                                          | What it covers                   |
| -------------------------------------------------- | -------------------------------- |
| `tests/unit/`                                      | Unit tests for runner components |
| `tests/integration/`                               | Integration tests for runner     |
| `tests/plan_amendment_scenario_test.ts`            | Plan amendment scenarios         |
| `tests/portal_knowledge_phase105_scenario_test.ts` | Portal knowledge validation      |
| `tests/triggers_basic_scenario_test.ts`            | Trigger scenario validation      |

Run them with:

```bash
deno test --allow-all tests/scenario_framework/tests/
```

### Forbidden Patterns

| ❌ Don't do this                                    | ✅ Do this instead                                           |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Embed prompts in YAML `steps.args`                  | Use `request_fixture` + `$REQUEST_FIXTURE`                   |
| Hardcode absolute paths in scenario YAML            | Use `$HOME`, `$WORKSPACE_ROOT`, `$REQUEST_FIXTURE`           |
| Create a new test pack for a single scenario        | Add to an existing pack or tag                               |
| Duplicate criteria across steps                     | Reuse criteria IDs or factor shared checks                   |
| Write TypeScript `Deno.test` for scenario logic     | Write YAML scenario definitions                              |
| Require a real LLM provider in self-contained packs | Use mock provider (default when `EXA_LLM_PROVIDER` is unset) |

### Validation Checklist

Before committing a new scenario:

1. **YAML is valid** — run the synthetic runner against it
1. **`request_fixture` exists** — the file path under `fixtures/requests/` is correct
1. **Criteria are measurable** — every `input_criteria` and `output_criteria` has
   a realistic `kind` and `equals`/`path`/`pattern` value
1. **`score_weight` sums make sense** — criteria weights within a step do not
   exceed 1.0 in expectation
1. **Mode support** — `auto` for CI; add `step` or `manual-checkpoint` only when
   interactive debugging is needed
1. **No hardcoded paths** — use `$WORKSPACE_ROOT`, `$REQUEST_FIXTURE`, `$HOME`

### See Also

- `scenarios/smoke/workspace-health-smoke.yaml` — minimal scenario example
- `scenarios/framework_test/smoke-validation.yaml` — multi-step scenario with scores
- `scenarios/integration_e2e/` — full E2E workflow scenarios
- `docs/Exaix_Evaluation.md` — CLI reference, scoring formulas, authoring guide
- `schema/scenario_schema.ts` — authoritative Zod schema for scenario YAML
- `schema/step_schema.ts` — authoritative Zod schema for steps and criteria
