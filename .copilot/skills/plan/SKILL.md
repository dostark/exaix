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
version: "1.12.1"
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

- Entry point for EVERY significant feature or refactor.
- Test-Driven Design: specify Planned Tests BEFORE implementation steps.
- Exaix Core Principles:
  1. Traceability: every significant state change AND every cross-component call
     (a service invoking an injected dependency) MUST emit a typed EventLogger/EventRegistry
     event. Tag genuinely load-bearing classes `@visible` in the leading JSDoc. Audit with
     `deno task check:event-coverage` (see §2H).
  2. Durability: plans result in atomic changesets or journaled DB state.
  3. Configurability: no magic numbers; wrap tunable defaults with `configurable()` and allow
     `exactl config set` override.
  4. Security: proactively apply Phase 3b checks (traversal, injection, auth).
- §3D: every interface/schema change REQUIRES a matching documentation step.
- Name the doc `exaix-dev-docs/planning/phase-NN-<kebab-slug>.md` (NN = next free number).
- Keep 8–10 implementation steps max; split larger features into two sequential phases.
- Assess `tests/scenario_framework/` coverage (§3E) when the feature touches
  request → plan → execution → review → memory → update.
- **Specify exact values**: for each enum/union/variant, state the concrete value each
  component emits and under what conditions. "Can be one of X, Y, Z" is a pre-gap.
- **Trace every output to its consumer**: name the consuming component for every interface
  field/event payload; zero-reader fields are dead data.
- **Survey module conventions**: read 5–10 existing examples before committing to a pattern;
  document divergence in Architecture Notes.
- **Mechanized event audit**: `check:event-coverage` AST-scans implemented code; name the
  exact event (existing `DomainEventType` member or the new one) in Architecture Notes.
  `@visible` marks a component load-bearing; `--fail-on-tagged` enforces it.
- **Ground third-party integrations in web research (§2F)**: design to the provider's
  CURRENT official surface — supported endpoints, auth model, knobs, limits, versioning.
  A wrapper/proxy/scrape/undocumented-flag "integration" is a hack. Cite URLs + date.
- **Ground every code-facing claim in real source (§2G)**: grep the symbol and read the call
  site before drafting any step referencing existing code.
- **Map prose claims to named tests**: every behavioral claim gets a named Planned Test.
- **Reachability over layering (§E)**: sequence a VERTICAL end-to-end slice before breadth;
  reject a horizontal "all schemas, then all services, then wire it" order.
- **Integration anchor per runtime-claiming step**: name (a) the exact production call-site
  (`file:Symbol`) and (b) a named integration/scenario test driving it. Package-unit-only is
  a pre-gap.
- **No forward-deferral chains**: a step may not consume a later step's output; "wired in
  Step M" is valid only if Step M's Actions contain the concrete wiring.
- **One non-deferrable "Integration & cutover" step**: its Success Criterion is the feature
  reachable from a real daemon/CLI run with config X.
- **Opt-in toggles must do something**: metric form "with `feature.enabled=true`, behavior B
  occurs", backed by a test flipping the REAL config.
- Reading existing source: batches of 5–10 files.

Canonical prompt (short):
"Draft a new Phase Planning Document for <FEATURE>. Follow `exaix-dev-docs/planning/README.md`
structure. Include §3B Security and §3C Traceability/Configurability checks in the design.
Ensure a §3D Documentation Update step is included."

Example prompt:
"#plan Implement a new 'vault' service for secure encrypted secret storage in .exa/vault.db.
Ensure full audit logging and config-driven rotation intervals."

Do / Don't
- ✅ Identify every affected file and its gap in a table.
- ✅ Specify constructor signatures for new/modified services.
- ✅ Include MERMAID diagrams for complex logic flows.
- ✅ Include a Section 12 safety-gates/replanning section if applicable.
- ✅ Classify risks/gaps with 🔴 🔒 🟡 🟠 🔵.
- ✅ Specify the exact value each component emits for every enum/variant — not just the set.
- ✅ Trace every output field to a named consumer.
- ✅ Survey the module's conventions before choosing a pattern; document divergence.
- ✅ Name the exact event in Architecture Notes for state-changing/cross-component steps;
  propose `@visible` for load-bearing classes.
- ✅ Ground third-party integrations in current official docs (§2F); cite URLs + date.
- ✅ Ground every code-facing claim in real source (§2G).
- ✅ Map every prose behavioral claim to a named test.
- ✅ Anchor every runtime-claiming step to a call-site AND an integration/scenario test.
- ✅ End the phase with a non-deferrable cutover step proving real-run reachability.
- ✅ Order steps: no step consumes a later step's output; vertical slice first.
- ✅ Name the doc `phase-NN-<kebab-slug>.md`.
- ✅ Keep phases to 8–10 steps.
- ✅ Give EVERY step-manifest the SAME `target_branch: feat/phase-NN` — never
  `feat/phase-NN-step-N` (empty placeholder branches preceded this standardization).
- ✅ Author criteria/metric checkboxes as `- [ ] <text>` (no `→` path) at authoring time —
  implementation timestamps come later. #next-steps rewrites each to
  `- ✅ <text> → `<path>`` or `- ⚠️ deferred <text> → `<LedgerSymbol>``. The gate blocks
  any `- [ ]` in a committed step — [ ] may remain only on unimplemented steps.
- ✅ Point every `→ `path`` at a real changed repo file — never a command/task/prose. The
  gate extracts the backticked text after `→` verbatim and requires it to match a changed
  file; `→ `deno task docs-agent-validate`` fails. Command-verified? Point `→` at the file
  the command's success depends on.
- ✅ Keep Success Metrics checkboxes `- [ ]` during step execution (the gate scopes only
  per-step criteria/tests). At phase closure, check each `- [x]` with a citation and correct
  any metric a later step revised — an all-`- [ ]` metrics section under `✅ Complete` is a
  trust gap.
- ✅ Use plain prose for step outputs at authoring time — never pre-write `✅ CORE`/`✅ WIRED`
  (#next-steps adds those execution labels once proven).
- ✅ Every h2 has content at its own level, not just sub-headings — a heading followed
  immediately by `###` is a blank container. Especially Executive Summary,
  Current State Analysis, Technical Architecture, Security Constraints.
- ❌ Use `any` or vague types — use Zod schemas and TS interfaces.
- ❌ Skip Planned Tests on any step.
- ❌ Let a runtime criterion be satisfiable by a package-unit test alone.
- ❌ Structure as horizontal layers ("all cores, then wire").
- ❌ Design a third-party integration from memory or accept a hack when an official path
  exists (§2F).
- ❌ Defer documentation updates — they land as the final phase step.
- ❌ Author code snippets with inline `npm:`/`jsr:`/`https:` specifiers — use a deno.json
  import-map alias (lint rejects the prefixes).

Prototypes & validation:
- #review-phase-plan re-verifies the plan against the codebase (a second pass, not first
  discovery). #review-phase-code verifies the implementation against the plan.

Workflow chain: #plan → #review-phase-plan → #next-steps → #review-phase-code → #commit

Dogfooding chain (once Phase E tooling ships):
  #plan (step-manifests) → #plan_to_requests (request queue) → daemon executes in the sandbox
```

## See also

- [next-steps](../next-steps/SKILL.md) — step-by-step execution
- [review-phase-plan](../review-phase-plan/SKILL.md) — plan validation
- [review-phase-code](../review-phase-code/SKILL.md) — post-implementation review
- [test-development](../test-development/SKILL.md) — edge cases, helpers

---

## Instructions for Agent

Refine the goal into a formal planning document at `exaix-dev-docs/planning/phase-NN-*.md`.

### 1. Structure (mandatory — follow `exaix-dev-docs/planning/README.md`)

1. **Executive Summary**: Problem, Solution, Goal.
1. **Current State Analysis**: Key Files table, Constraints, Affected Interfaces.
1. **Technical Architecture**: Schemas (Zod), Interfaces (TS), Logic Flows (Mermaid).
1. **Implementation Plan**: numbered TDD-first steps (Actions, Architecture Notes,
   Planned Tests, Success Criteria), sequenced as a vertical slice first.
1. **Integration & Cutover (§E)**: a mandatory, non-deferrable penultimate step proving
   real-run reachability.
1. **Reachability Ledger (§E)**: seeded empty table (#next-steps maintains; phase cannot
   close while a row is ⏳).
1. **Documentation Updates (§3D)**: mandatory final step.
1. **Success Metrics**: quantitative targets; an opt-in reachability metric per
   `enabled`-style flag.
1. **Step Manifests**: every step ends with a fenced YAML `step-manifest`
   (`step`, `title`, `agent_role`, `skills`, `portal`, `target_branch`, `depends_on`,
   `acceptance`). `target_branch` is the SAME value on every step (`feat/phase-NN` — one
   shared branch; `plan_to_requests.ts` reads it as a plain step string). The manifest is
   ADDITIVE — it sits beside the prose, never replaces it. Example:

   ```yaml
   # step-manifest
   step: 1
   title: Capability + constants
   agent_role: senior-coder
   skills: [tdd-methodology, exaix-conventions, portal-grounding, security-first]
   portal: exaix-self
   target_branch: feat/phase-NN
   depends_on: []
   acceptance:
     tests:
       - "capability is defined and gated to Team"
       - "[regression] all boundary constants accept and return expected types"
     outcomes:
       - "deno task check clean"
   ```

   **Self-check:** run `deno run -A scripts/check_step_manifests.ts <plan-path>` after
   drafting — the CI gate runs it across all planning docs; a manifest-less step blocks.

### 2. Core principles

#### A. Security (Phase 3b)

Per step verify: input validation (Zod), path resolution (PathResolver), auth boundary
(permission before each side effect), and secrets (never logged or plain-text).

#### B. Traceability & configurability

- Timeouts, thresholds, toggles wrapped with `configurable()` in
  `packages/core/src/types/constants.ts`, overridable via `exactl config set`.
- Every state transition/cross-component call names its exact event in Architecture Notes.
- `@visible` classes: the note says so and the Actions add the JSDoc tag.
- Event payloads use named interfaces, never `Record<string, unknown>`.
- Mechanized: `check:event-coverage` (advisory; runs once code exists — #next-steps and
  the gap analyses invoke it, #plan only names the events).

#### C. Durability & atomic changes

Group file modifications into approved Changesets; wrap DB ops in transactions where
atomicity is required.

#### D. Field specification & consumer tracing

For every new/modified interface, payload, or schema field: exact per-component values and
conditions; name the reading component; document the end-to-end flow and require a named
test exercising the complete chain.

#### E. Reachability & integration anchoring (the production-dead guard)

TDD/coverage/grounding all pass on production-dead code — a test-only consumer keeps it
"alive". Guard in the plan:

- **Vertical slice first.** First deliverable = one complete end-to-end path, then breadth.
- **Integration anchor.** Every runtime-claiming step names the call-site (`file:Symbol`)
  and an integration/scenario test driving it.
- **No forward-deferral.** "Wired in Step M" requires the concrete wiring in Step M.
- **Terminal cutover (non-deferrable).** Success Criterion is an EXECUTABLE
  daemon-boot/CLI invocation proving the feature works through its real entry point —
  e.g. "a booted daemon resolves value X through `context.configAdapter`" or "`exactl
  <cmd>` prints Y". A registration/buildHandlers()/manifest-count/hand-constructed-adapter
  criterion is INVALID (Phase 137's Step 8 shipped on those while the daemon never read
  the Config DB). At least one integration test drives the production entry point.
- **Opt-in proof.** `enabled` flags: "with flag=true, behavior B", tested against the REAL
  config.
- **Seed the Reachability Ledger** (`Symbol | Added in | Wiring step | Production
  call-site | Status`). A row flips ✅ ONLY in the commit that adds the call-site; a step
  whose row is ⏳ may not carry a `✅ WIRED` label; a deferred item's token must name a row.
- Feature too large for one phase? Split so EACH phase delivers a reachable vertical slice;
  a "package now, wire next phase" split needs the package phase's own metrics to not claim
  runtime behavior.

#### F. Third-party integration research (capability grounding)

Provider capabilities drift — research the CURRENT official surface, don't design from
memory: fetch official docs (endpoints/shape, auth model, official "use with" recipes).
Prefer the documented first-class path; a proxy/scrape/undocumented-flag is a hack that
breaks on the next release — if none exists, say so and justify the stop-gap. Surface the
provider's real knobs through config (routing, fallback, caching, rate/cost, retention),
keep model/provider/endpoint/auth-realm distinct, capture caveats + minimum versions, Probe the multiplicity and edge shapes, not just the happy path (a Gemini parallel batch
signs only its first call, which no
doc page stated) and record what came back + date, and cite the doc URLs (official vs
community) in a Sources block.

#### G. Codebase grounding — pre-draft (§2G)

Run before writing any step's Actions/Notes (mandatory, like §2F):

1. **Interface verification** — grep each existing interface the plan extends: EXISTS-MATCH
   (proceed), EXISTS-MISMATCH (read the real signature, adjust), NOT-FOUND (must be a new
   interface or the name is wrong).
1. **Call-site tracing** — for each claimed call/data-flow, read the real call site: params,
   return type, hidden indirection ("pass options to generate()" only if generate() takes
   options). Write real behavior, not assumed.
1. **Side-effect audit** — `Deno.env.get/set/delete` (request-time mutation is always a gap),
   static mutable state, module-level `let` accumulators. Note whether each side effect is
   removed or preserved.
1. **Record what was checked** — a Codebase Grounding Summary in Technical Architecture
   listing interfaces (MATCH/MISMATCH/NOT-FOUND), call sites read, side effects + disposition.

#### H. Event coverage verification (§2H)

Name the exact audit event per state-changing/cross-component step so the AST check has a
target. `check:event-coverage` is advisory; a finding means verify by hand. `@visible`
promotes the class to required coverage: the JSDoc tag sits above `export class Foo`.
Coverage means more than "a logger call exists": the action must resolve to a registered
`DomainEventType` member (a raw/dynamic string is a gap); multi-lifecycle-event operations
pass the trace ID as the logger's fourth argument on every event (else each gets an
independent random trace ID); streaming/async-generator methods plan a terminal event for
every exit path incl. early cancellation. A `@visible` step must also plan a Tier A
(package-integration, real EventLogger/db) or Tier B (scenario e2e, real daemon boot)
runtime test proving the events fire with real values — Gate 19's static check cannot prove
runtime firing (one component's events never fired because the logger was never injected).
See `tests/scenario_framework/scenarios/framework_test/smoke-validation.yaml`'s
`check-journal` step and `packages/core/tests/cost_tracker_test.ts` for the pattern.

### 3. Documentation update protocol (§3D)

Final step covering: `ARCHITECTURE.md` (new components/flows); `docs/Exaix_User_Guide.md`
(REQUIRED for every user-facing CLI/config/env change — Planned Tests must include "User
Guide updated", and the commit must include the edit; grep the guide before closing);
`TOOLS.md` (MCP schema changes → `deno task docs-sync-schemas`); `CODE_STYLE.md` (new
patterns).

### 3E. Scenario framework coverage

Change touches request → plan → execution → review → memory → update? Review
`tests/scenario_framework/scenarios/agent_flows/`, add steps for observable
CLI/daemon checkpoints, create a new scenario for a distinct observable phase, tag
`provider-live` (LLM-dependent, omit from auto CI) or `safety-gate` (correctness
invariants).

### 4. Derived best practices

- Phase Dependencies listed; Risk L/M/H with justification; `file:Symbol` references.
- Convention survey: 5–10 examples in the module before choosing a shape; divergence noted.
- Claim-to-test mapping: every prose behavioral claim has a named test.
- Integration capability grounding (§2F) with sources + date.
- Step-manifest convention per step (subset of the daemon request schema; additive).
- Codebase-ground every claim before writing it (§2G).

---

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines

## Output format

1. Brief chat summary of the approach + key risks.
1. Path to the new/updated planning document.
1. Each step includes a fenced step-manifest.
1. Markdown lint on the doc:
   `deno run --allow-read --allow-write scripts/markdown_lint.ts exaix-dev-docs/planning/<doc>`.
   Re-ran with `--fix`? Re-verify every `# step-manifest` yaml fence keeps its `step: N`
   key via `deno run --allow-read scripts/check_step_manifests.ts <doc>` — `--fix` has
   misread a `# step-manifest` comment in a fence as a heading and dropped the key.
1. Third-party integration? A Sources block (URLs, official vs community, date).
1. Recommend `#review-phase-plan`.
1. Commit payload — use `#commit`.

## Examples

- `#plan Phase 14: Add caching layer for LLM provider responses`
- `#plan Refactor EventLogger to support structured JSON output`
- `#plan Migrate CLI from Cliffy to a lighter argument parser`

---
exaix:
  skill_id: plan
  related_skills: [review-phase-plan, test-development]
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
