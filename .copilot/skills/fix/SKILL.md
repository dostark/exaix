---
agent: general
scope: dev
title: "Fix Skill (#fix)"
description: Fix a bug or failing test using TDD root-cause loop — regression test first, minimal fix, CI gates, structured commit
short_summary: "Systematic bug-fix workflow: reproduce → regress → fix → CI gates → commit. Never skip the regression test."
version: "1.0"
topics: ["bug-fix", "tdd", "regression", "root-cause", "ci", "validation"]
qwen_skill: fix
---

```text
Key points
- NEVER fix before writing a failing regression test. RED must come first.
- Fix only the root cause — not the symptom. Diff the fix to confirm scope.
- Run file-scoped tests by default; full suite only when blast radius is wide.
- All CI gates must pass before committing.

Canonical prompt (short):
"Fix <bug/failing test>. Reproduce it in a regression test first, then implement
the minimal fix to make it pass. Run CI gates and commit with #commit."

Examples
- "#fix PathResolver is not resolving symlinks to files outside the portal"
- "#fix deno test tests/services/memory_bank_test.ts — 3 failing tests"

Workflow
─────────
REPRODUCE phase
  1. Read the bug report or failing test output in full.
  2. Locate the source file(s) and related test file(s).
  3. Confirm the failure is reproducible:
       deno test --allow-all <test-file>     (for existing failing tests)
       deno check <src-file>                 (for type errors)
  4. Identify the root cause by reading the source — not just the stack trace.

REGRESSION TEST phase (RED)
  5. In the relevant test file (or a new dedicated regression test file), write
     a named test that:
     - reproduces the exact failure scenario
     - has a descriptive name: "fix(<component>): <what it should do>"
     - uses the established test helpers (initTestDbService, createCliTestContext, etc.)
  6. Confirm RED: the new test must fail before the fix.
       deno test --allow-all <test-file>   → must error or fail

FIX phase (GREEN)
  7. Implement the minimum change to make the regression test pass.
     - Do NOT refactor unrelated code in the same change.
     - Do NOT change public interfaces unless strictly necessary.
  8. Run the regression test again — it must pass.
       deno test --allow-all <test-file>   → must pass

CI GATES (REFACTOR)
  9. deno lint <src-file> <test-file>
 10. deno check <src-file>
 11. deno task check:arch   → confirm no UNGROUNDED files introduced
 12. deno fmt <src-file> <test-file>
 13. (optional) deno task check:magic  if new literals were added
 14. Confirm no regressions in adjacent test files touched by the change.

COMMIT
 15. Use #commit for the structured commit. Suggested type: `fix(<scope>): <description>`.
     Mandatory fields: what:, rationale:, tests:, who:, impact:.

Do / Don't
- ✅ Do write the regression test BEFORE the fix (RED must come first).
- ✅ Do name the regression test after the failure scenario.
- ✅ Do confirm RED before implementing.
- ✅ Do fix only the root cause — keep the diff minimal.
- ✅ Do use Exaix test helpers (initTestDbService, createCliTestContext, etc.).
- ✅ Do run all CI gates before committing.
- ✅ Do use #commit for the final commit message.
- ❌ Don't fix without a regression test.
- ❌ Don't refactor unrelated code in the same change.
- ❌ Don't skip CI gates.
- ❌ Don't suppress a test to make it "pass".
- ❌ Don't use --no-verify.

Related skills:
- #next-steps       — If the bug was found during a phase step, return to it after fixing
- #commit           — Create the structured commit after the fix
- #security         — If the bug is security-related, run Phase 3b checks first
- #refactor-check-magic — If the fix introduced new literals, reduce magic violations
```

---

## Instructions for Agent

You are performing a **systematic bug fix** following the TDD root-cause loop.

### Phase 1 — Reproduce

1. Read the full failure output (stack trace, test failure, type error).
2. Locate the source file and test file.
3. Run `deno test --allow-all <test-file>` or `deno check <src-file>` to confirm
   the failure is reproducible.
4. Read the source to identify root cause — not just the surface symptom.

### Phase 2 — Regression Test (RED)

1. Write a named regression test in the appropriate test file.
   - Use `initTestDbService` / `createCliTestContext` / `TestEnvironment.create()` as needed.
   - Name format: `"fix(<component>): <what it should do>"`.
2. Confirm RED: run the test and verify it fails.

### Phase 3 — Fix (GREEN)

1. Implement the minimum code change to make the regression test pass.
2. Do not touch unrelated code.
3. Confirm GREEN: run the test and verify it passes.

### Phase 4 — CI Gates

Run in order:

1. `deno lint <src-file> <test-file>`
2. `deno check <src-file>`
3. `deno task check:arch`
4. `deno fmt <src-file> <test-file>`
5. Spot-check adjacent tests: `deno test --allow-all <affected-test-dir>`

### Phase 5 — Commit

Use `#commit` for the structured commit. Type must be `fix`. Include the regression test
in the `tests:` field.

---

## Output Format

1. **Root cause** — concise explanation of why the bug occurred.
2. **Regression test** — file path and test name.
3. **Fix summary** — what changed and why it resolves the root cause.
4. **CI gate results** — lint, type-check, arch, fmt status.
5. **Commit payload** — use `#commit` to generate the final structured message.

## Workflow Chain

  #next-steps (bug discovered) → **#fix** → #commit

## Related

- [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules
