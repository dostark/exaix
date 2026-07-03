---
name: test-development
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: test
title: "Test Development Skill (#test-development)"
description: Write tests following Exaix conventions
short_summary: "Write tests for Exaix using the right helpers, placement rules, and patterns."
version: "1.0.0"
topics: ["testing", "tdd", "coverage", "test-helpers"]
qwen_skill: test-development
---

```text
Key points

See also
  Test directory structure   →  [tests/README.md](../../tests/README.md)
  Shared test helpers        →  [packages/testing/README.md](../../packages/testing/README.md)
  Integration test framework →  [tests/integration/README.md](../../tests/integration/README.md)
  Scenario / eval framework  →  [tests/scenario_framework/README.md](../../tests/scenario_framework/README.md)

Unified test helpers (prefer these over bespoke setup):
  - initTestDbService()      — DatabaseService + tempdir setup
  - createCliTestContext()   — CLI test with DB + tempdir, call cleanup() in afterEach
  - withEnv()                — Temporary env var changes
  - TestEnvironment.create() — Full workspace/DB/git scaffold for integration tests
  - MockLLMProvider          — Deterministic LLM responses (avoid real API calls)

Canonical prompt (short):
"Write tests for {feature}. Use initTestDbService() or createCliTestContext()
where appropriate. Follow the test target map below for file placement."
```

## Test placement

Package-owned code → package tests, app-owned → app tests, cross-cutting → root `tests/`:

- `packages/<name>/src/...` → `packages/<name>/tests/...`
- `apps/<name>/src/...` → `apps/<name>/tests/...`
- `scripts/...` → `tests/scripts/...`
- Cross-package integration → `tests/integration/...`
- Scenario / evaluation → `tests/scenario_framework/...`

Enforced by `deno task check:test-placement`.

## Patterns

### Coverage-Driven TDD

Target ≥70% branch coverage on new features. Run `deno task test:coverage`.

### Security Tests

Label security boundary tests with `[security]`. Cover path traversal, injection, symlink escapes. Run `deno task test:security`.

### Env vars

Use `EXA_TEST_*` prefix. Access via `@exaix/core/config/env_schema.ts`:

```typescript
import { isCIMode, isTestMode } from "@exaix/core/config/env_schema.ts";
if (isTestMode()) { /* skip timers */ }
if (isCIMode() && !Deno.env.get("EXA_TEST_ENABLE_PAID_LLM")) { /* skip paid API */ }
```

### CI pitfall

Prefer `Deno.Command(Deno.execPath(), { args: ["run", ...] })` over compiled binaries.

## Output format

1. **Target file(s)** — test files created or modified.
2. **Helpers used** — initTestDbService, createCliTestContext, etc.
3. **Test command** — how to run.
4. **Coverage check** — deno task test:coverage result.

## Examples

- `#test-development Add unit tests for PlanWriter error handling`
- `#test-development Write security tests for file path validation`

## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

```
---
exaix:
  skill_id: test-development
  triggers:
    keywords: [test, testing, coverage, tdd]
    task_types: [testing]
    tags: [testing]
  constraints:
    - "Use shared helpers (initTestDbService, createCliTestContext)"
    - "Place tests per package/app/root boundary"
    - "Label security tests [security]"
    - "Use EXA_TEST_* env vars"
  output_requirements:
    - "Target test files created or modified"
    - "Helpers and patterns used"
    - "Test command and coverage check results"
  quality_criteria:
    - name: placement_compliance
      description: Test placement follows boundaries
      weight: 40
    - name: helper_usage
      description: Shared helpers used
      weight: 30
    - name: coverage_target
      description: Coverage met or verified
      weight: 30
---
```
