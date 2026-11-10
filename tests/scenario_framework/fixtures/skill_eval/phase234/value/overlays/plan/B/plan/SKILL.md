---
name: plan
description: Draft a new Phase Planning Document for a feature, refactor, or architectural change — follows Exaix standards for TDD, security, and traceability. Produces plans that are machine-convertible to dogfood requests (step-manifests for automated request extraction). Grounds any third-party service/provider integration in deep web research of the provider's real, current capability surface so integrations are first-class, not hacks.
---

```text
Key points

- Entry point for EVERY significant feature or refactor.

- Test-Driven Design: specify Planned Tests BEFORE implementation steps.

- Exaix Core Principles:

  1. Traceability: emit a typed EventLogger/EventRegistry event for every significant state change and every cross-component call.
     A cross-component call invokes an injected dependency. Tag genuinely load-bearing classes `@visible` in the leading JSDoc. Audit with
     `deno task check:event-coverage` (see §2H).

  2. Durability: plans result in atomic changesets or journaled DB state.

  3. Configurability: no magic numbers. Wrap tunable defaults with `configurable()` and allow
     `exactl config set` override.

  4. Security: proactively apply Phase 3b checks (traversal, injection, auth).

- §3D: every interface/schema change REQUIRES a matching documentation step.

- Name the doc `exaix-dev-docs/planning/phase-NN-<kebab-slug>.md` (NN = next free number).

- Keep 8–10 implementation steps max. Split larger features into two sequential phases.

- Balance step workload (§2I) during drafting. Split overloaded steps into bounded
  checkpoints with separate Success Criteria and Planned Tests. Do not combine excessive
  work into one step to meet the step limit.

- Assess `tests/scenario_framework/` coverage (§3E) when the feature touches
  request → plan → execution → review → memory → update.

- **Specify exact values**: state each component's concrete enum/union/variant value and its emission conditions.
  Listing only possible values is a pre-gap.

- **Trace every output to its consumer**: name the consuming component for every interface
  field/event payload. Zero-reader fields are dead data.

- **Survey module conventions**: read 5–10 existing examples before committing to a pattern. Document divergence in Architecture Notes.

- **Mechanized event audit**: `check:event-coverage` AST-scans implemented code. Name the
  exact event (existing `DomainEventType` member or the new one) in Architecture Notes.
  The `@visible` tag marks a component load-bearing. The `--fail-on-tagged` option enforces it.

- **Ground third-party integrations in web research (§2F)**: use the provider's current official capabilities.
  Check endpoints, authentication, options, limits, and versioning.
  A wrapper/proxy/scrape/undocumented-flag "integration" is a hack. Cite URLs + date.

- **Ground every code-facing claim in real source (§2G)**.
  Grep the symbol and read its call site before drafting a step that references existing code.

- **Map prose claims to named tests**: every behavioral claim gets a named Planned Test.

- **Reachability over layering (§E)**: sequence the smallest end-to-end slice before breadth. Reject a horizontal "all schemas, then all services, then wire it" order.
  Use the bounded migration exception in §2E only when independent slices cannot land.

- **Integration anchor per runtime-claiming step**: name (a) the exact production call-site
  (`file:Symbol`) and (b) a named integration/scenario test driving it. Package-unit-only is
  a pre-gap.

- **No forward-deferral chains**: a step may not consume a later step's output.
  A wiring deferral to Step M requires concrete wiring in Step M's Actions.

- **One non-deferrable "Integration & cutover" step**.
  Its Success Criterion proves feature reachability through a real daemon/CLI run with config X.

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

- ✅ Survey the module's conventions before choosing a pattern. Document divergence.

- ✅ Name the exact event in Architecture Notes for state-changing/cross-component steps. Propose `@visible` for load-bearing classes.

- ✅ Ground third-party integrations in current official docs (§2F). Cite URLs + date.

- ✅ Price every requirement that forces runtime code (§2J).
  Record its configuration-only alternative and what that alternative gives up. Let the user choose.

- ✅ Ground every code-facing claim in real source (§2G).

- ✅ Map every prose behavioral claim to a named test.

- ✅ Anchor every runtime-claiming step to a call-site AND an integration/scenario test.

- ✅ End the phase with a non-deferrable cutover step proving real-run reachability.

- ✅ Order steps: no step consumes a later step's output. Use §2E for a bounded migration exception.

- ✅ Include a workload assessment for all steps and divide disproportionate workloads
  before handing the plan to review.

- ✅ Name the doc `phase-NN-<kebab-slug>.md`.

- ✅ Keep phases to 8–10 steps.

- ✅ Give EVERY step-manifest the SAME `target_branch: feat/phase-NN` — never
  `feat/phase-NN-step-N` (empty placeholder branches preceded this standardization).

- ✅ Author criteria/metric checkboxes as `- [ ] <text>` without an arrow path.
  Add implementation timestamps later. The next-steps skill rewrites met criteria to `- ✅ <text> → <path>`.
  Use a backticked path. Deferred criteria use `- ⚠️ deferred <text> → <LedgerSymbol>` with a backticked token.
  The gate blocks open checkboxes in a committed step. They may remain on unimplemented steps.

- ✅ When moving a deliverable to a later step, revise the source step's criteria.
  Use a deferred criterion with a ledger row, or a met criterion pointing to the absorbing step's changed file.
  Use the arrow formats above. Remove open checkboxes from the source step.
  The gate blocks commits whose plan diff includes open checkboxes in an implemented step.

- ✅ Point every `→ `path`` at a real changed repo file — never a command/task/prose. The gate extracts the backticked text after the arrow.
  That text must match a changed file. A command such as `deno task docs-agent-validate` cannot serve as the path. Command-verified? Point `→` at the file
  the command's success depends on.

- ✅ Keep Success Metrics checkboxes `- [ ]` during step execution (the gate scopes only
  per-step criteria/tests). At phase closure, check each met metric with a citation.
  Correct metrics revised by later steps. A completed phase with all metrics unchecked is a trust gap.

- ✅ Use plain prose for step outputs at authoring time.
  The next-steps skill adds `✅ CORE` or `✅ WIRED` only after verification.

- ✅ Give every h2 its own content before sub-headings.
  Check Executive Summary, Current State Analysis, Technical Architecture, and Security Constraints.
  An h2 followed immediately by a sub-heading is an empty container.

- ❌ Use `any` or vague types — use Zod schemas and TS interfaces.

- ❌ Skip Planned Tests on any step.

- ❌ Leave several independent capabilities under one step's acceptance gate.

- ❌ Let a runtime criterion be satisfiable by a package-unit test alone.

- ❌ Use horizontal layers for a feature or use the migration exception to defer feature wiring.

- ❌ Design a third-party integration from memory or accept a hack when an official path
  exists (§2F).

- ❌ Defer documentation updates — they land as the final phase step.

- ❌ Author code snippets with inline `npm:`/`jsr:`/`https:` specifiers — `deno lint`
  rejects them (`no-import-prefix` + `no-unversioned-import`). Reference npm/jsr packages
  via a deno.json import-map alias (e.g. `"@babel/parser/package.json":
  "npm:@babel/parser@7.29.8/package.json"`, then
  `import babelPkg from "@babel/parser/package.json"`).

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

### 0. Resolve decisions before drafting

Read `GLOSSARY.md`, `.copilot/docs/GLOSSARY.md`, relevant accepted decisions,
and the user's recorded choices. Use established meanings in the plan and its
acceptance criteria. If a term has multiple meanings, use a concrete scenario
to establish which meaning affects the required result.

Keep a concise decision record in the plan. Link material choices and their
rationale to affected acceptance criteria and Requirement Cost rows (§2J).
Record settled choices without asking again. Inspect available facts before
asking about an unresolved choice that changes scope, behavior, cost, or risk.
Mark affected criteria `PENDING USER DECISION` until the user answers.
If a later choice invalidates an assumption, identify and revise its dependent
criteria before drafting implementation steps for that work.

Keep ordinary choices in this record. Propose a separate ADR only for a
consequential tradeoff that is hard to reverse and unclear without its rationale.
Include alternatives, consequences, and the reason for that proposal.
Do not create an ADR or a glossary hierarchy automatically.

### 1. Structure (mandatory — follow `exaix-dev-docs/planning/README.md`)

1. **Executive Summary**: Problem, Solution, Goal.
1. **Current State Analysis**: Key Files table, Constraints, Affected Interfaces.
1. **Technical Architecture**: Schemas (Zod), Interfaces (TS), Logic Flows (Mermaid).
1. **Implementation Plan**: numbered TDD-first steps (Actions, Architecture Notes,
   Planned Tests, Success Criteria), sequenced as a small vertical slice first.
   Include a Step Workload Assessment table (§2I) to justify the scope of each step.
1. **Integration & Cutover (§E)**: a mandatory, non-deferrable penultimate step proving
   real-run reachability.
1. **Reachability Ledger (§E)**: seeded empty table (#next-steps maintains. Phase cannot
   close while a row is ⏳).
1. **Documentation Updates (§3D)**: mandatory final step.
1. **Success Metrics**: quantitative targets. An opt-in reachability metric per
   `enabled`-style flag.
1. **Step Manifests**: every step ends with a fenced YAML `step-manifest`
   (`step`, `title`, `agent_role`, `skills`, `portal`, `target_branch`, `depends_on`,
   `acceptance`).
   Use the same `target_branch: feat/phase-NN` on every step.
   The shared branch is read as a plain step string by `plan_to_requests.ts`. The manifest is
   ADDITIVE — it sits beside the prose, never replaces it. Example:

   ```yaml
   # step-manifest
   step: 1
   title: Capability + constants
   agent_role: senior-coder
   skills: [exaix-development, tdd-methodology]
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

   **`skills:` constraint — `.copilot` runtime skills only.** Use a dogfood skill folder name from `.copilot/skills/*/SKILL.md` for each `skills:` entry.
   Examples: `exaix-development`, `tdd-workflow`, `commit`, `review-code`, `fix-bug`, and `plan`.
   The `tdd-methodology` alias also resolves to `tdd-workflow`.
   Do not list Blueprint skills from `Blueprints/Skills/<name>/SKILL.md`.
   Examples include `portal-grounding`, `security-first`, and `response-contract`.
   Exaix development compiles only `.copilot` runtime skills for daemon resolution.
   A Blueprint ID therefore resolves to zero skills and loses its guidance. When in doubt, use the canonical `exaix-development` +
   `tdd-methodology` pairing.

   **Self-check:** run `deno run -A scripts/check_step_manifests.ts <plan-path>` after
   drafting — the CI gate runs it across all planning docs. A manifest-less step blocks.

### 2. Core principles

#### A. Security (Phase 3b)

For each step, verify input validation with Zod and path resolution with PathResolver.
Check permission before each side effect. Never log secrets or store them as plain text.

#### B. Traceability & configurability

- Timeouts, thresholds, toggles wrapped with `configurable()` in
  `packages/core/src/types/constants.ts`, overridable via `exactl config set`.
- Every state transition/cross-component call names its exact event in Architecture Notes.
- `@visible` classes: the note says so and the Actions add the JSDoc tag.
- Event payloads use named interfaces, never `Record<string, unknown>`.
- Mechanized: `check:event-coverage` (advisory. Runs once code exists — #next-steps and
  the gap analyses invoke it, #plan only names the events).

#### C. Durability & atomic changes

Group file modifications into approved Changesets. Wrap DB ops in transactions where
atomicity is required.

#### D. Field specification & consumer tracing

For every new/modified interface, payload, or schema field: exact per-component values and
conditions. Name the reading component. Document the end-to-end flow and require a named
test exercising the complete chain.

#### E. Reachability & integration anchoring (the production-dead guard)

TDD/coverage/grounding all pass on production-dead code — a test-only consumer keeps it
"alive". Guard in the plan:

- **Vertical slice first.** Deliver the smallest complete end-to-end path before adding
  breadth. Bound its implementation workload under §2I. Necessary prerequisite steps
  must have independent tests and explicit wiring owners in the Reachability Ledger.
- **Bounded migration exception.** Use expand, migrate, and contract only for a broad
  mechanical change that cannot land as independent end-to-end slices. Record why
  slices cannot land and name the actual blocking dependencies.
  Expand with compatible old and new contracts. Move callers in bounded, named batches.
  Contract only after every caller has moved and the old contract has no remaining consumer.
  For each stage, name compatibility checks, focused tests, and rollback conditions.
  Name the integration checkpoint that verifies the combined production path before contract.
  Keep runtime integration anchors, the Reachability Ledger, and terminal cutover requirements.
  Do not use this exception to postpone new-feature wiring.
- **Integration anchor.** Every runtime-claiming step names the call-site (`file:Symbol`)
  and an integration/scenario test driving it.
- **No forward-deferral.** "Wired in Step M" requires the concrete wiring in Step M.
- **Terminal cutover (non-deferrable).** The Success Criterion executes a daemon-boot/CLI invocation through the real entry point.
  Examples: a booted daemon resolves value X through `context.configAdapter`, or `exactl <cmd>` prints Y. A registration/buildHandlers()/manifest-count/hand-constructed-adapter
  criterion is INVALID (Phase 137's Step 8 shipped on those while the daemon never read
  the Config DB). At least one integration test drives the production entry point.
- **Opt-in proof.** `enabled` flags: "with flag=true, behavior B", tested against the REAL
  config.
- **Seed the Reachability Ledger** (`Symbol | Added in | Wiring step | Production
  call-site | Status`). A row flips ✅ ONLY in the commit that adds the call-site. A step
  whose row is ⏳ may not carry a `✅ WIRED` label. A deferred item's token must name a row.
- Feature too large for one phase? Split so EACH phase delivers a reachable vertical slice. A "package now, wire next phase" split needs the package phase's own metrics to not claim
  runtime behavior.

#### F. Third-party integration research (capability grounding)

Provider capabilities drift. Research the current official endpoints, shapes, authentication, and supported integration recipes before designing.
Prefer the documented first-class path. Proxies, scraping, and undocumented flags can break on the next release.
If no official path exists, state that limit and justify the stop-gap.
Expose real provider options through configuration: routing, fallback, caching, rate/cost, and retention.
Keep model, provider, endpoint, and authentication realm distinct. Record caveats and minimum versions.
Probe multiplicity and edge cases, not just the happy path.
For example, a Gemini parallel batch signed only its first call despite that detail being absent from documentation.
Record observed responses and the date. Cite official and community URLs separately in a Sources block.

#### G. Codebase grounding — pre-draft (§2G)

Run before writing any step's Actions/Notes (mandatory, like §2F):

1. **Interface verification** — grep each existing interface the plan extends.
   For EXISTS-MATCH, proceed. For EXISTS-MISMATCH, read the real signature and adjust.
   For NOT-FOUND, identify a new interface or correct the name.
1. **Call-site tracing** — read each claimed call/data-flow at its real call site.
   Check parameters, return types, and hidden indirection. Claim that options reach `generate()` only if it accepts them. Write real behavior, not assumed.
1. **Side-effect audit** — `Deno.env.get/set/delete` (request-time mutation is always a gap),
   static mutable state, module-level `let` accumulators. Note whether each side effect is
   removed or preserved.
1. **Record what was checked** in a Codebase Grounding Summary within Technical Architecture.
   List interface results (MATCH/MISMATCH/NOT-FOUND), call sites read, and side effects with their disposition.

#### H. Event coverage verification (§2H)

Name the exact audit event for each state-changing/cross-component step so the AST check has a target.
The `check:event-coverage` command is advisory. Verify each finding by hand.
The `@visible` tag makes coverage mandatory for its class. Put it above `export class Foo` in the leading JSDoc.
Each action must resolve to a registered `DomainEventType` member. Raw or dynamic event strings are gaps.
For operations with multiple lifecycle events, pass the trace ID as the logger's fourth argument on every event.
Otherwise, events receive independent random trace IDs. Plan terminal events for every streaming/async-generator exit, including early cancellation.

For each `@visible` step, plan a Tier A or Tier B runtime test that proves events fire with real values.
Tier A uses package integration with a real EventLogger/database. Tier B uses a scenario with a real daemon boot.
Gate 19's static check cannot prove event firing. Missing logger injection previously prevented events from firing despite passing static checks.

See `tests/scenario_framework/scenarios/framework_test/smoke-validation.yaml` and its `check-journal` step.
Also see `packages/core/tests/cost_tracker_test.ts` for this pattern.

#### I. Step scope & workload balance (§2I)

Design steps as separate implementation and validation checkpoints. Keep their workloads
reasonably even. Compare actual complexity and testing effort, not just the number of files.

1. **Assess the draft** — add a Step Workload Assessment table within the Implementation
   Plan. For every step, record deliverables, affected layers, dependencies, relative
   effort, testing burden, and a balance verdict with reasons. Consider new algorithms,
   migration and compatibility work, security boundaries, production wiring, and design
   uncertainty. Explain smaller documentation or final validation steps.
1. **Find overloaded steps** — compare each step with its peers, including Step 1 and
   final cutover. Several independent behaviors, broad changes across the entire stack,
   or many unrelated test suites can indicate excessive scope. A small path through
   several layers is acceptable when its workload remains bounded.
1. **Split before handoff** — divide overloaded steps into separately numbered steps.
   Give each a title, bounded deliverables, exclusions, and explicit dependencies.
   Each needs its own Actions, Architecture Notes, Planned Tests, measurable Success
   Criteria, and step-manifest. Preserve every original deliverable and map its criteria
   and tests to the resulting steps. Do not replace a split with sub-bullets or defer
   the scope decision to implementation.
1. **Make each checkpoint testable** — specify test files and cases that prove the
   step's criteria, including relevant failure paths. Its focused tests and applicable
   gates must pass without unfinished later work. If contracts need a prerequisite
   step, keep it small, independently testable, and tracked under §2E.
1. **Preserve integration and scope** — retain early production reachability and the
   final cutover evidence. Add capabilities incrementally after the first small path. Do not collect all wiring at the end. If bounded steps exceed the phase limit,
   divide the feature into sequential phases under §2E instead of merging overloaded
   steps. State which deliverables belong to each phase.
1. **Recheck the result** — reassess workloads after splitting. Synchronize numbering,
   dependencies, manifests, and ledger wiring references. Confirm that all deliverables,
   criteria, and planned tests remain covered before recommending `#review-phase-plan`.

#### J. Requirement cost and the configuration-only alternative (§2J)

Before a requirement or user decision becomes steps, ask what runtime code it forces. Record an alternative for each requirement that adds runtime code, a generated artifact, or a tool-specific setting.
This includes runtime modules and daemon-side adapters.

1. **Find the simplest shape** that meets the goal with installation or configuration only.
   Consider an installed plugin, configuration, existing check kind, CLI flag, or task.
1. **Write a Requirement Cost table** in Technical Architecture: requirement, runtime code it
   forces, configuration-only alternative, what the alternative gives up.
1. **Resolve the cost decision.** Reuse an explicit settled user choice and record its
   source in User decisions. Otherwise, ask the user to keep or drop the costly requirement.
   If new evidence changes the recorded cost or consequences, explain that change and
   ask only for the affected decision. Never drop or accept a requirement silently.
1. **Third-party tools stay independent in both directions by default.** The tool holds no Exaix code.
   The Exaix runtime holds no tool-specific module. Hosting the tool needs only installation and configuration. A deviation is a user decision.

Example: one integration required changed-line filtering, per-check rule-pack selection and
per-portal catalog overrides. Each forced runtime code, and the adapter grew past 1,500 lines
under review hardening. Running the linter with an installed, daemon-owned config met the core
goal with a fraction of the code. Nobody had priced the alternative.

### 3. Documentation update protocol (§3D)

The final step updates the applicable documents:

- `ARCHITECTURE.md` for new components or flows.
- `docs/Exaix_User_Guide.md` for every user-facing CLI, configuration, or environment-variable change.
  Planned Tests must include "User Guide updated", and the commit must include that edit. Grep the guide before closing.
- `TOOLS.md` for MCP schema changes. Run `deno task docs-sync-schemas`.
- `docs/CODE_STYLE.md` for new patterns.

### 3E. Scenario framework coverage

Does the change touch request → plan → execution → review → memory → update?
Review `tests/scenario_framework/scenarios/agent_flows/`. Add observable CLI/daemon checkpoints.
Create a new scenario for a distinct observable phase.
Tag LLM-dependent cases `provider-live` and omit them from automatic CI.
Tag correctness invariants `safety-gate`.

### 4. Derived best practices

- Phase Dependencies listed. Risk L/M/H with justification. `file:Symbol` references.
- Convention survey: 5–10 examples in the module before choosing a shape. Divergence noted.
- Claim-to-test mapping: every prose behavioral claim has a named test.
- Integration capability grounding (§2F) with sources + date.
- Step-manifest convention per step (subset of the daemon request schema. Additive).
- Codebase-ground every claim before writing it (§2G).

---

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines

## Output format

1. Brief chat summary of the approach + key risks.
1. Path to the new/updated planning document.
1. Each step includes a fenced step-manifest.
1. Step Workload Assessment table showing balanced scope and justified effort differences.
1. Markdown lint on the doc — **check-only**:
   `deno run --allow-read --allow-write scripts/markdown_lint.ts exaix-dev-docs/planning/<doc>`.
   Prefer check-only. The `--fix` option can reflow step-manifest fences and drop their `step: N` keys.
   It previously misread a `# step-manifest` comment inside a fence as a heading.

   If you did run `--fix`, re-verify immediately with the step-manifest checker
   (see "Editing an existing plan doc safely" below). A NEW plan that no commit holds yet may
   take `deno fmt` to clear table-alignment warnings. Re-run the manifest checker after. Never
   format a committed plan: it rewrites the whole file.
1. Third-party integration? A Sources block (URLs, official vs community, date).
1. Recommend `#review-phase-plan`.
1. Commit payload — use `#commit`.

### Editing an existing plan doc safely

A plan doc is structured data. Every `### Step N` heading owns a fenced `step-manifest` block.
The `scripts/check_step_manifests.ts` checker pairs each heading with its block by position.
Preserve this structure when `#next-steps` writes per-step done-marks or `#remediate-plan-gaps` edits step definitions.

Use **targeted text replacement against a unique anchor**.
Choose the step heading, a criterion, a planned-test line, or the manifest fence line.

- ❌ Never insert or delete by computed line number (`lines.insert(idx, …)`, `sed -i N
  ...`, any scripted splice). An off-by-one error shifts later fences.
  This previously removed nine `step: N` keys before `check:manifests` caught the error at commit time.
- ✅ Replace an existing anchor at the insertion point.
  For example, replace the final criterion line and its following fence as one string. Do not compute an index.
- ✅ Verify structure after every edit.
  The `step:` count must equal the number of `### Step N` headings. The top-level fence count must remain even.

  ````bash
  grep -c '^step: ' <doc>                 # == number of '### Step N' headings
  grep -c '^```' <doc>                    # must be even
  ````

- **Recovery when it goes wrong**: do not hand-repair the fences. Restore the doc from the last good commit with `git -C exaix-dev-docs checkout <commit> -- <doc>`.
  Reapply the edit as textual replacements and verify again. That is faster and safer than reconstructing
  lost `step: N` lines by hand.
- If the plan-step orchestrator already committed the submodule, roll back that commit first.
  Use `git -C exaix-dev-docs reset --soft HEAD~1`. Then restore and reapply as described in `#next-steps` step 26a.

## Examples

- `#plan Phase 14: Add caching layer for LLM provider responses`
- `#plan Refactor EventLogger to support structured JSON output`
- `#plan Migrate CLI from Cliffy to a lighter argument parser`
