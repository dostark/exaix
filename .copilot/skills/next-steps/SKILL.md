---
name: next-steps
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
title: "Next-Steps Skill (#next-steps)"
description: Run plan-driven TDD step-by-step workflow with CI gates and per-step commits
short_summary: "Prompt for iterating through .copilot/planning/ steps one-by-one using TDD red-green-refactor with CI gates and commits."
version: "1.0"
topics: ["tdd", "red-green-refactor", "planning", "steps", "ci", "commits"]
qwen_skill: next-steps
---

```text
Key points
- Work through .copilot/planning/phase-XX-*.md steps one-by-one
- Each step follows strict RED → GREEN → REFACTOR cycle
- After each step: mark success criteria ✅, run fast CI gates, commit
- Never skip ahead — complete and commit each step before starting the next
- If interrupted mid-step, re-read the RED/GREEN evidence in the chat to determine which phase you are in before proceeding
- Use focused, file-scoped test commands by default; reserve full-suite commands for massive changes or explicit user requests
- When reading plan references across more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue

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
  1. Restate the step context: read the step's "Architecture notes", "Success criteria",
     and "Planned tests" from the .copilot/planning/ doc. Briefly confirm what will be
     built (e.g. "Implementing Step 3.2: Add user authentication validation").
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
 14. deno task check:magic   → if new string/number literals were added, reduce violations
     (use #refactor-check-magic if the count is non-trivial)
 15. (optional) deno task check:complexity  if implementation is non-trivial
     (complexity threshold: 15 — refactor any function breaching it)
 16. (exception only) run a full-suite command only when the validation policy above says it is warranted

Planning doc update
 17. In the step's "Success criteria" block change `- [ ]` → `- [x]` for each
     criterion now met.
 18. Change each planned-test bullet `- \`...\`` → `- ✅ \`...\``
 19. Add a line immediately after the test list:
       **✅ IMPLEMENTED** — `<src/path>`, N/N tests passing

Commit
 20. Stage: src file, test file, planning doc.
 21. Use #commit for the full structured commit body. At minimum the subject line must
     follow conventional commits and the body must include what:, rationale:, tests:,
     who:, and impact: fields. A concise per-step shorthand is acceptable:
       feat(<scope>): implement <What> (Step N)

       what: <implementation summary>
       rationale: <why>
       tests: <test file>, N/N passing
       who: <your agent identity>
       impact: <ARCHITECTURE.md component>: <detail>

       CI gates: lint OK, type-check OK, style 0 errors, arch N GROUNDED, magic OK

       refs: <planning-doc-slug> step N

Do / Don't
- ✅ Do write the test file BEFORE the source file (RED must come first)
- ✅ Do add module-header JSDoc to every new file (src and test)
- ✅ Do run deno fmt before git add (avoid fmt pre-hook failures)
- ✅ Do mark planning doc checkboxes and add ✅ IMPLEMENTED after commit
- ✅ Do use IFoo interface naming (not Foo) — enforced by check:style
- ✅ Do use ICodeConvention["confidence"] instead of "low"|"medium"|"high" literal union
- ✅ Do keep test execution proportional to scope; prefer focused tests for a single-step cycle
- ✅ Do document any edge cases handled and any deviations from the plan in the commit body
- ❌ Don't implement source code before writing the failing test
- ❌ Don't batch multiple steps into one commit
- ❌ Don't proceed to the next step if any CI gate fails
- ❌ Don't use Record<string, unknown> — define a specific interface instead
- ❌ Don't commit without running deno fmt first
- ❌ Don't usually run `deno task test`, `deno task test_parallel`, `deno test -A`, or unscoped `deno test --allow-all` for a narrow step

Related skills
- #plan              — Create or extend a .copilot/planning/ document (precedes this skill)
- #pre-gap-analysis  — Validate the plan before starting (precedes this skill)
- #post-gap-analysis — Deep review when all steps are complete (follows this skill)
- #commit            — Create a structured commit message (used at end of each step)
- #tdd-workflow      — Full TDD red-green-refactor reference for individual components (used within each step)
- #refactor-check-magic — Run when check:magic violations are non-trivial
- #fix-bug           — Fix a bug discovered during implementation (branches off this skill)

Workflow chain (typical):
  #plan → #pre-gap-analysis → **#next-steps** → #post-gap-analysis → #commit
```

## Related

- [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. Step selected and why.
1. RED evidence (failing test/check output summary).
1. GREEN evidence (passing test summary).
1. REFACTOR/CI gate results.
1. Planning document updates and commit payload.

## Examples

- `#next-steps .copilot/planning/phase-14-caching.md` — execute the next unstarted step
- `#next-steps Step 3: Add ICache interface and inject into LLMProvider`
- `#next-steps Continue phase-76 — pick up from last completed step`
