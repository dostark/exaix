# Authoring swe_tasks Benchmark Tasks

## Task Directory Structure

Each task lives under `fixtures/swe_tasks/<task-id>/` with three files:

```
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
  ```
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

```
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

```
deno test --allow-all tests/scenario_framework/tests/unit/task_contract_schema_test.ts
```

This validates that `task.json` parses, the portal directory exists, and
`reference.patch` + `TASK.md` are present.
