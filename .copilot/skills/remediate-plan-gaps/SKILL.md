---
name: remediate-plan-gaps
agent: senior-coder
tools:
  - read_file
  - write_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Remediate Plan Gaps Skill (#remediate-plan-gaps)"
description: Consumes review-phase-plan gap findings and edits plan step definitions to close each gap — re-runs tests and bumps version
short_summary: "Edits phase planning documents to close gaps identified by review-phase-plan, then re-runs tests and bumps the document version."
version: "1.0.1"
topics: ["planning", "gap-analysis", "remediation", "tdd", "documentation"]
qwen_skill: remediate-plan-gaps
---

```text
Key points

- Consume the plan's Pre-Gap Analysis section; close every non-trivial gap by editing the
  step definitions (Actions, Architecture Notes, Planned Tests, Success Criteria).
- Close only gaps the analysis explicitly opened. No new analysis or scope creep.
- Per gap: read the step text, then edit it to satisfy the gap's Resolution. Clarify an
  imprecise resolution, but stay in the gap's scope.
- After remediation: re-run the planned tests (they must still pass or be updated), bump
  the document version, and update the Status line.
- Interfaces or schemas changed? Add a documentation update step as the final step (§3D).
- Work gaps in severity order: 🔴 → 🔒 → 🟡 → 🟠 → 🔵.

Canonical prompt (short):
"Remediate the gaps in exaix-dev-docs/planning/phase-NN-*.md's Pre-Gap Analysis section.
Edit each step to close its gaps, re-run tests, bump version, update Status."

Examples
- "#remediate-plan-gaps exaix-dev-docs/planning/phase-125-dogfood-meta-workflow-skills.md"

Do / Don't
- ✅ Read each gap entry and its Resolution before editing.
- ✅ Scope edits to exactly what the gap resolution requires.
- ✅ Re-run all planned tests after each edit.
- ✅ Bump the version and set Status to "🚧 Gap Remediation In Progress".
- ✅ Add a documentation update step (§3D) if interfaces or schemas changed.
- ❌ Add new analysis or gaps — only close existing ones.
- ❌ Change steps with no open gaps.
- ❌ Edit code files — only the planning document.

Related: #review-phase-plan (produces the gaps); #next-steps; #commit;
[test-development](../test-development/SKILL.md) — edge cases, helpers, placement.

Workflow chain: #plan → #review-phase-plan → **#remediate-plan-gaps** → #next-steps →
#review-phase-code → #remediate-code-gaps → #commit
```

## See also

- [plan](../plan/SKILL.md) — plan creation, step format, success criteria

---

## Instructions for Agent

Close every gap in the plan's Pre-Gap Analysis by editing its step definitions.

### Phase 1 — Ingest

1. Read the document in full — version, status, every step, the Pre-Gap Analysis.
1. Read each gap entry (Finding, Impact, Resolution).
1. Identify which steps each gap affects.

### Phase 2 — Remediate

Severity order; per gap:

1. Locate the affected step(s).
1. Apply the Resolution to the step's Actions, Architecture Notes, Planned Tests, or
   Success Criteria.
1. Ambiguous Resolution? Clarify from the Finding, stay in scope.
1. Do NOT change a step with no open gap.

### Phase 3 — Validate

1. Re-run each step's Planned Tests; confirm they pass.
1. A test now fails because the resolution changed behavior? Update the test.
1. Run `deno task check clean` — no regressions.

### Phase 4 — Finalize

1. Bump the document version (e.g. 1.2 → 1.3).
1. Set Status to `🚧 Gap Remediation In Progress`.
1. Interfaces or schemas changed? Ensure a §3D documentation step is final.
1. Run `deno run --allow-read --allow-write scripts/markdown_lint.ts exaix-dev-docs/planning/<doc>`.
   Re-ran with `--fix`? Immediately re-verify every `# step-manifest` yaml fence still
   has its `step: N` key via `deno run --allow-read scripts/check_step_manifests.ts <doc>`
   — `--fix`'s heading-blank-line rule has historically misread a `# step-manifest`
   comment inside a fence as a heading and dropped the following key.

### Phase 5 — Commit

Use `#commit`. Type: `fix`. Fields: `what:`, `rationale:`, `tests:`, `who:`, `impact:`.

## Output Format

1. Gaps closed (count by severity).
1. Steps edited, and what changed in each.
1. Confirmation that planned tests pass.
1. Version bump and Status update.
1. Commit payload.

---
exaix:
  skill_id: remediate-plan-gaps
  related_skills: [review-phase-plan, next-steps, test-development]
  triggers:
    keywords: [remediate-plan, plan-gaps, close-gaps, fix-plan]
    task_types: [planning]
    tags: [remediate-plan]
  constraints:
    - "Only close gaps explicitly opened by a Pre-Gap Analysis section"
    - "Do not add new analysis or scope-creep beyond named gaps"
    - "Do not edit source code files — only the planning document"
    - "Work through gaps in severity order: Critical, Security, Feasibility, Testing, Conceptual"
    - "Re-run all planned tests after remediation"
  output_requirements:
    - "All named gaps resolved in the planning document"
    - "Document version bumped"
    - "Status updated to Gap Remediation In Progress"
    - "Documentation update step added if interfaces/schemas changed"
  quality_criteria:
    - name: scope_discipline
      description: Only named gaps are closed — no scope creep
      weight: 40
    - name: completeness
      description: Every gap has a corresponding edit in the affected step
      weight: 30
    - name: validation
      description: All planned tests pass after remediation
      weight: 30
---
