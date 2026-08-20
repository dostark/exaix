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
version: "1.12.0"
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
  1. Traceability: Every significant state change AND every cross-component communication (a service calling another injected dependency) MUST emit a typed `EventLogger`/`EventRegistry` event (ARCHITECTURE.md's "Visibility" guarantee). Tag genuinely load-bearing classes `@visible` in their leading JSDoc comment — the explicit contract that promotes coverage from a heuristic guess to a required commitment. Mechanized audit: `deno task check:event-coverage` (see §2H).
  2. Durability: Plans must result in atomic changesets or journaled DB state.
   3. Configurability: Avoid magic numbers; wrap tunable defaults with `configurable()` from `@exaix/core/config` and override via `exactl config set`.
  4. Security: Proactively perform 'Phase 3b' checks (traversal, injection, auth).
- Documentation (§3D): Every interface/schema change REQUIRES a matching doc update step.
- Name the planning document `.copilot/planning/phase-NN-<kebab-slug>.md` (NN = next sequential phase number).
- Keep each phase to 8–10 implementation steps maximum — split larger features into two sequential phases.
- Assess `tests/scenario_framework/` coverage (§3E) whenever the feature touches the request → plan → execution → review → memory → update flow.
- **Specify exact values**: For every enum, union, or variant field, state which concrete value each component emits and under what conditions — not just the allowed set. Vague "can be one of X, Y, Z" without per-component mapping is a pre-gap.
- **Trace every output to its consumer**: For every new interface field or event payload name a consuming component and verify the data flow reaches it. Fields with no readers are dead data.
- **Survey module conventions**: Before committing to a pattern choice (event naming, error handling, DI style), read 5–10 existing examples in the affected module and document the dominant convention. Divergence requires justification in Architecture Notes.
- **Mechanized event-coverage audit**: `deno task check:event-coverage` AST-scans implemented code for classes/functions that accept an audit-logger dependency but never call it, and for state-changing or cross-component-call methods with no adjacent event. It only has code to scan once a step is implemented — advisory at `#next-steps`, re-verified at `#pre-gap-analysis`/`#post-gap-analysis`. Name the exact event (existing `DomainEventType` member, or the new one to add) in Architecture Notes so those later passes have something to check the code against. `@visible` (a JSDoc tag on a class's leading comment) marks a component explicitly load-bearing for coverage — adoptable now; `--fail-on-tagged` enforcement lands with Phase 168 (`exaix-dev-docs/planning/phase-168-event-logging-hardening-visibility-audit.md`). See §2H.
- **Ground third-party integrations in web research**: When a plan integrates an external service, provider, API, or CLI (an LLM provider, a coding-agent tool, a cloud/SaaS API, a binary), do deep web research on the provider's CURRENT official capability surface FIRST — supported endpoints, auth model, config/routing knobs, limits, versioning — and design to its real first-class mechanism. A wrapper/proxy/scrape/undocumented-flag "integration" is a hack that breaks on the next provider update: flag it and prefer the documented path. Record the doc URLs + research date. See §2F.
- **Ground every code-facing claim in real source**: Before writing any step that extends an existing interface, calls an existing method, or modifies an existing code path, grep the symbol and read the call site first. The plan must be drafted against real signatures and real behaviour, not memory. See §2G.
- **Map prose claims to named tests**: Every behavioural claim made in the prose (e.g., "checkpoint preserves data", "service Y calls service Z") must have a named test in Planned Tests. Claims without test names are gaps.
- **Reachability over layering**: structure the plan as a VERTICAL end-to-end slice (one complete path entry-point → … → output) BEFORE breadth. A horizontal, layer-by-layer plan (all schemas, then all services, then "wire it") is the classic setup for "every component exists, nothing works" — flag it and re-sequence. See §E.
- **Integration anchor per runtime-claiming step**: any step whose Success Criteria assert runtime/observable behaviour MUST name (a) the exact production call-site/constructor (`file:Symbol`) that invokes the new code, and (b) a named integration or scenario test that exercises that call-site. A runtime claim backed only by package-unit tests is a pre-gap.
- **No forward-deferral chains**: a step may not consume something a LATER step builds (dependency inversion); "wired in Step M" is acceptable only if Step M's Actions contain the concrete wiring. Every "consumed by Step M" must resolve to a real call in Step M.
- **One non-deferrable cutover step**: end the phase with an "Integration & cutover" step whose Success Criterion is "the feature is reachable from a real daemon/CLI run with config X", and which may NOT defer to a future phase.
- **Opt-in toggles must do something**: for any `enabled`-style flag, add a Success Metric of the form "with `feature.enabled=true`, observable behaviour B occurs", backed by a test that flips the REAL config.
- When reading existing source files to understand context, work in batches of 5–10 files: read a batch, record findings, then continue.

Canonical prompt (short):
"Draft a new Phase Planning Document for <FEATURE>. Follow `exaix-dev-docs/planning/README.md` structure. Include §3B Security and §3C Traceability/Configurability checks in the design. Ensure a §3D Documentation Update step is included."

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
- ✅ Do name the exact event (existing `DomainEventType` member, or the new member to add) in Architecture Notes for every step introducing a state change or cross-component call — `deno task check:event-coverage` verifies this once the step is implemented (§2H). If the step introduces a class genuinely load-bearing for observability (request/plan/execution/review/memory critical path, security-sensitive), propose tagging it `@visible` in Architecture Notes.
- ✅ Do ground every third-party/provider integration in deep web research of the provider's current official docs — design to the supported first-class endpoint/auth/config surface, and cite the URLs + research date (§2F).
- ✅ Do ground every code-facing claim in real source before writing it — grep interfaces, read call sites, audit side effects per §2G before drafting any step that references existing code.
- ✅ Do map every prose behavioural claim to a named test in the step's Planned Tests section.
- ✅ Do anchor every runtime-claiming step to a named production call-site AND an integration/scenario test (not just a unit test).
- ✅ Do include one terminal, non-deferrable "Integration & cutover" step proving the feature is reachable from a real run.
- ✅ Do order steps so no step consumes something a later step builds; prefer a vertical end-to-end slice before breadth.
- ✅ Do name the planning document `phase-NN-<kebab-slug>.md` for consistent slugs.
- ✅ Do keep phases to 8–10 steps maximum — split larger features into two sequential phases.
- ✅ Do give every step-manifest the SAME `target_branch: feat/phase-NN` — never a distinct
  `feat/phase-NN-step-N` per step (Phase 166's incident: 5 empty placeholder branches
  created and deleted before this was standardized).
- ✅ Do assess scenario framework coverage (§3E) for any change to the end-to-end flow.
- ✅ Do author all success criteria and success metric checkboxes as `- [ ] <text>` (no `→` path) at plan-authoring time — these are aspirational targets whose implementing module is not yet known. During execution #next-steps rewrites each done item to the completion form the commit gate requires: `- ✅ <text> → ` `` `<path>` `` (backtick-wrapped, staged file) for a met criterion/test, or `- ⚠️ deferred <text> → ` `` `<LedgerSymbol>` `` for one pushed to the Reachability Ledger. The commit gate (`scripts/check_commit_msg.ts` via `commit_plan_step.ts`) BLOCKS any `- [ ]` item left in a step whose commit claims it — so a committed step must have every criterion/test either `✅ → path` or `⚠️ deferred → token`; `[ ]` may only remain on steps not yet implemented.
- ✅ Do point every `→ ` `` `path` `` at a real repo file that is actually among the commit's
  changed files — never a command, task name, or prose description. `scripts/check_commit_msg.ts`
  extracts whatever is backtick-wrapped after `→` verbatim and requires it to literally match a
  changed file path; it does not parse or execute the text, so `→ ` `` `deno task
  docs-agent-validate` `` `` fails with "not among this commit's changed files" even though running
  that command IS how the criterion was verified. If the real evidence is "ran command X and
  observed clean output" rather than "this file implements/tests it", point `→` at the file the
  command's success actually depends on (e.g. the plan doc itself, or the source file the command
  validates) — not the command string.
- ✅ Do keep success-metric checkboxes (the `## Success Metrics` section, which are phase-level aspirational targets not tied to one step) as `- [ ]` — the commit gate only scopes the per-step Success Criteria / Planned Tests blocks, not the Success Metrics section.
- ✅ Do use plain descriptive prose to summarize a step's outputs at authoring time — never pre-write execution status labels such as `**✅ CORE**` or `**✅ WIRED**`. (#next-steps ADDS those reachability labels during execution once proven; they are execution artifacts, not plan-authoring content.)
- ✅ Do ensure every h2 section carries its own descriptive content that fulfills the section's stated purpose. A section that is only a heading followed immediately by sub-headings (e.g., `## Current State Analysis` with no prose before `### Key Files`) is a **blank container** — it reads as an unfinished outline placeholder, not a written plan. Every h2 must contain at least one paragraph of content at its own level that introduces, summarizes, or frames the sub-sections below it. This is especially critical for `## Executive Summary`, `## Current State Analysis`, `## Technical Architecture`, and `## Security Constraints` — sections whose heading promises information that must not be deferred entirely to sub-sections.
- ❌ Don't use 'any' or vague types; use Zod schemas and TypeScript interfaces.
- ❌ Don't skip the 'Planned Tests' section for any implementation step.
- ❌ Don't let a runtime success criterion be satisfiable by a package-unit test alone — that is how production-dead code ships green.
- ❌ Don't structure a feature as horizontal layers ("all cores, then wire") — it maximizes the risk that nothing is connected.
- ❌ Don't design a third-party integration from memory or assumptions, or settle for a proxy/scrape/undocumented-flag hack when an official integration path exists — verify against the provider's live docs first (§2F).
- ❌ Don't defer documentation updates; implement them as the last step of the phase.
- ❌ Don't author code snippets (Technical Architecture, Actions, runbooks) with inline `npm:`, `jsr:`, or `https:` specifiers — `deno lint` rejects them (`no-import-prefix` + `no-unversioned-import`). Reference npm/jsr packages via a deno.json import-map alias (e.g. `"@babel/parser/package.json": "npm:@babel/parser@7.29.8/package.json"` then `import babelPkg from "@babel/parser/package.json"`); keep plan-doc snippets lint-clean so a later implementer is not blocked by the plan's own example.

Prototypes & Validation:
- Use #pre-gap-analysis to validate this plan against the codebase before starting. The plan's §2G
  Codebase Grounding should have already caught interface mismatches, call-site surprises, and
  side-effect omissions — pre-gap-analysis re-verifies them as a second pass, not a first discovery.
- Use #post-gap-analysis to verify the final implementation against the plan's promises.

Workflow chain (typical):
  #plan → #pre-gap-analysis → #next-steps → #post-gap-analysis → #commit

Dogfooding chain (alternative, once Phase E tooling ships):
  #plan (produces step-manifests) → #plan_to_requests (generates request queue) → daemon executes via dogfood sandbox
```

## See also

- [next-steps](../next-steps/SKILL.md) — step-by-step execution of a plan
- [pre-gap-analysis](../pre-gap-analysis/SKILL.md) — plan validation before implementation
- [post-gap-analysis](../post-gap-analysis/SKILL.md) — post-implementation review against plan
- [test-development](../test-development/SKILL.md) — edge case coverage requirements, test helpers

---

## Instructions for Agent

Refine the goal into a formal planning document in `.copilot/planning/phase-NN-*.md`.

### 1. Structure Requirements (Mandatory)

Follow the structure defined in `exaix-dev-docs/planning/README.md`:

1. **Executive Summary**: Problem, Solution, Goal.
1. **Current State Analysis**: Key Files table, Constraints, Affected Interfaces.
1. **Technical Architecture**: Schemas (Zod), Interfaces (TS), Logic Flows (Mermaid).
1. **Implementation Plan**: Numbered steps using the TDD-First format (Actions, Architecture Notes, Planned Tests, Success Criteria), sequenced as a vertical end-to-end slice first (§E), not horizontal layers.
1. **Integration & Cutover (§E)**: A mandatory, non-deferrable penultimate step that wires the feature into a live path and proves it is reachable from a real daemon/CLI run with the feature enabled.
1. **Reachability Ledger (§E)**: A seeded (initially empty) `## Reachability Ledger (pending production consumers)` table that #next-steps maintains step-by-step; the phase cannot close while any row is ⏳.
1. **Documentation Updates (§3D)**: Mandatory final step to update `ARCHITECTURE.md`, `docs/`, `TOOLS.md`, etc.
1. **Success Metrics**: Quantitative targets (performance, quality), including an opt-in reachability metric for every `enabled`-style flag.
1. **Step Manifests (dogfooding compatibility)**: Every implementation step MUST end with a fenced YAML `step-manifest` block containing `step`, `title`, `identity`, `skills`, `portal`, `target_branch`, `depends_on`, and `acceptance` (tests + outcomes). This makes the plan machine-convertible to daemon requests via `plan_to_requests.ts`. `target_branch` is the SAME value on every step of a phase — `feat/phase-NN`, one shared branch, never `feat/phase-NN-step-N` (Phase 166 created and had to delete 5 empty placeholder branches from that per-step pattern before standardizing; `plan_to_requests.ts` reads `target_branch` as a plain per-step string with no uniqueness assumption, so sharing one value across every step is fully compatible). Example:

   ```yaml
   # step-manifest
   step: 1
   title: Capability + constants
   identity: senior-coder
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

   The manifest is **additive** — it sits beside the existing prose sections (Actions,
   Architecture Notes, Planned Tests, Success Criteria), never replaces them. Tools that
   don't understand manifests continue to read the prose. The `plan_to_requests.ts`
   generator prefers the manifest and falls back to heading scrape when absent.

   **Self-check:** After drafting all steps, run `deno run -A scripts/check_step_manifests.ts <plan-path>` to verify every step has a valid manifest. The CI gate `deno task check:manifests` runs the same check across all planning docs. A manifest-less step is a blocking failure — fix it before considering the plan ready for review.

### 2. Core Principles Integration

#### A. Security (Phase 3b Feasibility)

For every step, verify:

- **Input Validation**: Are external inputs (JSON/TOML) validated with Zod?
- **Path Resolution**: Are all FS paths routed through `PathResolver`?
- **Auth Boundary**: Is a permission check performed before each side effect?
- **Secrets**: Are secrets NEVER logged or stored in plain-text?

#### B. Traceability & Configurability (Phase 3c Check)

- **Event Logging**: Every significant state transition AND every cross-component call (a
  service invoking another constructor-injected dependency) must have a named
  `EventLogger`/`EventRegistry` event (e.g., `vault.secret.rotated`). Name the exact event —
  an existing `DomainEventType` member, or the new member the step adds — in Architecture
  Notes; "emits an event" with no name is underspecified.
- **`@visible` contract**: If the step introduces a class genuinely load-bearing for
  observability, its Architecture Notes must say so and its Actions must add the `@visible`
  JSDoc tag to the class's leading comment — the difference between "the checker might flag
  this" and "this component's coverage is required." See §2H.
- **Typing**: Event payloads must use named interfaces, never `Record<string, unknown>`.
- **Config**: Timeouts, thresholds, and feature toggles must be wrapped with `configurable()` in `packages/core/src/types/constants.ts` and overridable via `exactl config set`.
- **Mechanized verification (§2H)**: `deno task check:event-coverage` is the AST-based
  first-pass audit for this principle — it flags classes wired to a logger that never call
  it, and state-changing/cross-component-call methods with no adjacent event. Advisory, not
  authoritative (see §2H for known false-positive sources); runs once code exists, so
  `#next-steps`/`#pre-gap-analysis`/`#post-gap-analysis` invoke it, not `#plan` itself.

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
  The cutover Success Criterion MUST be phrased as an **executable daemon-boot or
  CLI-invocation test** that observes the feature working through its real entry point —
  e.g. "a booted daemon service resolves value X through `context.configAdapter`" or
  "`exactl <cmd>` prints Y". A criterion satisfiable by a registration check, a
  `buildHandlers()` enumeration, a manifest-count assertion, or a hand-constructed
  adapter/store inside a unit test is INVALID — those are the exact green signals that
  ship on production-dead code (Phase 137's Step 8 passed on all of them while the
  daemon never read the Config DB). At least one named integration test must drive the
  production entry point, not the component in isolation.
- **Opt-in proof.** For every `enabled`-style flag, a Success Metric must read "with
  `feature.enabled=true`, observable behaviour B occurs", backed by a test that flips
  the REAL config — not a unit test of the gated component in isolation.
- **Seed the Reachability Ledger.** Add an (initially empty) `## Reachability Ledger
  (pending production consumers)` section to the planning doc — a table with columns
  `Symbol | Added in | Wiring step | Production call-site | Status`. #next-steps
  appends a ⏳ row whenever a step ships a symbol with no production caller and flips
  it to ✅ when a later step wires it; the phase cannot close while any row is ⏳. The
  ledger is the durable, doc-resident to-do list that prevents production-dead code
  from being silently forgotten between steps. A row is flipped to ✅ ONLY in the same
  commit that adds the production call-site — never pre-emptively because the wiring is
  "planned" for that step. A step whose ledger row is still ⏳ may not simultaneously
  carry a `✅ WIRED` status label; that combination is a
  self-contradiction (Phase 137 marked steps `✅ WIRED` while their ledger rows read
  `⏳ Step 3`, and the phase was finalized anyway). The ledger is the authority — if the
  row says ⏳, the symbol is not wired, regardless of any status prose elsewhere in the
  doc. A criterion/test that a step defers (rather than completes) is written
  `- ⚠️ deferred <text> →` `` `<LedgerSymbol>` `` and MUST have a matching Reachability
  Ledger row naming that symbol — the commit gate blocks a deferred item whose token has
  no ledger row.

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

#### G. Codebase Grounding — Pre-Draft Verification (§2G)

**Goal:** Before writing a single line of the plan, verify every existing symbol, interface, call
site, and side-effect assumption against real source code. Pre-gap-analysis will later do a deeper
pass; this step prevents the plan from being drafted against phantom interfaces or wrong mental
models in the first place.

Run this as a **pre-draft checklist** after reading the Executive Summary / Goal and before
writing any step's Actions or Architecture Notes. Treat it as mandatory — the same way §2F
(web research) is mandatory for integrations.

1. **Interface verification — pre-draft.** For every existing interface the plan proposes to
   extend (add a field, add a method), grep the codebase for the symbol BEFORE writing the step.
   Classify:
   - **EXISTS-MATCH** — symbol and its current shape match the plan's assumption. Safe to proceed.
   - **EXISTS-MISMATCH** — symbol exists but has a different shape than assumed. Read the real
     signature, update the plan's mental model, and design the extension against the real interface.
   - **NOT-FOUND** — symbol does not exist. The plan's "extend existing" claim is impossible.
     Either the plan meant to create a new interface, or it references the wrong name. Fix before
     drafting.

2. **Call-site tracing — pre-draft.** For every method the plan claims a component calls, or
   every data-flow the plan asserts, read the actual call site BEFORE describing it in the plan:
   - Does the method accept the parameters the plan assumes?
   - Does the return type match what the plan expects?
   - Is there a hidden indirection (wrapper, adapter, delegation) the plan didn't account for?
   - If the plan says "pass options to generate()", confirm generate() actually takes options.
     Write the real call-site behaviour into the Architecture Notes, not the assumed behaviour.

3. **Side-effect audit — pre-draft.** For every method the plan's step will invoke or modify,
   scan for impure patterns before describing the change:
   - `Deno.env.get/set/delete` — env var mutation in request-time code is always a gap.
   - `static` mutable state — registry writes, global caches. Is this boot-time or request-time?
   - Module-level `let` variables that accumulate state across calls.
   - If a side effect exists but the plan's step doesn't mention removing or preserving it,
     the plan's model of the code is incomplete. Add an Architecture Note about the side effect
     and whether the step eliminates or preserves it.

4. **Record what was checked.** After completing the pre-draft checks, add a **Codebase Grounding
   Summary** paragraph in the plan's Technical Architecture section listing:
   - Every interface checked + result (MATCH / MISMATCH / NOT-FOUND).
   - Every call site read + what was learned.
   - Every side effect found + disposition (eliminated / preserved with note).
     This creates an audit trail and prevents the next reader from wondering whether the plan
     was grounded or written from memory.

> **Why this exists:** Pre-gap analysis commonly finds gaps that are invisible to
> document-level review — interfaces that don't have fields the plan assumed, methods that
> work differently than described, env var side effects the plan never knew existed. Adding
> these checks to the plan skill means those gaps are caught at draft time, not later. The
> pre-gap-analysis skill's equivalent phases (2A–2C) become a verification pass over grounded
> work rather than the first discovery of mismatches.

#### H. Event Coverage Verification (§2H)

**Goal:** Every step whose Actions introduce a state change or a cross-component call names
the exact audit event in Architecture Notes, so the mechanized check below has a concrete
target to verify against once the step is implemented.

`deno task check:event-coverage` (`scripts/check_event_coverage.ts`) AST-scans exported
classes, methods, and functions for two heuristic gap shapes: (1) a class that accepts an
`IEventLogger`/`IEventRegistry` constructor dependency but never calls it anywhere in the
class body ("wired but silent"), and (2) an exported function or public method that mutates
a `this.*` field, calls a write-verb method on another field, performs a direct
filesystem/subprocess write, or calls a method on another constructor-injected `IFoo`-typed
dependency ("communication between components") — with no call to its own audit-logger
binding anywhere in its body. It is advisory, like `check:reachability-ledger` and
`check:god-objects`: a finding means "verify by hand," not "automatically a real gap." It has
nothing to scan at plan-authoring time (no code exists yet), so `#plan`'s job is naming the
intended event per step, not running the tool; `#next-steps` runs it once the step lands,
`#pre-gap-analysis`/`#post-gap-analysis` re-verify it against the finished implementation.

`@visible` (a JSDoc tag directly above `export class Foo`'s leading comment) is the
explicit contract that promotes a class from "the checker guesses this might need
coverage" to "this component's coverage is a requirement, not advisory." When a step
introduces a class genuinely load-bearing for observability — on the request → plan →
execution → review → memory critical path, or handling security-sensitive operations —
name it in Architecture Notes as an `@visible` candidate and have the step's own Actions
add the tag. The tag costs nothing and is adoptable immediately; the checker's
`--fail-on-tagged` enforcement and the real pre-commit gate (Gate 19) that blocks a
violating commit are wired and live, landed by Phase 168
(`exaix-dev-docs/planning/phase-168-event-logging-hardening-visibility-audit.md`) — a
`@visible`-tagged class with a coverage gap now fails a real `git commit`, not just an
advisory CI note.

`@visible` coverage means more than "a logger call exists": the action argument must
resolve to a registered `DomainEventType` member (a literal reference, or a same-class
private-helper parameter/field typed `TDomainEventType`) — a raw string or dynamically
computed action is a gap even with a logger call present. When a step's operation emits
more than one lifecycle event (started/completed/failed), plan for the trace ID to be
passed as the logger call's fourth argument on every one of them, not only embedded in
the payload — otherwise each event gets an independent random trace ID and cannot be
joined in the Activity Journal. A streaming or async-generator method must have a
planned terminal event for every exit path, including early consumer cancellation, not
only normal completion and a thrown error.

A step tagging a class `@visible` must also plan a Tier A (package-integration, real
`EventLogger`/db, no daemon) or Tier B (scenario e2e, full daemon boot) runtime
verification test for that class's highest-value events in its Planned Tests — not rely
on Gate 19's static check alone. Gate 19 only proves the decorator/logger-call shape
exists in source; it cannot prove the event actually fires with a real payload at
runtime, is reached by a real production caller, or carries a correct trace ID. Phase
169 (`exaix-dev-docs/planning/phase-169-visible-event-runtime-verification.md`) found
multiple `@visible` components whose events passed Gate 19's static check yet had zero
real runtime coverage — including one (`RequestAnalyzer`) whose event never fired in
production at all, because the logger dependency was never injected at either
production call site. A step is not complete until its named `@visible` events are
proven to fire, with real field values, against a real `EventLogger`/db (Tier A) or a
real daemon-boot scenario (Tier B) — see `tests/scenario_framework/scenarios/framework_test/smoke-validation.yaml`'s
`check-journal` step and `packages/core/tests/cost_tracker_test.ts`'s real-`EventLogger`
tests for the reference pattern.

### 3. Documentation Update Protocol (§3D)

Include a final **Step N (§3D): Update Documentation** that covers:

- `ARCHITECTURE.md`: If new components/flows are added.
- `docs/Exaix_User_Guide.md`: **Required** for every user-facing CLI/config/env change. The
  step's Planned Tests section MUST include "User Guide updated" as a bullet, and the commit
  MUST include the User Guide edit. Missing User Guide coverage is a blocking gap —
  grep `docs/Exaix_User_Guide.md` for the feature name to confirm before closing the step.
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
- **Codebase-ground every claim before writing it**: Do not design interfaces, describe call flows,
  or assert side-effect safety from memory. Before writing any step that references an existing
  symbol, method, or code path: grep the symbol to confirm its real signature exists, read the call
  site to verify the plan's behavioural model matches reality, and audit the method for hidden side
  effects (env var mutation, static state, concurrent-unsafe caching). A plan drafted from memory
  will be contradicted by the codebase — catch it at draft time, not in pre-gap-analysis. See §2G.

---

## Related

- [CLAUDE.md](../../../CLAUDE.md#behavioral-guidelines) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)

## Output format

1. Brief chat summary of the architectural approach and key identified risks.
1. The path to the new or updated planning document file.
1. Each implementation step includes a fenced YAML step-manifest block (for dogfooding compatibility).
1. Markdown lint result: `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>`. If re-run with `--fix`, re-verify every `# step-manifest` yaml fence still has its `step: N` key via `deno run --allow-read scripts/check_step_manifests.ts <doc>` — `--fix`'s heading-blank-line rule has historically misidentified a `# step-manifest` comment inside a fence as a real heading and dropped the following key.
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
  related_skills: [test-development]
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
