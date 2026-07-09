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
- This skill consumes a Post-Gap Analysis section in a planning document and closes every code-level gap by editing source files (not the plan document).
- Only close gaps that the post-gap analysis explicitly opened. Do NOT add new refactoring or polish beyond the named gaps.
- For each gap: read the affected source file, then edit it to satisfy the gap's Resolution (documented in the remediation step that the post-gap analysis added to the plan).
- Tests come first (TDD): if the gap remediation adds new behaviour, write the test first, then implement.
- After all gaps are remediated: re-run all affected tests, run CI gates, and create a structured commit.
- Do NOT edit the planning document — that was done by post-gap-analysis.

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
- ✅ Do use `#commit` for a structured commit at the end.
- ❌ Don't add new refactoring or polish beyond the named gaps.
- ❌ Don't edit the planning document — only source files.
- ❌ Don't skip tests for any remediation.

Related skills:
- #post-gap-analysis — Produces the remediation steps this skill executes
- #fix-bug — Fix a specific finding discovered during remediation
- #commit — Structured commit after remediation
- #test-development — Edge case coverage requirements, test helpers, placement rules

Workflow chain (typical):
  #plan → #pre-gap-analysis → #remediate-plan-gaps → #next-steps → #post-gap-analysis → **#remediate-code-gaps** → #commit
```

## See also

- [test-development](../test-development/SKILL.md) — test helpers, placement rules
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

### Phase 3 — Validate

1. Re-run all tests mentioned in the remediation step's Planned Tests.
2. Run `deno task check clean` to confirm no regressions.
3. Verify the gap's Finding is now resolved by re-reading the source.

### Phase 4 — Commit

Use `#commit` for a structured commit. Type: `fix`. Include the gap number in the commit body (e.g., `remediation: GAP-1, GAP-3`). Mandatory fields: `what:`, `rationale:`, `tests:`, `who:`, `impact:`.

## Output Format

1. Summary of gaps closed (count by severity).
2. List of files edited with what changed.
3. Confirmation that all tests pass and CI gates are clean.
4. Commit payload.

---
exaix:
  skill_id: remediate-code-gaps
  triggers:
    keywords: [remediate-code, code-gaps, close-code-gaps, fix-code]
    task_types: [bugfix, refactor]
    tags: [remediate-code]
  constraints:
    - "Only close gaps explicitly opened by a Post-Gap Analysis section"
    - "Do not add new refactoring or polish beyond named gaps"
    - "Do not edit the planning document — only source files"
    - "Write tests first (TDD) when adding new behaviour"
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
