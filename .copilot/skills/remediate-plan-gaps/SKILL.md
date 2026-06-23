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
description: Consumes pre-gap-analysis gap findings and edits plan step definitions to close each gap — re-runs tests and bumps version
short_summary: "Edits phase planning documents to close gaps identified by pre-gap-analysis, then re-runs tests and bumps the document version."
version: "1.0.0"
topics: ["planning", "gap-analysis", "remediation", "tdd", "documentation"]
qwen_skill: remediate-plan-gaps
---

```text
Key points
- This skill consumes a Pre-Gap Analysis section in a planning document and closes every non-trivial gap by editing the plan's step definitions (Actions, Architecture Notes, Planned Tests, Success Criteria).
- Only close gaps that the pre-gap analysis explicitly opened. Do NOT add new analysis or scope-creep beyond the named gaps.
- For each gap: read the existing step text, then edit it to satisfy the gap's Resolution. If the resolution is imprecise, clarify it, but stay within the gap's scope.
- After all gaps are remediated: re-run the plan's planned tests (they must still pass or be updated), bump the document version, and update the Status line to reflect remediation.
- A documentation update step must be added as the final step when interfaces or schemas change (matching §3D).
- Work through gaps in severity order: 🔴 → 🔒 → 🟡 → 🟠 → 🔵.

Canonical prompt (short):
"Remediate the gaps in .copilot/planning/phase-NN-*.md's Pre-Gap Analysis section.
Edit each step to close its gaps, re-run tests, bump version, update Status."

Examples
- "#remediate-plan-gaps .copilot/planning/phase-125-dogfood-meta-workflow-skills.md"

Do / Don't
- ✅ Do read each gap entry and its Resolution before editing.
- ✅ Do scope edits to exactly what the gap resolution requires.
- ✅ Do re-run all planned tests after each edit to confirm they still pass.
- ✅ Do bump the document version and update Status to "🚧 Gap Remediation In Progress".
- ✅ Do add a documentation update step (§3D) if interfaces or schemas were changed.
- ❌ Don't add new analysis or gaps — only close existing ones.
- ❌ Don't change steps that have no open gaps.
- ❌ Don't edit code files — only the planning document.

Related skills:
- #pre-gap-analysis — Produces the gaps this skill closes
- #next-steps — Executes the plan after gaps are remediated
- #commit — Structured commit after remediation

Workflow chain (typical):
  #plan → #pre-gap-analysis → **#remediate-plan-gaps** → #next-steps → #post-gap-analysis → #remediate-code-gaps → #commit
```

---

## Instructions for Agent

You are performing a **plan-gap remediation** of a phase planning document. Your goal is to close every gap identified in the Pre-Gap Analysis section by editing the plan's step definitions.

### Phase 1 — Ingest

1. Read the planning document in full — version, status, every step, and the Pre-Gap Analysis section.
2. Read each gap entry (Finding, Impact, Resolution).
3. Identify which steps are affected by which gaps.

### Phase 2 — Remediate Gaps

For each gap, in severity order:

1. Locate the affected step(s).
2. Apply the Resolution from the gap entry to the step's Actions, Architecture Notes, Planned Tests, or Success Criteria.
3. If the Resolution is ambiguous, clarify it using the Finding description, but stay within scope.
4. Do NOT change any step that has no open gap.

### Phase 3 — Validate

1. Re-run each step's Planned Tests (in the test file) and confirm they still pass.
2. If a test no longer passes because the gap resolution changed the behaviour, update the test.
3. Run `deno task check clean` to confirm no regressions.

### Phase 4 — Finalize

1. Bump the document version (e.g., 1.2 → 1.3).
2. Update the Status line to `🚧 Gap Remediation In Progress`.
3. If interfaces or schemas changed, ensure a documentation update step (§3D) exists as the final step.
4. Run `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>`.

### Phase 5 — Commit

Use `#commit` for the structured commit. Type: `fix`. Mandatory fields: `what:`, `rationale:`, `tests:`, `who:`, `impact:`.

## Output Format

1. Summary of gaps closed (count by severity).
2. List of steps edited with what changed in each.
3. Confirmation that planned tests still pass.
4. Version bump and Status update confirmation.
5. Commit payload.

---
exaix:
  skill_id: remediate-plan-gaps
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
