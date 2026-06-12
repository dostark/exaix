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
version: "1.4"
topics: ["tdd", "red-green-refactor", "planning", "steps", "ci", "commits", "reachability"]
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
- **Reachability ledger (lives IN THE PLANNING DOC)**: a step that adds a symbol with NO production importer appends a row to a **Reachability Ledger** table kept in the planning doc itself — not just chat/commit, so the debt survives context compaction and is visible to anyone reading the plan. Each later step that wires an item closes its row in the same commit. The PHASE cannot be marked complete while any row is still ⏳ — see VERIFY step 11, the ledger template (step 24a), and the Phase-completion gate. A green package-unit test proves correctness, NOT that production calls the code; the test is the only caller.

Canonical prompt (short):
"Continue with implementation of next steps one-by-one in TDD red-green-refactor
manner. For each completed step mark implemented success criteria and tests, run
deno check, deno lint and other fast CI check scripts. Make one commit per completed step
with a detailed message describing rationale and what was changed/added."

Workflow per step
─────────────────
Validation policy
   0a. Default to file-scoped validation. Prefer `deno test --allow-all <test-file>` or a small set of touched test files.
   0b. Do not usually run full-suite commands such as `deno task test`, `deno task test_parallel`, `deno test -A`, or unscoped `deno test --allow-all` for a normal one-step cycle.
   0c. Use full-suite test commands only in exclusive cases:
       - the change is massive or cross-cutting
       - the change modifies files imported by more than 3 unrelated packages, or modifies shared utilities/base classes used across subsystems (e.g. files under packages/core/src/runtime/)
       - the user explicitly requests a full run
       - a planning document explicitly requires repository-wide validation and the step is broad enough to justify it

RED phase
   1. Restate the step context: read the step's "Architecture notes", "Success criteria",
      and "Planned tests" from the .copilot/planning/ doc. Briefly confirm what will be
      built (e.g. "Implementing Step 3.2: Add user authentication validation").
   2. Cross-reference against pre-gap analysis: if the plan document has a
      Pre-Gap Analysis section with findings for this step number, read each relevant
      gap entry and confirm the step's Planned Tests and Architecture Notes address
      them. Flag any pre-gap finding not covered by the step's tests.
   3. Create the test file at the mirrored path under tests/.
      If the step has no Planned tests, note this explicitly, skip the RED/GREEN test-file creation,
      and proceed directly to implementing the source file followed by REFACTOR/CI gates.
      Document the absence of tests in the commit body.
   4. Add a module-header JSDoc block (required by check:arch):
        /** @module XxxTest @path tests/... @description ... */
   5. Write all planned tests — they must import the not-yet-existing source file
      so that `deno check` or `deno test` fails with TS2307 (module not found).
   6. Confirm RED: run `deno test --allow-all <test-file>` and verify it errors.

GREEN phase
   7. Create the source file at the appropriate `packages/<package>/src/...` or `apps/<app>/src/...`
      path with the minimum implementation needed to pass all tests (include a module-header
      with @module, @path, @description, @architectural-layer, @dependencies, @related-files).
   8. Run `deno test --allow-all <test-file>` — all tests must pass.
   9. Fix any test failures; do not skip tests.

VERIFY phase — value correctness, wiring, consumer tracing, convention check
  10. Verify field values are correct, not just present.
      For every field the step introduces in events, schemas, or API responses:
      trace the component's injected dependencies and configuration to confirm the
      field's runtime value is consistent. A field whose value contradicts what the
      component's construction dictates is a gap even if tests pass.
  11. Verify constructor wiring for new services and classes — and DO NOT accept
      "a later step will wire it" as satisfying this check.
      For every new class, service, or data structure the step introduces:
      grep the production codebase (excluding tests and test helpers) for
      importers and instantiation sites. If the class is only instantiated
      in tests, it is PRODUCTION-DEAD code — invisible to TDD, coverage, and
      check:arch grounding (a test-only consumer keeps it "alive"; grounding is
      satisfied by a README/@related-files reference, not a real import). None of
      those gates detect a missing production caller; only this check does.
      - If a production consumer exists now: verify the class is injected via
        constructor DI into that consumer, or registered in the appropriate
        factory / registry / bootstrap module (e.g. apps/daemon/main.ts).
      - If NO production consumer exists yet: append a ⏳ row to the **Reachability
        Ledger** section of the planning doc (create the section if absent — see the
        template in step 24a), naming the symbol, the step that added it, and the
        named later step whose Actions contain the wiring. This is allowed ONLY if
        that later step IN THIS PLAN really contains the concrete wiring — deferral to
        "follow-ups", "a future phase", or an unnamed later step is NOT allowed;
        re-sequence so the wiring lands in this phase, or pause and surface it to the
        user. Stage the planning-doc ledger edit in THIS step's commit.
      - If the CURRENT step wires an item an earlier step put on the ledger: flip that
        row to ✅ and fill in the production call-site, in this step's commit.
      Every ledger row MUST be ✅ before the phase is closed (Phase-completion gate G2).
  12. Trace every output field to its consumer.
      Grep the codebase for consumers of each new exported symbol, interface field,
      or event payload field the step introduces. If a field has zero readers, flag
      it as dead data. If a field claims integration with an adjacent service, verify
      that service is actually wired and called.
  13. Check new code against existing module conventions.
      Survey 5–10 existing examples of the same concern (event emission, error
      handling, import style, type usage) in the same file or module. If the new code
      diverges from the dominant convention, flag it. Divergence without documented
      justification in the plan's Architecture Notes is a gap.

SECURITY gate (apply when the step touches portal code or any of: input parsing,
  file paths, database queries, subprocesses, HTTP handlers, auth, secrets)
  13a. Consult Blueprints/Skills/security-first.skill.md and verify the step
       addresses all applicable sections (input validation, path traversal,
       injection, auth boundary, secret handling, transport, dependency pinning).
  13b. If the step introduces a new input path, query, subprocess call, or HTTP
       handler, confirm a security test exists that asserts rejection-by-validation
       (tagged [security]).
  13c. Run deno task test:security if any security-relevant file was touched.

REFACTOR + CI gates
  14. deno lint <src-file> <test-file>
  15. deno check <src-file>
  16. deno task check:style   → fix any errors (interface naming I*, no magic unions)
  17. deno task check:arch    → all files must be GROUNDED, 0 UNGROUNDED
  18. deno fmt <src-file> <test-file>  (run before commit, not after)
  19. deno task check:magic   → if new string/number literals were added, reduce violations
      (use #refactor-check-magic if the count is non-trivial)
  20. (optional) deno task check:complexity  if implementation is non-trivial
      (complexity threshold: 15 — refactor any function breaching it)
  21. (exception only) See Validation policy above for when a full-suite command is warranted.

Planning doc update
  22. In the step's "Success criteria" block change `- [ ]` → `- [x]` for each
      criterion now met.
  23. Change each planned-test bullet `- \`...\`` → `- ✅ \`...\``
  24. Add a status line immediately after the test list, using the marker that
      reflects REACHABILITY (not merely "I wrote the code"):
        - **✅ WIRED** — `<src path>`, N/N tests passing, reached by `<production call-site file:Symbol>`
          (use ONLY when a production consumer invokes the code — verified in VERIFY step 11).
        - **✅ CORE** — `<src path>`, N/N tests passing; NOT yet reached by production
          (use when the symbol is on the pending-consumer ledger; NAME the later step in
          this plan that wires it).
      A bare **✅ IMPLEMENTED** is forbidden on any step whose Success Criteria assert
      runtime/observable behaviour — such a step is either ✅ WIRED or it is not done.
  24a. Maintain the **Reachability Ledger** section of the planning doc — create it
       once (if #plan did not seed it), then keep it current EVERY step. One row per
       symbol not yet reached by production:

         ## Reachability Ledger (pending production consumers)

         | Symbol                 | Added in | Wiring step | Production call-site   | Status |
         | ---------------------- | -------- | ----------- | --------------------- | ------ |
         | `SessionReturnWatcher` | Step 6   | Step 9      | `apps/daemon/main.ts` | ⏳     |

       Append a ⏳ row when VERIFY step 11 finds a production-dead symbol; flip Status
       to ✅ and fill the call-site when a later step wires it. Stage this doc edit in
       the same step's commit. Reading the ledger top-to-bottom is the to-do list the
       remaining steps (and the terminal cutover step) must drain — the phase is done
       only when every row is ✅ (or the ledger is empty).

Commit
  25. Stage: src file, test file, planning doc (including any Reachability Ledger
      row added or closed this step — step 24a).
  26. Use #commit for the full structured commit body. At minimum the subject line must
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

PHASE-COMPLETION GATE (run ONCE, after the last step, BEFORE declaring the phase complete)
  G1. Integration-surface audit across EVERY symbol the phase added: for each new
      exported class / service / function, grep the production codebase (excluding
      tests + test helpers) for a real importer or caller. ANY runtime-claiming symbol
      still production-dead is a BLOCKING failure — the phase cannot be marked complete.
      (This is the same audit #post-gap-analysis runs — running it here turns an
      after-the-fact finding into a pre-close gate.)
  G2. The planning doc's **Reachability Ledger** MUST have every row at ✅ (or be
      empty). Any ⏳ row is a BLOCKING failure — drain it (wire the symbol; that is
      the terminal cutover step's job) before closing the phase. Read the ledger as
      the residual to-do list.
  G3. For every opt-in flag the phase introduced, confirm a test flips the REAL config
      (e.g. `config.feature.enabled = true`) and asserts the observable behaviour — not
      a unit test of the gated component in isolation. "Enabling the flag does nothing"
      is a blocking failure.
  G4. If G1–G3 fail: do NOT close the phase. Either implement the missing wiring as
      additional steps in this phase, or pause and surface the production-dead set to
      the user with the explicit statement that the feature would ship non-functional.

Do / Don't
- ✅ Do write the test file BEFORE the source file (RED must come first)
- ✅ Do add module-header JSDoc to every new file (src and test)
- ✅ Do run deno fmt before git add (avoid fmt pre-hook failures)
- ✅ Do mark planning doc checkboxes and add ✅ IMPLEMENTED before commit (include in the step's staged files)
- ✅ Do use IFoo interface naming (not Foo) — enforced by check:style
- ✅ Do use ICodeConvention["confidence"] instead of "low"|"medium"|"high" literal union
- ✅ Do keep test execution proportional to scope; prefer focused tests for a single-step cycle
- ✅ Do verify field values are correct given the component's dependencies, not just present (step 10)
- ✅ Do verify new services and classes are wired into production code, not just tests (step 11)
- ✅ Do treat "no production importer" as a blocking debt on the pending-consumer ledger — never as "done" (step 11)
- ✅ Do keep the Reachability Ledger current IN THE PLANNING DOC every step — append a ⏳ row when a symbol is production-dead, flip it to ✅ when wired, stage the doc edit in that step's commit (step 24a)
- ✅ Do run the Phase-completion gate (integration-surface audit) before declaring the phase complete — production-dead runtime code blocks closure (G1–G4)
- ✅ Do mark runtime steps **✅ WIRED** only when a production caller exists; use **✅ CORE** (naming the wiring step) otherwise (step 24)
- ✅ Do trace new output fields to their consumers — dead fields with no readers are gaps (step 12)
- ✅ Do check new code against existing module conventions — inconsistency within a file is a gap (step 12)
- ✅ Do cross-reference the step's tests against pre-gap analysis findings for the same step number (step 2)
- ✅ Do document any edge cases handled and any deviations from the plan in the commit body
- ❌ Don't implement source code before writing the failing test
- ❌ Don't batch multiple steps into one commit
- ❌ Don't proceed to the next step if any CI gate fails
- ✅ If a CI gate failure cannot be resolved within the current step's file scope (e.g. check:arch failure in an unrelated file), document the blocker in a comment, pause execution, and surface the specific failing command output and file to the user for a decision before proceeding.
- ❌ Don't use Record<string, unknown> — define a specific interface instead
- ❌ Don't accept a green package-unit test as evidence a runtime success criterion is met — the test is the only caller; it proves correctness, not reachability
- ❌ Don't defer wiring to "follow-ups" or an unnamed future step — re-sequence so it lands in this phase, or surface it to the user
- ❌ Don't put a bare "✅ IMPLEMENTED" on a runtime-claiming step — it is ✅ WIRED or it is not done
- ❌ Don't commit without running deno fmt first
- ❌ Don't run full-suite commands for a narrow step — see Validation policy above

Related skills
- #plan              — Create or extend a .copilot/planning/ document (precedes this skill)
- #pre-gap-analysis  — Validate the plan before starting (precedes this skill)
- #post-gap-analysis — Deep review when all steps are complete (follows this skill)
- #commit            — Create a structured commit message (used at end of each step)
- #tdd-workflow      — Full TDD red-green-refactor reference for individual components (used within each step)
- #refactor-check-magic — Run when check:magic violations are non-trivial
- #fix-bug           — Fix a bug discovered during implementation (branches off this skill)
- #security          — Full security audit skill for Exaix internals (use when 3+ security findings exist)
- Blueprints/Skills/security-first.skill.md — Secure coding practices for portal (user project) code; apply during step 13a whenever the step touches input, paths, queries, subprocesses, HTTP, auth, or secrets

Workflow chain (typical):
  #plan → #pre-gap-analysis → **#next-steps** → #post-gap-analysis → #commit
```

## Related

- [LLM_GUIDE.md](../../../LLM_GUIDE.md) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
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
