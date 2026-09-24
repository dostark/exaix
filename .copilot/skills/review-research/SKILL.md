---
name: review-research
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
version: "1.0.1"
topics: ["architecture-review", "improvement-planning", "patterns", "refactoring", "quality", "planning"]
qwen_skill: review-research
---

```text
Key points

- Four-phase loop: REVIEW → RESEARCH → PLAN → ARTIFACTS.
- Every weakness needs code evidence (file:line), not speculation.
- Keep the plan to 6–8 sub-phases; beyond that, split it.
- Every plan MUST end with a Documentation Update phase.
- Commit all artifacts (planning doc + templates + README updates) together.
- Reading > ~20 files: batches of 5–10. Read a batch, record findings, continue.

Canonical prompt (short):
"Perform a Review-Research-Improvement analysis on [subsystem]:
1. Review: read all docs, implementation, and templates
2. Research: compare to state-of-the-art patterns
3. Plan: create phased improvement roadmap with success criteria
4. Artifacts: commit planning doc, new templates, README updates"

Workflow
────────
Phase 1 — REVIEW (current state)
  1. Documentation: read docs/, Blueprints/, relevant READMEs, and prior planning docs
     in exaix-dev-docs/planning/ for the subsystem.
     List: stated purpose/goals, documented features, TODOs/FIXMEs, acknowledged gaps.
  2. Implementation: use semantic_search or grep_search for code patterns; read key
     service files end-to-end (packages/, apps/, tests/); check test coverage (tests
     document behavior). Note docs-vs-implementation inconsistencies, dead paths, data flow.
  3. Template/example audit (Agents, Flows): count templates, assess quality, find
     missing patterns or incomplete coverage.
  4. Output: capability list with gaps annotated.

Phase 2 — RESEARCH (state-of-the-art)
  5. Identify relevant modern patterns:
     | Subsystem | Research Areas |
     |-----------|----------------|
     | Agents | ReAct, Reflexion, Chain-of-Thought, Tool Use |
     | Flows  | Multi-agent orchestration, DAG execution, transforms |
     | Memory | RAG, semantic search, context windows |
     | Tools  | Function calling, schema validation, sandboxing |
  6. Build a gap table:
     | Feature | Current State | Best Practice | Gap |
     |---------|---------------|---------------|-----|
  7. Document each weakness: **Problem** (what's wrong), **Impact** (why it matters),
     **Evidence** (`file.ts:line`).
  8. Output: numbered weakness list (max ~10) with code evidence.

Phase 3 — PLAN (roadmap)
  9. Create `exaix-dev-docs/planning/phase-N-<subsystem>-improvements.md` with:
     Executive Summary; Current State Analysis; Identified Weaknesses; Improvement Plan;
     Implementation Priority; Risk Assessment; Success Metrics.
 10. Design sub-phases (6–8 max), each with: single-sentence **Goal**, numbered
     **Tasks**, **Success Criteria** checkboxes, **Effort Estimate**, **Dependencies**.
 11. Prioritization matrix: Critical (blocking/security/integrity) > High (quality/
     reliability) > Medium (features/moderate) > Low (polish/minor) > Documentation
     (always last).
 12. The final sub-phase MUST be a Documentation Update: docs/Exaix_User_Guide.md,
     docs/Building_with_AI_Agents.md, subsystem README.

Phase 4 — ARTIFACTS (deliverables)
 13. Templates in appropriate templates/ dirs: frontmatter metadata, overview,
     instructions, output format, a complete worked example, customization points table,
     and "when to use" guidance.
 14. Example implementations with real scenarios and comments on key decisions.
 15. README updates: new template descriptions, comparison tables, links to the plan.
 16. Commit planning doc + templates + README updates together.
     Use #commit: `feat(<subsystem>): add review-research improvement plan (Phase N)`
     with what/rationale/tests/who/impact.

Verification checklist
  - [ ] Planning doc committed to exaix-dev-docs/planning/
  - [ ] Every weakness has code evidence (file:line), not speculation
  - [ ] All sub-phases have success criteria checkboxes
  - [ ] Documentation Update is the final sub-phase
  - [ ] Templates follow existing conventions
  - [ ] README files updated
  - [ ] Commit message follows conventional commits

Common pitfalls
  | Pitfall | Prevention |
  |---------|-----------|
  | Vague weaknesses | Require code evidence for each |
  | Over-scoped plans | Limit to 6–8 sub-phases |
  | Missing dependencies | Draw the dependency graph first |
  | No success criteria | Mandate checkboxes per sub-phase |
  | Orphan artifacts | Update READMEs in the same commit |

Do / Don't
- ✅ Read the subsystem implementation (not just docs) before identifying weaknesses.
- ✅ Include file:line evidence for every weakness.
- ✅ Keep the plan realistic: 6–8 sub-phases max.
- ✅ Make Documentation Update the always-final sub-phase.
- ✅ Commit planning doc + templates + README updates atomically.
- ✅ No prior planning docs? Use source + tests as ground truth; treat absent docs
  itself as a listed weakness.
- ❌ Speculate about weaknesses without code evidence.
- ❌ Create a plan with > 8 sub-phases — split into two.
- ❌ Skip the Documentation Update phase.
- ❌ Start implementation here — this skill produces a plan only.

Related: #plan; #pre-gap-analysis; #review-code (code-level, not subsystem); #next-steps;
#commit.

Workflow chain: **#review-research** → #pre-gap-analysis → #next-steps → #post-gap-analysis
```

## Output format

1. Phase 1 — capability inventory with gaps annotated.
1. Phase 2 — weakness list (numbered, problem/impact/evidence per item).
1. Gap table (Current State vs. Best Practice).
1. Phase 3 — planning document path and executive summary.
1. Sub-phase table (goal, effort, dependencies).
1. Phase 4 — artifacts created (template paths, README sections updated).
1. Commit payload.

## Examples

- `#review-research Evaluate the LLM provider layer for extensibility weaknesses`
- `#review-research Assess EventLogger against structured logging best practices`
- `#review-research Review MCP tool handlers for security and input validation gaps`

---
exaix:
  skill_id: review-research
  triggers:
    keywords: [review-research, evaluate, assess, research-review, subsystem]
    task_types: [research]
    tags: [research, review]
  constraints:
    - "Read the subsystem implementation (not just docs) before identifying weaknesses"
    - "Include file:line evidence for every weakness"
    - "Keep the plan realistic: 6-8 sub-phases max"
    - "Always make Documentation Update the final sub-phase"
    - "Do not speculate about weaknesses without code evidence"
    - "Do not start implementation in this skill — this skill produces a plan only"
  output_requirements:
    - "Phase 1: Capability inventory with gaps annotated"
    - "Phase 2: Weakness list with problem, impact, evidence per item"
    - "Gap table comparing Current State vs Best Practice"
    - "Phase 3: Planning document with sub-phases"
    - "Phase 4: Artifacts created (templates, README updates)"
  quality_criteria:
    - name: evidence_quality
      description: Every weakness has file:line code evidence
      weight: 40
    - name: plan_actionability
      description: Improvement plan has concrete sub-phases with success criteria
      weight: 30
    - name: scope_discipline
      description: Limited to 6-8 sub-phases, documentation is final
      weight: 30
---
