---
agent: general
scope: dev
title: "Plan Workflow"
short_summary: "Thin slash-command wrapper for canonical plan workflow."
version: "1.0"
topics: ["plan", "workflow"]
qwen_skill: plan
description: Drafts a new Phase Planning Document for a feature, refactor, or architectural change — follows Exaix standards for TDD, security, and traceability
---

# Plan (Phase Planning Documentation)

Thin slash-command wrapper for the canonical phase planning document lifecycle workflow.

## Canonical source of truth

- `.copilot/prompts/plan.md`

## Use this command to

1. Draft or refine a formal Planning Document in `.copilot/planning/phase-NN-*.md` for a new feature or significant refactor.
1. Adhere to the mandatory structure and principles defined in `.copilot/prompts/plan.md`:
   - **Executive Summary**: Define the Problem, Solution, and Goal.
   - **Current State Analysis**: Audit existing files/interfaces and identify gaps.
   - **Technical Architecture**: Specify fully-typed schemas, interfaces, and logic flows (Mermaid).
   - **TDD-First Implementation Plan**: Numbered steps including Actions, Architecture Notes, Planned Tests, and Success Criteria.
   - **Traceability (§3C)**: Ensure every state transition emits a typed and documented `EventLogger` event.
   - **Configurability (§3C)**: Externalize all thresholds, timeouts, and toggles into constants or config files.
   - **Security (§3B)**: Perform mandatory security checks for input, paths, auth, and secrets.
   - **Documentation Update (§3D)**: Include a final step to keep `ARCHITECTURE.md` and user guides in sync.
1. Incorporate Success Metrics and Backward Compatibility plans.

## Execution requirements

1. Treat `.copilot/prompts/plan.md` as authoritative if this wrapper conflicts with it.
1. Use Test-Driven Design (TDD): Never specify implementation steps without corresponding Planned Tests.
1. Every interface or schema change REQUIRES a matching documentation update in §3D.
1. Security Phase 3b and Traceability Phase 3c checks are mandatory parts of the blueprinting phase.
1. All new features must be justified against Exaix's core principles of durability and human-in-the-loop auditability.

## Output format

1. Brief chat summary of the architectural approach and key identified risks.
1. The path to the new or updated planning document file.
1. Recommendation to run `#pre-gap-analysis` on the new plan to verify its completeness against the codebase.

## Canonical Prompt (Short)

"You are a planning specialist. Draft a new phase planning document for [task] following Exaix standards."

## Examples

- Example prompt: "#plan a new feature 'portal-v2'."
