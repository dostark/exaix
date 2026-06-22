---
agent: general
scope: dev
title: Specification-Driven Development in Exaix
short_summary: "Analysis of how Exaix's request-clarification-planning-execution pipeline implements Specification-Driven Development (SDD) principles for AI agent orchestration."
version: "1.0"
topics: ["methodology", "sdd", "quality", "request-processing", "architecture"]
links:
  - "CODE_STYLE.md"
---

## Specification-Driven Development in Exaix

## Overview

**Specification-Driven Development (SDD)** is an approach to building applications with LLM agents where a structured specification is written _before_ code generation begins, and that specification serves as both the execution guide and the evaluation rubric. Rather than iterating on generated code ("generate → fix → regenerate"), SDD iterates on the _specification_ until it's well-defined, then generates code from a solid foundation.

Exaix's Phases 45–49 quality pipeline implements an adapted form of SDD optimized for agent orchestration. This document maps the correlation between SDD principles and Exaix's architecture, identifies where Exaix goes beyond vanilla SDD, and notes the remaining gap.

---

## Core SDD Principles → Exaix Mapping

| # | SDD Principle                        | Exaix Implementation                                                                                                                                   | Phase         |
| - | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| 1 | **Write a spec before code**         | The Q&A loop produces an `IRequestSpecification` (goals, success criteria, scope, constraints) _before_ the agent executes                             | Phase 47      |
| 2 | **Spec defines acceptance criteria** | `IRequestAnalysis` extracts acceptance criteria; `CriteriaGenerator` converts them into evaluation rubric items (`GOAL_ALIGNMENT`, `TASK_FULFILLMENT`) | Phase 45 + 48 |
| 3 | **Iterate on the spec, not on code** | Multi-round Q&A refines the specification through conversation; rounds track quality improvement; agent and user both must be satisfied                | Phase 47      |
| 4 | **Spec is the contract**             | `IRequestSpecification` is preserved (never overwritten), persisted as `_clarification.json`, and used as ground truth for evaluation                  | Phase 47      |
| 5 | **Grounded in reality**              | `PortalKnowledgeService` provides actual codebase architecture, conventions, and key files — specs are written with awareness of what exists           | Phase 119     |
| 6 | **Spec as evaluation rubric**        | Quality gates, reflexive agent, and confidence scorer evaluate against spec-derived criteria, not generic heuristics                                   | Phase 48 + 49 |
| 7 | **Change the spec, not the code**    | Structured frontmatter allows users to express expectations declaratively; spec revision path under consideration                                      | Phase 49      |

---

## The Exaix SDD Pipeline

````text
┌─────────────────────────────────────────────────────────────────────────┐
│                     SPECIFICATION PHASE                                 │
│                                                                         │
│  Request (.md)                                                          │
│    → RequestQualityGate.assess()           Is this specific enough?     │
│    → [if not] Q&A Loop                     Iterative refinement         │
│        ├── Planning agent asks questions   (goal/scope/constraint/etc.) │
│        ├── User answers                                                 │
│        ├── Agent synthesizes IRequestSpecification                      │
│        ├── Quality re-assessment                                        │
│        └── Repeat until satisfied                                       │
│    → RequestAnalyzer.analyze()             Extract structured intent    │
│    → IRequestSpecification + IRequestAnalysis = THE SPECIFICATION       │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     KNOWLEDGE PHASE                                     │
│                                                                         │
│  PortalKnowledgeService                                                 │
│    → Architecture overview, key files, conventions, dependencies        │
│    → Feeds into: Q&A questions, auto-enrichment, agent context          │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     EXECUTION PHASE                                     │
│                                                                         │
│  AgentRunner.run()                                                      │
│    → Agent executes with specification + portal knowledge as context    │
│    → ReflexiveAgent critiques against specification goals               │
│    → ConfidenceScorer assesses goal alignment                           │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     EVALUATION PHASE                                    │
│                                                                         │
│  GateEvaluator / JudgeEvaluator                                        │
│    → GOAL_ALIGNMENT criterion: does output satisfy spec goals?          │
│    → TASK_FULFILLMENT criterion: are all requirements addressed?        │
│    → REQUEST_UNDERSTANDING criterion: does output match intent?         │
│    → Generic criteria: code correctness, security, style (unchanged)    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```text

---

## Where Exaix Goes Beyond Vanilla SDD

### 1. Assisted Specification Writing

In pure SDD, the human writes the full specification manually. This requires skill — knowing what to specify, how to structure it, and what level of detail agents need. Exaix lowers this barrier through **collaborative specification**:

- A planning agent identifies what's missing, vague, or ambiguous
- It generates categorized questions (goal, scope, constraint, acceptance, context)
- Each question includes a rationale explaining *why* it matters
- Answers are synthesized into structured `IRequestSpecification` sections
- Users don't need to know how to write a good spec — the system guides them there

### 2. Progressive Specification Depth

SDD typically applies the same rigor uniformly — every task gets a full spec. Exaix adapts the specification effort to the request:

- **Clear, well-bounded requests** (e.g., "add a `--verbose` flag to `exactl portal list`") skip the Q&A loop entirely — the `RequestQualityGate` scores them above threshold and they proceed directly
- **Ambiguous requests** (e.g., "make the TUI better") trigger the full refinement loop
- **Moderate requests** get auto-enriched via LLM without user interaction

This avoids the friction of over-specifying trivial tasks while ensuring complex tasks are well-defined.

### 3. Codebase-Grounded Specifications

Traditional SDD specs are written by humans who (presumably) know the codebase. When working with AI agents, this assumption breaks down — neither the agent writing the spec nor (sometimes) the user has deep codebase familiarity.

Exaix's `PortalKnowledgeService` (Phase 119) addresses this by providing:

- Actual architecture layers and key files
- Detected code conventions and patterns
- Dependency information and tech stack
- File significance ranking

The planning agent can reference this knowledge when generating questions: *"The codebase uses the service pattern with constructor-based DI. Should the new feature follow this pattern?"* — producing specifications that are feasible and convention-aligned.

### 4. Spec-to-Evaluation Traceability

The most distinctive SDD aspect in Exaix: the specification doesn't just guide execution — it **becomes** the evaluation rubric. When `CriteriaGenerator` (Phase 48) converts `IRequestAnalysis` goals and requirements into `GOAL_ALIGNMENT` and `TASK_FULFILLMENT` evaluation criteria, the quality gates verify output against the specification, not generic heuristics.

This closes the SDD feedback loop:
```text
Specification → Execution → Evaluation against Specification → Pass/Fail
```text

Without this, evaluation answers "is this good code?" — with it, evaluation answers "does this code do what was specified?"

---

## Known Gap: Re-Refinement During Execution

SDD emphasizes **spec versioning and change management** — if requirements are discovered to be infeasible mid-execution, the specification is updated first, then execution resumes from the revised spec.

Exaix's current design finalizes the specification before execution and does not revisit it during the agent's work. If the `ReflexiveAgent` discovers during self-critique that a requirement is infeasible, the current design retries with feedback but doesn't return to the user to revise the specification.

**Impact:** An agent may produce suboptimal output trying to satisfy an infeasible requirement rather than flagging it for spec revision.

**Possible future solution:** Add a "return to refinement" path from the execution phase back to the Q&A loop — the `ReflexiveAgent` or `ConfidenceScorer` could trigger a `NEEDS_REVISION` status that re-enters the clarification session with the specific infeasibility as context. This is tracked as an open question in Phase 47.

---

## Phase Dependency Map

```text
Phase 119: Portal Knowledge ─────────────────────────┐
  (codebase context)                                  │
                                                      ▼
Phase 47: Quality Gate & Q&A Loop ──▶ IRequestSpecification
  (spec refinement)                          │
                                             ▼
Phase 45: Request Intent Analysis ──▶ IRequestAnalysis
  (structured extraction)                    │
                                             ▼
Phase 48: Criteria Propagation ────▶ Dynamic Evaluation Criteria
  (spec → rubric)                            │
                                             ▼
Phase 49: Pipeline Hardening ──────▶ Goal-Aware Critique & Frontmatter
  (robustness)
```text

---

## Flow (Multi-Agent) Request Coverage

All analysis above describes the **agent request path**. Exaix also supports **flow requests** — multi-agent orchestration via `FlowRunner` with gate, branch, consensus, and feedback loop step types.

**Current gap:** The SDD pipeline (quality gate, specification, analysis, criteria, portal knowledge) is designed to integrate with `processAgentRequest()`. Flow requests take a separate path through `processFlowRequest()` that bypasses these services. `FlowRunner.execute()` receives the raw `request.body` as `userPrompt` with no specification, analysis, or portal knowledge attached.

**Required changes across phases:**

| Concern | Current (Flow Path) | Required Change |
| --------- | -------------------- | ----------------- |
| Quality Gate (47) | Skipped | Run before agent/flow routing split — applies to all requests |
| Request Analysis (45) | Skipped | Run before routing split; propagate `IRequestAnalysis` to `FlowRunner` |
| Specification (47) | Not available | Extend `FlowRunner.execute()` to accept `IRequestSpecification`; inject into step contexts |
| Dynamic Criteria (48) | Gate steps use static YAML criteria only | Propagate analysis to gate steps; enable `includeRequestCriteria` at flow level |
| Portal Knowledge (46) | Not injected | Resolve before routing split; pass to `FlowRunner`; inject into step contexts |
| `IFlowStepRequest` | Has empty `context: {}` | Extend with `requestAnalysis`, `specification`, `portalKnowledge` fields |

**Architectural principle:** The SDD specification phase (Phases 45, 119, 47) operates on the *request*, which is independent of the execution mechanism. Analysis, quality gating, specification building, and portal knowledge resolution should all happen before the agent/flow routing decision. Only the *consumption* of these artifacts differs between the agent path and the flow path.

See the "Flow Request Coverage" sections in each phase document for detailed integration designs.

---

## References

- Phase 45: [Request Intent Analysis](../planning/phase-45-request-intent-analysis.md)
- Phase 119: [Portal Codebase Knowledge Gathering](../planning/phase-119-multi-language-portal-extraction.md)
- Phase 47: [Request Quality Gate & Clarification](../planning/phase-47-request-quality-gate.md)
- Phase 48: [Acceptance Criteria Propagation](../planning/phase-48-acceptance-criteria-propagation.md)
- Phase 49: [Quality Pipeline Hardening](../planning/phase-49-quality-pipeline-hardening.md)
````

## Canonical Prompt (Short)

"You are an SDD specialist. Ensure the request-clarification-planning-execution pipeline is followed and the specification is refined before implementation."

## Examples

- Example prompt: "Perform SDD analysis on the new portal-v2 request."
