# Standardized Agent Planning Documentation Guideline

This document defines the mandatory standards for creating high-quality, architecturally rigorous planning documents in the Exaix codebase. All future planning documents (e.g., in `.copilot/planning/`) must adhere to these guidelines to ensure consistency, clarity, and agent-native discoverability.

## 1. Overview

A high-quality implementation plan is a formal architectural document that bridges the gap between a high-level goal and a concrete, testable implementation. It serves as:

1. **The Source of Truth**: For what is being built and why.
1. **The Blueprint**: For the structural changes and interfaces.
1. **The Test Plan**: Defining the success criteria and validation steps.
1. **The Agent Map**: Providing structured metadata (YAML) for future agent discovery and reasoning.

---

## 2. Mandatory Document Structure

Every planning document must include the following sections in order:

### A. YAML Frontmatter

```yaml
---
agent: [primary-agent-blueprint, e.g., senior-coder]
scope: [dev/ops/docs/ux]
title: "Phase N: Clear, Actionable Title"
short_summary: "One-sentence summary of the phase objective."
version: "1.0"
topics: ["planning", "roadmap", "architecture", "tdd", "guidelines"]
---

> [!TIP]
> This document is a specialized extension of the [root .copilot/ guidelines](../README.md).
```

### B. Status & Context

> [!NOTE]
> **Status**: 🚧 Planning / ✅ In Progress / ✅ Complete
> **Phase Dependencies**: None / [Phase 56]
> **Risk Level**: L/M/H (briefly justify)

### C. Executive Summary

- **The Problem**: Detailed description of the current pain points and architectural gaps.
- **The Solution**: High-level technical approach and proposed outcome.
- **The Goal**: Clear, high-level objectives.

### D. Current State Analysis

- **Key Files**: Table of relevant files and their current role/gap.
- **Constraints**: Identified limitations or "hallucinations" to fix.
- **Interfaces**: List of existing interfaces that will be affected.

### E. Technical Architecture & Detailed Design

- **Schemas**: Explicit Zod schema definitions with field types and descriptions.
- **Interfaces**: Fully-typed TypeScript interfaces for all new or modified services.
- **Logic Flows**: Mermaid diagrams or structured text flows (Input → Process → Output).
- **Design Decisions**: Rationale for chosen patterns (e.g., TDD, Strategy Pattern, DI).

### F. Implementation Plan (Step-by-Step)

Each step must follow the **TDD-First** order:

1. **Actions**: Specific file paths to create/modify and the logic to implement.
1. **Architecture Notes**: Low-level implementation details (DI, constructor patterns, factory methods).
1. **Planned Tests**: List of specific unit/integration tests to be written **before** implementation.
1. **Success Criteria**: Measurable, objective outcomes for the step.

### G. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation Strategy |
| ------ | -------- | ------------ | --------------------- |
| R1: API Drift | High | Low | CI Gate with mock synchronization |

### H. Success Metrics (Quantitative)

- Performance targets (e.g., "< 5ms processing time").
- Quality targets (e.g., "Hallucination reduced by 80% on codebase queries").

### I. Backward Compatibility

Detailed handling of legacy code, deprecated flags, or old shims during and after the transition.

---

## 3. Implementation Phase Maintenance

Once implementation begins, the planning document MUST be updated in real-time to reflect progress.

### A. Marking Completion

- Use task list syntax `[x]` to mark completed actions and tests.
- When a step is fully finished and all its success criteria are met, label it with **✅ IMPLEMENTED**.
- Update the main document `Status` to `✅ In Progress` or `✅ Complete`.

### B. No-Skip Policy

- **Never skip success criteria.** If a criterion cannot be met, the plan must be amended with a justification.
- **Test results matter.** A step is not completed until its `Planned Tests` pass with 100% coverage.

### C. Handling Deviations

- If implementation reveals a design flaw, DO NOT just change the code.
- Update the `Technical Architecture` section of the plan first.
- Bump the document `version` (e.g., 1.0 → 1.1) to signal an architectural pivot.

### D. Documentation Updates (Mandatory)

When a phase introduces or modifies architecture, public interfaces, CLI behaviour, data formats, or user-facing features, the following documentation **must** be updated as part of the same implementation step — not deferred to a follow-up:

| Document                      | Update when…                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `ARCHITECTURE.md`             | New components, services, data flows, or architectural layers are introduced |
| `docs/`                       | User-facing behaviour, configuration, CLI commands, or workflows change      |
| `TOOLS.md`                    | MCP tool schemas are added or modified (`deno task docs-sync-schemas`)       |
| `CODE_STYLE.md`               | New patterns or constraints are established by the phase                     |
| `.copilot/cross-reference.md` | New task→doc mappings are required for agent discoverability                 |

**Rules:**

- A step's **Success Criteria** must include documentation update verification when the step touches a public surface.
- Documentation-only updates do not require new tests but must pass `deno task docs-agent-validate` and `deno task check:docs`.
- If a document does not yet exist for the affected area, create it and add it to `.copilot/manifest.json`.

---

## 4. Guiding Principles

1. **Test-Driven Design (TDD)**: Never describe an implementation without describing its corresponding tests. Every step in your plan should have a matching "Planned Tests" section.
1. **Explicit Interfaces**: Do not use `any`. Define exact TypeScript interfaces and Zod schemas in the design section.
1. **Symbol-Based Linking**: Reference source code using stable symbols (`src/services/db.ts:LogEntry`) rather than fragile line numbers (`#L42`).
1. **Visual & Structured Data**: Use Mermaid diagrams for logic flows. Pair them with Markdown tables or YAML blocks for precise reasoning by both humans and agents.

1.
1.
1.
1.

   ```bash
   deno run --allow-all scripts/markdown_lint.ts --fix .copilot/planning/phase-N.md
   ```

---

## 5. Derived Examples

1. `phase-47-request-quality-gate.md`: Best-in-class multi-turn conversation and iterative Q&A protocol.
1. `phase-45-request-intent-analysis.md`: Detailed heuristic and LLM scoring signals.
1. `phase-61-agent-executor-mcp-integration.md`: Clean, design-first implementation roadmap with before/after comparisons.
1. `phase-80-enterprise-provider-support.md`: Comprehensive business-compliant implementation guidelines.

---
**Last Updated**: 2026-04-07
