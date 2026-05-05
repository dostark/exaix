---
agent: senior-coder
scope: dev
title: "Plan Skill (#plan)"
description: Draft a new Phase Planning Document for a feature, refactor, or architectural change — follows Exaix standards for TDD, security, and traceability
short_summary: "Canonical prompt for drafting and justifying high-quality, architecturally rigorous implementation plans built for Exaix's human-in-loop philosophy."
version: "1.3"
topics: ["planning", "architecture", "tdd", "security", "traceability", "configurability"]
qwen_skill: plan
---

```text
Key points
- This is the entry point for EVERY significant feature or refactor.
- Use Test-Driven Design (TDD): specify Planned Tests BEFORE implementation steps.
- Enforce Exaix Core Principles:
  1. Traceability: Every state change MUST emit a typed EventLogger event.
  2. Durability: Plans must result in atomic changesets or journaled DB state.
  3. Configurability: Avoid magic numbers; use exa.config.toml or named constants.
  4. Security: Proactively perform 'Phase 3b' checks (traversal, injection, auth).
- Documentation (§3D): Every interface/schema change REQUIRES a matching doc update step.

Canonical prompt (short):
"Draft a new Phase Planning Document for <FEATURE>. Follow .copilot/planning/README.md structure. Include §3B Security and §3C Traceability/Configurability checks in the design. Ensure a §3D Documentation Update step is included."

Example prompt:
"#plan Implement a new 'vault' service for secure encrypted secret storage in .exa/vault.db. Ensure full audit logging and config-driven rotation intervals."

Do / Don't
- ✅ Do identify every affected file and its specific gap in a table.
- ✅ Do specify constructor signatures for new/modified services.
- ✅ Do include MERMAID diagrams for complex logic flows.
- ✅ Do include a Section 12 for Safety Gates / Mid-execution replanning if applicable.
- ✅ Do use symbols like 🔴 🔒 🟡 🟠 🔵 for risk and gap classification.
- ❌ Don't use 'any' or vague types; use Zod schemas and TypeScript interfaces.
- ❌ Don't skip the 'Planned Tests' section for any implementation step.
- ❌ Don't defer documentation updates; implement them as the last step of the phase.

Prototypes & Validation:
- Use #pre-gap-analysis to validate this plan against the codebase before starting.
- Use #post-gap-analysis to verify the final implementation against the plan's promises.

Workflow chain (typical):
  #plan → #pre-gap-analysis → #next-steps → #post-gap-analysis → #commit
```

---

## Instructions for Agent

Refine the goal into a formal planning document in `.copilot/planning/phase-NN-*.md`.

### 1. Structure Requirements (Mandatory)

Follow the structure defined in `.copilot/planning/README.md`:

1. **Executive Summary**: Problem, Solution, Goal.
1. **Current State Analysis**: Key Files table, Constraints, Affected Interfaces.
1. **Technical Architecture**: Schemas (Zod), Interfaces (TS), Logic Flows (Mermaid).
1. **Implementation Plan**: Numbered steps using the TDD-First format (Actions, Architecture Notes, Planned Tests, Success Criteria).
1. **Documentation Updates (§3D)**: Mandatory step to update `ARCHITECTURE.md`, `docs/`, `TOOLS.md`, etc.
1. **Success Metrics**: Quantitative targets (performance, quality).

### 2. Core Principles Integration

#### A. Security (Phase 3b Feasibility)

For every step, verify:

- **Input Validation**: Are external inputs (JSON/TOML) validated with Zod?
- **Path Resolution**: Are all FS paths routed through `PathResolver`?
- **Auth Boundary**: Is a permission check performed before each side effect?
- **Secrets**: Are secrets NEVER logged or stored in plain-text?

#### B. Traceability & Configurability (Phase 3c Check)

- **Event Logging**: Every state transition must have a named `EventLogger` event (e.g., `vault.secret.rotated`).
- **Typing**: Event payloads must use named interfaces, never `Record<string, unknown>`.
- **Config**: Timeouts, thresholds, and feature toggles must be in `exa.config.toml` or `src/shared/constants.ts`.

#### C. Durability & Atomic Changes

- Ensure file modifications are grouped into approved Changesets.
- DB operations must be wrapped in transactions where atomicity is required.

### 3. Documentation Update Protocol (§3D)

Include a final **Step N (§3D): Update Documentation** that covers:

- `ARCHITECTURE.md`: If new components/flows are added.
- `docs/Exaix_User_Guide.md`: For user-facing CLI/config changes.
- `TOOLS.md`: If MCP tool schemas changed (`deno task docs-sync-schemas`).
- `CODE_STYLE.md`: If new patterns (e.g., specific error handling) are established.

### 3E. Scenario Framework Coverage

If the implementation affects the **request → plan → execution → review → memory → update** flow
(or any sub-path of it), assess whether `tests/scenario_framework/` scenarios need new or updated
coverage:

- **Review existing scenarios**: Check `tests/scenario_framework/scenarios/agent_flows/`.
- **Add scenario steps** if the new behaviour introduces observable CLI/daemon checkpoints in the
  end-to-end flow.
- **Create a new scenario** under `tests/scenario_framework/scenarios/agent_flows/` if the change
  adds a distinct observable phase that the existing scenarios do not exercise.
- **Tag appropriately**: Use `provider-live` for LLM-dependent scenarios and omit from CI auto
  runs. Use `safety-gate` for scenarios that validate correctness invariants.

### 4. Derived Best Practices

- **Phase Dependencies**: Explicitly list required prior phases.
- **Risk Level**: L/M/H classification with justification.
- **Symbolic References**: Use `file:Symbol` syntax for traceability.

---

## Output format

1. Brief chat summary of the architectural approach and key identified risks.
1. The path to the new or updated planning document file.
1. Recommendation to run `#pre-gap-analysis` on the new plan to verify its completeness against the codebase.
