---
agent: general
tools:
  - read_file
  - search_files
  - write_file
  - run_command
scope: dev
title: "Review-Research-Improvement Skill (#review-research)"
description: Evaluate an Exaix subsystem for weaknesses, compare to best practices, produce a phased improvement plan and concrete artifacts
short_summary: "Autonomous skill for systematic subsystem review: analyze current state, research best practices, create actionable improvement plan with phase doc and templates."
version: "1.0"
topics: ["architecture-review", "improvement-planning", "patterns", "refactoring", "quality", "planning"]
qwen_skill: review-research
---

```text
Key points
- Follow the four-phase loop: REVIEW → RESEARCH → PLAN → ARTIFACTS
- Every identified weakness must have code evidence (file:line reference), not speculation
- Limit the improvement plan to 6–8 sub-phases; any broader and it needs splitting
- Every improvement plan MUST include a Documentation Update phase (always last)
- Commit all artifacts (planning doc + templates + README updates) together
- When reading more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue

Canonical prompt (short):
"Perform a Review-Research-Improvement analysis on [subsystem]:
1. Review: read all docs, implementation, and templates
2. Research: compare to state-of-the-art patterns
3. Plan: create phased improvement roadmap with success criteria
4. Artifacts: commit planning doc, new templates, README updates"

Workflow
────────
Phase 1 — REVIEW (Analyze Current State)
  1. Documentation review:
     - Read docs/, Blueprints/, and relevant README files for the subsystem.
     - Read the planning docs in .copilot/planning/ for prior phases on this subsystem.
     - List: stated purpose/goals, documented features, TODOs/FIXMEs, acknowledged gaps.
  2. Implementation analysis:
     - Use semantic_search or grep_search for relevant code patterns.
     - Read key service files end-to-end (src/ and tests/).
     - Check test coverage — tests document behavior.
     - Note inconsistencies between docs and implementation.
     - Key questions: Does implementation match docs? Dead code paths? Data flow?
  3. Template/example audit (for pattern-based subsystems — Agents, Flows):
     - Count existing templates and assess quality.
     - Identify missing patterns or incomplete coverage.
  4. Output: capability list with gaps annotated.

Phase 2 — RESEARCH (Compare to State-of-the-Art)
  5. Identify relevant modern patterns for the subsystem type:
     | Subsystem | Research Areas                                       |
     |-----------|------------------------------------------------------|
     | Agents    | ReAct, Reflexion, Chain-of-Thought, Tool Use         |
     | Flows     | Multi-agent orchestration, DAG execution, transforms |
     | Memory    | RAG, semantic search, context windows                |
     | Tools     | Function calling, schema validation, sandboxing      |
  6. Build a gap table:
     | Feature   | Current State | Best Practice | Gap          |
     |-----------|---------------|---------------|--------------|
     | Feature A | Basic         | Advanced      | Missing X, Y |
     | Feature B | None          | Required      | Not implemented |
  7. Document each weakness with:
     - **Problem:** What's wrong or missing
     - **Impact:** Why it matters
     - **Evidence:** `file.ts:line` reference showing the issue
  8. Output: numbered weakness list (max ~10) with code evidence.

Phase 3 — PLAN (Create Improvement Roadmap)
  9. Create a planning document at .copilot/planning/phase-N-<subsystem>-improvements.md
     using this structure:
       # Phase N: <Subsystem> Improvements
       Status: Planning | Priority: High/Medium/Low
       ## Executive Summary [1-2 paragraphs]
       ## Current State Analysis [key components table]
       ## Identified Weaknesses [numbered, with problem/impact/evidence]
       ## Improvement Plan [sub-phases with tasks, success criteria, effort]
       ## Implementation Priority [dependency order]
       ## Risk Assessment [risk/impact/mitigation table]
       ## Success Metrics [how to measure improvement]
 10. Design sub-phases (6–8 max) — each with:
     - Single-sentence **Goal**
     - Numbered **Tasks**
     - **Success Criteria** checkboxes
     - **Effort Estimate** (days/hours)
     - **Dependencies** (which phases precede it)
 11. Use the prioritization matrix:
     Critical (blocking/security/integrity) > High (quality/reliability) >
     Medium (features/moderate) > Low (polish/minor) > Documentation (always last)
 12. The final sub-phase MUST be a Documentation Update:
     docs/Exaix_User_Guide.md, docs/Building_with_AI_Agents.md, subsystem README.

Phase 4 — ARTIFACTS (Create Concrete Deliverables)
 13. Templates: create reusable templates in appropriate templates/ directories.
     Each template must have: frontmatter metadata, overview, instructions,
     output format, complete worked example, customization points table,
     and "when to use" guidance.
 14. Example implementations: real scenarios with complete implementations and
     comments explaining key decisions.
 15. README updates: update subsystem README with new template descriptions,
     comparison tables, and links to the planning doc.
 16. Commit: stage planning doc + new templates + README updates together.
     Use #commit for structured commit body:
       feat(<subsystem>): add review-research improvement plan (Phase N)

       what: analysis of <subsystem>, identified N weaknesses, created N-phase plan
       rationale: systematic improvement before next feature phase
       tests: N/A (planning artifacts only)
       who: <agent identity>
       impact: <subsystem> roadmap documented

Verification checklist (before committing)
 - [ ] Planning doc committed to .copilot/planning/
 - [ ] Every weakness has code evidence (file:line), not speculation
 - [ ] All sub-phases have success criteria checkboxes
 - [ ] Documentation Update phase is the final sub-phase
 - [ ] Templates follow existing conventions
 - [ ] README files updated
 - [ ] Commit message follows conventional commits convention

Common pitfalls to avoid
| Pitfall              | Prevention                          |
|----------------------|-------------------------------------|
| Vague weaknesses     | Require code evidence for each      |
| Over-scoped plans    | Limit to 6–8 sub-phases             |
| Missing dependencies | Draw dependency graph first         |
| No success criteria  | Mandate checkboxes per sub-phase    |
| Orphan artifacts     | Update READMEs in the same commit   |

Do / Don't
- ✅ Do read the subsystem implementation (not just docs) before identifying weaknesses
- ✅ Do include file:line evidence for every weakness
- ✅ Do keep the plan realistic: 6–8 sub-phases max
- ✅ Do always make Documentation Update the final sub-phase
- ✅ Do commit planning doc + templates + README updates atomically
- ✅ If no prior planning docs exist for the subsystem, use source files and tests as ground truth for Phase 1 — treat absent docs themselves as a weakness to list.
- ❌ Don't speculate about weaknesses without code evidence
- ❌ Don't create a plan with > 8 sub-phases (split into two phases instead)
- ❌ Don't skip the Documentation Update phase
- ❌ Don't start implementation in this skill — this skill produces a plan only
   (execution follows via #next-steps or #plan)

Related skills
- #plan              — Draft or extend a phase planning document (lighter-weight alternative)
- #pre-gap-analysis  — Validate a plan's ambiguities and security risks before execution
- #review            — Code-level review (individual PR/change scope, not subsystem scope)
- #next-steps        — Execute the improvement plan produced by this skill
- #commit            — Create a structured commit message for the artifacts

Workflow chain (typical):
  **#review-research** → #pre-gap-analysis → #next-steps → #post-gap-analysis
```

## Output format

1. Phase 1 — Capability inventory with gaps annotated.
1. Phase 2 — Weakness list (numbered, each with problem/impact/evidence).
1. Gap table (Current State vs. Best Practice).
1. Phase 3 — Planning document path and executive summary.
1. Sub-phase table (goal, effort, dependencies).
1. Phase 4 — Artifacts created (template paths, README sections updated).
1. Commit payload.

## Examples

- `#review-research Evaluate the LLM provider layer for extensibility weaknesses`
- `#review-research Assess EventLogger against structured logging best practices`
- `#review-research Review MCP tool handlers for security and input validation gaps`
