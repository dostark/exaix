---
name: fix-bug
agent: general
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
  - git_status
  - git_commit
scope: dev
title: "Fix Bug Skill (#fix-bug)"
description: Fix a bug or failing test using TDD root-cause loop — regression test first, minimal fix, CI gates, structured commit
short_summary: "Systematic bug-fix workflow: reproduce → regress → fix → CI gates → commit. Never skip the regression test."
version: "1.0.0"
topics: ["bug-fix", "tdd", "regression", "root-cause", "ci", "validation"]
qwen_skill: fix-bug
---

```text
Key points

- NEVER fix before a failing regression test. RED must come first.
- Fix only the root cause, not the symptom. Diff the fix to confirm scope.
- File-scoped tests by default; full suite only when blast radius is wide.
- Multiple test files failing at once? Identify the single root cause first — one fault,
  one regression test.
- All CI gates pass before committing.
- No GREEN after 2 attempts: revert, use `#review-research`, retry.
- Tracing > ~20 files: batches of 5–10. Read a batch, record findings, continue.

Canonical prompt (short):
"Fix <bug/failing test>. Reproduce it in a regression test first, then implement
the minimal fix to make it pass. Run CI gates and commit with #commit."

Examples
- "#fix-bug PathResolver is not resolving symlinks to files outside the portal"
- "#fix-bug deno test tests/services/memory_bank_test.ts — 3 failing tests"

Workflow
────────
REPRODUCE
  1. Read the bug report or failing test output in full.
  2. Locate the source file(s) and related test file(s).
  3. Confirm reproducibility:
       deno test --allow-all <test-file>     (existing failing tests)
       deno check <src-file>                 (type errors)
  4. Find the root cause by reading source — not just the stack trace.

REGRESSION TEST (RED)
  5. In the relevant test file (or a new one), write a named test that:
     - reproduces the exact failure scenario
     - is named "fix(<component>): <what it should do>"
     - uses the established helpers (initTestDbService, createCliTestContext, etc.)
  6. Confirm RED: the new test fails before the fix.
       deno test --allow-all <test-file>   → must error or fail

FIX (GREEN)
  7. Minimum change to pass the regression test.
     - No unrelated refactors in the same change.
     - No public interface changes unless strictly necessary.
  8. Run the regression test again — it must pass.
       deno test --allow-all <test-file>   → must pass

CI GATES
  9. deno lint <src-file> <test-file>
 10. deno check <src-file>
 11. deno task check:arch   → no new UNGROUNDED files
 12. deno fmt <src-file> <test-file>
 13. deno task check:magic  (if new literals added — optional)
 14. No regressions in adjacent test files touched by the change.

COMMIT
 15. Use #commit. Type: `fix(<scope>): <description>`. Fields: what:, rationale:,
     tests:, who:, impact:.

Do / Don't
- ✅ Write the regression test BEFORE the fix. RED first.
- ✅ Name the regression test after the failure scenario.
- ✅ Confirm RED before implementing.
- ✅ Fix only the root cause — keep the diff minimal.
- ✅ Use Exaix test helpers (initTestDbService, createCliTestContext, etc.).
- ✅ Run all CI gates before committing.
- ✅ Use #commit for the final message.
- ❌ Fix without a regression test.
- ❌ Refactor unrelated code in the same change.
- ❌ Skip CI gates.
- ❌ Suppress a test to make it "pass".
- ❌ Use --no-verify.

Related: #next-steps (return after the fix); #commit (structured commit); #audit-security
(security-related bugs first); #refactor-check-magic (new literals).
```

## See also

- [test-development](../test-development/SKILL.md) — regression test patterns, helpers
- [exaix-development](../exaix-development/SKILL.md) — source patterns, DI, config conventions

## Output Format

1. **Root cause** — why the bug occurred.
1. **Regression test** — file path and test name.
1. **Fix summary** — what changed and why it resolves the root cause.
1. **CI gate results** — lint, type-check, arch, fmt.
1. **Commit payload** — use `#commit`.

## Workflow Chain

#next-steps (bug discovered) → **#fix-bug** → #commit

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines
- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules

---
exaix:
  skill_id: fix-bug
  related_skills: [test-development, exaix-development]
  triggers:
    keywords: [fix, bug, bugfix, failing-test, defect, regression]
    task_types: [bugfix]
    tags: [bugfix, tdd]
  constraints:
    - "Write regression test first that reproduces the bug (RED phase)"
    - "Implement minimal fix to pass the test (GREEN phase)"
    - "Run all CI gates after fix to prevent regressions"
    - "If GREEN unreachable after 2 attempts, revert and re-analyse"
    - "Use structured commit with bug reference"
  output_requirements:
    - "RED evidence: failing test reproducing the bug"
    - "GREEN evidence: all tests passing after fix"
    - "CI gates clean before commit"
    - "Structured commit message referencing the bug"
  quality_criteria:
    - name: regression_test
      description: Test written that reproduces the bug before fix
      weight: 40
    - name: minimal_fix
      description: Only the minimum code changed to fix the bug
      weight: 30
    - name: ci_gate_compliance
      description: All CI gates pass before commit
      weight: 30
---
