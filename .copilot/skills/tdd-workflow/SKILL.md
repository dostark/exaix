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
- Always write the failing test BEFORE writing any source code (RED must come first)
- Use Exaix test helpers: initTestDbService(), createCliTestContext(), withEnv(), MockLLMProvider
- Use TestEnvironment.create() for full integration scaffolding
- Verify coverage doesn't drop after implementation
- TDD is non-negotiable — no implementation without a prior failing test
- When modifying existing source code, add tests to the existing test file — write the failing test first, then modify the source
- When the scope involves more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue
- If GREEN cannot be reached after 2 implementation attempts, revert to the pre-RED state and use `#review-research` or `#plan` to re-analyse the design before retrying.

Canonical prompt (short):
"Apply TDD to [feature/bug/refactor] for [component]. Write failing test first,
implement minimal code, refactor, verify coverage. Use Exaix test helpers and
inject context for the relevant domain."

Workflow
────────
CONTEXT phase
  1. Identify the component, domain, and relevant test helpers.
     - DB + tempdir: use initTestDbService()
     - CLI commands: use createCliTestContext()
     - Temporary env vars: use withEnv()
     - LLM/AI behavior: use MockLLMProvider (never real API calls in tests)
     - Full integration workspace: use TestEnvironment.create()
  2. Read existing tests for the component to understand patterns already in use.
  3. Determine the test file path: package-owned code → `packages/<package>/tests/`; integration tests → `tests/`.

RED phase
  4. Write the failing test(s) that define the desired behavior:
     - New source file: import from the not-yet-existing module; RED = TS2307 (module not found).
     - Existing source modification: add tests to the existing test file; RED = assertion failure.
     - Use descriptive test names: what behavior is expected under what conditions.
     - Cover: happy path, edge cases, error cases.
     - For new test files, add a module-header JSDoc block (required by check:arch):
         /** @module XxxTest @path tests/... @description ... */
  5. Confirm RED: run `deno test --allow-all <test-file>` and verify it fails —
     never skip this step.

GREEN phase
  6. Create or modify the source file at the appropriate `packages/<package>/src/...` or `apps/<app>/src/...`
     path with the minimum implementation needed to pass all tests (no over-engineering).
     - New files must include module-header with @module, @path, @description,
       @architectural-layer, @dependencies, @related-files.
  7. Run `deno test --allow-all <test-file>` — all tests must pass.
  8. Fix test failures; do not suppress or skip tests.

REFACTOR phase
  9. Improve code quality without changing behavior (tests must stay green):
     - Extract magic numbers/strings into named constants
     - Apply Interface-first / constructor-injection patterns (see IFoo naming)
     - Remove any duplicate logic
 10. Run `deno test --allow-all <test-file>` again after refactor — still green.

CI gates
 11. deno lint <src-file> <test-file>
 12. deno check <src-file>
 13. deno task check:style   → fix interface naming (IFoo), no magic unions
 14. deno task check:arch    → all files GROUNDED, 0 UNGROUNDED
 15. deno fmt <src-file> <test-file>
 16. deno task check:magic   → reduce violations if new literals were added
 17. (when relevant) deno task check:complexity — refactor if threshold exceeded

Coverage check
 18. Run `deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts` — confirm:
     - Line coverage ≥ 70%
     - Branch coverage ≥ 60%
     If coverage dropped, add targeted tests for uncovered branches
     (see #coverage for the full coverage improvement workflow).

COMMIT
 19. Use #commit for the structured commit. Suggested type: `feat` or `fix`.
     Mandatory fields: what:, rationale:, tests:, who:, impact:.

Do / Don't
- ✅ Do write the test file BEFORE the source file (RED first, always)
- ✅ Do use initTestDbService() for DB tests, not raw SQLite setup
- ✅ Do use withEnv() for environment variable changes — never mutate globally
- ✅ Do add module-header JSDoc to every new file (src and test)
- ✅ Do use MockLLMProvider for deterministic AI tests
- ✅ Do run deno fmt before git add
- ✅ Do cover error paths, not just the happy path
- ✅ Do use sanitizeOps: false, sanitizeResources: false for timer-based tests
- ✅ Do skip setTimeout in test mode: if (Deno.env.get("DENO_TEST") !== "1") setTimeout(...)
- ❌ Don't write source code before the test (no exceptions)
- ❌ Don't call real LLM APIs in tests — use MockLLMProvider
- ❌ Don't use `as any` to fake a service — implement the full IFoo interface
- ❌ Don't leave suppressed or skipped tests in the committed state
- ❌ Don't reduce coverage thresholds — add tests instead

Related skills
- #next-steps         — Multi-step plan execution using this TDD cycle per step
- #coverage           — When coverage has dropped, run the full coverage improvement loop
- #fix-bug            — When a bug is found, this skill mandates regression tests first
- #refactor-check-magic — Run when check:magic violations are non-trivial
- #plan               — Create the feature plan before starting (precedes this skill)
- #commit             — Create a structured commit message after CI gates pass

Workflow chain (typical):
  #plan → #pre-gap-analysis → **#tdd-workflow** (per step, via #next-steps) → #post-gap-analysis
```

## Related

- [CLAUDE.md](../../../CLAUDE.md#behavioral-guidelines) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. CONTEXT: Component, test helper selection, test file path.
1. RED evidence: failing test run output (error type and line).
1. GREEN evidence: passing test run summary (N/N tests passing).
1. REFACTOR summary: changes made (constants extracted, interfaces applied, etc.).
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
