---
name: tdd-workflow
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "TDD Workflow Skill (#tdd-workflow)"
description: Enforce test-driven development for any code change — write failing tests first, implement minimally, refactor, verify coverage
short_summary: "Autonomous skill for applying rigorous TDD red-green-refactor to any Exaix code change."
version: "1.0.0"
topics: ["tdd", "testing", "red-green-refactor", "coverage", "helpers"]
qwen_skill: tdd-workflow
---

```text
Key points

- Write the failing test BEFORE source code. RED must come first.
- Use the Exaix helpers: initTestDbService(), createCliTestContext(), withEnv(), MockLLMProvider.
- Use TestEnvironment.create() for full integration scaffolding.
- Keep coverage after implementation.
- TDD is non-negotiable: no implementation without a prior failing test.
- Existing source: add tests to the existing file — failing test first, then modify the source.
- Scope > ~20 files: work in batches of 5–10. Read a batch, record findings, continue.
- No GREEN after 2 attempts: revert to pre-RED, use `#review-research` or `#plan`, retry.

Canonical prompt (short):
"Apply TDD to [feature/bug/refactor] for [component]. Write failing test first,
implement minimal code, refactor, verify coverage. Use Exaix test helpers."

Workflow
────────
CONTEXT
  1. Identify component, domain, and helpers.
     - DB + tempdir: initTestDbService()
     - CLI: createCliTestContext()
     - Env vars: withEnv()
     - LLM/AI: MockLLMProvider (never real API calls in tests)
     - Integration workspace: TestEnvironment.create()
  2. Read existing tests for the component's patterns.
  3. Choose the test path: package code → `packages/<package>/tests/`; integration → `tests/`.

RED
  4. Write the failing test.
     - New file: import the not-yet-existing module. RED = TS2307.
     - Existing file: add tests there. RED = assertion failure.
     - Name tests by expected behavior and conditions.
     - Cover happy path, edge cases, errors.
     - New test files need a module-header JSDoc (check:arch):
         /** @module XxxTest @path tests/... @description ... */
  5. Confirm RED. Run `deno test --allow-all <test-file>`. Never skip.

GREEN
  6. Create/modify the source at `packages/<package>/src/...` or `apps/<app>/src/...`.
     Minimum change for all tests. No over-engineering.
     - New files need module-header with @module, @path, @description,
       @architectural-layer, @dependencies, @related-files.
  7. Run `deno test --allow-all <test-file>`. All tests pass.
  8. Fix failures. Do not suppress or skip tests.

REFACTOR
  9. Improve quality with tests green:
     - Extract magic numbers/strings into named constants
     - Apply Interface-first / constructor injection (IFoo naming)
     - Remove duplicate logic
 10. Run the test again. Still green.

CI
 11. deno lint <src-file> <test-file>
 12. deno check <src-file>
 13. deno task check:style   → fix interface naming (IFoo), no magic unions
 14. deno task check:arch    → all files GROUNDED, 0 UNGROUNDED
 15. deno fmt <src-file> <test-file>
 16. deno task check:magic   → reduce violations if new literals added
 17. deno task check:complexity — refactor if threshold exceeded (when relevant)

Coverage
 18. Run `deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts`:
     - Line ≥ 70%
     - Branch ≥ 60%
     Dropped? Add targeted tests for uncovered branches (see #coverage).

COMMIT
 19. Use #commit. Type: `feat` or `fix`. Fields: what:, rationale:, tests:, who:, impact:.

Do / Don't
- ✅ Write the test file BEFORE the source file. RED first, always.
- ✅ Use initTestDbService() for DB tests, not raw SQLite setup.
- ✅ Use withEnv() for env changes — never mutate globally.
- ✅ Add module-header JSDoc to every new file (src and test).
- ✅ Use MockLLMProvider for deterministic AI tests.
- ✅ Run deno fmt before git add.
- ✅ Cover error paths, not just the happy path.
- ✅ Use sanitizeOps: false, sanitizeResources: false for timer-based tests.
- ✅ Skip setTimeout in test mode: if (Deno.env.get("DENO_TEST") !== "1") setTimeout(...)
- ❌ Write source before the test. No exceptions.
- ❌ Call real LLM APIs in tests. Use MockLLMProvider.
- ❌ Use `as any` to fake a service. Implement the full IFoo interface.
- ❌ Leave suppressed or skipped tests in the commit.
- ❌ Reduce coverage thresholds. Add tests instead.

Related
- #next-steps — multi-step plan execution uses this TDD cycle per step
- #coverage — dropped coverage: run the full improvement loop
- #fix-bug — bug found: regression tests first
- #refactor — magic-value & duplication pass (check:magic)
- #plan — create the feature plan first (precedes this skill)
- #commit — structured commit message after CI gates pass

Workflow chain:
  #plan → #pre-gap-analysis → **#tdd-workflow** (per step, via #next-steps) → #post-gap-analysis
```

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules

## Output format

1. CONTEXT: Component, helper selection, test file path.
1. RED evidence: failing test output (error type and line).
1. GREEN evidence: passing test summary (N/N tests passing).
1. REFACTOR summary: constants extracted, interfaces applied, etc.
1. CI gate results: lint, type-check, style, arch, fmt, magic.
1. Coverage delta: before vs. after line/branch percentages.
1. Commit payload (use #commit).

## Examples

- `#tdd-workflow Add unit tests for PlanService.createPlan() then implement`
- `#tdd-workflow Cover validatePath() with edge cases (missing dir, symlink, escape)`
- `#tdd-workflow Implement EventLogger structured output — red-green-refactor cycle`

## See also

- [test-development](../test-development/SKILL.md) — test helpers, placement rules, patterns
- [exaix-development](../exaix-development/SKILL.md) — DI patterns, config constants, coding conventions

---
exaix:
  skill_id: tdd-methodology
  related_skills: [test-development, exaix-development]
  triggers:
    keywords: [tdd, test, red-green-refactor]
    task_types: [feature, bugfix, refactor]
    tags: [tdd, testing]
  constraints:
    - "Write the failing test BEFORE writing any source code (RED must come first)"
    - "TDD is non-negotiable -- no implementation without a prior failing test"
    - "When the scope involves more than ~20 files, work in batches of 5-10"
  output_requirements:
    - "CONTEXT: Component, test helper selection, test file path"
    - "RED evidence: failing test run output (error type and line)"
    - "GREEN evidence: passing test run summary (N/N tests passing)"
  quality_criteria:
    - name: tdd_compliance
      description: Tests were written before implementation for every behaviour change
      weight: 40
    - name: ci_gate_compliance
      description: All CI gates pass before each commit (lint, type-check, style, arch, magic)
      weight: 30
    - name: coverage_maintained
      description: Line coverage does not drop below 70%, branch below 60%
      weight: 30
---
