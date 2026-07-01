---
agent: general
scope: dev
title: Review-Research-Improvement Pattern
short_summary: "Systematic approach to evaluate Exaix subsystems, identify weaknesses, and create actionable improvement plans."
version: "1.1"
topics: ["architecture-review", "improvement-planning", "patterns", "refactoring", "quality"]
---

> **Invocable workflow moved to skill** — The full autonomous Review-Research-Improvement
> workflow (REVIEW → RESEARCH → PLAN → ARTIFACTS) is now the canonical skill
> **[skills/review-research/SKILL.md](../skills/review-research/SKILL.md)**.
> Use `#review-research` to invoke it.
>
> This guideline is retained as a **reference summary** of the pattern's rationale,
> subsystem-specific research areas, and illustrative examples.

## Review-Research-Improvement Pattern

A structured methodology for evaluating Exaix subsystems, identifying architectural weaknesses, and producing actionable improvement plans with concrete artifacts.

## When to Use

- Evaluating a concept/subsystem for quality and completeness
- Planning major architectural improvements
- Preparing for multi-phase refactoring work
- Identifying technical debt and prioritizing fixes
- Creating new templates/patterns based on state-of-the-art research

## Pattern Overview

`````text
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   REVIEW    │───▶│  RESEARCH   │───▶│    PLAN     │───▶│  ARTIFACTS  │
│  (Analyze)  │    │ (Compare)   │    │ (Prioritize)│    │  (Create)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
      │                  │                  │                  │
      ▼                  ▼                  ▼                  ▼
  Weaknesses        Best Practices      Phased Plan       Templates
  Identified        Identified          Document          Examples
```text

## Phase 1: Review (Analyze Current State)

### 1.1 Documentation Review

Read all relevant documentation:

- Primary docs in `docs/`
- Blueprints in `Blueprints/`
- README files in relevant directories
- Implementation plan sections

**Checklist:**

- [ ] Understand the stated purpose/goals
- [ ] Identify documented features vs. missing features
- [ ] Note any TODOs, FIXMEs, or acknowledged gaps

### 1.2 Implementation Analysis

Examine the actual code:

- Use `semantic_search` for relevant code patterns
- Read key service files end-to-end
- Check test coverage for behavior documentation
- Look for inconsistencies between docs and implementation

**Key Questions:**

- Does the implementation match the documentation?
- Are there unused/dead code paths?
- What error handling exists?
- What's the actual data flow?

### 1.3 Template/Example Audit

For pattern-based subsystems (Agents, Flows):

- Count existing templates
- Assess template quality and coverage
- Identify missing patterns

**Output:** List of current capabilities with gaps noted.

## Phase 2: Research (Compare to State-of-the-Art)

### 2.1 Identify Relevant Patterns

Research modern approaches for the subsystem type:

| Subsystem | Research Areas                                       |
| --------- | ---------------------------------------------------- |
| Agents    | ReAct, Reflexion, Chain-of-Thought, Tool Use         |
| Flows     | Multi-agent orchestration, DAG execution, transforms |
| Memory    | RAG, semantic search, context windows                |
| Tools     | Function calling, schema validation, sandboxing      |

### 2.2 Gap Analysis

Compare current implementation to best practices:

```markdown
| Feature   | Current State | Best Practice | Gap             |
| --------- | ------------- | ------------- | --------------- |
| Feature A | Basic         | Advanced      | Missing X, Y    |
| Feature B | None          | Required      | Not implemented |
| Feature C | Good          | Good          | None            |
```text

### 2.3 Document Weaknesses

Create numbered weakness list with:

- **Problem:** What's wrong or missing
- **Impact:** Why it matters
- **Evidence:** Code reference showing the issue

**Example:**

````markdown
### 1. No Self-Reflection Mechanism

**Problem:** Agents produce output in single pass without self-evaluation.

**Impact:** Quality varies; no automatic improvement loops.

**Evidence:**

```typescript
// agent_runner.ts:115 - Single-pass execution
const rawResponse = await this.modelProvider.generate(combinedPrompt);
const result = this.parseResponse(rawResponse); // Direct return
```text
````text

````text
## Phase 3: Plan (Create Improvement Roadmap)

### 3.1 Planning Document Structure

Create `exaix-dev-docs/planning/phase-N-<subsystem>-improvements.md`:

```markdown
# Phase N: <Subsystem> Improvements

**Created:** <date>
**Status:** Planning
**Priority:** High/Medium/Low
**Estimated Duration:** X weeks

---

## Executive Summary
[1-2 paragraph overview]

## Current State Analysis
[Architecture diagram, key components table]

## Identified Weaknesses
[Numbered list with problem/impact/evidence]

## Improvement Plan
[Sub-phases with tasks, success criteria]

## Implementation Priority
[Dependency graph, recommended order]

## Risk Assessment
[Risk/impact/mitigation table]

## Success Metrics
[How to measure improvement]
````text

### 3.2 Sub-Phase Design

Each sub-phase should have:

- **Goal:** Single-sentence objective
- **Tasks:** Numbered implementation steps
- **Success Criteria:** Checkboxes for completion
- **Effort Estimate:** Days/hours
- **Dependencies:** Which phases must complete first

### 3.3 Documentation Phase (REQUIRED)

**Every improvement plan MUST include a dedicated Documentation Update phase.**

This phase should update:

| Document                               | Purpose                                   |
| -------------------------------------- | ----------------------------------------- |
| `docs/Exaix_User_Guide.md`          | User-facing feature documentation         |
| `docs/Building_with_AI_Agents.md`      | Patterns and best practices               |
| `docs/Exaix_Implementation_Plan.md` | Phase completion status                   |
| Subsystem README                       | Template catalog, configuration reference |

**Documentation Phase Template:**

```markdown
### Phase N.X: Documentation Update (1 day)

**Goal:** Update user-facing documentation to reflect new capabilities.

**Files to Update:**

| File                            | Updates Required      |
| ------------------------------- | --------------------- |
| docs/Exaix_User_Guide.md     | [Section]: [features] |
| docs/Building_with_AI_Agents.md | [patterns, examples]  |
| [Subsystem]/README.md           | [templates, config]   |

**Tasks:**

1. Document new features with examples
2. Update CLI reference
3. Add troubleshooting section
4. Update configuration reference

**Success Criteria:**

- [ ] User guide complete
- [ ] Each feature has example
- [ ] CLI documented

### 3.4 Prioritization Matrix

| Priority  | Criteria                                  |
| --------- | ----------------------------------------- |
| Critical  | Blocking issues, security, data integrity |
| High      | Major quality/reliability improvements    |
| Medium    | Important features, moderate impact       |
| Low       | Nice-to-have, polish, minor improvements  |
| **Final** | Documentation Update (always last phase)  |

## Phase 4: Artifacts (Create Concrete Deliverables)

### 4.1 Templates

Create reusable templates that encode best practices:

- Place in appropriate `templates/` directory
- Include inline documentation
- Provide customization points with placeholders
- Add usage examples

**Template Structure:**

```markdown
---
[frontmatter with metadata]
---

# Template Name

## Overview

[What this template is for]

## Instructions

[How to use it]

## Output Format

[Expected structure]

## Example

[Complete worked example]

## Customization Points

[Table of placeholders]

## When to Use

[✅ Good for / ❌ Not ideal for]
```text

### 4.2 Example Implementations

Create concrete examples showing the pattern in action:

- Real scenarios, not toy examples
- Complete implementations
- Comments explaining key decisions

### 4.3 Documentation Updates

Update relevant READMEs with:

- New template descriptions
- Comparison tables
- Implementation status
- Links to planning docs

## Verification Checklist

Before completing the pattern:

- [ ] Planning document committed to `exaix-dev-docs/planning/`
- [ ] Weaknesses have code evidence (not speculation)
- [ ] Improvement phases have clear success criteria
- [ ] **Documentation Update phase included** (updates `docs/` folder)
- [ ] Templates follow existing conventions
- [ ] README files updated
- [ ] All pre-commit checks pass
- [ ] Commit message follows convention

## Example Applications

### Example 1: Flow Orchestration Review (Phase 15)

**Request:** "Review the concept of Flows, find weaknesses, create improvement plan"

**Process:**

1. **Review:** Read `Blueprints/Flows/`, `packages/flow/src/`, examples, templates
2. **Research:** Multi-agent patterns, LLM-as-a-Judge, DAG orchestration
3. **Plan:** Created `phase-15-flow-orchestration-improvements.md`
   - Identified 8 weaknesses (dead fields, no quality gates, etc.)
   - Proposed 6 sub-phases
4. **Artifacts:**
   - `llm-judge-code-review.flow.template.ts`
   - `quality-judge.md` agent blueprint
   - Updated templates README

### Example 2: Agent Orchestration Review (Phase 16)

**Request:** "Same review-research-improvement for direct agent orchestration"

**Process:**

1. **Review:** Read `Blueprints/Agents/`, `AgentRunner`, `AgentExecutor`, templates
2. **Research:** Reflexion, ReAct, tool-use patterns, confidence scoring
3. **Plan:** Created `phase-16-agent-orchestration-improvements.md`
   - Identified 8 weaknesses (no self-reflection, weak validation, etc.)
   - Proposed 8 sub-phases
4. **Artifacts:**
   - `reflexive-agent.md.template`
   - `research-agent.md.template`
   - `judge-agent.md.template`
   - Updated templates README

## Common Pitfalls

| Pitfall              | Prevention                     |
| -------------------- | ------------------------------ |
| Vague weaknesses     | Require code evidence for each |
| Over-scoped plans    | Limit to 6-8 sub-phases        |
| Missing dependencies | Draw dependency graph          |
| No success criteria  | Mandate checkboxes per phase   |
| Orphan artifacts     | Update READMEs immediately     |

## Related Documents

- [Self-improvement loop](./self-improvement.md) - For instruction gaps
- [Phase 15: Flow Improvements](../planning/phase-15-flow-orchestration-improvements.md)
- [Phase 16: Agent Improvements](../planning/phase-16-agent-orchestration-improvements.md)

## Canonical Prompt

```text
"Perform a Review-Research-Improvement analysis on [subsystem]:

1. Review: Read all docs, implementation, templates
2. Research: Compare to state-of-the-art patterns
3. Plan: Create exaix-dev-docs/planning/phase-N document with weaknesses and improvement phases
4. Artifacts: Create templates/examples that encode best practices
Commit all artifacts with descriptive commit message."
```text
`````

## Canonical Prompt (Short)

"Perform a Review-Research-Improvement analysis on [subsystem]:

1. Review: Read all docs, implementation, templates
2. Research: Compare to state-of-the-art
3. Plan: Create improvement roadmap
   Commit all artifacts with descriptive commit message."

## Examples

- Example prompt: "Perform a Review-Research-Improvement analysis on direct agent orchestration."
