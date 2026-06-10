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
