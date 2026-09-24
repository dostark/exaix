---
name: coverage
agent: senior-coder
tools:
  - run_command
  - read_file
  - write_file
  - patch_file
  - search_files
scope: dev
title: "Coverage Skill (#coverage)"
description: Identify uncovered code paths, write targeted tests to meet thresholds, and verify with measure_coverage.ts
short_summary: "Coverage improvement workflow: measure → identify gaps → write targeted tests → re-measure until thresholds pass."
version: "1.0.0"
topics: ["testing", "coverage", "tdd", "ci", "quality"]
qwen_skill: coverage
---

```text
Key points

- Start by measuring — never guess which paths are uncovered.
- Write real behavioural tests, not trivial pass-throughs that game the numbers.
- CI thresholds: Line ≥ 70%, Branch ≥ 60% (enforced by scripts/measure_coverage.ts).
- Target untested business logic, error paths, and edge cases — not boilerplate.
- Tests meet the same quality bar as production tests (helpers, naming).
- Scope > ~20 files: batches of 5–10. Measure a batch, record gaps, continue.

Canonical prompt (short):
"Improve coverage for <module or full suite>. Measure first, identify the
lowest-covered paths with real business logic, write targeted tests, and
re-measure until CI thresholds pass."

Examples
- "#coverage — overall suite is below 70% line coverage"
- "#coverage packages/core/src/vault_service.ts — missing error-path tests"

Do / Don't
- ✅ Run measure_coverage.ts first for the baseline.
- ✅ Target functions/branches with real logic — not trivial getters.
- ✅ Verify behaviour, not call count.
- ✅ Use Exaix helpers (initTestDbService, createCliTestContext, etc.).
- ✅ Re-run measure_coverage.ts after each batch.
- ✅ Check branch coverage separately — 90% line with 30% branch is common.
- ❌ Add empty assertions or trivial tests to inflate numbers.
- ❌ Suppress coverage via ignore comments without documented justification.
- ❌ Skip CI gates (lint, type-check) when adding test files.

Related: #fix-bug (untested bug found — fix first); #next-steps (coverage as a phase
criterion); #commit.

Workflow chain: #next-steps (phase complete) → **#coverage** → #commit
```

## See also

- [test-development](../test-development/SKILL.md) — test helpers, coverage targets, placement
- [tdd-workflow](../tdd-workflow/SKILL.md) — TDD red-green-refactor cycle

---

## Instructions for Agent

Improve Exaix test coverage: measure the baseline, identify high-value uncovered paths, write targeted tests, re-measure until thresholds pass.

### Phase 1 — Measure Baseline

```bash
deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts
```

Capture overall line % and branch %, the per-file breakdown (lowest first), and the
thresholds (Line ≥ 70%, Branch ≥ 60%). Report the baseline before proceeding.

### Phase 2 — Identify High-Value Gaps

Per low-coverage file (start with the bottom 10 by line %):

1. Read the source.
1. Find uncovered functions/branches — focus on:
   - Error handling (`catch` blocks, early `return` with error)
   - Edge cases (`if (!x)`, `x === null`, empty array, max size)
   - Business logic (state transitions, conditional feature paths)
   - Skip trivial auto-generated code or pure delegation.
1. Prioritise by impact: could the uncovered path fail silently in production?

### Phase 3 — Write Targeted Tests (TDD)

Per selected gap:

1. Write a named test exercising the uncovered path.
   - Name: `"<module>: <path description>"`, e.g.
     `"VaultService: throws on missing encryption key"`.
   - Helpers: `initTestDbService` / `createCliTestContext` / `TestEnvironment.create()`.
   - Timer-based TUI tests: `sanitizeOps: false, sanitizeResources: false`.
1. Run the file; the test passes (coverage tests verify existing behaviour, not new
   requirements):
   ```bash
   deno test --allow-all <test-file>
   ```
1. Test reveals a bug? Pause and use `#fix-bug` first.

### Phase 4 — Re-measure

After each batch:

```bash
deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts
```

Report the delta per modified file. Repeat Phases 2–4 until line ≥ 70% AND branch ≥ 60%,
or diminishing returns (remaining paths intentionally excluded or untestable without live
infrastructure).

### Phase 5 — Exclusion Documentation

Unexposed paths:

- Live-infrastructure-dependent (LLM calls, real DB) → comment why in the test file and
  tag the test `provider-live`.
- Truly unreachable code → remove it, or comment the invariant that makes it unreachable.
- Auto-generated/schema boilerplate → document the exclusion in `measure_coverage.ts`
  under `COVERAGE_EXCLUDE_PATTERNS`.

### Phase 6 — CI Gates

```bash
deno lint <new-test-files>
deno check <src-files>
deno fmt <new-test-files>
deno task check:arch
```

No new UNGROUNDED files, no lint errors.

## Output Format

1. **Baseline** — overall line%, branch%, bottom-10 files.
1. **Gaps selected** — which functions/branches and why.
1. **Tests written** — file paths and test names.
1. **Coverage delta** — before/after per file and overall.
1. **Residual gaps** — remaining low-coverage paths and why deferred/excluded.
1. **CI gate results** — lint, type-check, arch.
1. **Commit payload** — use `#commit`.

## Workflow Chain

#next-steps (phase complete) → **#coverage** → #commit

## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules for test code

---
exaix:
  skill_id: coverage
  related_skills: [test-development, tdd-workflow]
  triggers:
    keywords: [coverage, test-coverage, uncovered, untested, threshold]
    task_types: [testing]
    tags: [coverage, testing]
  constraints:
    - "Run measure_coverage.ts before and after writing tests"
    - "Target uncovered code paths reported by coverage tool"
    - "Do not reduce overall line or branch coverage"
    - "Preferred file-scoped test commands — full suite for cross-cutting only"
  output_requirements:
    - "Coverage delta report (before vs after)"
    - "Targeted tests for previously uncovered paths"
    - "All tests passing after new tests added"
  quality_criteria:
    - name: path_closure
      description: Every reported uncovered path has a corresponding test
      weight: 40
    - name: threshold_defense
      description: Line coverage does not drop below 70%, branch below 60%
      weight: 30
    - name: minimal_overhead
      description: Tests are concise and targeted, not blanket coverage
      weight: 30
---
