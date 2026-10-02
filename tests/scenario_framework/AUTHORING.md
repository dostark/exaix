# Authoring swe_tasks Benchmark Tasks

## Task Directory Structure

Each task lives under `fixtures/swe_tasks/<task-id>/` with three files:

```text
fixtures/swe_tasks/<task-id>/
├── task.json          # Task metadata (schema, portal, difficulty)
├── reference.patch    # Ground truth: the correct fix diff
└── TASK.md            # Rich brief: goal, actions, acceptance criteria, constraints
```

Adding a new task is a content-only exercise — no code changes needed.

## Step-by-Step

### 1. Choose a Portal Fixture

Tasks run against a fixture portal under `fixtures/portals/`. The default is
`todo_app`. If your task requires a deliberate codebase defect (crashes,
compilation errors), clone the portal to a new directory, introduce the bug,
and set `portal` in `task.json` to the new directory name.

Existing portals:

| Portal                    | Content                                                  | Used by                            |
| ------------------------- | -------------------------------------------------------- | ---------------------------------- |
| `todo_app`                | Null-safe multi-file task-tracking app                   | add-feature, refactor, write-tests |
| `todo_app_null_guard_bug` | `todo_app` with deliberate null-crash bugs in `utils.ts` | fix-bug-null-guard                 |

### 2. Create task.json

```json
{
  "base_ref": "<fixture git init SHA>",
  "scoped_test_cmd": "<test command>",
  "portal": "<portal directory name>",
  "family": "task:<family-tag>",
  "difficulty": "S",
  "min_turns": 2,
  "title": "Short human-readable title"
}
```

**Fields:**

- `base_ref`: SHA of the fixture portal's `git init` commit. Compute with:
  ```text
  git init && git add -A && GIT_COMMITTER_DATE=2020-01-01T00:00:00Z \
    GIT_AUTHOR_DATE=2020-01-01T00:00:00Z \
    git -c user.email=swe-tasks@exaix.dev -c user.name=swe-tasks \
    commit -m 'init todo-app fixture' && git rev-parse HEAD
  ```
- `scoped_test_cmd`: The test command that verifies the fix (`deno test <file>`).
- `portal`: Name of the fixture portal directory under `fixtures/portals/`.
- `family`: One of: `task:bug-fix`, `task:security-fix`, `task:feature`,
  `task:cross-cutting`, `task:refactor`, `task:test-authoring`,
  `task:comprehension`, `task:documentation`.
- `difficulty`: `"S"` (small) or `"M"` (medium).
- `min_turns`: Minimum reasonable ReAct iterations for the task (default 2).

### 3. Create reference.patch

The reference patch is a standard `git diff` that transforms the buggy state
into the fixed state. Generate with:

```text
# Copy fixture, init git, commit
cp -r fixtures/portals/<portal> /tmp/task-fixture
cd /tmp/task-fixture && git init -q && git add -A && \
  GIT_COMMITTER_DATE=2020-01-01T00:00:00Z GIT_AUTHOR_DATE=2020-01-01T00:00:00Z \
  git -c user.email=swe-tasks@exaix.dev -c user.name=swe-tasks commit -q -m 'init'

# Apply your fix (edit the files)
# Then: git diff > reference.patch
```

### 4. Write TASK.md

The brief must include:

- **Goal** — one-line description of what the agent should accomplish
- **Files** — what source files are in scope
- **Actions** — ordered steps the agent should take (read, write, test, iterate)
- **Acceptance criteria** — specific, testable conditions
- **Constraints** — things the agent must NOT change or must preserve

The template in `runner/scenario_templates.ts` (`renderSweTaskTemplate`) emits
the full YAML scenario with matrix cells, scoring weights, and both CLI-delegate
and direct-API step sequences. You only need the three fixture files above.

### 5. Validate

Run the controls test to verify the task is non-vacuous:

```text
deno test --allow-all tests/scenario_framework/tests/unit/task_contract_schema_test.ts
```

This validates that `task.json` parses, the portal directory exists, and
`reference.patch` + `TASK.md` are present.

## Choosing Providers for a Scenario

The sections above cover `swe_tasks` content. Any scenario, in any pack, also chooses which
provider setup it runs on. Prefer these forms over a hand-listed matrix or an `EXA_EVAL_LLM_*`
env block; the full reference is [`SCENARIO_DSL.md` §2.3](./SCENARIO_DSL.md).

1. **Name a preset.** Write `matrix: { from_catalog: [<preset>] }` and add a `[tool.<preset>]` row to
   `configs/eval-cells.toml` when none fits. A model variant is a new preset row, not a copied TOML
   file. `MatrixSchema` takes `cells` or `from_catalog`, never both, and the old `axes` map is gone.
   Cell ids keep the `${tool}-${provider}` form.
1. **Bind steps.** Add a `bindings:` table to the scenario (`ScenarioSchema`), to a cell
   (`MatrixCellSchema`) or to one `exactl request` step. Add `catalog:` when a binding names a
   service or model the built-in catalog lacks.
1. **Bind the judge.** A judge binds through `judge` or `judge:<step-id>` only. `default`, `role:` and
   `flow:` do not apply to a scenario judge. Flow gate judges are a different mechanism and resolve
   through those selectors, so do not expect the two to behave alike. A live judge still needs
   `EXA_EVAL_LLM_MOCK=false`.
1. **Pin what must not move.** Add a `pin:` entry with a `selector`, `fields` and a `reason` (one of
   `provider-qualification`, `wire-compat-regression`, `pricing-table`, `capability-gate`,
   `compliance`) for every field a qualification run depends on. An operator `--overlay` or `--bind`
   can then not change it silently.
1. **Select Ollama explicitly.** Use `service = "ollama-chat"` (YAML: `service: ollama-chat`) with the
   model declared in `catalog.models`. Do not write a `meta` or `qwen` preference route.

**What an operator can do.** `--overlay <file>` (repeatable, JSON) and `--bind 'selector=field=value'`
rerun the scenario with different providers and no edit. Later layers win, and two layers that set the
same selector and field resolve to the later layer without `ambiguous_selector`. A pinned field is
protected by removing it from operator entries: an exact or more specific selector fails with
`pinned` before the daemon starts, a broader one is stripped and reported as `pin_kept`.

**Where the files live.** The runner writes overlays outside the sandbox. A service added only by a
run-time overlay needs its host in the base config's `allow_net`, or the run fails as `needs_restart`.

**Interfaces this touches.** `ICatalogPreset` carries a preset's fields, `BindingStepKind` gained a
judge kind, `loadBindingLayers` collapses same-selector entries per layer, `loadOverlays` rejects a
symlink or a file above `BINDING_OVERLAY_MAX_BYTES`, `planScenarioBindings` takes `compatFixturePort`
to substitute `__COMPAT_FIXTURE_PORT__`, and `IProviderLiveEvidenceInput` carries `overlays`,
`bindings`, `judges` and `pins` into the provider-live evidence file.

## See Also

This guide covers **internal** `swe_tasks` corpus tasks (content-only, against the `todo_app`
fixture). For adding a **new external public benchmark** (Terminal-Bench, SWE-bench, or a
future adapter), see
`tests/scenario_framework/templates/external_benchmark_adapter.template.md` and
`exaix-dev-docs/planning/phase-160-external-benchmark-harness-sota-hardening.md` — that path
implements the `IExternalBenchmarkAdapter` contract instead of this content-only workflow.
