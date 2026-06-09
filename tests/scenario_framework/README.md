# Scenario Framework

The Scenario Framework is a reusable tool designed to validate Exaix behavior through real deployed workspaces. It executes declarative scenarios, captures evidence, and enforces measurable criteria at each step.

## Quick Start

For a complete step-by-step tutorial on deploying a sandbox, configuring LLM providers (including real LLMs like Google Gemini), and running the framework externally, please refer to the **[`VALIDATION_GUIDE.md`](./VALIDATION_GUIDE.md)**.

### Running Scenarios (CLI Reference)

Once you have a workspace set up (or deployed the framework), you can run scenarios using the `run-scenarios` script.

```bash
./bin/run-scenarios --workspace /path/to/workspace --output /path/to/output
```

**Common Flags:**

- `-w, --workspace <path>`: (Required) Path to the Exaix workspace to test.
- `-o, --output <path>`: (Required) Path where evidence and manifests will be written.
- `-m, --mode <auto|step|manual-checkpoint>`: Execution mode (default: `auto`).
- `-p, --profile <ci-smoke|ci-core|ci-extended>`: CI profile filter.
- `-s, --scenario <id>`: Run a specific scenario by ID (repeatable).
- `-P, --pack <name>`: Run all scenarios in a pack (e.g., `agent_flows`).
- `-t, --tag <tag>`: Filter scenarios by tag (e.g., `smoke`).
- `-d, --dry-run`: Validate selection and config without executing.
- `-c, --config <path>`: Load configuration from a YAML/JSON file.
- `-v, --verbose`: Show full CLI commands being executed in terminal.

### Scoring with `score_weight`

Criteria and steps support optional `score_weight` (0.0–1.0) for graded evaluation.
When `score_weight` is omitted, all criteria weigh equally (default 1.0).
Steps with `score_weight` contribute proportionally to the overall `suite_score`.

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

Run with `--eval-mode` to write scored results to `output/history/eval-history.jsonl`.

### Useful Option Values & Compatible Modes

When running or filtering scenarios, it is important to match the target environment (e.g., automated vs manual) with the proper execution mode.

| Flag / Target   | Value           | Compatible Mode             | Description / Use Case                                                                                      |
| :-------------- | :-------------- | :-------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **`--pack`**    | `agent_flows`   | `auto`, `manual-checkpoint` | Complex multi-step behaviors testing LLM output. Contains checkpoints for human review.                     |
| **`--pack`**    | `smoke`         | `auto`                      | Fast, lightweight validation of the framework and workspace configurations.                                 |
| **`--pack`**    | `provider_live` | `auto`                      | Stress testing scenarios that **require** real LLM API providers instead of mock models.                    |
| **`--tag`**     | `smoke`         | `auto`                      | Runs only basic connectivity/parsing scenarios. Best for CI pre-flight checks.                              |
| **`--tag`**     | `manual-only`   | `manual-checkpoint`         | Scenarios intentionally built with pauses to simulate edge-case human interventions. Will be skipped in CI. |
| **`--tag`**     | `provider-live` | `auto`                      | Scenarios restricted to non-mock providers. Will skip execution during mock CLI tests.                      |
| **`--tag`**     | `clarification` | `manual-checkpoint`         | Agent workflows specifically interacting with the Quality Gate clarifying UX loop.                          |
| **`--profile`** | `ci-smoke`      | `auto`                      | Subset of extremely fast regression tasks invoked natively by the CI server.                                |
| **`--profile`** | `ci-core`       | `auto`                      | Standard automation suite running the bulk of reliable, deterministic tests.                                |
| **`--profile`** | `ci-extended`   | `auto`                      | The most comprehensive testing layer; typically skipped on PRs to save time.                                |

---

## Directory Structure

- `bin/`: Convenient shell script wrappers for the runner and deployer.
- `runner/`: Core execution logic (loader, executor, assertion engine, modes).
- `scenarios/`: Declarative scenario definitions (YAML).
  - `agent_flows/`: Validation for recent Exaix features.
  - `smoke/`: Lightweight confidence checks.
- `fixtures/requests/`: Plain text files containing the request prompts.
- `schema/`: Zod schemas for scenarios, steps, and manifests.
- `scripts/`: Implementation scripts for deployment and auxiliary tasks.
- `tests/`: Framework's own unit and integration tests.

---

## Execution Modes

1. **`auto` (Default)**: Runs all steps non-interactively. Fails fast on the first error. Best for CI and regression.
2. **`step`**: Pauses after every step, waiting for user confirmation to continue. Excellent for debugging.
3. **`manual-checkpoint`**: Pauses only at steps marked as `checkpoint: true` in the scenario YAML.

---

## Authoring Scenarios

Scenarios are defined in YAML files under `scenarios/<pack>/`.

### Example Scenario Structure

```yaml
id: my-new-scenario
title: Validate custom behavior
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

### Key Rules

- **No Embedded Prompts**: Always use `request_fixture` to point to a file in `fixtures/requests/`.
- **Measurable Criteria**: Use `input_criteria` and `output_criteria` to define what "success" looks like at each step.
- **Independence**: Scenarios should ideally be independent but can be grouped into packs.

---

## Fuzzy Matching (Text Similarity)

To handle the variability of LLM outputs, several criteria support optional fuzzy matching using a Levenshtein-based similarity algorithm.

**How it works:**

- It computes a score between `0.0` and `1.0`.
- A score of `1.0` means an exact match; `0.0` means completely different.
- The `similarity_threshold` property defines the minimum score required to pass.

**Supported criteria:**

- `text-contains`: If `similarity_threshold` is provided, it performs a similarity check on the **entire file content** against the `contains` string, rather than a simple substring search.
- `json-path-equals`: Compares the string value at a JSON path against the `equals` string using similarity.
- `frontmatter-field-equals`: Compares a frontmatter field value against the `equals` string using similarity.

**Example:**

```yaml
- id: check-goal-fuzzy
  kind: json-path-equals
  path: "$.goals[0]"
  equals: "Initialize the authentication module"
  similarity_threshold: 0.8 # Pass if output is ~80% similar (e.g., "Init auth module")
```

---

## Regex Matching

For more precise pattern validation (e.g., verifying specific requirements exist regardless of LLM "chatiness"), use the `text-matches` criterion.

**Features:**

- **Multiple Patterns**: Supports a list of regex patterns that must _all_ match the file content.
- **Order Independent**: The patterns can appear in any order within the file.
- **Custom Flags**: Supports standard JavaScript regex flags (e.g., `i` for case-insensitive, `m` for multiline).
- **Default Multi-line/Dot-all**: Defaults to the `s` (dotAll) flag, allowing the `.` character to match newlines.

**Example:**

```yaml
- id: check-readme-requirements
  kind: text-matches
  path: "README.md"
  flags: "si" # Case-insensitive and dotAll
  matches:
    - "Project Title"
    - "Database Schema: v\\d+"
    - "\\[x\\] Task 1"
```

---

## Quality Pipeline Hardening

The Scenario Framework provides criteria that directly map to the "hardening" artifacts and internal logic. These allow scenarios to verify that every safeguard in the quality pipeline is functioning as intended.

### 1. Intent & Requirement Extraction

Verifies the `RequestAnalyzer` and the `_analysis.json` artifact.

- **`json-path-equals`**: Checks that structured goals/requirements in `_analysis.json` match expectations.
- **`json-path-exists`**: Ensures correct identification of `referencedFiles`.

### 2. Knowledge-Aware Context

Verifies the `PortalKnowledgeService` and `knowledge.json`.

- **`portal-mounted`**: Mandatory `input_criterion` to ensure the portal boundary is active.
- **`json-path-equals`**: Verifies identification of `techStack` or architecture `layers` in `knowledge.json`.

### 3. Quality Gating & Clarification

Verifies the `RequestQualityGate` and `_clarification.json`.

- **`status-equals`**: Ensures requests are correctly held in `NEEDS_CLARIFICATION` when vague.
- **`json-path-exists`**: Confirms missing info (e.g., `questions`) was correctly identified in `_clarification.json`.

### 4. Acceptance Criteria Propagation

Verifies explicit criteria in request frontmatter and plan propagation.

- **`frontmatter-field-equals`**: Verifies `acceptance_criteria` in `request.md` are correctly parsed.
- **`json-path-exists`**: Verifies the `requirementsFulfillment` section in `plan.yaml` produced by the `ReflexiveAgent`.

### 5. Audit & Traceability

Verifies internal process execution via the workspace journal.

- **`journal-event-exists`**: Ensures events like `request.quality_assessed` or `portal.analyzed` occurred.

### Summary Mapping

| Criterion                      | Exaix Artifact   | Hardening Goal                                    |
| :----------------------------- | :--------------- | :------------------------------------------------ |
| **`frontmatter-field-equals`** | Request `.md`    | Enforce explicit user-defined success conditions. |
| **`json-path-equals`**         | `_analysis.json` | Validate that LLM intent extraction is accurate.  |
| **`portal-mounted`**           | Active Workspace | Ensure environmental pre-conditions are met.      |
| **`journal-event-exists`**     | `journal.ndjson` | Confirm the quality pipeline actually executed.   |
| **`json-path-exists`**         | `plan.yaml`      | Verify per-requirement fulfillment was tracked.   |

---

## Path Model

- **Framework Home**: The directory containing the framework (or its deployed copy).
- **Workspace Under Test**: The external Exaix workspace targeted by the runner.
- **Output Directory**: Where evidence, manifests, and summaries are written.

The framework treats the workspace under test as an external system and does not assume repository-root execution.
