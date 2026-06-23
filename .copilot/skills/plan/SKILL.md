---
name: plan
agent: senior-coder
tools:
  - read_file
  - write_file
  - search_files
  - run_command
scope: dev
title: "Plan Skill (#plan)"
description: Draft a new Phase Planning Document for a feature, refactor, or architectural change — follows Exaix standards for TDD, security, and traceability. Produces plans that are machine-convertible to dogfood requests (step-manifests for automated request extraction). Grounds any third-party service/provider integration in deep web research of the provider's real, current capability surface so integrations are first-class, not hacks.
short_summary: "Canonical prompt for drafting and justifying high-quality, architecturally rigorous implementation plans built for Exaix's human-in-loop philosophy."
version: "1.8.0"
topics: [
  "planning",
  "architecture",
  "tdd",
  "security",
  "traceability",
  "configurability",
  "reachability",
  "dogfooding",
  "integrations",
]
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
- Name the planning document `.copilot/planning/phase-NN-<kebab-slug>.md` (NN = next sequential phase number).
- Keep each phase to 8–10 implementation steps maximum — split larger features into two sequential phases.
- Assess `tests/scenario_framework/` coverage (§3E) whenever the feature touches the request → plan → execution → review → memory → update flow.
- **Specify exact values**: For every enum, union, or variant field, state which concrete value each component emits and under what conditions — not just the allowed set. Vague "can be one of X, Y, Z" without per-component mapping is a pre-gap.
- **Trace every output to its consumer**: For every new interface field or event payload name a consuming component and verify the data flow reaches it. Fields with no readers are dead data.
- **Survey module conventions**: Before committing to a pattern choice (event naming, error handling, DI style), read 5–10 existing examples in the affected module and document the dominant convention. Divergence requires justification in Architecture Notes.
- **Ground third-party integrations in web research**: When a plan integrates an external service, provider, API, or CLI (an LLM provider, a coding-agent tool, a cloud/SaaS API, a binary), do deep web research on the provider's CURRENT official capability surface FIRST — supported endpoints, auth model, config/routing knobs, limits, versioning — and design to its real first-class mechanism. A wrapper/proxy/scrape/undocumented-flag "integration" is a hack that breaks on the next provider update: flag it and prefer the documented path. Record the doc URLs + research date. See §2F.
- **Map prose claims to named tests**: Every behavioural claim made in the prose (e.g., "checkpoint preserves data", "service Y calls service Z") must have a named test in Planned Tests. Claims without test names are gaps.
- **Reachability over layering**: structure the plan as a VERTICAL end-to-end slice (one complete path entry-point → … → output) BEFORE breadth. A horizontal, layer-by-layer plan (all schemas, then all services, then "wire it") is the classic setup for "every component exists, nothing works" — flag it and re-sequence. See §E.
- **Integration anchor per runtime-claiming step**: any step whose Success Criteria assert runtime/observable behaviour MUST name (a) the exact production call-site/constructor (`file:Symbol`) that invokes the new code, and (b) a named integration or scenario test that exercises that call-site. A runtime claim backed only by package-unit tests is a pre-gap.
- **No forward-deferral chains**: a step may not consume something a LATER step builds (dependency inversion); "wired in Step M" is acceptable only if Step M's Actions contain the concrete wiring. Every "consumed by Step M" must resolve to a real call in Step M.
- **One non-deferrable cutover step**: end the phase with an "Integration & cutover" step whose Success Criterion is "the feature is reachable from a real daemon/CLI run with config X", and which may NOT defer to a future phase.
- **Opt-in toggles must do something**: for any `enabled`-style flag, add a Success Metric of the form "with `feature.enabled=true`, observable behaviour B occurs", backed by a test that flips the REAL config.
- When reading existing source files to understand context, work in batches of 5–10 files: read a batch, record findings, then continue.

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
- ✅ Do specify the exact value each component emits for every enum/variant field — not just the allowed set.
- ✅ Do trace every new output field to a named consumer — verify the data flow has a destination before writing it.
- ✅ Do survey the affected module's existing conventions before choosing a pattern — document divergence in Architecture Notes.
- ✅ Do ground every third-party/provider integration in deep web research of the provider's current official docs — design to the supported first-class endpoint/auth/config surface, and cite the URLs + research date (§2F).
- ✅ Do map every prose behavioural claim to a named test in the step's Planned Tests section.
- ✅ Do anchor every runtime-claiming step to a named production call-site AND an integration/scenario test (not just a unit test).
- ✅ Do include one terminal, non-deferrable "Integration & cutover" step proving the feature is reachable from a real run.
- ✅ Do order steps so no step consumes something a later step builds; prefer a vertical end-to-end slice before breadth.
- ✅ Do name the planning document `phase-NN-<kebab-slug>.md` for consistent slugs.
- ✅ Do keep phases to 8–10 steps maximum — split larger features into two sequential phases.
- ✅ Do assess scenario framework coverage (§3E) for any change to the end-to-end flow.
- ✅ Do use `[ ]` for all success criteria and success metric checkboxes in planning documents — these represent aspirational targets, not completion status. Reserve `[x]` (or ✅) for actual implementation progress tracked during execution (e.g., in todo lists or step-manifests).
- ✅ Do use plain descriptive prose to summarize a step's outputs and consumers — never status-like labels such as `**✅ CORE**` or `**✅ WIRED**` that could be mistaken for implementation status.
- ✅ Do ensure every h2 section carries its own descriptive content that fulfills the section's stated purpose. A section that is only a heading followed immediately by sub-headings (e.g., `## Current State Analysis` with no prose before `### Key Files`) is a **blank container** — it reads as an unfinished outline placeholder, not a written plan. Every h2 must contain at least one paragraph of content at its own level that introduces, summarizes, or frames the sub-sections below it. This is especially critical for `## Executive Summary`, `## Current State Analysis`, `## Technical Architecture`, and `## Security Constraints` — sections whose heading promises information that must not be deferred entirely to sub-sections.
- ❌ Don't use 'any' or vague types; use Zod schemas and TypeScript interfaces.
- ❌ Don't skip the 'Planned Tests' section for any implementation step.
- ❌ Don't let a runtime success criterion be satisfiable by a package-unit test alone — that is how production-dead code ships green.
- ❌ Don't structure a feature as horizontal layers ("all cores, then wire") — it maximizes the risk that nothing is connected.
- ❌ Don't design a third-party integration from memory or assumptions, or settle for a proxy/scrape/undocumented-flag hack when an official integration path exists — verify against the provider's live docs first (§2F).
- ❌ Don't defer documentation updates; implement them as the last step of the phase.

Prototypes & Validation:
- Use #pre-gap-analysis to validate this plan against the codebase before starting.
- Use #post-gap-analysis to verify the final implementation against the plan's promises.

Workflow chain (typical):
  #plan → #pre-gap-analysis → #next-steps → #post-gap-analysis → #commit

Dogfooding chain (alternative, once Phase E tooling ships):
  #plan (produces step-manifests) → #plan_to_requests (generates request queue) → daemon executes via dogfood sandbox
```

---

## Instructions for Agent

Refine the goal into a formal planning document in `.copilot/planning/phase-NN-*.md`.

### 1. Structure Requirements (Mandatory)

Follow the structure defined in `.copilot/planning/README.md`:

1. **Executive Summary**: Problem, Solution, Goal.
1. **Current State Analysis**: Key Files table, Constraints, Affected Interfaces.
1. **Technical Architecture**: Schemas (Zod), Interfaces (TS), Logic Flows (Mermaid).
1. **Implementation Plan**: Numbered steps using the TDD-First format (Actions, Architecture Notes, Planned Tests, Success Criteria), sequenced as a vertical end-to-end slice first (§E), not horizontal layers.
1. **Integration & Cutover (§E)**: A mandatory, non-deferrable penultimate step that wires the feature into a live path and proves it is reachable from a real daemon/CLI run with the feature enabled.
1. **Reachability Ledger (§E)**: A seeded (initially empty) `## Reachability Ledger (pending production consumers)` table that #next-steps maintains step-by-step; the phase cannot close while any row is ⏳.
1. **Documentation Updates (§3D)**: Mandatory final step to update `ARCHITECTURE.md`, `docs/`, `TOOLS.md`, etc.
1. **Success Metrics**: Quantitative targets (performance, quality), including an opt-in reachability metric for every `enabled`-style flag.
1. **Step Manifests (dogfooding compatibility)**: Every implementation step MUST end with a fenced YAML `step-manifest` block containing `step`, `title`, `identity`, `skills`, `portal`, `target_branch`, `depends_on`, and `acceptance` (tests + outcomes). This makes the plan machine-convertible to daemon requests via `plan_to_requests.ts`. Example:

   ```yaml
   # step-manifest
   step: 1
   title: Capability + constants
   identity: senior-coder
   skills: [tdd-methodology, exaix-conventions, portal-grounding, security-first]
   portal: exaix-self
   target_branch: feat/phase-NN-step-1
   depends_on: []
   acceptance:
     tests:
       - "capability is defined and gated to Team"
       - "[regression] all boundary constants accept and return expected types"
     outcomes:
       - "deno task check clean"
   ```

   The manifest is **additive** — it sits beside the existing prose sections (Actions,
   Architecture Notes, Planned Tests, Success Criteria), never replaces them. Tools that
   don't understand manifests continue to read the prose. The `plan_to_requests.ts`
   generator prefers the manifest and falls back to heading scrape when absent.

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
- **Config**: Timeouts, thresholds, and feature toggles must be in `exa.config.toml` or `packages/core/src/types/constants.ts`.

#### C. Durability & Atomic Changes

- Ensure file modifications are grouped into approved Changesets.
- DB operations must be wrapped in transactions where atomicity is required.

#### D. Field Specification & Consumer Tracing

For every new or modified interface, event payload, or schema field:

- **Exact values**: If the field's type is an enum, union, or set of allowed values,
  specify the exact value each component emits and the condition under which that value
  changes. "Field can be one of A, B, C" without per-component mapping is underspecified.
- **Consumer destination**: Name the component or code path that reads each output field.
  A field defined in one step whose consumer is never implemented is dead data.
- **Flow completion**: Document the end-to-end data flow from producer to consumer.
  Verify at least one named test exercises the complete chain.

#### E. Reachability & Integration Anchoring (the production-dead guard)

The most common — and most expensive — post-implementation gap is a feature whose
components are all built and tested but never wired into a live path: every test is
green because the test is the only caller. TDD, coverage, and `check:arch` grounding
all pass on production-dead code (a test-only consumer keeps it "alive"; grounding is
satisfied by a README/`@related-files` reference, not a real import). Guard against it
in the plan itself:

- **Vertical slice first.** Sequence steps so the FIRST deliverable is one complete
  end-to-end path (entry point → … → observable output), then add breadth. Reject a
  horizontal layer-by-layer ordering (all schemas → all services → "wire it later").
- **Integration anchor.** For every step whose Success Criteria assert
  runtime/observable behaviour, the step MUST name: (1) the exact production call-site
  or constructor (`file:Symbol`) that invokes the new code, and (2) a named integration
  or scenario test that drives that call-site. A runtime claim whose only Planned Tests
  are package-unit tests is a pre-gap — unit tests cannot detect that nothing calls the
  code.
- **No forward-deferral chains.** A step may not consume something a later step builds.
  "Wired in Step M" is acceptable only if Step M's Actions contain the concrete wiring;
  verify each "consumed by Step M" resolves to a real call in Step M. Deferral to
  "follow-ups" or an unnamed future step is forbidden.
- **Terminal cutover step (non-deferrable).** The phase MUST include an
  "Integration & cutover" step whose Success Criterion is reachability from a real
  daemon/CLI run with the feature enabled, and which may not defer to a future phase.
- **Opt-in proof.** For every `enabled`-style flag, a Success Metric must read "with
  `feature.enabled=true`, observable behaviour B occurs", backed by a test that flips
  the REAL config — not a unit test of the gated component in isolation.
- **Seed the Reachability Ledger.** Add an (initially empty) `## Reachability Ledger
  (pending production consumers)` section to the planning doc — a table with columns
  `Symbol | Added in | Wiring step | Production call-site | Status`. #next-steps
  appends a ⏳ row whenever a step ships a symbol with no production caller and flips
  it to ✅ when a later step wires it; the phase cannot close while any row is ⏳. The
  ledger is the durable, doc-resident to-do list that prevents production-dead code
  from being silently forgotten between steps.

> If the feature is genuinely too large to wire end-to-end within one 8–10 step phase,
> split it so that **each** phase delivers a reachable vertical slice — never a phase
> that ships only disconnected cores. A "package now, wiring next phase" split is only
> acceptable if the package phase's own Success Metrics do not claim runtime behaviour.

#### F. Third-Party Integration Research (Capability Grounding)

When a plan integrates an external service, provider, API, or CLI (an LLM provider, a
coding-agent tool, a SaaS/cloud API, a CLI binary), DO NOT design from memory, training
data, or assumptions — provider capabilities and APIs drift. Research the provider's
CURRENT official surface with web search/fetch (where available), then design to its
real, supported, first-class mechanism:

- **Find the official integration path.** Fetch the provider's own current docs (API
  reference, integration/cookbook pages, auth guide). Identify the supported endpoint(s)
  and their shape (e.g. OpenAI-compatible vs Anthropic-compatible), the auth model
  (API key / OAuth / BYOK), and any official "use with `<tool>`" recipe. Prefer a
  documented first-class path over everything else.
- **Treat workarounds as a RED flag.** A proxy/shim, HTML scrape, undocumented flag, or
  reverse-engineered protocol is a hack that breaks on the next provider release. If a
  first-class path exists, design to it. If none exists, say so explicitly and justify
  the workaround as a stop-gap with the risk called out — never present a hack as a
  first-class integration.
- **Expose the capability surface, don't hardcode one path.** A provider is usually a
  control plane, not a single endpoint. Surface its real knobs (routing, fallback,
  caching, rate/cost limits, data-retention/privacy) through Exaix config rather than
  pinning one hardcoded behaviour.
- **Separate the axes.** Keep model vs provider vs endpoint vs auth-realm distinct in the
  design — conflating them is how "first-class" silently degrades to "works in one config".
- **Capture caveats + versions.** Record provider-stated caveats ("only guaranteed with
  X"), minimum binary/API versions, and auth-env gotchas, so the plan is implementable
  exactly as written.
- **Cite sources, date the research.** List the consulted doc URLs and the research date
  in a **Sources** block in the plan, marking each as official vs community/unofficial;
  re-verify if the plan is implemented much later.

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
- **Convention survey**: Before committing to an interface shape, naming pattern, or architectural
  style in a module with existing code, survey 5–10 examples in the same file to determine the
  dominant convention. Document divergence in Architecture Notes.
- **Claim-to-test mapping**: For every prose behavioural claim, list a corresponding named test in
  the step's Planned Tests section. Prose without test names is a pre-gap.
- **Integration capability grounding**: For any third-party/provider integration, research the
  provider's current official docs (web search/fetch) and design to its first-class supported surface
  — endpoints, auth model, config knobs — never a workaround. Record sources + research date (§2F).
- **Step-manifest convention**: Every implementation step must include a fenced YAML step-manifest
  block (after Success Criteria) for machine conversion to dogfood requests. The manifest fields
  (`identity`, `skills`, `portal`, `target_branch`, `depends_on`, `acceptance`) are a subset of the
  daemon request schema — validating early ensures the step is representable as a request. The
  manifest is additive and backward-compatible: existing tools read the prose, `plan_to_requests.ts`
  prefers the manifest.

---

## Related

- [LLM_GUIDE.md](../../../LLM_GUIDE.md) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)

## Output format

1. Brief chat summary of the architectural approach and key identified risks.
1. The path to the new or updated planning document file.
1. Each implementation step includes a fenced YAML step-manifest block (for dogfooding compatibility).
1. Markdown lint result: `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>`.
1. If the plan integrates a third-party service/provider, a **Sources** block: the provider doc URLs consulted (marked official vs community/unofficial) and the research date (§2F).
1. Recommendation to run `#pre-gap-analysis` on the new plan to verify its completeness against the codebase.
1. Commit payload — use `#commit` to stage and commit the new planning document.

## Examples

- `#plan Phase 14: Add caching layer for LLM provider responses`
- `#plan Refactor EventLogger to support structured JSON output`
- `#plan Migrate CLI from Cliffy to a lighter argument parser`

---
exaix:
  skill_id: plan
  triggers:
    keywords: [plan, phase, planning, design]
    task_types: [planning]
    tags: [planning, architecture]
  constraints:
    - "Follow Exaix TDD, security, and traceability standards"
    - "Each step includes a step-manifest YAML block"
    - "Ground third-party integrations in deep web research"
    - "Include a Reachability Ledger section"
    - "Vertical end-to-end slice before breadth"
    - "Documentation update step as final step"
  output_requirements:
    - "Phase planning document with numbered steps"
    - "Step-manifest blocks for dogfood compatibility"
    - "Reachability Ledger table"
    - "Pre-Gap Analysis recommended"
  quality_criteria:
    - name: step_manifest_completeness
      description: Every step has a manifest block
      weight: 35
    - name: architectural_rigor
      description: Plan references ARCHITECTURE.md components
      weight: 35
    - name: reachability_tracking
      description: Reachability Ledger tracks production-dead symbols
      weight: 30
---

