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
version: "1.10.1"
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

- PRE-implementation analysis — no code exists yet. Make the plan SAFE to implement.
- Read the plan, then every source file it references, verifying assumptions against
  reality. Supplied documents are context — use them.
- Classify gaps by severity and write them INTO the plan (appended), plus Amendments.
- Phase 2 architectural alignment & necessity is MANDATORY for every plan: does it fill
  a real gap or duplicate existing infrastructure? Redundancy lives in the NEGATIVE
  SPACE — an independent survey of the subsystem (real handlers, canonical
  catalog/schema/registry, same-domain components grepped by capability `*reflect*`,
  `*validat*`, `*diagnos*`) must precede any "does it exist" answer; verifying the plan's
  own citations can never reveal what it failed to cite. Flag 🟡 Feasibility or recommend
  cancellation/postponement when the value is already covered.
- Phase 6 security feasibility is mandatory for input/auth/path/secrets/external-data
  steps — findings are 🔒, always above 🟡.
- Phase 7 traceability & configurability for state-change/cross-component/new-event/
  threshold/timeout/opt-in steps. Actively check whether a step SHOULD have an event and
  doesn't; `deno task check:event-coverage` is the mechanized first pass (advisory,
  scoped to the EXISTING module a step extends). Untyped events and hardcoded values are
  gaps. A load-bearing class with no `@visible` proposal → 🔵 Conceptual.
- Phase 8 integration feasibility & reachability is MANDATORY: Phase 3 proves symbols
  resolve; it cannot prove a step WIRES them. Verify a production call-site + integration
  test per runtime-claiming step, no forward-deferral chains, a non-deferrable cutover
  step, opt-in proof, and a seeded Reachability Ledger. A runtime criterion with no wiring
  path is 🔴 Critical (internally contradictory).
- Reviewing > ~20 files: batches of 5–10.
- **Trivial gaps (typos, wrong paths, formatting, clarifying sentences) are fixed
  IN-PLACE — no gap entry.** Only non-trivial gaps (underspecified algorithms, missing
  tests, security, architecture, missing wiring, design decisions) get full entries.
  Append an "In-Place Fixes" subsection afterward.
- Bump the document version after writing gaps in.

Canonical prompt (short):
"Pre-gap-analyse exaix-dev-docs/planning/phase-NN-*.md. Read every source file it
references and report every ambiguity, missing contract, and implementation
risk before we start coding. Write the gaps into the document."

Examples
- "#pre-gap-analysis exaix-dev-docs/planning/phase-65-flow-scheduler.md"
- "#pre-gap-analysis exaix-dev-docs/planning/phase-48-acceptance-criteria-propagation.md
   Additional context: ARCHITECTURE.md, packages/flow/src/flow_runner.ts"

Do / Don't
- ✅ Apply the Phase 2 architectural-alignment checklist to EVERY plan before touching
  source — verify it fills a real gap, not duplicate infrastructure.
- ✅ Survey the subsystem INDEPENDENTLY before accepting its problem statement — real
  handlers, the canonical catalog/schema/registry (e.g. `DomainEventType`), same-domain
  components by capability grep.
- ✅ Read every cited source file — never trust the plan's description.
- ✅ Follow every input/output data-flow chain end-to-end.
- ✅ Check constructor signatures of newly injected dependencies.
- ✅ Verify Zod `.default()` on every optional new field.
- ✅ Verify new interfaces are exported from an index/barrel.
- ✅ `ls`/`stat` every doc path the §3D step names — a missing path is 🟡 Feasibility
  (Phase 2A), not implementation-time discovery.
- ✅ Verify value-specification depth — which value each component emits, not just the set.
- ✅ Survey module conventions before accepting pattern choices.
- ✅ Trace every prose behavioral claim to a named test.
- ✅ Look for magic numbers/strings that belong in constants.
- ✅ Classify gaps 🔴/🔒/🟡/🟠/🔵 and include a numbered gap summary table.
- ✅ Run Phase 6 security on input/auth/path/secrets/external steps.
- ✅ Write all gaps + a Pre-Implementation Actions list into the doc.
- ✅ Grep-verify every Pre-Implementation Action claiming a source change — a doc-only
  edit claiming code changed is ⛔ UNVERIFIED; the grep must find the symbol in production.
- ❌ Accept a doc-only edit as resolving a code-change gap (editing the plan doesn't create
  the field).
- ✅ Re-read the ACTUAL current text of every section a Resolution names before marking
  ✅ APPLIED — a Resolution is an unverified claim about the edit, not the edit; verify in
  EVERY named location, not just the first.
- ❌ Mark a 🔴/🔒 ✅ APPLIED when its Resolution defers the decision to
  "before/during implementation" — mark `⏳ DEFERRED-TO-IMPLEMENTATION`, verdict stays
  `⚠️ GAPS FOUND`.
- ✅ Bump the document version after writing gaps.
- ✅ Use supplied documents as context.
- ✅ Run Phase 7 on state-change/cross-component/new-event/threshold/opt-in steps — check
  for MISSING coverage, not just typing; flag a load-bearing class with no `@visible`
  proposal.
- ✅ Run Phase 5 scenario-coverage check on request→plan→execution→review→memory→update steps.
- ✅ Run Phase 8 reachability on every plan: call-site + integration test per runtime step;
  flag non-terminating deferral chains, ordering inversion, missing cutover, opt-in flag
  with no real-config proof, missing Reachability Ledger.
- ✅ Escalate a runtime criterion with no wiring path to 🔴 Critical.
- ❌ Pass a plan as READY TO IMPLEMENT with an open 🔴 reachability gap.
- ❌ Accept "wired in a later step" without the concrete wiring in that step's Actions.
- ❌ Mark a step gap-free without fully specified sources, types, tests.
- ❌ Skip Phase 2 for any plan, even a straightforward one.
- ❌ Satisfy Phase 2 from the plan's cited symbols or problem statement — survey
  independently (redundancy hides in the negative space).
- ❌ Skip Phase 6 on external-data/path steps.
- ❌ Report gaps only in chat.
- ❌ Skip the gap summary table.
- ❌ Ignore backward-compatibility risk on schema changes.
- ❌ Assume tests cover a path the planned tests don't name.
- ❌ Accept hardcoded thresholds/timeouts — named constants.
- ❌ Skip event payload typing.
- ❌ Register trivial gaps as full entries — fix in-place, note in "In-Place Fixes".

Related: #plan; #remediate-plan-gaps (closes what this finds); #next-steps; #post-gap-analysis;
#commit; test-development.

Workflow chain: #plan → **#pre-gap-analysis** → #remediate-plan-gaps → #next-steps →
#post-gap-analysis → #commit
```

## See also

- [plan](../plan/SKILL.md) — structure, remediation format
- [remediate-plan-gaps](../remediate-plan-gaps/SKILL.md) — closes these gaps
- [post-gap-analysis](../post-gap-analysis/SKILL.md) — post-implementation review

---

## Instructions for Agent

Pre-implementation gap analysis. Output: (1) chat summary; (2) edits into the plan — gap
table, detailed entries, Pre-Implementation Actions list.

### Phase 1 — Ingest

Read the whole plan (version, status, goals, metrics, every step + sub-sections, every
path/symbol/field/constant). Read supplied documents as ground truth; note conflicts.

### Phase 2 — Architectural Alignment & Necessity Check

BEFORE verifying source. Failure → 🟡 Feasibility (or recommend cancellation).
1. **Independently survey the subsystem first** — never answer "does it already exist"
   from the plan or memory. Map where the capability would ALREADY be represented: the
   canonical catalog/schema/registry (DomainEventType, storage migrations, Zod schemas,
   tool/command registries); the real handlers along the plan's flow (what is already
   validated/logged/retried/persisted at the point of occurrence); same-domain components
   by capability grep (`*reflect*`, `*validat*`, `*diagnos*`, `*circuit*`, reporters),
   incl. built-but-dormant. **Redundancy lives in the negative space** — the plan's
   uncited components. (A whole phase was cancelled at this step after the survey found
   the capability shipped.)
1. **Map each claimed improvement to existing infrastructure** — exists already? Can it
   achieve the goal with minimal change (new wait-state kind, schema extension, validator
   rule) without a new service/abstraction? Document as a table.
1. **Devil's advocate** per new concept: what does it buy that simpler cannot? Real runtime
   problem or author-discipline (validation/docs cheaper)? Who races/conflicts in a
   local-first single-user system? Can an operator with FS access bypass it — what boundary
   does it really provide?
1. **Architectural drift**: aligns with file-driven, artifact-centric, local-first,
   single-user, human-governed? Conflicts/bypasses (in-process locks over VCS isolation)?
   Works identically solo vs multi-user?
1. **Complexity-to-value ratio**: implementation surface vs how often exercised. Poor
   ratio → 🟡 + simpler alternative or postponement.
A "should not proceed" conclusion → 🟡 Feasibility with
`Resolution: "Recommend cancellation — see Phase 2 findings"`, written into the doc.

### Phase 2A — Interface Verification (codebase-level)

Verify every interface/type/schema the plan creates or extends actually exists and matches:
1. Catalogue create/extend/add-to references; grep each.
   Classify: 🟢 EXISTS-MATCH; 🟡 EXISTS-MISMATCH (real signature → gap); 🔴 NOT-FOUND-NEW
   (expected); 🔴 NOT-FOUND-EXTEND (says "extend", doesn't exist → Critical — create it or
   fix the reference); ⚪ NOT-FOUND-DELETED (expected).
1. Check barrel exports: the plan names the index/barrel + owning package for shared types.
1. `ls`/`stat` every §3D doc path — a missing path is 🟡 Feasibility naming the real file
   (grep docs/*.md/ARCHITECTURE.md for the nearest section); don't leave it to
   implementation. A hedged "(or the security-facing guide)" is undecided, not resolved.

Rationale: "extend IModelOptions" for a symbol that doesn't exist is invisible to Phase 3
(which reads only the files the plan names). Phase 145 Step 6 named a never-created
security guide — one `ls` at review time would have caught it.

### Phase 2B — Call-Site Tracing (codebase-level)

For every method/call chain the plan claims to modify or rely on, read the actual call
site. Extract behavioral claims ("X calls Y with Z", "generate() takes options",
"createByName resolves"), read each, classify: 🟢 CLAIM-MATCHES; 🟡 CLAIM-OMISSION
(unmentioned behavior — e.g. env mutation/caching); 🔴 CLAIM-CONTRADICTS (plan wrong about
a core dependency → revision); ⚪ CLAIM-AMBIGUOUS. Trace constructor-injection chains: read
the signature + every `new X` batch of call-sites; verify param order/type/optionality.
Phase 3 proves files/symbols exist; 2B proves the code WORKS THE WAY the plan thinks.

### Phase 2C — Side-Effect Audit (codebase-level)

Scan each touched method for: `Deno.env.get/set/delete` (request-time writes = gap;
module-init const reads OK); mutating `static` state (timeliness: boot, not lazy);
module-level mutable singletons; concurrent-unsafe shared state (future Workers).
Classify: 🟢 ACCEPTABLE (boot-scoped); 🟡 UNMENTIONED (model incomplete); 🔴 RETAINED
(plan replaces X but a side effect in it isn't handled); 🔴 VESTIGIAL (a method existing
only to set env before `createByName` — a bypass). A plan-proposed new impure pattern:
boot-time or request-time? Lifecycle? Concurrent access?

### Phase 3 — Source Verification (exhaustive file-by-file)

Read every referenced file; verify symbols + signatures. Trace each data flow
(origin/consumer/undefined risk). Check constructor contracts at every call-site. Audit
schema backward-compat: `.default()`, existing artifacts still valid, migration step.
Audit algorithm completeness (fully specified sort/cap/similarity; named constants). Verify
cross-component ownership (one authoritative definition, imported, export path declared).
Verify value-specification depth (per-component values, not just the set). Survey module
conventions (5–10 examples; divergence → gap). Trace each prose behavioral claim to a named
Planned Test.

### Phase 4 — Standards Compliance

Every step has Actions / Architecture Notes / Planned Tests / Success Criteria (missing
subsection = gap, severity by which). No h2 "blank containers" — every h2 has content at
its own level before `###` (🟠 Conceptual, esp. Executive Summary / Current State /
Technical Architecture / Security Constraints; write content, don't remove sub-sections).
Test coverage specified: named unit + integration, edge cases, error paths. §3D doc step
per interface/schema/CLI change. Interface export paths named. Missing constants flagged.

### Phase 5 — Scenario Framework Coverage

For every step affecting the request → plan → execution → review → memory → update flow:
does `tests/scenario_framework/` need new/updated coverage?

### Phase 6 — Security Feasibility

Per step touching input, FS, auth, secrets, network, process, shared state: apply the nine
checklist items. Findings are 🔒, triaged above 🟡.

### Phase 7 — Traceability & Configurability

Per new-behavior step:
- **Coverage, not typing**: a state change or cross-component call the Actions describe
  with NO named event is a gap — don't only type-check events the plan does mention.
- **`@visible` candidacy**: a load-bearing class (request→plan→execution→review→memory
  critical path or security-sensitive) without a `@visible` proposal → 🔵 Conceptual.
  Modifying a file with an existing `@visible` class? A coverage gap there is 🔴 Critical
  (an existing commitment; real pre-commit fails it).
- **Taxonomy, not call presence**: a tagged class's logger action must be a registered
  `DomainEventType` member (not a raw string); multi-event operations pass the trace ID as
  the 4th logger arg on every one (payload-only mints independent random traces); a
  streaming/generator method plans a terminal event for early cancellation.
- Event naming, typed payloads, audit-chain completeness, test assertions; config-driven vs
  constant values, schema declaration, enable/disable path, validation tests.
- **Mechanized cross-check on the module the step extends** (the step's code doesn't exist
  yet): run `check:event-coverage` scoped to the existing file — a pre-existing
  "wired-but-silent" class the step adds a state-changing method to will likely inherit the
  gap unless the notes fix it. Advisory.

### Phase 8 — Integration Feasibility & Reachability

The most expensive gap: components buildable/testable but never wired into a live path.
Run on every plan. Default 🟡 Feasibility; **🔴 Critical when a step's runtime criteria
have no wiring path anywhere** (internally contradictory). Caught here is cheapest
(#next-steps' gate and #post-gap re-run it).
1. **Reachability anchor** — every runtime-claiming step names (a) the call-site
   (`file:Symbol`, e.g. `apps/daemon/main.ts`) and (b) an integration/scenario test driving
   it. Package-unit-only or no call-site = gap (the test is the only caller).
1. **Forward-deferral audit** — every "consumed by Step M" must have the concrete wiring in
   M's Actions. Flag dangling pointers, deferral to "follow-ups"/"future phase", and a
   chain whose LAST step still defers (Phase 106 shipped production-dead this way).
1. **Dependency-inversion check** — Step N consuming something Step N+k builds → re-sequence
   or stub-then-replace.
1. **Terminal cutover** — a non-deferrable "Integration & cutover" step whose criterion is
   end-to-end reachability. Absence = gap.
1. **Opt-in proof** — every `enabled` flag has "with flag=true, behavior B" + a test flipping
   the REAL config.
1. **Vertical-slice ordering** — reject horizontal layers ("all cores, then wire last");
   require one complete path first, then breadth.
1. **Reachability Ledger seeded** — the (possibly empty) `## Reachability Ledger` section
   exists; absence = 🔵 Conceptual, seed it.

### Phase 9 — Gap Classification

| Symbol | Meaning |
| ------ | ------- |
| 🔴 Critical | Blocks implementation — contradictory plan or missing required symbol |
| 🔒 Security | Control unspecified/missing (OWASP) |
| 🟡 Feasibility | Risky assumption or unspecified algorithm — needs a decision |
| 🟠 Testing | Missing/under-specified test |
| 🔵 Conceptual | Minor ambiguity or style — low risk, clarify |

Reachability → 🟡 by default, 🔴 when a runtime criterion has no wiring path. An open 🔴
blocks `✅ READY TO IMPLEMENT`. A Resolution deferring the decision to implementation time
("choose (a) or (b)", "to be defined") does NOT close a 🔴/🔒 — mark the action
`⏳ DEFERRED-TO-IMPLEMENTATION`, verdict stays `⚠️ GAPS FOUND` until the decision is made in
text (or the severity is down-weighted with a reason).

Build the gap summary table before detailed entries.

### Phase 10 — Apply In-Place Fixes and Write Gaps

1. Fix trivial gaps in-place first; list them under `### In-Place Fixes`:

   ```text
   ### In-Place Fixes
   - Corrected test directory path to match existing convention.
   - Fixed field name on `IReviewMetadata` for type clarity.
   - Inline clarifying sentences added to Architecture Notes.
   ```
1. Register non-trivial gaps. Required format:

````markdown
---

## Pre-Gap Analysis — <ISO date> — Verdict: ⚠️ GAPS FOUND / ✅ READY TO IMPLEMENT

<!-- READY TO IMPLEMENT requires zero open 🔴 gaps, including 🔴 reachability gaps. -->

### Gap Summary

| # | Step | Severity | Description |
| - | ---- | -------- | ----------- |

### Gap Detail

#### GAP-1 — 🔴 Critical — Step N: <title>

**Finding:** <detailed explanation>
**Impact:** <what breaks if not fixed>
**Resolution:** <what must be added to the plan>

---

### Pre-Implementation Actions (ordered by severity)

1. 🔴 [GAP-1] <action> — ✅ [grep: `symbol` in `file.ts:N`]
2. 🟡 [GAP-2] <action> — ⛔ UNVERIFIED [grep: `symbol` not found]
3. 🔴 [GAP-3] <action deferring the choice> — ⏳ DEFERRED-TO-IMPLEMENTATION
````

Verification rules: (1) grep every code-change claim — missing symbol = `⛔ UNVERIFIED`,
step ⏳; (2) cross-reference step markers — "implemented" on a CORE step = contradiction;
(3) no doc-only code-change resolutions; (4) re-verify EVERY Resolution's own text against
the document, doc-only or not, word-for-word in every named location — three names, two
edits = not closed.

### Phase 11 — Finalize

1. Bump the frontmatter version.
1. No Reachability Ledger? Append an empty one.
1. Grep-verify code-change resolutions; re-read doc-only resolutions one final time.
1. Step-markers: every step `⏳ pending` — reset premature `✅ CORE`/`WIRED`/`[x]` (exempt
   prior-phase shipped steps).
1. `deno run --allow-read --allow-write scripts/markdown_lint.ts exaix-dev-docs/planning/<doc>`.
   Re-ran `--fix`? Re-verify every `# step-manifest` yaml fence keeps `step: N` via
   `deno run --allow-read scripts/check_step_manifests.ts <doc>`.

## Output format

1. Chat summary: gaps by severity, in-place fixes, implementable verdict.
1. Gap summary table.
1. Confirmation the doc was updated (fixes + gap sections + actions list).
1. Version bump confirmation.
1. Blocking issues.

---
exaix:
  skill_id: pre-gap-analysis
  related_skills: [plan, remediate-plan-gaps, test-development]
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
