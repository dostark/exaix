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
description: Consumes post-gap-analysis gap findings and edits source code to close each gap — re-runs tests and commits
short_summary: "Edits source files to close code-level gaps identified by post-gap-analysis, then re-runs tests and creates a structured commit."
version: "1.0.0"
topics: ["planning", "gap-analysis", "remediation", "tdd", "code-quality"]
qwen_skill: remediate-code-gaps
---

```text
Key points
- This skill consumes a Post-Gap Analysis section in a planning document and closes every code-level gap by editing source files.
- Only close gaps that the post-gap analysis explicitly opened. Do NOT add new refactoring or polish beyond the named gaps.
- For each gap: read the affected source file, then edit it to satisfy the gap's Resolution (documented in the remediation step that the post-gap analysis added to the plan).
- Tests come first (TDD): if the gap remediation adds new behaviour, write the test first, then implement.
- Do NOT rewrite the remediation step's Actions/Architecture Notes/prose — those were authored by post-gap-analysis. The ONLY plan-doc edit you make is marking that step's Success Criteria / Planned Tests DONE once satisfied: rewrite each to `- ✅ <text> → ` `` `<staged-path>` `` (or `- ⚠️ deferred <text> → ` `` `<LedgerSymbol>` `` + a Reachability Ledger row). This is a plan-step completion, so it goes through the plan-step commit gate (below).
- After all gaps are remediated: re-run all affected tests, run CI gates, then commit BOTH the submodule plan doc (the ✅/deferred marks) and the parent source via `scripts/commit_plan_step.ts <msg> --commit` — the message carries a `plan: <doc>#<remediation-step-N>` field. No `- [ ]` may remain in a remediation step this commit claims.

Canonical prompt (short):
"Remediate the code gaps in .copilot/planning/phase-NN-*.md's Post-Gap Analysis
remediation steps. Edit source files to close each gap, re-run tests, CI gates, commit."

Examples
- "#remediate-code-gaps .copilot/planning/phase-125-dogfood-meta-workflow-skills.md"

Do / Don't
- ✅ Do read each gap's remediation step (Actions) before editing.
- ✅ Do scope edits to exactly what the gap resolution requires.
- ✅ Do write tests first (TDD) when adding new behaviour.
- ✅ Do run CI gates (lint, check, style, arch, magic) before committing.
- ✅ Do mark the remediation step's Success Criteria / Planned Tests done in the plan doc (`- ✅ <text> → ` `` `<staged-path>` ``) and commit via `scripts/commit_plan_step.ts <msg> --commit` with a `plan:` field.
- ❌ Don't add new refactoring or polish beyond the named gaps.
- ❌ Don't rewrite the remediation step's Actions/prose in the plan doc — only flip its Success Criteria / Planned Tests to the done form.
- ❌ Don't skip tests for any remediation.
- ❌ Don't run a bare `git commit` for a remediation that flips plan-doc criteria — it is a plan-step commit and must go through `commit_plan_step.ts` (else the gate blocks it or the plan doc + parent fall out of sync).

Related skills:
- #post-gap-analysis — Produces the remediation steps this skill executes
- #fix-bug — Fix a specific finding discovered during remediation
- #commit — Structured commit after remediation
- [test-development](../test-development/SKILL.md) — Edge case coverage requirements, test helpers, placement rules

Workflow chain (typical):
  #plan → #pre-gap-analysis → #remediate-plan-gaps → #next-steps → #post-gap-analysis → **#remediate-code-gaps** → #commit
```

## See also

- [exaix-development](../exaix-development/SKILL.md) — source patterns, DI, coding conventions

---

## Instructions for Agent

You are performing a **code-gap remediation** of source files. Your goal is to close every gap identified in the Post-Gap Analysis remediation steps.

### Phase 1 — Ingest

1. Read the planning document's Post-Gap Analysis section — each remediation step has Actions, Architecture Notes, Planned Tests, Success Criteria.
2. Read every source file referenced in the Actions.
3. Read the code at each affected symbol to understand the current state.

### Phase 2 — Remediate Gaps (TDD)

For each remediation step, in order:

1. **RED**: If the remediation adds new behaviour, write the failing test first at the test path specified in Planned Tests.
2. **GREEN**: Edit the source file to satisfy the remediation step's Actions. Stay exactly within scope.
3. **REFACTOR**: Run CI gates (lint, check, style, arch, magic).

### Phase 3 — Validate & mark done

1. Re-run all tests mentioned in the remediation step's Planned Tests.
2. Run `deno task check clean` to confirm no regressions.
3. Verify the gap's Finding is now resolved by re-reading the source.
4. In the plan doc's remediation step, rewrite each satisfied Success Criterion / Planned
   Test to `- ✅ <text> →` `` `<staged-path>` `` (the source/test module you edited,
   backtick-wrapped and a staged file). If a criterion is being deferred rather than closed,
   write `- ⚠️ deferred <text> →` `` `<LedgerSymbol>` `` and add a Reachability Ledger row.
   Leave no `- [ ]` in a remediation step this commit claims.

### Phase 4 — Commit (plan-step commit)

The commit spans the submodule plan doc (the ✅/deferred marks) and the parent source, so
it goes through the plan-step gate:

1. Stage the plan doc in the submodule (`git -C exaix-dev-docs add <planning-doc>`) — the
   ✅/deferred lines must be added lines of this diff.
2. Stage the edited source + test files in the parent — every `→ path` you wrote must be
   among them.
3. Write the structured message (type `fix`; body has `what:`, `rationale:`, `tests:`,
   `who:`, `impact:`, the gap numbers e.g. `remediation: GAP-1, GAP-3`, and a mandatory
   `plan: exaix-dev-docs/planning/<phase>.md#<remediation-step-N>` field), then commit both
   repos via `deno run -A scripts/commit_plan_step.ts <commit-msg-file> --commit`.
4. If it blocks asking to roll back the submodule's last commit, run
   `git -C exaix-dev-docs reset --soft HEAD~1` and re-run so the plan doc + parent land in
   sync. See the submodule-workflow and #next-steps (step 26) skills.

## Output Format

1. Summary of gaps closed (count by severity).
2. List of files edited with what changed.
3. Confirmation that all tests pass and CI gates are clean.
4. Commit payload.

---
exaix:
  skill_id: remediate-code-gaps
  related_skills: [post-gap-analysis, test-development, exaix-development]
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
    - "CI gates clean (lint, check, style, arch, magic)"
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
