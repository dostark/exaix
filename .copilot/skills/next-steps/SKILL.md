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
version: "1.6.0"
topics: ["tdd", "red-green-refactor", "planning", "steps", "ci", "commits", "reachability", "traceability"]
qwen_skill: next-steps
---

```text
Key points
- Work through .copilot/planning/phase-XX-*.md steps one-by-one
- Each step follows strict RED → GREEN → VERIFY → REFACTOR → CI → DOC cycle
- After each step: run the Success Criterion Verification Gate (step 14), rewrite each met criterion/test to `- ✅ <text> → ` `` `<staged-path>` `` (or `- ⚠️ deferred <text> → ` `` `<LedgerSymbol>` `` with a ledger row), run fast CI gates, then commit BOTH the submodule plan doc and the parent code via `scripts/commit_plan_step.ts <msg> --commit` (message carries a `plan:` field). No `- [ ]` may remain in a committed step
- Never skip ahead — complete and commit each step before starting the next
- If interrupted mid-step, re-read the RED/GREEN evidence in the chat to determine which phase you are in before proceeding. **Chat/session memory is not reliable evidence on its own** — after a compaction, a resumed session, or when a phase may have been worked on by another agent/tool in the interim, ALWAYS cross-check with `git log --oneline -N` in both the parent repo and `exaix-dev-docs` plus the plan doc's own per-step `**Status:**` markers BEFORE writing any code. Trusting stale chat context over `git log` risks re-implementing already-committed work or drafting tests against a design another session already changed.
- Use focused, file-scoped test commands by default; reserve full-suite commands for massive changes or explicit user requests
- **All tests implemented in a step MUST be executed and pass before the step can be reported as completed.** This applies to unit tests, integration tests, and scenario/E2E tests alike. Scenario YAML or test files that have only been written (parsed, type-checked) but not run against a real environment do NOT count as passing tests. A step that introduces tests cannot claim completion until those tests are run and green.
- When reading plan references across more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue
- **Reachability ledger (lives IN THE PLANNING DOC)**: a step that adds a symbol with NO production importer appends a row to a **Reachability Ledger** table kept in the planning doc itself — not just chat/commit, so the debt survives context compaction and is visible to anyone reading the plan. Each later step that wires an item closes its row in the same commit. The PHASE cannot be marked complete while any row is still ⏳ — see VERIFY step 11, the ledger template (step 24a), and the Phase-completion gate. A green package-unit test proves correctness, NOT that production calls the code; the test is the only caller.
- **Success criteria are NOT the same as tests.** A passing test proves a function works correctly in isolation. A success criterion proves a system behaviour is observable at the right level. Every criterion must be verified independently — do not assume a green test suite means all criteria are met.

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
   1a. **Verify previous step's completion before starting this one.** Do NOT trust
       the planning doc's status markers alone — re-read the previous step's "Success
       criteria" block and confirm every criterion is either:
       - marked ✅ in the doc AND verifiable by a passing test or production-code grep
         (re-run the test if needed — do not assume it still passes after subsequent changes),
         OR
       - explicitly acknowledged as a known gap (e.g. tracked in a Post-Implementation
         Gap Register with ⏳ status).
       If a previous-step criterion is marked ✅ but cannot be demonstrated, stop, flag
       it, and do not proceed. A gap in a previous step inevitably contaminates every
       step built on top of it. Determine "which step am I actually on" from `git log
       --oneline` (both repos) and the plan doc's own `**Status:**` markers, NOT from
       chat memory — see the Key points bullet above.
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
        row to ✅ and fill in the production call-site, in this step's commit. Before
        flipping it, run `deno task check:reachability-ledger <plan-doc-path>`
        (`scripts/check_reachability_ledger.ts`) — it parses the row's "Production
        call-site" cell for identifier/filename mentions and greps for a real
        non-test reference outside the definition file, catching by mechanism the
        exact mistake phase-158's 2026-08-04 post-gap analysis found by hand: six ✅
        rows whose named call-site was never actually invoked by any committed code.
        Advisory only (false positives happen — see the tool's own output for known
        causes), so a finding means "verify by hand," not "automatically revert to ⏳."
      Every ledger row MUST be ✅ before the phase is closed (Phase-completion gate G2).
  12. Trace every output field to its consumer.
      Grep the codebase for consumers of each new exported symbol, interface field,
      or event payload field the step introduces. If a field has zero readers, flag
      it as dead data. If a field claims integration with an adjacent service, verify
      that service is actually wired and called.
  13. Check new code against existing module conventions, AND verify event coverage.
      Survey 5–10 existing examples of the same concern (event emission, error
      handling, import style, type usage) in the same file or module. If the new code
      diverges from the dominant convention, flag it. Divergence without documented
      justification in the plan's Architecture Notes is a gap.
      For every state-changing or cross-component-calling method/function this step adds
      or modifies: confirm it emits the event named in the plan's Architecture Notes
      (#plan §2H) — "no event needed" must be an explicit, documented decision, not a
      silent omission. Run `deno task check:event-coverage` (or `--staged` once files are
      staged) as a first-pass advisory audit: it flags a class accepting an
      `IEventLogger`/`IEventRegistry` dependency that never calls it, and a state-changing
      or cross-component-call method with no adjacent event. A finding means "verify by
      hand," not "automatically a gap" — but an unexamined finding on THIS step's touched
      files is itself a gap.
      If this step introduces a class genuinely load-bearing for observability (request/
      plan/execution/review/memory critical path, security-sensitive), add the `@visible`
      JSDoc tag to its leading comment (per the plan's Architecture Notes, §2H) —
      `check:event-coverage --fail-on-tagged` and the real pre-commit gate (Gate 19) that
      enforce it are wired and live (landed by Phase 168). If this step modifies a file
      that already carries an `@visible`-tagged class, treat any coverage finding on it as
      a real gap to fix in this step, not an advisory item to defer — it will fail the
      real pre-commit hook otherwise.

SECURITY gate (apply when the step touches portal code or any of: input parsing,
  file paths, database queries, subprocesses, HTTP handlers, auth, secrets)
  13a. Consult Blueprints/Skills/security-first.skill.md and verify the step
       addresses all applicable sections (input validation, path traversal,
       injection, auth boundary, secret handling, transport, dependency pinning).
  13b. If the step introduces a new input path, query, subprocess call, or HTTP
       handler, confirm a security test exists that asserts rejection-by-validation
       (tagged [security]).
  13c. Run deno task test:security if any security-relevant file was touched.

SUCCESS CRITERION VERIFICATION GATE — mandatory, IMMEDIATELY before the Planning doc update section
  14. **Read this step's full "Success criteria" block from the planning doc.**
      For each criterion, do ONE of the following:
      - **Point to a passing test that directly asserts the behaviour** — include the test
        name and file path. The test must go beyond type-checking and actually exercise
        the runtime behaviour the criterion describes.
      - **Demonstrate the behaviour with a grep/rg of production code** — show the exact
        line(s) where the behaviour is implemented. This is acceptable only when no
        dedicated test exists AND the behaviour is trivially visible from reading the
        source (e.g. "model_size:"L" resolved to matching profile" → grep for the call
        to `resolvePresetFromSize` inside `resolve`).
      - **Flag as NOT MET if neither applies.** A criterion with no passing test AND no
        direct production-code evidence is a blocking gap — the step cannot be committed.
        Do not mark it as met. Pause and surface the gap to the user.
   14a. **Close the loop: re-read the Success criteria AFTER implementation** — do not
        rely on your pre-implementation reading of them. The gap between "what I planned
        to build" and "what I actually built" is invisible until you re-read the criteria
        with the finished code in front of you. Copy each criterion into a comment or
        scratch buffer and annotate it with your evidence (test path:line or source path:line)
        before moving on. If you cannot annotate all criteria, the step is not done.

REFACTOR + CI gates
  15. deno lint <src-file> <test-file>
  16. deno check <src-file>
  17. deno task check:style   → fix any errors (interface naming I*, no magic unions)
  18. deno task check:arch    → all files must be GROUNDED, 0 UNGROUNDED
  19. deno fmt <src-file> <test-file>  (run before commit, not after)
  20. deno task check:magic   → if new string/number literals were added, reduce violations
      (use #refactor-check-magic if the count is non-trivial)
  21. (optional) deno task check:complexity  if implementation is non-trivial
      (complexity threshold: 15 — refactor any function breaching it)
  22. (exception only) See Validation policy above for when a full-suite command is warranted.

Planning doc update
   22a. **Run every test the step implements.** Before marking any success criterion or
        planned test as completed, execute every test file written or modified in this
        step and verify it passes. For unit tests: `deno test --allow-all <file>`.
        For scenario/E2E YAML tests: run the scenario against a real environment
        (daemon + real tool binaries) and assert all steps pass. A test that has only
        been parsed, type-checked, or structurally validated (e.g. "YAML parses correctly")
        but not executed against a live runtime does NOT satisfy this gate.
        If the environment required to run an E2E test is unavailable (missing provider
        keys, missing binary, no daemon), do NOT mark the dependent criteria as completed
        on source-level validation alone. Because the commit gate forbids a `- [ ]`
        criterion in a committed step, you have two honest options: (a) DEFER the criterion
        — rewrite it `- ⚠️ deferred <text> → ` `` `<LedgerSymbol>` `` and add a Reachability
        Ledger row naming the step/environment that will verify it; or (b) do NOT commit
        the step yet. Never flip an unverified criterion to `✅` to get past the gate.
   23. In the step's "Success criteria" block, rewrite each criterion now met from
       `- [ ] <text>` to the completion form the commit gate requires:
       `- ✅ <text> → ` `` `<path>` `` — where `<path>` is the actual source/test
       module that meets it, **backtick-wrapped** and a **staged file of this commit**.
       Multiple modules: `→ ` `` `a.ts` `` `, ` `` `b.ts` ``. Do this ONLY after ALL the
       criterion's tests have run and pass AND the Success Criterion Verification Gate
       (step 14) passed for it. A criterion you are DEFERRING (not completing) this step
       becomes `- ⚠️ deferred <text> → ` `` `<LedgerSymbol>` `` and MUST get a matching
       Reachability Ledger row (step 24a) in the same commit. **No `- [ ]` criterion may
       remain in a step this commit claims** — the gate (`check_commit_msg.ts` via
       `commit_plan_step.ts`) blocks it; either complete it (`✅ → path`), defer it
       (`⚠️ deferred → token` + ledger row), or the step is not ready to commit.
   24. Change each planned-test bullet to `- ✅ <name> → ` `` `<test-path>` `` (the test
       file that implements it, backtick-wrapped + staged), ONLY after the test has been
       executed and passes. The done-mark is `✅` for both criteria and tests; the `→`
       path is what the gate verifies is (a) backticked, (b) a staged file, and (c) an
       added line of the plan doc's staged diff for this commit — so mark the item in the
       SAME change that implements it (stale/pre-existing marks are rejected).
  24. Add a status line immediately after the test list, using the marker that
      reflects REACHABILITY (not merely "I wrote the code"):
        - **✅ WIRED** — `<src path>`, N/N tests passing, reached by `<production call-site file:Symbol>`
          (use ONLY when a production consumer invokes the code — verified in VERIFY step 11).
        - **✅ CORE** — `<src path>`, N/N tests passing; NOT yet reached by production
          (use when the symbol is on the pending-consumer ledger; NAME the later step in
          this plan that wires it).
      The only two reachability labels are **✅ WIRED** and **✅ CORE** — there is no
      generic "implemented" label. A step whose Success Criteria assert runtime/observable
      behaviour is either ✅ WIRED (a production caller exists) or it is not done; use
      ✅ CORE only when the symbol is on the ledger awaiting a named later wiring step.
      Never write **✅ WIRED** while this step's Reachability Ledger row is still ⏳ — the
      label and the ledger must agree in the same commit. If the production call-site
      does not exist yet, the correct marker is **✅ CORE** and the ledger row stays ⏳.
  24a. Maintain the **Reachability Ledger** section of the planning doc — create it
       once (if #plan did not seed it), then keep it current EVERY step. One row per
       symbol not yet reached by production:

         ## Reachability Ledger (pending production consumers)

         | Symbol                 | Added in | Wiring step | Production call-site   | Status |
         |
## See also

- [plan](../plan/SKILL.md) — plan structure, step format, success criteria
- [tdd-workflow](../tdd-workflow/SKILL.md) — RED-GREEN-VERIFY-REFACTOR cycle per step
- [commit](../commit/SKILL.md) — structured commit message format per step
---------------------- | -------- | ----------- | --------------------- | ------ |
         | `SessionReturnWatcher` | Step 6   | Step 9      | `apps/daemon/main.ts` | ⏳     |

       Append a ⏳ row when VERIFY step 11 finds a production-dead symbol; flip Status
       to ✅ and fill the call-site when a later step wires it. Stage this doc edit in
       the same step's commit. Reading the ledger top-to-bottom is the to-do list the
       remaining steps (and the terminal cutover step) must drain — the phase is done
       only when every row is ✅ (or the ledger is empty).

Commit (plan-step commit — spans the submodule plan doc + the parent code)
  25. Stage BOTH repos (the plan doc lives in the exaix-dev-docs submodule, the code in
      the parent):
        - In the submodule: `git -C exaix-dev-docs add <planning-doc>` — this stages the
          step's `✅ … → ` `` `path` `` `/ `⚠️ deferred … → ` `` `token` `` lines and any
          Reachability Ledger row added/closed this step (step 24a). These lines MUST be
          added lines of this diff (the gate verifies it).
        - In the parent: stage the src file(s), test file(s), and any other code — every
          `→ path` you wrote on a done item MUST be among these staged files.
        - Plan-doc criteria (a criterion/test whose module IS the plan doc itself) use
          the gitlink arrow `→ ` `` `exaix-dev-docs` `` — the only plan-doc path the
          parent gate sees in `git diff --cached --name-only`. Never write the internal
          `exaix-dev-docs/planning/<phase>.md` path: it is not a parent staged file and
          the gate rejects the commit with "…not among this commit's changed files".
  26. Do NOT run a bare `git commit`. Write the structured message to a file with a `plan:`
      field naming the doc + step, then commit BOTH repos via the orchestrator, which runs
      the plan-step gate and commits the submodule then the parent pointer bump in sync:
        `deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit`
      The message body still follows #commit's schema (what/rationale/tests/who/impact)
      plus the mandatory `plan:` field:
       feat(<scope>): implement <What> (Step N)

       what: <implementation summary>
       rationale: <why>
       tests: <test file>, N/N passing
       who: <your agent identity>
       impact: <ARCHITECTURE.md component>: <detail>
       plan: exaix-dev-docs/planning/<phase>.md#<N>

       CI gates: lint OK, type-check OK, style 0 errors, arch N GROUNDED, magic OK
  26a. If the orchestrator BLOCKS with "roll back the submodule's last commit", you
      committed the plan doc separately (breaking the commit-together flow): run
      `git -C exaix-dev-docs reset --soft HEAD~1` to restage those lines, then re-run
      step 26 so the phase file and the parent land together. If it blocks on a missing
      `→ path` / un-backticked path / a lingering `- [ ]` / a deferred token with no
      ledger row, fix the plan-doc line (step 23–24 / 24a) and re-stage before retrying.
      See the submodule-workflow and commit skills.
  26b. If the submodule commit SUCCEEDED but the parent gate rejects the plan-doc lines
      (e.g. a wrong `→ path` convention), AMEND the submodule commit — `git -C
      exaix-dev-docs add <planning-doc> && git -C exaix-dev-docs commit --amend --no-edit` —
      instead of adding a follow-up submodule commit: `validatePlanStepDiff` requires ALL
      of the step's item lines to be added lines of `HEAD~1..HEAD`, which a second commit
      would drop for the unchanged lines. Then re-stage the pointer (`git add exaix-dev-docs`)
      and commit the parent directly.

PHASE-COMPLETION GATE (run ONCE, after the last step, BEFORE declaring the phase complete)
  This gate is MANDATORY and cannot be skipped. A "finalize", "commit remaining
  changes", "wrap up", or "close the phase" instruction does NOT waive G1–G5 — it is the
  trigger to RUN them. Green unit tests, a green build, and "no open 🔴 in the plan"
  (which describes plan-health from #pre-gap-analysis, not implementation completeness)
  are NOT evidence the gate passed. If you are about to declare a phase complete without
  having run G1–G5 in this session, stop and run them first. (Phase 137 was finalized on
  green tests + "no open 🔴" while four ledger rows were still ⏳ and the daemon never
  read the Config DB — the gate existed but was never run.)
  G1. Integration-surface audit across EVERY symbol the phase added: for each new
      exported class / service / function, grep the production codebase (excluding
      tests + test helpers) for a real importer or caller. ANY runtime-claiming symbol
      still production-dead is a BLOCKING failure — the phase cannot be marked complete.
      (This is the same audit #post-gap-analysis runs — running it here turns an
      after-the-fact finding into a pre-close gate.)
  G2. The planning doc's **Reachability Ledger** MUST have every row at ✅ (or be
      empty). Any ⏳ row is a BLOCKING failure — drain it (wire the symbol; that is
      the terminal cutover step's job) before closing the phase. Read the ledger as
      the residual to-do list. Also reconcile the ledger against the step status labels:
      a step marked `✅ WIRED` whose ledger row is still ⏳ is a
      self-contradiction and a BLOCKING failure — trust the ⏳ row (the symbol is NOT
      wired) and either wire it or correct the label to `✅ CORE (wired in Step M)`.
      Confirm each ✅ row's "Production call-site" column names a real file:Symbol that a
      G1 grep actually found — a row flipped to ✅ with no verifiable call-site is
      treated as ⏳. Run `deno task check:reachability-ledger <plan-doc-path>` as a
      first pass before the manual G1 grep — it mechanizes exactly this check across
      every ✅ row in the doc and will not find dynamic-dispatch/registry-based wiring,
      so treat its output as candidates to verify by hand, not a final verdict.
  G3. For every opt-in flag the phase introduced, confirm a test flips the REAL config
      (e.g. `config.feature.enabled = true`) and asserts the observable behaviour — not
      a unit test of the gated component in isolation. "Enabling the flag does nothing"
      is a blocking failure.
  G4. If G1–G3 fail: do NOT close the phase. Either implement the missing wiring as
       additional steps in this phase, or pause and surface the production-dead set to
       the user with the explicit statement that the feature would ship non-functional.
  G5. **Every test the phase implemented must have been executed and passed.** For each
      step in the phase, verify that every test file written or modified in that step
      was actually run (not just parsed) and produced a passing result. Scenario/E2E
      tests that exist only as structurally-validated YAML but were never executed
      against a real daemon are BLOCKING — the phase cannot be closed until they pass
      or are explicitly waived by the user. **Agent shells commonly have `CI=true` set
      by default** — any `Deno.test({ ignore: Deno.env.get("CI") === "true", ... })`
      (the standard convention for real-subprocess/real-daemon-boot tests, e.g.
      `[cutover]`/`[live]`-tagged tests) silently skips under it, and Deno's summary line
      folds skipped tests into an easy-to-miss `N ignored` count next to `ok`. A file
      reporting `ok | 2 passed | 0 failed` may still have 3 untested `[live]` cases. At
      G5, explicitly grep the phase's test files for `ignore:.*CI`, then re-run each
      match with `env -u CI deno test --allow-all <file>` (or `CI= deno test ...`) and
      confirm the previously-ignored tests now show `ok`, not just `ok | 0 failed`.
  G6. **Event coverage audit.** Run `deno task check:event-coverage` across the whole
      repo (no `--staged` — the phase's changes are already committed by this point).
      For every finding whose file the phase touched (cross-reference against `git diff
      --stat <phase-start-commit>..HEAD` in both repos), verify by hand whether it is a
      real gap: a state change or cross-component call this phase introduced with no
      event, or a class this phase wired to a logger that is never called anywhere. A
      confirmed gap is a BLOCKING failure — either add the missing event as an additional
      step in this phase, or document in the plan doc why no event applies (e.g. the
      operation is internal bookkeeping, not a domain-significant transition). Findings on
      files the phase did NOT touch are pre-existing debt, out of scope for this gate — do
      not block phase closure on them. Any finding on an `@visible`-tagged class (this
      phase's own or pre-existing) is a BLOCKING failure regardless of the file-touched
      scoping above — the tag is an explicit commitment, not a heuristic guess.

Do / Don't
- ✅ Do write the test file BEFORE the source file (RED must come first)
- ✅ Do run `deno task check:event-coverage` scoped to this step's touched files at VERIFY step 13, and across the whole phase at the Phase-Completion Gate (G6) — a state change or cross-component call with no adjacent event is a gap unless explicitly justified in Architecture Notes. Tag genuinely load-bearing new classes `@visible` (§ VERIFY step 13) — a gap on a tagged class is always blocking, never advisory.
- ✅ Do add module-header JSDoc to every new file (src and test)
- ✅ Do run deno fmt before git add (avoid fmt pre-hook failures)
- ✅ Do rewrite each met criterion/test to `- ✅ <text> → ` `` `<staged-path>` `` (or `- ⚠️ deferred <text> → ` `` `<token>` `` + ledger row) and add the ✅ WIRED/✅ CORE reachability label before commit — stage the plan-doc edit in the submodule as part of the plan-step commit (step 26)
- ✅ Do use IFoo interface naming (not Foo) — enforced by check:style
- ✅ Do use ICodeConvention["confidence"] instead of "low"|"medium"|"high" literal union
- ✅ Do keep test execution proportional to scope; prefer focused tests for a single-step cycle
- ✅ Do verify field values are correct given the component's dependencies, not just present (step 10)
- ✅ Do verify new services and classes are wired into production code, not just tests (step 11)
- ✅ Do treat "no production importer" as a blocking debt on the pending-consumer ledger — never as "done" (step 11)
- ✅ Do run the Success Criterion Verification Gate (step 14) AFTER implementation, not just before — re-read the criteria with finished code in front of you
- ✅ Do keep the Reachability Ledger current IN THE PLANNING DOC every step — append a ⏳ row when a symbol is production-dead, flip it to ✅ when wired, stage the doc edit in that step's commit (step 24a)
- ✅ Do run the Phase-completion gate (integration-surface audit) before declaring the phase complete — production-dead runtime code blocks closure (G1–G4)
- ✅ Do mark runtime steps **✅ WIRED** only when a production caller exists; use **✅ CORE** (naming the wiring step) otherwise (step 24)
- ✅ Do trace new output fields to their consumers — dead fields with no readers are gaps (step 12)
- ✅ Do check new code against existing module conventions — inconsistency within a file is a gap (step 12)
- ✅ Do cross-reference the step's tests against pre-gap analysis findings for the same step number (step 2)
- ✅ Do verify the previous step's success criteria before starting the current step — re-run its tests if needed; a gap in the foundation contaminates everything built on it (step 1a)
- ✅ Do document any edge cases handled and any deviations from the plan in the commit body
- ✅ Do re-ground on `git log --oneline` (both repos) before resuming a phase after a session gap/compaction, or when another agent/tool may have touched it — never assume chat memory reflects current repo state (step 1a)
- ✅ Do grep the phase's tests for `ignore:.*CI` and re-run matches with `env -u CI` at the Phase-Completion Gate (G5) — a shell's default `CI=true` silently skips real-subprocess/real-boot tests inside an otherwise-green summary line
- ❌ Don't implement source code before writing the failing test
- ❌ Don't batch multiple steps into one commit
- ❌ Don't proceed to the next step if any CI gate fails
- ✅ If a CI gate failure cannot be resolved within the current step's file scope (e.g. check:arch failure in an unrelated file), document the blocker in a comment, pause execution, and surface the specific failing command output and file to the user for a decision before proceeding.
- ❌ Don't use Record<string, unknown> — define a specific interface instead
- ❌ Don't accept a green package-unit test as evidence a runtime success criterion is met — the test is the only caller; it proves correctness, not reachability
- ❌ Don't defer wiring to "follow-ups" or an unnamed future step — re-sequence so it lands in this phase, or surface it to the user
- ❌ Don't invent status labels beyond ✅ WIRED / ✅ CORE — a runtime-claiming step is ✅ WIRED (production caller exists) or it is not done; there is no generic "implemented" label
- ❌ Don't mark a planned test as completed (`✅ \`...\``) if the test has only been written and type-checked but not executed against a live runtime — unit tests must be `deno test`-ed, scenario/E2E YAML must be run against a real daemon environment
- ❌ Don't close the gap on a success criterion whose only validating test is an E2E/scenario test that was structurally parsed but never run — document the untested criterion as `[ ]` with a note about the required environment
- ❌ Don't assume a green test suite means all success criteria are met — a passing test proves function-level correctness, not system-level behaviour. Run step 14 (Success Criterion Verification Gate) explicitly before marking any criterion as met.
- ❌ Don't start implementing the current step without verifying the previous step's criteria — a gap in the foundation will silently propagate and compound (step 1a)
- ❌ Don't commit without running deno fmt first
- ❌ Don't run full-suite commands for a narrow step — see Validation policy above

Related skills
- #plan              — Create or extend a .copilot/planning/ document (precedes this skill)
- #pre-gap-analysis  — Validate the plan before starting (precedes this skill)
- #post-gap-analysis — Deep review when all steps are complete (follows this skill)
- #commit            — Create a structured commit message (used at end of each step)
- #tdd-workflow      — Full TDD red-green-refactor reference for individual components (used within each step)
- [test-development](../test-development/SKILL.md) — Edge case coverage requirements, test helpers, placement rules
- #refactor-check-magic — Run when check:magic violations are non-trivial
- #fix-bug           — Fix a bug discovered during implementation (branches off this skill)
- #security          — Full security audit skill for Exaix internals (use when 3+ security findings exist)
- Blueprints/Skills/security-first.skill.md — Secure coding practices for portal (user project) code; apply during step 13a whenever the step touches input, paths, queries, subprocesses, HTTP, auth, or secrets

Workflow chain (typical):
  #plan → #pre-gap-analysis → **#next-steps** → #post-gap-analysis → #commit
```

## Related

- [CLAUDE.md](../../../CLAUDE.md#behavioral-guidelines) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output format

1. Step selected and why.
1. RED evidence (failing test/check output summary).
1. GREEN evidence (passing test summary).
1. REFACTOR/CI gate results.
1. Planning document updates and commit payload.

## Examples

- `#next-steps phase-14-caching` — execute the next unstarted step of that plan
- `#next-steps Step 3: Add ICache interface and inject into LLMProvider`
- `#next-steps Continue phase-76 — pick up from last completed step`

---
exaix:
  skill_id: next-steps
  related_skills: [plan, tdd-workflow, commit, test-development]
  triggers:
    keywords: [next-steps, step-execution, implement, execute]
    task_types: [feature, bugfix, refactor, testing]
    tags: [step-execution, tdd]
  constraints:
    - "Complete each step in sequence with TDD red-green-refactor"
    - "One commit per step with structured message"
    - "Run CI gates against each step before moving to next"
    - "Update planning doc with step status per step"
    - "Maintain Reachability Ledger in planning doc"
  output_requirements:
    - "Step completed with passing tests"
    - "CI gates clean per step"
    - "Planning doc updated with completion markers"
    - "Reachability Ledger row added or closed per step"
  quality_criteria:
    - name: tdd_compliance
      description: Tests written before implementation
      weight: 40
    - name: step_independence
      description: Each step committed independently
      weight: 30
    - name: ci_gate_compliance
      description: All CI gates pass before each commit
      weight: 30
---
