---
name: pre-gap-analysis
agent: senior-coder
tools:
  - read_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Pre-Gap Analysis Skill (#pre-gap-analysis)"
description: Pre-implementation gap analysis of a phase planning document — finds ambiguities, missing contracts, and security risks before coding starts
short_summary: "Deep gap analysis of a phase planning document before implementation begins: verifies the plan is complete, unambiguous, and safe to code against."
version: "1.10.0"
topics: [
  "planning",
  "gap-analysis",
  "architecture",
  "risk",
  "quality",
  "security",
  "tdd",
  "reachability",
  "integration",
]
qwen_skill: pre-gap-analysis
---

```text
Key points
- This is a PRE-implementation analysis — no code has been written yet.
  The goal is to make the plan safe to implement, not to implement it.
- Read the planning document first, then read every source file it references
  to verify the plan's assumptions against reality.
- Any additionally supplied documents (architecture references, prior phase
  plans, design specs) must be used as context — not ignored.
- Gaps must be classified by severity and written INTO the planning document
  itself (appended after the last existing section), not just reported in chat.
- Amendments to the plan text (e.g., adding missing schema fields, clarifying
  an interface signature) must also be written directly into the document.
- An architectural alignment & necessity check (Phase 2) is mandatory for every
  planning document. Before verifying source files, evaluate whether the plan
  actually fills a gap or could be satisfied by existing infrastructure. If the
  plan's core value is already covered by existing Phases, flag a 🟡 Feasibility
  gap or recommend cancellation/postponement.
- The necessity check must be grounded in an INDEPENDENT survey of the existing
  subsystem (its real handlers, the canonical catalog/schema/registry for that
  domain, and same-domain components) — not in the plan's own references or your
  memory. Redundancy lives in what a plan never cites, so verifying its
  citations (Phase 3) can never reveal it.
- A security feasibility check (Phase 6) is mandatory for every step that
  touches input handling, auth, path resolution, secrets, or external data.
  Security gaps use the 🔒 severity symbol and are always prioritised above
  🟡 Feasibility.
- A traceability & configurability check (Phase 7) is required for every step that
  introduces a state change, a cross-component call, new EventLogger/EventRegistry
  events, thresholds, timeouts, or opt-in features. This is not just "verify the
  declared events are well-typed" — actively check whether the step SHOULD have an
  event and doesn't. `deno task check:event-coverage` is the mechanized first pass
  (advisory; scoped to the EXISTING module a step extends, since the step's own new
  code doesn't exist yet at this phase). Untyped events and hardcoded values are gaps;
  a state change or cross-component call the plan's prose never mentions an event for
  is also a gap. If a step introduces an obviously load-bearing class (request/plan/
  execution/review/memory critical path, or security-sensitive) with no `@visible`
  tagging proposal in Architecture Notes, flag a 🔵 Conceptual gap — see #plan §2H.
- An integration feasibility & reachability check (Phase 8) is mandatory for
  every plan. Phase 3 confirms the plan's named symbols *resolve*; it cannot
  reveal that no step actually *wires* them into a live path. A plan whose steps
  build all the cores but never connect them ships "every part exists, nothing
  works" — the most expensive post-implementation gap. Verify a production
  call-site + integration test per runtime-claiming step, no forward-deferral
  chains, a non-deferrable cutover step, opt-in proof, and a seeded Reachability
  Ledger. A runtime success criterion with no wiring path anywhere in the plan is
  🔴 Critical (the plan is internally contradictory).
- When verifying more than ~20 source files, work in batches of 5–10: read a batch, record findings, then continue.
- **Trivial gaps (typos, wrong module paths, minor formatting, missing clarifying sentences) MUST be fixed by editing the plan text in-place — do NOT register them as gap entries.** Only non-trivial gaps (underspecified algorithms, missing tests, security concerns, architectural issues, missing wiring paths, design decisions) get full gap entries. After all in-place fixes, append a brief "In-Place Fixes" subsection listing what was fixed, then proceed to register only the non-trivial gaps.
- Bump the document version (e.g., 1.0 → 1.1) after writing all gaps in.

Canonical prompt (short):
"Pre-gap-analyse .copilot/planning/phase-NN-*.md. Read every source file it
references and report every ambiguity, missing contract, and implementation
risk before we start coding. Write the gaps into the document."

Examples
- "#pre-gap-analysis .copilot/planning/phase-65-flow-scheduler.md"
- "#pre-gap-analysis .copilot/planning/phase-48-acceptance-criteria-propagation.md
   Additional context: ARCHITECTURE.md, packages/flow/src/flow_runner.ts"

Do / Don't
- ✅ Do apply the architectural alignment checklist (Phase 2) to every planning
  document before touching source files — verify the plan fills a real gap and
  does not duplicate existing infrastructure.
- ✅ Do independently survey the subsystem the plan touches BEFORE accepting its
  problem statement — its real handlers, the canonical catalog/schema/registry
  for that domain (e.g. `DomainEventType` for an events plan), and same-domain
  components grepped by capability (`*reflect*`, `*validat*`, `*diagnos*`).
- ✅ Do read every source file cited in the planning document — never trust
  the plan's description of what a file contains.
- ✅ Do follow every input/output data-flow chain end-to-end.
- ✅ Do check constructor signatures for every newly injected dependency.
- ✅ Do verify Zod schemas have .default() on every optional new field.
- ✅ Do check that every new interface is exported from an index/barrel file.
- ✅ Do `ls`/`stat` every doc file path the mandatory §3D documentation step's Actions name — a path that doesn't exist is a 🟡 Feasibility gap, not something to leave for implementation to discover.
- ✅ Do verify value specification depth — enum/variant fields must specify which value each component emits, not just the allowed set.
- ✅ Do survey module conventions before accepting the plan's pattern choices — new code should match the dominant existing style in the same module.
- ✅ Do trace every prose behavioural claim to a named test in Planned Tests — claims without test names are gaps.
- ✅ Do look for magic numbers/strings that belong in constants.
- ✅ Do classify every gap with a severity symbol (🔴 Critical / 🔒 Security /
  🟡 Feasibility / 🟠 Testing / 🔵 Conceptual) so the team can triage quickly.
- ✅ Do include a numbered gap summary table before the detailed gap entries.
- ✅ Do run Phase 6 security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do write all gaps and a Pre-Implementation Actions list into the document.
- ✅ Do grep-verify every Pre-Implementation Action that claims a source-code change
  before marking it ✅ — a resolution that only edits the doc but claims code was
  changed is ⛔ UNVERIFIED. The grep must find the claimed symbol in production code.
- ❌ Don't accept a doc-only edit as resolving a code-change gap — if the gap says
  "file X needs a new field", editing the plan to say "file X has the field" does not
  create the field. Only a real code change and a successful grep close the gap.
- ✅ Do re-read the actual current text of every section a Resolution names before marking
  it ✅ APPLIED, even when the Resolution is doc-only — a Resolution is itself an
  unverified claim about the edit, not the edit.
- ❌ Don't mark a Resolution ✅ APPLIED from memory of having "addressed" the gap
  conceptually — verify the literal text change exists exactly where and as the
  Resolution says, in every location it names, not just the first one.
- ❌ Don't mark a 🔴/🔒 gap ✅ APPLIED when its Resolution defers the actual decision to
  "before/during implementation" — that is a precisely-scoped open decision, not a closed
  gap; mark it `⏳ DEFERRED-TO-IMPLEMENTATION` and keep the verdict `⚠️ GAPS FOUND`.
- ✅ Do bump the document version after writing gaps in.
- ✅ Do fix trivial gaps (typos, wrong paths, minor formatting, missing clarifying sentences) by editing the plan text in-place without registering a gap entry.
- ✅ Do include a brief "In-Place Fixes" subsection in the Pre-Gap Analysis section listing all in-place fixes so the reader knows what was changed.
- ✅ Do use any additionally supplied documents as context.
- ✅ Do run Phase 7 traceability & configurability checks on every step that
  introduces a state change, a cross-component call, new `EventLogger`/`EventRegistry`
  events, thresholds, timeouts, or opt-in features — check for missing coverage, not
  just typing of what's already declared. Flag a step introducing a load-bearing class
  with no `@visible` tagging proposal as underspecified (#plan §2H).
- ✅ Do run Phase 5 scenario framework coverage checks on every step that
  affects the request → plan → execution → review → memory → update flow.
- ✅ Do run the Phase 8 reachability check on every plan — for each runtime-claiming
  step verify a named production call-site AND an integration/scenario test; flag any
  forward-deferral chain that never terminates, any step-ordering inversion, a missing
  cutover step, an opt-in flag with no real-config proof, and a missing Reachability Ledger.
- ✅ Do escalate a runtime success criterion that has no wiring path anywhere in the plan
  to 🔴 Critical — the plan promises behaviour its steps cannot deliver.
- ❌ Don't pass a plan as READY TO IMPLEMENT while a 🔴 reachability gap is open (no wiring
  path / no cutover step) — that is how production-dead features get greenlit.
- ❌ Don't accept "wired in a later step" without confirming that later step's Actions
  contain the concrete wiring; a deferral to "follow-ups" or an unnamed step is a gap.
- ❌ Don't mark a step gap-free unless its data sources, types, and tests are
  fully specified.
- ❌ Don't skip Phase 2 architectural alignment for any planning document —
  even if the plan seems straightforward.
- ❌ Don't satisfy Phase 2 by checking only the symbols the plan names or by
  trusting its problem statement — redundancy hides in the negative space (the
  existing components the plan fails to cite). Survey the subsystem independently.
- ❌ Don't skip Phase 6 for steps that handle external data or file paths —
  even if the plan did not mention security.
- ❌ Don't report gaps only in chat — they MUST be written into the document.
- ❌ Don't skip the gap summary table — it is required for agent traceability.
- ❌ Don't ignore backward-compatibility risk on schema changes.
- ❌ Don't assume tests cover a path — verify the plan's Planned Tests section
  explicitly names them.
- ❌ Don't accept hardcoded threshold or timeout literals — they must be named
  constants in `packages/core/src/types/constants.ts` or config-schema fields.
- ❌ Don't skip event payload typing — untyped events block audit chain
  verification and make integration tests fragile.
- ❌ Don't register trivial gaps (typos, wrong paths, minor formatting) as full gap entries — fix them in-place and note in an "In-Place Fixes" subsection instead. Reserve full entries for gaps that need design discussion, test additions, or significant new content.

Related skills:
- #plan             — Draft a new phase planning document from scratch (precedes this skill)
- #next-steps       — Execute the plan step-by-step after analysis is clean (follows this skill)
- #post-gap-analysis — Deep post-implementation review (code already written)
- #commit           — Create a structured commit after gap fixes
- [test-development](../test-development/SKILL.md) — Edge case coverage requirements, test helpers, placement rules

Workflow chain (typical):
  #plan → **#pre-gap-analysis** → #next-steps → #post-gap-analysis → #commit
```

## See also

- [plan](../plan/SKILL.md) — plan structure, gap remediation step format
- [post-gap-analysis](../post-gap-analysis/SKILL.md) — complementary post-implementation review

---

## Instructions for Agent

You are performing a **pre-implementation gap analysis** of the phase planning
document provided. Your output has two parts:

1. **A chat summary** — brief findings overview.
1. **Edits written directly into the planning document** — gap table, detailed
   gap entries, and a Pre-Implementation Actions list appended after the last
   existing section.

---

### Phase 1 — Ingest

1. **Read the planning document in full.**
   Record:
   - Document version and Status.
   - Every stated goal and success metric (§C, §H).
   - Every step and its sub-sections (Actions / Architecture Notes / Planned
     Tests / Success Criteria).
   - Every file path, symbol name, interface, schema field, and constant the
     plan mentions.

1. **Read all additionally supplied documents.**
   Treat them as ground-truth context (architecture references, prior phase
   plans, design decisions). Note any conflicts with the planning document.

---

### Phase 2 — Architectural Alignment & Necessity Check

Apply this phase **before** verifying source files. If the plan fails this
check, flag 🟡 Feasibility gaps (or recommend cancellation) before proceeding
to Phase 3.

1. **Independently survey the subsystem first (before any "does it already exist?" answer).**
   Do NOT answer the necessity question from the plan's own references or from
   memory. Run a fresh codebase survey of the area the plan touches, mapping
   where its target capability would ALREADY be represented if it existed:
   - The canonical catalog / schema / registry for the plan's domain — e.g. the
     event taxonomy (`DomainEventType`) for an events or signals plan, the
     storage schema + migrations for a persistence plan, the Zod schemas for a
     validation plan, or the tool/command registries for a tooling plan.
   - The real handlers along the plan's flow (whichever of request / plan /
     execution / review / memory / MCP / git it touches) — what is already
     validated, logged, retried, persisted, or diagnosed **at the point of
     occurrence**.
   - Existing same-domain components found by capability, not by the plan's
     names — grep patterns such as `*reflect*`, `*validat*`, `*diagnos*`,
     `*circuit*`, `*registry*`, reporters — including built-but-dormant ones
     defined but not yet wired in.
   - **Redundancy lives in the negative space** — the components a plan never
     references. Confirming the plan's named symbols resolve (Phase 3) can never
     reveal what the plan failed to reference; only this survey can. Treat it as
     a precondition, not a formality. (A whole phase has been cancelled at this
     step after the survey found the capability already shipped.)

1. **Map every claimed improvement to existing infrastructure.**
   For each stated goal or improvement in the plan, answer:
   - Does this capability already exist in a shipped Phase **or in existing
     runtime infrastructure surfaced by the survey above**? (check Phases 37,
     64, 65, 82, 84, the event taxonomy, and any handlers/components relevant
     to the plan's domain.)
   - If yes, can the existing capability achieve the stated goal with minimal
     changes (e.g., adding a wait-state kind, extending a schema, adding a
     flow-validator rule) — without introducing a new service or abstraction?
   - Document each existing-vs-planned mapping as a table.

1. **Apply the devil's advocate test.**
   For each major new concept the plan introduces (new service, new abstraction,
   new orchestration primitive), ask:
   - "What does this buy us that a simpler approach cannot?"
   - "Is this solving a real runtime problem, or a flow-author discipline
     problem that validation or documentation would handle more cheaply?"
   - "In a local-first single-user system, who would race / conflict / contend
     on this resource?"
   - "Can an operator with filesystem access bypass this mechanism? If so,
     what security boundary does it actually provide?"

1. **Check for architectural drift.**
   - Does the concept align with Exaix's core patterns (file-driven,
     artifact-centric, local-first, single-user, human-governed)?
   - Does it introduce a concept that conflicts with or bypasses the existing
     architecture (e.g., in-process locks over VCS-level isolation, global
     mutexes over resource-scoped coordination)?
   - Would the plan's approach work identically in both solo and multi-user
     modes, or does it assume one runtime model?

1. **Assess the complexity-to-value ratio.**
   - Estimate the implementation surface: new files, interfaces, services,
     config fields, event types, tests.
   - Compare against the estimated value: how often will this feature be
     exercised in normal operation?
   - If the ratio is poor, flag a 🟡 Feasibility gap and propose a simpler
     alternative or recommend postponement.

A finding in Phase 2 that concludes the plan should not proceed is classified
🟡 Feasibility with `Resolution: "Recommend cancellation — see analysis in
Phase 2 findings"`. It must be written into the document alongside any other
gaps.

---

### Phase 2A — Interface Verification (codebase-level)

**Goal:** Verify every interface, type, and schema the plan proposes to create or extend actually exists (or provably doesn't) in current source, and that its real shape matches what the plan assumes.

Run this phase after Phase 2 (architectural alignment) and before Phase 3 (detailed source verification). It is a lighter, targeted check that catches the most common plan-vs-reality mismatches in a single pass.

1. **Catalogue every interface/type/schema the plan references.**
   From Phase 1 notes, extract:
   - Interfaces the plan proposes to **create** (e.g. `IModelRegistry`, `IResolvedModel`)
   - Interfaces the plan proposes to **extend** (e.g. add `thinking`/`effort` to `IModelOptions`)
   - Constants or enums the plan proposes to **add to** (e.g. `DomainEventType`)
   - Zod schemas the plan proposes to **extend** (e.g. `RoutingConfigSchema`)

1. **Resolve each against real source.**
   For each entry, grep the codebase for the symbol name. Classify the result:
   - **🟢 EXISTS-MATCH** — symbol found with the exact shape the plan assumes. No gap.
   - **🟡 EXISTS-MISMATCH** — symbol found but differs from the plan's assumption (wrong field name, different signature, optional vs required). Flag as a gap with the real signature.
   - **🔴 NOT-FOUND-NEW** — symbol does not exist and the plan says it's new. Expected; note it for Phase 3 verification of the plan's creation actions.
   - **🔴 NOT-FOUND-EXTEND** — symbol does not exist but the plan says "extend existing". The plan assumes something exists that doesn't — 🔴 Critical gap. The plan must either create it or correct the reference.
   - **⚪ NOT-FOUND-DELETED** — symbol does not exist and the plan says to replace/retire it. Expected; note it for Phase 3.

1. **Check barrel exports.**
   For each new or extended interface, verify the plan names the barrel/index file it will be exported from. If multiple packages share the type, confirm the plan specifies which package owns the canonical definition.

1. **Verify every doc file path named in the mandatory §3D documentation step's Actions.**
   `ls`/`stat` each file the closing documentation step proposes to edit (e.g. a security
   guide file that turns out not to exist yet). A path that doesn't exist is the doc-path equivalent of
   NOT-FOUND-EXTEND — flag a 🟡 Feasibility gap naming the real file the content should
   land in instead (grep `docs/*.md`/`ARCHITECTURE.md` for the nearest existing section
   covering the same topic), rather than leaving the step to discover this at
   implementation time. A plan step that already hedges with "(or the security-facing
   guide)" is itself acknowledging the uncertainty this check should have resolved before
   implementation, not during it.

**Rationale:** Catches the pattern where a plan says "extend IModelOptions with thinking/effort" but IModelOptions doesn't exist, or says "add ModelResolved to DomainEventType" but DomainEventType doesn't use that event registration pattern. Phase 3 cannot catch these — it verifies the files the plan names, not the files the plan assumes. The same failure mode applies to doc paths: Phase 145's own Step 6 named a security guide file that was never created — a one-line `ls` at plan-review time would have caught it instead of costing an `#next-steps` implementation pass a grep-the-repo detour to find the real target (`docs/Exaix_User_Guide.md` §9).

---

### Phase 2B — Call-Site Tracing (codebase-level)

**Goal:** For every code path, method, or call chain the plan claims to modify or rely on, read the actual call site and verify the plan's mental model matches reality. Catches the most common implementation blocker: the plan describes how a component works, but the real component works differently.

Run this phase after Phase 2A (interface verification). It is an independent audit — do not re-use Phase 3 file reads; read the call sites specifically to test the plan's claims.

1. **Extract every behavioural claim from the plan.**
   From each step's Actions and Architecture Notes, list claims like:
   - "Component X calls service Y with parameter Z" — read Y's actual method signature.
   - "The resolver passes options to every generate() call" — read the call site; does generate() accept options?
   - "ProviderFactory.createByName() resolves the provider" — read the method; does it create one or multiple?
   - "FlowRunner creates a new LlmClient with dynamicModel" — read the constructor; what does the third param actually do?

1. **Read each call site and classify.**
   - **🟢 CLAIM-MATCHES** — the real call site matches the plan's description. No gap.
   - **🟡 CLAIM-OMISSION** — the real call site has behaviour the plan doesn't mention (e.g. env var mutation, error handling, caching). The plan's model is incomplete; flag what was missed.
   - **🔴 CLAIM-CONTRADICTS** — the real call site flatly contradicts the plan's claim (e.g. plan says "generate() accepts options" but the method takes only a prompt string). The plan is wrong about how a core dependency works — requires a plan revision.
   - **⚪ CLAIM-AMBIGUOUS** — the plan's wording is vague enough that multiple interpretations are valid. Flag for clarification.

1. **Trace constructor-injection chains.**
   For every service the plan says "X receives Y via constructor injection":
   - Read X's constructor signature.
   - Read every production call-site that constructs X (grep `new X`).
   - Verify the parameter order, type, and optionality match at every call-site.
   - Flag any call-site where Y would be `undefined` or the types don't align.

**Rationale:** Phase 3 confirms `files exist and symbols resolve`. Phase 2B confirms `the code the plan describes works the way the plan thinks it does`. These are different guarantees — a plan can name every real file and still be wrong about how those files behave.

---

### Phase 2C — Side-Effect Audit (codebase-level)

**Goal:** Flag impure patterns (env var mutation, global state modification, concurrent-unsafe caching) that the plan assumes don't exist, or that the plan proposes to remove without explicitly naming and eliminating them.

Run this phase after Phase 2B. It is a targeted scan for side-effect patterns in every method or code path the plan touches.

1. **Scan each touched method for impure patterns.**
   For every method the plan references or would call, search for:
   - `Deno.env.get/set/delete` — env var reads/writes. Non-const env reads at module init are acceptable (config bootstrap); env writes inside request handlers or resolution logic are gaps.
   - `static mutable state` — `static` fields that are mutated after construction (e.g. `ProviderRegistry.metadata` as a `Map` with `register()` calls). Not inherently a gap, but the plan must account for the timeliness of registration (at boot, not lazily).
   - `global singletons with mutable state` — module-level `let` variables, `Map`s, `Set`s that accumulate state across calls.
   - `concurrent-unsafe patterns` — shared mutable state without synchronization. (Deno is single-threaded in practice, but future Workers or isolate sharing would break.)

1. **Classify each finding.**
   - **🟢 SIDE-EFFECT-ACCEPTABLE** — side effect is scoped to boot/init (e.g. registering providers at startup). The plan may or may not mention it; if it doesn't, note as optional documentation gap.
   - **🟡 SIDE-EFFECT-UNMENTIONED** — side effect exists in a method the plan modifies but the plan does not mention it. The plan's model of the method is incomplete; flag what was missed so the implementation step can choose to preserve, remove, or document it.
   - **🔴 SIDE-EFFECT-RETAINED** — the plan says "replace X with Y" but a side effect in X (env var mutation, global cache write) is not mentioned in the replacement step. The plan will ship a broken or leaking abstraction if the side effect survives unnoticed.
   - **🔴 SIDE-EFFECT-VESTIGIAL** — a method that only exists to perform a side effect (e.g. `resolveProvider()` which exists only to set env vars before calling `ProviderFactory.createByName()`). The plan must explicitly delete or replace the method; otherwise the vestigial path is a bypass around the new routing.

1. **Check the plan's own side-effect proposal.**
   If the plan itself proposes a new impure pattern (e.g. writing to a global registry, caching resolved models in a static Map), evaluate it against the architecture:
   - Is this a boot-time registration or a request-time mutation?
   - If request-time, is there a clear lifecycle (initialized when, cleared when)?
   - Is concurrent access possible (or planned for a future phase)?

**Rationale:** Phase 2B catches "the method signature is different." Phase 2C catches "the method looks right but has a hidden side effect the plan didn't account for" — a method the plan would keep but never knew was impure. Without Phase 2C, an implementer would preserve the env var mutation alongside new routing, creating a silent bypass.

---

### Phase 3 — Source Verification

> **Note:** Phases 2A–2C already verified interfaces, call-sites, and side effects for the plan's core claims. This phase is the exhaustive file-by-file read of every source file the plan references — including files not covered by the targeted checks above (e.g. test files, config schemas, constants files, barrel exports).

1. **Locate every referenced source file and read it.**
   For each file the plan mentions: confirm it exists, and that the symbols the
   plan assumes (classes, functions, exported types, constants) are actually
   present and have the signatures the plan claims.

1. **Trace every data-flow chain.**
   For each piece of data the plan passes between components, answer:
   - Where does it originate? (constructor param / loaded from disk / computed)
   - Where is it consumed? (method param / field on a shared type / stored)
   - Is there any step in the chain where the data may be `undefined` or missing?

1. **Check constructor contracts.**
   For every service or class the plan modifies or creates:
   - List all existing constructor parameters from the actual source.
   - Identify which new parameters the plan adds.
   - Confirm the parameter order is consistent with all call-sites.

1. **Audit schema backward compatibility.**
   For every Zod schema field the plan adds or changes:
   - Is `.default()` present for optional fields?
   - Are existing serialised artefacts (JSON files, DB rows) still valid after
     the change?
   - Does the plan include a migration step if existing data must be transformed?

1. **Audit algorithm completeness.**
   If the plan merges, caps, sorts, or deduplicates collections, verify:
   - The algorithm is fully specified (sort key, similarity definition, cap value).
   - Every threshold or limit is a named constant in `packages/core/src/types/constants.ts`,
     not a hardcoded literal.

1. **Verify cross-component ownership.**
   For every type or field shared between two or more components:
   - Is there a single authoritative definition?
   - Is it imported rather than duplicated?
   - Is the owning module's export path declared in the plan?

1. **Verify value specification depth.**
   For every field with an enum, union, or variant type that the plan introduces:
   - Confirm the plan specifies which concrete value each component emits, stores, or produces — not just the allowed set.
   - If the plan says "field can be one of X, Y, Z" without mapping values to components or conditions, flag as underspecified.

1. **Survey module conventions.**
   Before accepting the plan's choice of interface shape, naming pattern, or architectural style in a module that already has established conventions:
   - Survey 5–10 existing examples in the same file or module.
   - Identify the dominant convention for the concern the plan touches (event emission, field naming, error handling, DI pattern, etc.).
   - If the plan's approach diverges from the module's existing convention without justification, flag a gap.

1. **Trace claimed consumer paths against Planned Tests.**
   For every behavioural claim the plan makes in prose (e.g., "checkpoint preserves data", "component X calls service Y", "result remains accessible via Z"):
   - Verify a named test in the step's Planned Tests section explicitly covers that claim.
   - Prose-only claims that lack a corresponding test name are a gap — flag whether the missing test or the prose claim is the problem.

---

### Phase 4 — Standards Compliance Check

1. **Check plan structure against `exaix-dev-docs/planning/README.md`.**
   For every step, verify it contains all four §F sub-sections:
   - `Actions` — explicit file paths and the changes to make
   - `Architecture Notes` — DI / constructor / pattern rationale
   - `Planned Tests` — named unit and integration tests (not just "add tests")
   - `Success Criteria` — measurable, objective outcomes

   A step missing any sub-section is a gap (severity depends on which one).

1. **Check h2 sections carry their own descriptive content (no blank containers).**
   For every h2 heading in the plan document, verify it contains at least one paragraph of substantive content at its own level before any sub-headings. A section whose heading is followed immediately by a `###` sub-heading (e.g., `## Current State Analysis` → `### Key Files` with no prose in between) is a **blank container** — the heading promises information that the plan has not yet delivered. Flag it as a 🟠 Conceptual gap. This applies especially to `## Executive Summary`, `## Current State Analysis`, `## Technical Architecture`, and `## Security Constraints` — sections whose purpose is not fully satisfied by sub-sections alone. The fix is to write introductory content at the h2 level, not to remove the sub-sections.

1. **Check test coverage specification.**
   For every new code path the plan introduces:
   - Is there a named unit test in Planned Tests?
   - Is there a named integration test in Planned Tests?
   - Are edge cases (empty input, null, max-size, concurrent access) explicitly
     listed?
   - Are negative / error-path tests named?

1. **Check §3D documentation update compliance.**
   Does the plan include a documentation update step (or sub-task) for each
   step that introduces or changes interfaces, schemas, CLI behaviour, or
   architecture? If not, flag a gap per missing update target.

1. **Check interface export paths.**
   For every new interface or type the plan defines, confirm it names the
   index / barrel file it will be exported from.

1. **Identify missing constants.**
   Flag every literal string or number in the plan (threshold, mode name, file
   name, timeout) that belongs in `packages/core/src/types/constants.ts`.

---

### Phase 5 — Scenario Framework Coverage Check

For **every step** that affects the **request → plan → execution → review → memory → update**
flow (or any sub-path of it), assess whether the scenario framework at
`tests/scenario_framework/` needs new or updated coverage.

---

### Phase 6 — Security Feasibility Check

For **every step** that touches input parsing, file-system access, auth, secrets,
network calls, process execution, or shared mutable state — apply the security
checklist (input validation, path traversal, secret handling, injection,
auth boundary, error leakage, concurrency/TOCTOU, dependency trust, security tests).

A finding is classified 🔒 Security — always triaged above 🟡 Feasibility.

---

### Phase 7 — Traceability & Configurability Check

For **every step** that introduces new behaviour, check:

- **Coverage, not just typing.** For every state change (a new field, a new persisted
  value, a new mutation) or cross-component call (a new service invoking another
  injected dependency) the step's Actions describe: does the step's Architecture Notes
  or prose name the event that reports it? A state change or cross-component call with
  no event anywhere in the step's description is a gap — don't only check that the
  events the plan DOES mention are well-formed.
- **`@visible` candidacy.** If the step introduces a class handling state-changing or
  cross-component work on the request → plan → execution → review → memory critical
  path, or a security-sensitive operation, and Architecture Notes do not propose
  tagging it `@visible` (see #plan §2H), flag a 🔵 Conceptual gap — the plan should
  make the "is coverage required here" decision explicit, not leave it to the advisory
  heuristic. If the step MODIFIES a file that already carries an `@visible`-tagged
  class, any coverage gap `check:event-coverage` finds there is 🔴 Critical, not 🟡 —
  the tag is an existing, explicit commitment the step must not silently regress, and
  a real gap on it fails the real pre-commit hook (Gate 19), not just this analysis.
- **Taxonomy conformance, not just call presence.** For a step touching an `@visible`
  class: does the plan's logger call use a registered `DomainEventType` action (a
  literal reference, or a same-class private-helper parameter/field typed
  `TDomainEventType`), not a raw string? Does an operation emitting multiple lifecycle
  events pass the canonical trace ID as the logger call's fourth argument on every one
  of them (embedding it only in the payload lets `EventLogger.log` mint an independent
  random trace ID per event, breaking Activity Journal correlation)? Does a streaming/
  generator method plan a terminal event for early consumer cancellation, not only
  normal completion and a thrown error? Each missing case is a real gap on a tagged
  class, not advisory.
- Event naming, payload typing, audit chain completeness, event assertions in tests.
- Config-driven vs. constant-driven values, config schema declaration, feature
  enable/disable path, config validation tests.
- **Mechanized cross-check on the module the step extends.** The step's own code
  doesn't exist yet, but if the step modifies an EXISTING file, run
  `deno task check:event-coverage` scoped to that file — a pre-existing "wired but
  silent" class the step is about to add a new state-changing method to is a strong
  signal the new method will inherit the same gap unless Architecture Notes explicitly
  call for fixing it. Advisory (see `scripts/check_event_coverage.ts`'s module header
  for known false-positive sources), not authoritative.

---

### Phase 8 — Integration Feasibility & Reachability Check

The most expensive post-implementation gap is a plan whose components are all
buildable and testable but whose **step sequence never wires them into a live path** —
the feature ships as disconnected cores ("every part exists, nothing works"). Phase 3
confirms the plan's named symbols resolve; it cannot reveal that no step connects them,
because a plan can name every class and still never call any of them from production.
Run this check on every plan. Findings are 🟡 Feasibility by default and **🔴 Critical
when a step's Success Criteria assert runtime behaviour with no wiring path anywhere in
the plan** (the plan is internally contradictory). The same audit is re-run later by
`#next-steps`' phase-completion gate and `#post-gap-analysis` — catching it here is the
cheapest point.

1. **Reachability anchor per runtime-claiming step.**
   For every step whose Success Criteria assert runtime/observable behaviour (a daemon
   does X, a gate produces Y, an out-of-band event resumes Z), verify the plan names:
   (a) the exact production call-site/constructor (`file:Symbol`, e.g.
   `apps/daemon/main.ts`) that will invoke the new code, and (b) a named integration or
   scenario test that drives that call-site. A runtime claim whose only Planned Tests are
   package-unit tests — or that names no production call-site — is a reachability gap:
   unit tests cannot detect that nothing calls the code (the test is the only caller).

1. **Forward-deferral chain audit.**
   Grep the plan for every "consumed by Step M" / "wired in Step M" / "registered later"
   deferral. For each, confirm Step M's Actions actually CONTAIN the concrete wiring. Flag:
   - a deferral whose target step does not contain the wiring (dangling pointer);
   - a deferral to "follow-ups", "a future phase", or an unnamed later step (open-ended);
   - a chain where the LAST step still defers (the chain never terminates — this is the
     exact failure mode that shipped Phase 106 production-dead).

1. **Dependency-ordering (inversion) check.**
   Build the inter-step dependency graph: if Step N consumes something Step N+k builds
   (e.g. gate hooks in Step 7 read a config field added in Step 9), the ordering is
   inverted. Flag it; recommend re-sequencing or an explicit stub-then-replace.

1. **Terminal cutover step presence.**
   Verify the plan ends with a non-deferrable "Integration & cutover" step whose Success
   Criterion is end-to-end reachability from a real daemon/CLI run with the feature
   enabled. Its absence is a gap — there is then no step that makes the feature work.

1. **Opt-in proof.**
   For every `enabled`-style flag the plan introduces, verify a Success Metric of the
   form "with `feature.enabled=true`, observable behaviour B occurs", backed by a test
   that flips the REAL config (not a unit test of the gated component in isolation). A
   flag with no such metric/test risks shipping a toggle that does nothing.

1. **Vertical-slice ordering.**
   Detect horizontal layer-by-layer ordering (all schemas → all services → "wire it
   last"). If the first N−1 steps build cores and only the final step(s) connect
   anything, flag the structural risk and recommend a vertical-slice re-ordering: one
   complete path (entry point → … → observable output) first, then breadth.

1. **Reachability Ledger seeded.**
   Confirm the plan contains a (possibly empty) `## Reachability Ledger (pending
   production consumers)` section for `#next-steps` to maintain. Its absence is a
   🔵 Conceptual gap — note it so `#plan`/`#next-steps` seeds it.

---

### Phase 9 — Gap Classification

Classify every gap:

| Symbol         | Meaning                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| 🔴 Critical    | Blocks implementation — plan is contradictory or a required symbol is missing |
| 🔒 Security    | Security control unspecified or missing (OWASP Top 10)                        |
| 🟡 Feasibility | Risky assumption or unspecified algorithm — needs a design decision           |
| 🟠 Testing     | Missing or under-specified test — step may ship without coverage              |
| 🔵 Conceptual  | Minor ambiguity or style issue — low risk, but should be clarified            |

Reachability findings (Phase 8) map to 🟡 Feasibility by default, and to 🔴 Critical when
a runtime success criterion has no wiring path anywhere in the plan (the plan is
internally contradictory). An open 🔴 reachability gap blocks the `✅ READY TO IMPLEMENT`
verdict. A Resolution that defers the actual decision to implementation time (e.g. "choose
option (a) or (b) before implementation," "to be defined during implementation," "ask the
implementer to state...") does **not** close a 🔴 or 🔒 gap for verdict purposes — it
documents the decision precisely but leaves it unmade. Mark that Pre-Implementation Action
`⏳ DEFERRED-TO-IMPLEMENTATION`, not `✅ APPLIED`, and the verdict stays `⚠️ GAPS FOUND`
until the decision is actually made in the plan text (or the severity is explicitly
downgraded with a stated reason the decision genuinely cannot be made before code exists).

Build a gap summary table before detailed entries.

---

### Phase 10 — Apply In-Place Fixes and Write Gaps Into the Document

1. **Fix trivial gaps in-place first.** Before writing any gap entry, scan all findings and
   separate trivial from non-trivial:
   - **Trivial** (typos, wrong module paths, minor formatting, obvious clarifying sentence):
     edit the plan text directly. No gap entry needed.
   - **Non-trivial** (underspecified algorithm, missing tests, security concern, missing
     wiring, design decision): register as a full gap entry.
1. **List in-place fixes.** After all in-place edits, add a brief `### In-Place Fixes`
   subsection (before `### Gap Summary`) listing what was fixed, e.g.:

   ```text
   ### In-Place Fixes
   - Corrected test directory path to match existing convention.
   - Fixed field name on `IReviewMetadata` for type clarity.
   - Inline clarifying sentences added to Architecture Notes.
   ```

1. **Register non-trivial gaps.** Append the gap summary table, detailed gap entries,
   and Pre-Implementation Actions list after the last existing section.

#### Required markdown format

````markdown
---

## Pre-Gap Analysis — <ISO date> — Verdict: ⚠️ GAPS FOUND / ✅ READY TO IMPLEMENT

<!-- READY TO IMPLEMENT requires zero open 🔴 gaps, including 🔴 reachability gaps (Phase 8). -->

### Gap Summary

| # | Step   | Severity       | Description            |
| - | ------ | -------------- | ---------------------- |
| 1 | Step N | 🔴 Critical    | <one-line description> |
| 2 | Step N | 🔒 Security    | <one-line description> |
| 3 | Step N | 🟡 Feasibility | <one-line description> |

### Gap Detail

#### GAP-1 — 🔴 Critical — Step N: <title>

**Finding:** <detailed explanation>
**Impact:** <what breaks if not fixed>
**Resolution:** <what needs to be added to the plan>

---

### Pre-Implementation Actions (ordered by severity)

List every resolution in priority order. Each action must state the exact file and
change. The grep verification and marker-consistency check (see Finalize section) run after these
are written. Format with grep outcome annotations:

```markdown
1. 🔴 [GAP-1] <action> — ✅ [grep: `symbol` in `file.ts:N`]
2. 🟡 [GAP-2] <action> — ⛔ UNVERIFIED [grep: `symbol` not found]
3. 🔴 [GAP-3] <action deferring the actual choice to implementation> — ⏳ DEFERRED-TO-IMPLEMENTATION [not a closed gap — see Phase 9]
```
````

**Verification rules (applied during finalize):**

1. **Grep every code-change claim.** If the expected symbol doesn't exist in production
   code, the resolution is `⛔ UNVERIFIED` — downgrade the step to ⏳ pending.

1. **Cross-reference against step markers.** If a resolution claims enforcement is
   "implemented" but the step is marked CORE (not WIRED), flag the contradiction.
   Either the resolution is wrong or the marker is wrong.

1. **No doc-only code-change resolutions.** A doc edit alone cannot close a gap that
   requires source code. The grep must find the claimed change.

1. **Re-verify every Resolution's own text against the document — doc-only or not.** A
   Resolution paragraph is a _claim about what the edit did_, not proof it happened. Before
   marking any Pre-Implementation Action `✅ APPLIED` — whether its Resolution promises a
   plan-text edit only (no source code exists yet) or a source-code change — re-read the
   actual current text of _every_ section/step the Resolution names and confirm each one
   literally contains what the Resolution claims, word for concrete word (not "conceptually
   addressed"). If the Resolution names three locations and only two were actually edited,
   the gap is not closed: mark it `⛔ UNVERIFIED` and leave the step `⏳ pending` until the
   missing edit lands. This applies even when nothing exists to grep — "no code to verify"
   is not license to skip verifying the doc edit itself happened as described.

---

### Phase 11 — Finalize

1. Bump the document version in frontmatter.
1. If the plan had no `## Reachability Ledger` section, append an empty one
   (see the "Reachability Ledger seeded" check in the Integration Feasibility section)
   so `#next-steps` has a place to track wiring debt.
1. **Grep-verify every code-change resolution.** For each Pre-Implementation Action that
   claims a source-code change, grep the production codebase for the expected symbol.
   A resolution that only edits the doc but claims code was changed is ⛔ UNVERIFIED
   (see the Pre-Implementation Actions section for the full grep protocol).
1. **Re-read every doc-only resolution against the current document, one final time.**
   For each Pre-Implementation Action with no code to grep, re-open the exact section(s)
   its Resolution names and confirm the text matches, right before finalizing — not from
   memory of having written it. This is the same discipline as the grep step above, applied
   to plan-text edits instead of source-code edits; skipping it is how a gap gets marked
   `✅ APPLIED` while the document still contains the original, unfixed claim.
1. **Check step-level marker consistency.** Verify every step has `⏳ pending` markers —
   no code has been written yet. Flag any `✅ CORE`/`✅ WIRED`/`[x]` as premature and
   reset to `⏳`. Exempt only prior-phase steps confirmed shipped via grep.
1. Run `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>`. If it reports fixable violations and you re-run with `--fix`, immediately re-verify every `# step-manifest` yaml fence still has its `step: N` key via `deno run --allow-read scripts/check_step_manifests.ts <doc>` — `--fix`'s heading-blank-line rule has historically misidentified a `# step-manifest` comment inside a fence as a real heading and dropped the following key.

---

## Output format

1. Brief chat summary: total gaps by severity, list of in-place fixes, and whether the plan is safe to implement.
1. Gap summary table — one row per gap (step, severity, description).
1. Confirmation that the planning document was updated: in-place fixes applied, gap sections and Pre-Implementation Actions list appended.
1. Version bump confirmation — the document version was bumped in frontmatter.
1. Any blocking issue that must be resolved before implementation can begin.

---
exaix:
  skill_id: pre-gap-analysis
  related_skills: [test-development]
  triggers:
    keywords: [pre-gap, plan-review, gap-analysis, gap]
    task_types: [planning]
    tags: [pre-gap, plan-review]
  constraints:
    - "Validate every behavioural claim against the codebase"
    - "Check Reachability Ledger for missing production consumers"
    - "Flag underspecified fields"
    - "Do not modify source files — report gaps only"
    - "Fix trivial gaps in-place in plan, register non-trivial as gap entries"
  output_requirements:
    - "Gap summary table sorted by severity"
    - "Detailed gap entries with Finding, Impact, Resolution"
    - "Pre-Implementation Actions list with grep verification"
    - "In-Place fixes subsection listing trivial corrections"
  quality_criteria:
    - name: completeness
      description: Every plan step verified against codebase
      weight: 40
    - name: specificity
      description: Gaps reference specific lines or symbols
      weight: 30
    - name: actionability
      description: Each gap includes a proposed fix
      weight: 30
---
