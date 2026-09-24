---
name: remediate-code-gaps
agent: senior-coder
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Remediate Code Gaps Skill (#remediate-code-gaps)"
description: Consumes review-phase-code gap findings and edits source code to close each gap — re-runs tests and commits
short_summary: "Edits source files to close code-level gaps identified by review-phase-code, then re-runs tests and creates a structured commit."
version: "1.2.1"
topics: ["planning", "gap-analysis", "remediation", "tdd", "code-quality"]
qwen_skill: remediate-code-gaps
---

```text
Key points

- Consume the plan's Post-Gap Analysis; close every code gap by editing source files.
- Close only gaps the analysis explicitly opened. No extra refactoring or polish.
- Per gap: read the affected source, then edit it to satisfy the gap's Resolution (the
  remediation step added by review-phase-code).
- TDD: new behavior → write the test first, then implement.
- Do NOT rewrite the remediation step's Actions/notes — review-phase-code owns those. The
  ONLY plan-doc edit is marking its Success Criteria / Planned Tests done:
  `- ✅ <text> → `<staged-path>`` (or `- ⚠️ deferred <text> → `<LedgerSymbol>` + a
  Reachability Ledger row). This is a plan-step completion → the plan-step commit gate.
- Done: re-run affected tests, CI gates, then commit submodule plan doc + parent source via
  `scripts/commit_plan_step.ts <msg> --commit` (`plan: <doc>#<remediation-step-N>`). No
  `- [ ]` may remain in a claimed remediation step.
- Exhaustive event coverage claimed? Reconcile every source-declared event against
  attributable real-`EventLogger` scenario/integration/package-test evidence — representative
  component coverage is not completion.
- Before the phase is done: run #self-improvement-retro, update the phase registry, and
  disposition every process finding PATCHED / DEFERRED / REJECTED.

Canonical prompt (short):
"Remediate the code gaps in exaix-dev-docs/planning/phase-NN-*.md's Post-Gap Analysis
remediation steps. Edit source files to close each gap, re-run tests, CI gates, commit."

Examples
- "#remediate-code-gaps exaix-dev-docs/planning/phase-125-dogfood-meta-workflow-skills.md"

Do / Don't
- ✅ Read each gap's remediation step (Actions) before editing.
- ✅ Scope edits to exactly the gap resolution.
- ✅ Write tests first when adding behavior.
- ✅ Run `deno run -A scripts/ci.ts check` before committing — ONE command covering every
  real pre-commit gate (lint, style, magic, complexity, arch, event-coverage). A bare
  `deno task check` is ONLY the type-checker and misses the rest (Phase 168 retro: a
  remediation using only it shipped two regressions).
- ✅ Mark the remediation step's criteria/tests done in the plan doc and commit via
  `scripts/commit_plan_step.ts` with a `plan:` field.
- ❌ Add refactoring or polish beyond the named gaps.
- ❌ Rewrite the remediation step's Actions/prose — flip only its criteria/tests.
- ❌ Skip tests for any remediation.
- ❌ Run a bare `git commit` for a remediation that flips plan-doc criteria — the gate
  blocks it or the plan doc + parent fall out of sync.

Related: #review-phase-code (produces the steps); #self-improvement (terminal retro);
#fix-bug (findings during remediation); #commit; test-development.

Workflow chain: #plan → #review-phase-plan → #remediate-plan-gaps → #next-steps →
#review-phase-code → **#remediate-code-gaps** → #self-improvement-retro
```

## See also

- [exaix-development](../exaix-development/SKILL.md) — source patterns, DI, conventions

---

## Instructions for Agent

Close every code gap in the Post-Gap Analysis remediation steps by editing source files.

### Phase 1 — Ingest

1. Read the Post-Gap Analysis section — each remediation step has Actions, Architecture
   Notes, Planned Tests, Success Criteria.
1. Read every source file referenced in the Actions.
1. Read the code at each affected symbol.

### Phase 2 — Remediate (TDD)

Per remediation step, in order:

1. **RED**: new behavior → write the failing test at the path Planned Tests names.
1. **GREEN**: edit the source to satisfy the step's Actions, strictly in scope.
1. **REFACTOR**: run `deno run -A scripts/ci.ts check` (all real pre-commit gates).

### Phase 3 — Validate & mark done

1. Re-run every test in the step's Planned Tests.
1. Confirmed regression-free with `deno run -A scripts/ci.ts check` — NEVER a bare
   `deno task check` or a hand-picked subset (both silently missed a regression before).
1. Re-read the source to confirm the Finding is resolved.
1. In the plan doc, rewrite each satisfied criterion/test to `- ✅ <text> →`<staged-path>``;
   a deferred one becomes `- ⚠️ deferred <text> →`<LedgerSymbol>`+ a ledger row. No`- [ ]` in a claimed step.
1. **Canary trap**: a criterion satisfied by a canary (break source → confirm RED →
   restore byte-identical) cites the TEST file as `→ path`, never the canaried source — a
   byte-identical restore has zero net diff and is not stageable. Verify with
   `git status --short <source-file>` before writing the citation.
1. **Truncation trap**: long single-line criteria are shown with trailing `...` by the read
   tool. NEVER copy truncated text into an edit — it deletes the rest of the line. Re-read a
   narrow range and confirm no `...`, or do a targeted Python/sed replace on the exact
   substring and verify with `git diff`.
1. **Arrow sweep trap**: `extractArrowPaths()` demands EVERY backticked span after `→` on a
   `- ✅`/`- ⚠️ deferred` line be a staged parent file. A backticked test name/symbol after
   the arrow blocks the commit. Put incidental mentions BEFORE the arrow; put ONLY the real source/test paths after
   after (comma-separated spans). Re-read #commit's validator-traps first.
1. Exhaustive observability claim? Generate a source event inventory and reconcile it with
   the runtime-evidence matrix. Each event needs an attributable test driving production
   through the real `EventLogger`; mocks, global lookup, presence-without-value, and one
   event standing in for a multi-event component are insufficient.
1. Run #self-improvement-retro before the final completion claim — it owns terminal status,
   `PHASE_REGISTRY.md` hygiene, and dispositions.

### Phase 4 — Commit (plan-step)

Spans the submodule plan doc (the ✅/deferred marks) and the parent source → plan-step gate:

1. Stage the plan doc in the submodule (`git -C exaix-dev-docs add <planning-doc>`); the
   ✅/deferred lines must be added lines of this diff.
1. Stage the edited source + test files in the parent — every `→ path` must be among them.
   A criterion whose module IS the plan doc uses the gitlink arrow `→`exaix-dev-docs``;
   a doc-only (§3D) step often cites both: `→ `ARCHITECTURE.md`, `exaix-dev-docs``.
1. Write the structured message (`fix`; what:, rationale:, tests:, who:, impact:; the gap
   numbers e.g. `remediation: GAP-1, GAP-3`; mandatory
   `plan: exaix-dev-docs/planning/<phase>.md#<remediation-step-N>`), then
   `deno run -A scripts/commit_plan_step.ts <msg-file> --commit`. Read #commit's validator
   traps first (Structural Bloom, impact-component-word-in-what, semicolon-in-impact).
1. Multiple steps touching the SAME source file: group them into ONE commit whose `plan:`
   names any one step, mark ALL grouped steps' criteria done in that same commit, and name
   every covered GAP/step in the body — honest (every cited `→ path` is a changed file) and
   far cheaper than hunk surgery.
1. Preflight blocks with "roll back the submodule's last commit"? The submodule was
   committed separately: `git -C exaix-dev-docs reset --soft HEAD~1`, re-run.
1. Submodule commit SUCCEEDED but the PARENT's `check_commit_msg.ts` rejects the message?
   Do NOT roll back the submodule (it is valid). Confirm `git -C exaix-dev-docs log --oneline
   -1`, fix the message, commit the parent directly. Parent rejects the `→ path`
   convention itself? AMEND the submodule commit (`git -C exaix-dev-docs add <planning-doc>
   && git -C exaix-dev-docs commit --amend --no-edit`) so every item line stays an added
   line of `HEAD~1..HEAD`, re-stage the pointer, commit the parent directly.

## Output Format

1. Gaps closed (count by severity).
1. Files edited, with what changed.
1. All tests pass and CI gates clean.
1. Commit payload.

---
exaix:
  skill_id: remediate-code-gaps
  related_skills: [review-phase-code, test-development, exaix-development, self-improvement]
  triggers:
    keywords: [remediate-code, code-gaps, close-code-gaps, fix-code]
    task_types: [bugfix, refactor]
    tags: [remediate-code]
  constraints:
    - "Only close gaps explicitly opened by a Post-Gap Analysis section"
    - "Do not add new refactoring or polish beyond named gaps"
    - "Edit source files; in the plan doc only flip the remediation step's criteria/tests to the done form (never rewrite its Actions/prose)"
    - "Write tests first (TDD) when adding new behaviour"
    - "Commit remediation that flips plan-doc criteria via commit_plan_step.ts with a plan: field"
    - "Run full CI gate suite before committing"
  output_requirements:
    - "All code gaps resolved in the source files"
    - "All affected tests pass"
    - "CI gates clean (deno run -A scripts/ci.ts check)"
    - "Structured commit with gap references"
  quality_criteria:
    - name: scope_discipline
      description: Only named gaps are closed — no scope creep
      weight: 40
    - name: tdd_compliance
      description: Tests written before implementation for new behaviour
      weight: 30
    - name: ci_gate_compliance
      description: All CI gates pass before commit
      weight: 30
---
