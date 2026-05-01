---
agent: general
scope: dev
title: "Next-Steps Skill (#next-steps)"
description: Run plan-driven TDD step-by-step workflow with CI gates and per-step commits
short_summary: "Prompt for iterating through .copilot/planning/ steps one-by-one using TDD red-green-refactor with CI gates and commits."
version: "0.2"
topics: ["tdd", "red-green-refactor", "planning", "steps", "ci", "commits"]
qwen_skill: next-steps
---

```text
Key points
- Work through .copilot/planning/phase-XX-*.md steps one-by-one
- Each step follows strict RED → GREEN → REFACTOR cycle
- After each step: mark success criteria ✅, run fast CI gates, commit
- Never skip ahead — complete and commit each step before starting the next
- Use focused, file-scoped test commands by default; reserve full-suite commands for massive changes or explicit user requests

Canonical prompt (short):
"Continue with implementation of next steps one-by-one in TDD red-green-refactor
manner. For each completed step mark implemented success criteria and tests, run
deno check, deno lint and other fast CI check scripts. Make occasional commits
with nice detailed messages describing rationale and what was changed/added."

Workflow per step
─────────────────
Validation policy
   0. Default to file-scoped validation. Prefer `deno test --allow-all <test-file>` or a small set of touched test files.
   0. Do not usually run full-suite commands such as `deno task test`, `deno task test_parallel`, `deno test -A`, or unscoped `deno test --allow-all` for a normal one-step cycle.
   0. Use full-suite test commands only in exclusive cases:
       - the change is massive or cross-cutting
       - the blast radius spans multiple subsystems or shared runtime foundations
       - the user explicitly requests a full run
       - a planning document explicitly requires repository-wide validation and the step is broad enough to justify it

RED phase
  1. Read the step's "Architecture notes", "Success criteria", and "Planned tests"
     from the .copilot/planning/ doc.
  2. Create the test file at the mirrored path under tests/.
  3. Add a module-header JSDoc block (required by check:arch):
       /** @module XxxTest @path tests/... @description ... */
  4. Write all planned tests — they must import the not-yet-existing source file
     so that `deno check` or `deno test` fails with TS2307 (module not found).
  5. Confirm RED: run `deno test --allow-all <test-file>` and verify it errors.

GREEN phase
  6. Create the source file at src/... with the minimum implementation needed to
     pass all tests (include a module-header with @module, @path, @description,
     @architectural-layer, @dependencies, @related-files).
  7. Run `deno test --allow-all <test-file>` — all tests must pass.
  8. Fix any test failures; do not skip tests.

REFACTOR + CI gates
  9. deno lint <src-file> <test-file>
 10. deno check <src-file>
 11. deno task check:style   → fix any errors (interface naming I*, no magic unions)
 12. deno task check:arch    → all files must be GROUNDED, 0 UNGROUNDED
 13. deno fmt <src-file> <test-file>  (run before commit, not after)
 14. (optional) deno task check:complexity  if implementation is non-trivial
 15. (exception only) run a full-suite command only when the validation policy above says it is warranted

Planning doc update
 16. In the step's "Success criteria" block change `- [ ]` → `- [x]` for each
     criterion now met.
 17. Change each planned-test bullet `- \`...\`` → `- ✅ \`...\``
 18. Add a line immediately after the test list:
       **✅ IMPLEMENTED** — `<src/path>`, N/N tests passing

Commit
 19. Stage: src file, test file, planning doc.
 20. Commit message format:
       feat(<scope>): implement <What> (Step N)

       <Short rationale paragraph>

       <src/path> (NEW):
       - <key exported symbol and purpose>
       - <notable design decisions>

       <test/path> (NEW):
       - N tests, all passing

       CI gates: lint OK, type-check OK, style 0 errors, arch N GROUNDED

       refs: <planning-doc-slug> step N

Do / Don't
- ✅ Do write the test file BEFORE the source file (RED must come first)
- ✅ Do add module-header JSDoc to every new file (src and test)
- ✅ Do run deno fmt before git add (avoid fmt pre-hook failures)
- ✅ Do mark planning doc checkboxes and add ✅ IMPLEMENTED after commit
- ✅ Do use IFoo interface naming (not Foo) — enforced by check:style
- ✅ Do use ICodeConvention["confidence"] instead of "low"|"medium"|"high" literal union
- ✅ Do keep test execution proportional to scope; prefer focused tests for a single-step cycle
- ❌ Don't implement source code before writing the failing test
- ❌ Don't batch multiple steps into one commit
- ❌ Don't proceed to the next step if any CI gate fails
- ❌ Don't use Record<string, unknown> — define a specific interface instead
- ❌ Don't commit without running deno fmt first
- ❌ Don't usually run `deno task test`, `deno task test_parallel`, `deno test -A`, or unscoped `deno test --allow-all` for a narrow step

Related skills
- #plan   — Create or extend a .copilot/planning/ document
- #commit — Create a structured commit message
- #fix    — Fix a bug discovered during implementation
```

## Output format

1. Step selected and why.
1. RED evidence (failing test/check output summary).
1. GREEN evidence (passing test summary).
1. REFACTOR/CI gate results.
1. Planning document updates and commit payload.
