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
short_summary: "Prompt for iterating through exaix-dev-docs/planning/ steps one-by-one using TDD red-green-refactor with CI gates and commits."
version: "1.6.2"
topics: ["tdd", "red-green-refactor", "planning", "steps", "ci", "commits", "reachability", "traceability"]
qwen_skill: next-steps
---

```text
Key points

- Work through planning/phase-XX-*.md steps one by one. Never skip ahead.
- Each step is RED → GREEN → VERIFY → REFACTOR → CI → DOC.
- After each step: run the Success Criterion Verification Gate (step 14), rewrite each met
  criterion/test to `- ✅ <text> → \`<staged-path>\`` (or `- ⚠️ deferred <text> → \`<token>\` +
  a ledger row), run fast CI gates, commit submodule plan doc + parent code via
  `scripts/commit_plan_step.ts <msg> --commit` (message carries `plan:`). No `- [ ]` stays.
- Interrupted? **Chat memory is not reliable evidence.** Cross-check `git log --oneline -N`
  in both repos and the plan doc's per-step `**Status:**` markers before writing code —
  trusting stale chat re-implements committed work or drafts against a changed design.
- File-scoped test commands by default; full-suite only for massive changes or user request.
- **Tests must RUN and pass before a step is complete.** Scenario YAML/test files that were
  only written (parsed/type-checked) but never executed do not count.
- Reading > ~20 files: batches of 5–10. Read a batch, record findings, continue.
- **Reachability ledger lives IN THE PLANNING DOC**: a step adding a symbol with NO
  production importer appends a ⏳ row; a later step wires it and flips it ✅ in its commit.
  The phase stays open while any row is ⏳. A green unit test proves correctness, NOT that
  production calls the code — the test is the only caller.
- **Success criteria ≠ tests.** A passing test proves a function; a criterion proves a
  system behavior at the right level. Verify each criterion independently.
- No next `### Step N` but Success Metrics open? This is a real stop: drafting a new step is
  #plan's job. Surface the open metrics and ask how to close them — no invented scope, no
  silent "done".
- A live-provider run surfacing a shared-code bug outside the step's scope: fix it in a
  SEPARATE ordinary (non-plan-step) TDD commit — never fold it into the step's commit, and
  don't block the step unless the bug is in its declared scope.

Canonical prompt (short):
"Continue with implementation of next steps one-by-one in TDD red-green-refactor
manner. For each completed step mark implemented success criteria and tests, run
deno check, deno lint and other fast CI check scripts. Make one commit per completed step
with a detailed message describing rationale and what was changed/added."

Workflow per step
─────────────────
Validation policy
   0a. Default to file-scoped: `deno test --allow-all <test-file>` or the touched set.
   0b. No full-suite (`deno task test`, `test_parallel`, `deno test -A`, unscoped
       `deno test --allow-all`) for a normal one-step cycle.
   0c. Full-suite only when: the change is massive/cross-cutting; it modifies files
       imported by > 3 unrelated packages or shared classes across subsystems
       (e.g. packages/core/src/runtime/); the user requests it; a plan doc requires it.

RED phase
   1. Restate the step: read its Architecture notes, Success criteria, Planned tests.
      Confirm what will be built.
   1a. **Verify the previous step first.** Do not trust status markers alone — re-read its
       Success criteria and confirm each is ✅ AND verifiable by a passing test or
       production grep (re-run if needed), or is a tracked gap (Gap Register ⏳). A
       previous-step gap contaminates everything above it. Determine "which step am I on"
       from `git log --oneline` (both repos) + the doc's `**Status:**` — not chat memory.
   2. Cross-reference pre-gap analysis findings for this step; confirm the step's tests and
      notes cover them.
   3. Create the test file at the mirrored path under tests/. No planned tests? Say so,
      skip RED/GREEN test creation, implement source, then REFACTOR/CI — note the absence
      in the commit body.
   4. Add the module-header JSDoc: `/** @module XxxTest @path tests/... @description ... */`.
   5. Write all planned tests importing the not-yet-existing source so `deno check`/`test`
      fails with TS2307.
   6. Confirm RED: `deno test --allow-all <test-file>` errors.

GREEN phase
   7. Create the source at `packages/<package>/src/...` or `apps/<app>/src/...` with the
      minimum implementation to pass (module header: @module, @path, @description,
      @architectural-layer, @dependencies, @related-files).
   8. Run `deno test --allow-all <test-file>` — all pass.
   9. Fix failures; do not skip tests.

VERIFY phase — value correctness, wiring, consumers, conventions
  10. Verify field VALUES, not just presence: trace injected deps/config so the runtime
      value matches what construction dictates.
  11. Verify constructor wiring — do NOT accept "a later step will wire it".
      Grep production (excluding tests/helpers) for importers/instantiation. Only
      instantiated in tests? It is PRODUCTION-DEAD — invisible to TDD/coverage/grounding.
      - Consumer exists now: inject it via constructor DI into that consumer, or register
        it in the factory/registry/bootstrap (apps/daemon/main.ts).
      - No consumer yet: append a ⏳ row to the plan doc's Reachability Ledger (create it
        if absent — template in step 24a), naming the symbol, the adding step, and the
        named later step that wires it. Allocation only to a step IN THIS PLAN that really
        contains the wiring — not "follow-ups"/"future phases". Stage the doc edit in this
        commit.
      - Wires an earlier step's row: flip it ✅, fill the call-site, run
        `deno task check:reachability-ledger <plan-doc>` (advisory; false positives
        happen — verify by hand; if it wrongly flags a genuinely-✅ row, append a
        `(tool false-positive: verified <date> — <reason>)` note).
      Every ledger row must be ✅ before the phase closes (gate G2).
  12. Trace every new output field to a consumer. Zero readers = dead data.
  13. Check conventions (survey 5–10 same-concern examples; flag divergence without a
      documented justification). Verify event coverage for state-changing/cross-component
      methods per §2H — "no event needed" must be an explicit documented decision. Run
      `deno task check:event-coverage` (advisory; verify by hand). Introduce a
      load-bearing @visible class? Add the tag and treat any gap as blocking
      (`--fail-on-tagged`).

SECURITY gate (portal code or input parsing, file paths, DB queries, subprocesses,
  HTTP handlers, auth, secrets)
  13a. Consult Blueprints/Skills/security-first.skill.md; address all applicable sections.
  13b. New input path/query/subprocess/HTTP handler? Confirm a [security] rejection-by-
       validation test exists.
  13c. Security-relevant file touched? Run `deno task test:security`.

SUCCESS CRITERION VERIFICATION GATE — mandatory, before the doc update
  14. Read the step's full Success criteria. Per criterion do ONE of:
      - Point to a passing test directly asserting the behavior (name + file; must exercise
        runtime behavior, not just type-check).
      - Show the production lines via grep when no dedicated test exists and the behavior
        is trivially visible.
      - Flag NOT MET if neither applies — a blocking gap. Do not commit; surface it.
  14a. Re-read the criteria AFTER implementation and annotate each with evidence
      (test path:line or source path:line). Unannotatable criterion = step not done.

REFACTOR + CI gates
  15. deno lint <src> <test>
  16. deno check <src>
  17. deno task check:style   → fix (I* naming, no magic unions)
  18. deno task check:arch    → all GROUNDED, 0 UNGROUNDED
  19. deno fmt <src> <test>   (before commit, not after)
  20. deno task check:magic   → reduce new literals (use the #refactor check:magic pass if many)
  21. (optional) deno task check:complexity if non-trivial (threshold 15)
  22. (exception) full-suite only per Validation policy.

Planning doc update
  22a. **Execute every test the step implements** before marking anything done.
      Unit: `deno test --allow-all <file>`. Scenario/E2E YAML: run against a real
      environment (daemon + real binaries) and assert steps pass. A test that was parsed/
      type-checked but never run does NOT satisfy this gate. Environment unavailable? Do
      NOT mark criteria done on source-level validation alone — (a) DEFER the criterion
      (`- ⚠️ deferred <text> → \`<token>\` + ledger row`) or (b) don't commit yet. Never
      flip an unverified criterion to ✅ to pass the gate.
  23. Rewrite each met criterion to `- ✅ <text> → \`<path>\`` (backticked, a staged file of
      this commit; multiple modules comma-separated). A deferred criterion becomes
      `- ⚠️ deferred <text> → \`<LedgerSymbol>\`` + a ledger row. No `- [ ]` remains.
  24. Rewrite each planned-test bullet to `- ✅ <name> → \`<test-path>\`` only after the test
      runs and passes. Inspect the done-mark in the SAME change that implements it.
  24. Add the reachability status line after the tests:
      - **✅ WIRED** — `<src path>`, N/N tests passing, reached by `<call-site file:Symbol>`
        (only when a production consumer invokes it).
      - **✅ CORE** — `<src path>`, N/N passing; NOT yet reached by production (symbol on the
        pending-consumer ledger; NAME the wiring step).
      Only these two labels exist. A runtime-claiming step is WIRED or not done; use CORE
      only when a named later step wires it. Never WIRED while the ledger row is ⏳.
  24a. Maintain the Reachability Ledger every step:

         ## Reachability Ledger (pending production consumers)

         | Symbol | Added in | Wiring step | Production call-site | Status |
         | ------ | -------- | ----------- | -------------------- | ------ |
         | \`SessionReturnWatcher\` | Step 6 | Step 9 | \`apps/daemon/main.ts\` | ⏳ |

      Append ⏳ on production-dead symbols; flip ✅ + fill the call-site when wired. Stage
      the doc edit in the same commit. The ledger is the residual to-do list — the phase
      closes only when every row is ✅ (or it is empty).

Commit (plan-step — spans submodule plan doc + parent code)
  25. Stage BOTH repos: submodule plan doc (the ✅/deferred lines must be added lines of this
      diff) AND the parent src/test files (every `→ path` a staged file). Criterion/test
      whose module IS the plan doc uses the gitlink arrow `→ \`exaix-dev-docs\`` — never the
      internal `exaix-dev-docs/planning/<phase>.md` path (not a parent staged file).
  26. Do NOT run a bare `git commit`. Write the structured message (with `plan:`:
      `exaix-dev-docs/planning/<phase>.md#<N>`) and commit both repos via
      `deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit`, which runs the
      plan-step gate and commits submodule → parent pointer in sync. Before drafting,
      re-read #commit's "Validator Traps" (semicolons in impact:, verbatim component word,
      impact: swallowing trailing text, extractArrowPaths scanning after the first `→`).
  26a. Orchestrator blocks with "roll back the submodule's last commit"? The plan doc was
      committed separately: `git -C exaix-dev-docs reset --soft HEAD~1`, re-run step 26.
      Blocks on a missing/un-backticked `→ path` or lingering `- [ ]`? Fix the doc line,
      re-stage, retry.
  26b. Submodule commit SUCCEEDED but the parent gate rejects the plan-doc lines? AMEND the
      submodule commit (`git -C exaix-dev-docs add <doc> && git -C exaix-dev-docs commit
      --amend --no-edit`), re-stage the pointer, commit the parent directly.

PHASE-COMPLETION GATE (ONCE, after the last step, before declaring the phase complete)
  MANDATORY — a "finalize"/"wrap up" instruction triggers it, not waives it. Green tests +
  "no open 🔴" are NOT evidence it passed (Phase 137 closed on green tests while four
  ledger rows were still ⏳).
  G1. Integration-surface audit: every symbol the phase added — grep production for a real
      importer/caller. A runtime-claiming symbol still production-dead is BLOCKING.
  G2. Reachability Ledger: every row ✅ or empty. Any ⏳ is BLOCKING — drain it (that is the
      terminal cutover step's job). Also: a step marked ✅ WIRED whose ledger row is still
      ⏳ is a self-contradiction — trust the ⏳, wire it or relabel to ✅ CORE. Confirm each
      ✅ row's call-site by a G1 grep. Run `deno task check:reachability-ledger <doc>` first.
  G3. Every opt-in flag introduced has a test flipping the REAL config and asserting the
      observable behavior — not a unit test of the gated component. "Flag does nothing" is
      BLOCKING.
  G4. G1–G3 fail? Do not close. Implement the wiring as more steps, or surface the
      production-dead set with the explicit claim that the feature would ship non-functional.
  G5. Every test implemented was EXECUTED and passed, including scenario/E2E. Shells often
      set `CI=true`, silently skipping `ignore: CI` real-boot tests (folded into an ignored
      count). Grep for `ignore:.*CI`, re-run each with `env -u CI deno test --allow-all
      <file>` and confirm the previously-ignored tests show `ok`.
  G6. Event coverage: `deno task check:event-coverage` (full repo). Verify by hand any
      finding on a phase-touched file; a confirmed gap is BLOCKING (add the event or
      document why none applies). Findings on untouched files are pre-existing debt, out of
      scope. Any finding on an `@visible`-tagged class is BLOCKING regardless.
  G7. Phase-doc status hygiene: bump BOTH the frontmatter `status:` (line 2) and the prose
      `**Status**:` header in the SAME closing commit — two separate fields; one without the
      other leaves the phase invisible to `grep -l '^status: COMPLETED'` or stuck as open.
      Reconcile PHASE_REGISTRY.md: grep every mention (pickup bullets, notes, Registry row)
      and remove/close per its "completed phases are not listed" rule.

Do / Don't
- ✅ Write the test BEFORE the source (RED first).
- ✅ Run `check:event-coverage` on touched files at VERIFY 13 and whole phase at G6; tag
  load-bearing classes `@visible`.
- ✅ Add module-header JSDoc to every new file.
- ✅ Run deno fmt before git add.
- ✅ Rewrite met criteria/tests to `- ✅ … → \`path\`` (or deferred + ledger) with the
  WIRED/CORE label before commit; stage the doc edit with the plan-step commit.
- ✅ Use IFoo naming; `ICodeConvention["confidence"]`, not literal unions.
- ✅ Keep test execution proportional to scope.
- ✅ Verify field values, production wiring, output-field consumers, conventions,
  event coverage (steps 10–13).
- ✅ Treat "no production importer" as blocking ledger debt, never done.
- ✅ Re-read criteria after implementation (step 14a).
- ✅ Keep the ledger current in the plan doc every step.
- ✅ Re-ground on `git log --oneline` after a session gap; never trust chat alone.
- ✅ Grep `ignore:.*CI` and re-run matches with `env -u CI` at G5.
- ✅ Bump BOTH frontmatter status and prose header in the closing commit (G7).
- ❌ Implement source before the failing test.
- ❌ Batch multiple steps into one commit.
- ❌ Proceed past a failing CI gate; a gate failure unresolvable in this step's file scope:
  document it in a comment, pause, surface the command + file.
- ❌ Use Record<string, unknown> — define an interface.
- ❌ Treat a green package-unit test as proof a runtime criterion is met.
- ❌ Defer wiring to "follow-ups" — re-sequence into this phase, or surface it.
- ❌ Invent status labels beyond ✅ WIRED / ✅ CORE.
- ❌ Mark a planned test ✅ if it was only written/type-checked, not run.
- ❌ Close a success criterion whose only test is a never-run E2E/scenario — leave `[ ]` and
  note the environment.
- ❌ Assume a green suite means criteria are met — run step 14.
- ❌ Start the current step without verifying the previous step's criteria.
- ❌ Commit without deno fmt.
- ❌ Full-suite for a narrow step.

Related skills
- #plan — create/extend the planning doc (precedes)
- #review-phase-plan — validate the plan (precedes)
- #remediate-plan-gaps — close pre-gap findings (precedes when found)
- #review-phase-code — deep review after all steps (follows)
- #commit — structured message per step
- #tdd-workflow — full TDD reference per component
- test-development — edge cases, helpers, placement
- #refactor — its check:magic & duplication pass covers non-trivial counts
- #fix-bug — for bugs found during implementation
- #security — when 3+ security findings
- Blueprints/Skills/security-first.skill.md — secure portal-code practices (step 13a)

Workflow chain (typical):
  #plan → #review-phase-plan → **#next-steps** → #review-phase-code → #commit
```

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines
- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules

## Output format

1. Step selected and why.
1. RED evidence (failing test/check output).
1. GREEN evidence (passing test summary).
1. REFACTOR/CI gate results.
1. Planning doc updates + commit payload.

## Examples

- `#next-steps phase-14-caching` — execute the next unstarted step
- `#next-steps Step 3: Add ICache interface and inject into LLMProvider`
- `#next-steps Continue phase-76 — pick up from last completed step`

---
exaix:
  skill_id: next-steps
  related_skills: [remediate-plan-gaps, plan, tdd-workflow, commit, review-phase-code, test-development]
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
    - "Bump both frontmatter status: and the prose Status header when closing the last step"
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
