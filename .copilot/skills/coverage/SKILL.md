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
version: "1.0"
topics: ["testing", "coverage", "tdd", "ci", "quality"]
qwen_skill: coverage
---

```text
Key points
- Always start by measuring — never guess which paths are uncovered.
- Write real behavioural tests — not trivial pass-through tests to game the numbers.
- CI thresholds: Line ≥ 70%, Branch ≥ 60% (enforced by scripts/measure_coverage.ts).
- Focus on untested business logic, error paths, and edge cases — not boilerplate.
- Tests must follow the same quality bar as production tests (helpers, naming, etc.).
- When the scope involves more than ~20 files, work in batches of 5–10: measure a batch, record gaps, then continue.

Canonical prompt (short):
"Improve coverage for <module or full suite>. Measure first, identify the
lowest-covered paths with real business logic, write targeted tests, and
re-measure until CI thresholds pass."

Examples
- "#coverage — overall suite is below 70% line coverage"
- "#coverage packages/core/src/vault_service.ts — missing error-path tests"

Do / Don't
- ✅ Do run measure_coverage.ts first to get the baseline.
- ✅ Do target functions/branches with real logic — not trivial getters.
- ✅ Do write tests that verify behaviour, not just call count.
- ✅ Do use Exaix test helpers (initTestDbService, createCliTestContext, etc.).
- ✅ Do re-run measure_coverage.ts after each batch to confirm improvement.
- ✅ Do check branch coverage separately — a file can have 90% line but 30% branch.
- ❌ Don't add empty assertions or trivial tests to inflate numbers.
- ❌ Don't suppress coverage via ignore comments without documented justification.
- ❌ Don't skip CI gates (lint, type-check) when adding test files.

Related skills:
- #fix-bug   — If coverage reveals an untested bug, fix it first
- #next-steps — If coverage is tracked as a phase success criterion
- #commit    — Structured commit after coverage improvements

Workflow chain:
  #next-steps (phase complete) → **#coverage** → #commit
```

---

## Instructions for Agent

You are improving test coverage for the Exaix repository.

### Phase 1 — Measure Baseline

Run coverage measurement:

```bash
deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts
```

Capture:

- Overall line coverage % and branch coverage %.
- Per-file breakdown: identify files with the lowest line or branch percentages.
- The current thresholds: Line ≥ 70%, Branch ≥ 60%.

Report the baseline in the chat output before proceeding.

### Phase 2 — Identify High-Value Gaps

For each low-coverage file (start with the bottom 10 by line%):

1. Read the source file.
2. Identify functions and branches that are **not** covered, focusing on:
   - Error handling paths (`catch` blocks, early `return` with error).
   - Edge case branches (`if (!x)`, `x === null`, empty array, max size).
   - Business logic branches (state machine transitions, conditional feature paths).
   - Skip trivial auto-generated code or pure delegation methods.

3. Prioritise by **impact**: does the uncovered path contain real business logic
   that could silently fail in production?

### Phase 3 — Write Targeted Tests (TDD style)

For each selected gap:

1. Write a named test that exercises the uncovered path.
   - Name format: `"<module>: <path description>"` e.g.,
     `"VaultService: throws on missing encryption key"`.
   - Use `initTestDbService` / `createCliTestContext` / `TestEnvironment.create()` as needed.
   - For timer-based TUI tests: add `sanitizeOps: false, sanitizeResources: false`.
2. Run the test file to confirm the test passes (it should pass — coverage tests verify
   existing behaviour, not introduce new requirements).
   ```bash
   deno test --allow-all <test-file>
   ```
3. If the test reveals a bug, pause and use `#fix-bug` before continuing.

### Phase 4 — Re-measure

After each batch of new tests:

```bash
deno run --allow-run --allow-read --allow-write scripts/measure_coverage.ts
```

Report the delta (before vs. after) for each modified file.

Repeat Phase 2–4 until:

- Overall line coverage ≥ 70% AND branch coverage ≥ 60%.
- Or diminishing returns (remaining uncovered paths are intentionally excluded
  or untestable without live infrastructure).

### Phase 5 — Exclusion Documentation

If any paths remain uncovered because they are:

- Live-infrastructure-dependent (LLM calls, real DB) → add a comment in the test
  file explaining why, and tag the test with `provider-live`.
- Truly unreachable code → remove the dead code or add a comment explaining the
  invariant that makes it unreachable.
- Auto-generated / schema boilerplate → document the exclusion in `measure_coverage.ts`
  under `COVERAGE_EXCLUDE_PATTERNS`.

### Phase 6 — CI Gates

Before committing:

```bash
deno lint <new-test-files>
deno check <src-files>
deno fmt <new-test-files>
deno task check:arch
```

Confirm no new UNGROUNDED files and no lint errors.

---

## Output Format

1. **Baseline** — overall line%, branch%, and bottom-10 files by line coverage.
2. **Gaps selected** — which functions/branches were chosen and why.
3. **Tests written** — file paths and test names.
4. **Coverage delta** — before/after per file and overall.
5. **Residual gaps** — any remaining low-coverage paths and the reason they are
   deferred or excluded.
6. **CI gate results** — lint, type-check, arch status.
7. **Commit payload** — use `#commit` to generate the final structured message.

## Workflow Chain

#next-steps (phase complete) → **#coverage** → #commit

## Related

- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules for any new test code
