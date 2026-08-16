---
name: post-gap-analysis
agent: senior-coder
tools:
  - read_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Post-Gap Analysis Skill (#post-gap-analysis)"
description: Deep post-implementation review of a phase planning document — verifies what was built against the plan, delegates code quality review to #review-code, finds gaps, and writes remediation steps back into the document
short_summary: "Deep review of an existing phase planning document: checks implementation against plan, delegates code quality to #review-code, finds gaps, and writes remediation steps back into the document."
version: "1.7.0"
topics: [
  "planning",
  "gap-analysis",
  "review",
  "tdd",
  "architecture",
  "quality",
  "security",
  "code-style",
  "typescript",
  "performance",
]
qwen_skill: post-gap-analysis
---

```text
Key points
- This is a POST-implementation review, not a pre-implementation gap analysis.
  Verify what was actually built against what the plan promised.
- Read the planning document first, then read every source file it references.
- Check every step whose criteria/tests are marked done (`- ✅ <text> → ` `` `path` ``)
  or that carries a `✅ WIRED`/`✅ CORE` status label against the real
  code, not against the plan's description. A criterion/test marked `✅ → path` whose
  named path does not actually implement it (or is not the file that was changed) is a
  gap. A `- ⚠️ deferred <text> → ` `` `token` `` item must have a live Reachability
  Ledger row for that token — a deferral with no ledger row (or a ledger row silently
  dropped) is a gap.
- Any additionally supplied documents (architecture references, prior phase
  plans, design specs) must be used as context — not ignored.
- Gaps must be classified by severity and written INTO the planning document
  itself (appended after existing content), not just reported in chat.
- New remediation steps must follow the exact TDD-First format required by
  .copilot/planning/README.md §F: Actions, Architecture Notes, Planned Tests,
  Success Criteria. They must be numbered sequentially after the last
  existing step.
- A documentation update step (matching §3D of the planning README) must be
  included as the final new step whenever interface, schema, or CLI behaviour
  gaps are remediated.
- Bump the document version (e.g., 1.2 → 1.3) and update the Status line
  to "🚧 Gap Remediation In Progress" after writing gaps into it.
- Run a semantic value verification (Phase 2a) on every step that adds fields
  to events, schemas, or responses — verify values are correct, not just present.
- Run an integration surface audit (Phase 2b) on every step that introduces a
  new interface or output field — dead fields with no consumers are gaps.
  Run `deno task check:reachability-ledger <plan-doc-path>` first, as a mechanized
  first pass over every ✅ Reachability Ledger row — advisory, not a replacement for
  the manual grep.
- Run a module convention probe (Phase 2c) on every step that modifies or
  creates source files — new code should match the existing module's dominant
  style.
- Run a security gap check (Phase 5) on every step that touches input
  handling, auth, path resolution, secrets, or external data.
- Run a traceability & configurability check (Phase 6) on every step — not only ones
  that already mention new EventLogger events. Run `deno task check:event-coverage`
  first as a mechanized first pass (advisory, like `check:reachability-ledger`); for
  every finding on a file the step touched, verify by hand whether the step's state
  change or cross-component call really lacks an event, or new hardcoded thresholds/
  opt-in flags exist. If a step built a component load-bearing for observability with no
  `@visible` tag proposed anywhere in the plan, flag a 🔵 Conceptual gap — see #plan §2H.
  Any coverage finding on a class that IS `@visible`-tagged is 🔴 Critical, not advisory —
  the tag is an explicit, already-made commitment.
- Delegate code quality review to #review-code (Phase 7) instead of
  duplicating style/TS/defensive/perf checks here.
- When reviewing more than ~20 source files, work in batches of 5–10: read a batch, record findings, then continue.

Canonical prompt (short):
"Deep-review .copilot/planning/phase-NN-*.md against the actual codebase.
Find all gaps between plan claims and implementation, write them into the
document with remediation steps."

Examples
- "#post-gap-analysis .copilot/planning/phase-63-flow-error-recovery.md"
- "#post-gap-analysis .copilot/planning/phase-64-flow-namespace-blackboard.md
   Additional context: ARCHITECTURE.md, packages/flow/src/flow_runner.ts"

Do / Don't
- ✅ Do read the actual source files — never trust the plan's description alone.
- ✅ Do verify every success criterion by inspecting real code and test files.
- ✅ Do cross-check each step against .copilot/planning/README.md §F
  requirements (Actions / Architecture Notes / Planned Tests / Success Criteria).
- ✅ Do classify every gap with a severity symbol (🔴 Critical / 🔒 Security /
  🟡 Feasibility / 🟠 Testing / 🔵 Conceptual) so the team can triage quickly.
- ✅ Do verify values, not just presence — a field existing with the wrong value is a gap (Phase 2a).
- ✅ Do trace output fields to their consumers — dead fields with no readers are gaps (Phase 2b).
- ✅ Do run `check:reachability-ledger` as a first pass on every ✅ ledger row, then verify its findings by hand
  (Phase 2b) — it is advisory, not authoritative.
- ✅ Do check new code against existing module conventions — inconsistency within a file is a gap (Phase 2c).
- ✅ Do run Phase 5 security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do include a numbered gap summary table before the detailed gap entries.
- ✅ Do write new remediation steps using the full §F TDD-First template.
- ✅ Do add a documentation update step last (§3D) when interfaces or
  schemas change.
- ✅ Do bump the document version and update the Status field in the frontmatter.
- ✅ Do use any additionally supplied documents as context.
- ✅ Do run Phase 6 traceability & configurability checks on every step — run
  `deno task check:event-coverage` as a mechanized first pass, then verify findings
  on the step's touched files by hand; a state change or cross-component call with no
  event is a gap even if the step's Success Criteria never claimed to add one. Escalate
  any finding on an `@visible`-tagged class to 🔴 Critical.
- ✅ Do run Phase 4 scenario framework coverage verification on every step that
  affects the request → plan → execution → review → memory → update flow.
- ✅ Do delegate all code quality checks (lint, fmt, TS idiomacy, defensive
  programming, performance, dep hygiene) to #review-code Phase 7 — do not
  re-check from scratch.
- ❌ Don't mark a plan step as gap-free unless you verified its test files.
- ❌ Don't skip Phase 5 for steps that handle external data or file paths.
- ❌ Don't invent remediation steps for code that already exists and passes.
- ❌ Don't report gaps only in chat — they MUST be written into the document.
- ❌ Don't skip the gap summary table — it is required for agent traceability.
- ❌ Don't renumber existing steps — new steps continue from the last existing
  step number.
- ❌ Don't accept hardcoded threshold or timeout literals — they must be named
  constants in `packages/core/src/types/constants.ts` or config-schema fields.
- ❌ Don't skip event payload typing — untyped events block audit chain
  verification and make integration tests fragile.
- ❌ Don't re-run the #review-code checklists in Phase 7 — delegate to
  #review-code and use its report; duplicating creates inconsistency.

Related skills:
- #pre-gap-analysis — Pre-implementation gap analysis (no code to check yet)
- #plan              — Draft a new phase planning document from scratch
- #next-steps        — Re-enter the TDD loop to remediate gaps found here
- #commit            — Create a structured commit after remediation
- #review-code       — Code quality review (style, TS idiomacy, defensive,
                       performance, deps) — Phase 7 delegates here
- [test-development](../test-development/SKILL.md) — Edge case coverage requirements, test helpers, placement rules

Workflow chain (typical):
  #plan → #pre-gap-analysis → #next-steps → **#post-gap-analysis** → #commit
```

## See also

- [plan](../plan/SKILL.md) — plan structure, remediation step format
- [pre-gap-analysis](../pre-gap-analysis/SKILL.md) — complementary pre-implementation analysis
- [remediate-code-gaps](../remediate-code-gaps/SKILL.md) — closing code-level remediation steps

---

## Instructions for Agent

You are performing a **deep post-implementation review** of the phase planning
document provided. Your output has two parts:

1. **A chat summary** — brief findings overview.
1. **Edits written directly into the planning document** — gap table, detailed
   gap entries, and numbered remediation steps appended after the last existing
   section.

---

### Phase 1 — Ingest

Read the planning document in full: version, status, every step and its
completion marker, every file path and symbol. Read all additionally supplied
documents as ground-truth context.

---

### Phase 2 — Implementation Verification

For **every completed step**: verify the actual implementation exists, the
planned tests exist and pass, and every success criterion is met by inspecting
real code.

For **every incomplete step**: check whether it was implemented anyway but the
plan not updated (document gap, 🔵 Conceptual).

---

### Phase 2a — Semantic Value Verification

For **every field** in events, schemas, config, or API responses introduced
or modified by the step:

1. **Verify the value is correct, not just present.**
   Confirm each field's runtime value is consistent with the component's
   injected dependencies, configuration, and operational state. A field
   that always resolves to a specific value due to the component's
   construction should not report a contradictory value. Presence alone
   is insufficient.

1. **Cross-validate against component capabilities.**
   For every field whose value depends on a dependency or configuration flag:
   trace the dependency chain from constructor to emission point and verify
   the field's value matches what the dependency chain dictates.

---

### Phase 2b — Integration Surface Audit

For **every interface, type, or output field** the step introduces:

1. **Grep the codebase for consumers.**
   For each exported symbol or field the step adds, search the codebase for
   importers, callers, and readers. A symbol with zero consumers is dead data
   and should be flagged (🟠 Testing if unused in tests, 🔵 Conceptual if
   unused in production).

1. **Trace every consumer path end-to-end.**
   For each consumer found, verify the data flow completes — the consumer
   receives the value in the expected format and can act on it. If a path
   claims integration with an adjacent service, verify that service is
   actually wired and called.

1. **Flag orphaned interface slices.**
   If the step defines a field that the plan's prose says will be consumed by
   a specific component, but that component never reads the field, flag the
   gap (🔴 Critical if a required integration is missing, 🔵 Conceptual if
   the field is forward-compatibility-only).

1. **Verify constructor wiring for new services and classes.**
   For every new class, service, or data structure the step introduces:
   - Grep the production codebase (excluding tests and test helpers) for
     importers and instantiation sites. The class must be imported and its
     constructor called by at least one production consumer.
   - If the class is only instantiated in tests, it is production-dead code
     and should be flagged (🔴 Critical if the integration is required by
     the plan, 🔵 Conceptual if intentional but undocumented).
   - If the class is a service, verify it is either injected via constructor
     DI into a production consumer or registered in the appropriate factory /
     registry / bootstrap module. Services that exist solely as definitions
     with no wiring path are dead regardless of how many tests create them.

1. **Audit the plan doc's Reachability Ledger against real call-sites, not against its
   own prose.** Run `deno task check:reachability-ledger <plan-doc-path>`
   (`scripts/check_reachability_ledger.ts`) first — it parses every ✅ ledger row's
   "Production call-site" cell for identifier/filename mentions and greps for a real
   non-test reference outside the definition file. This exists because phase-158's
   2026-08-04 post-gap analysis found six ✅ rows whose narrated call-site
   (`computePairedComparison`, `evaluateValidityGate`, and the Step 4–6
   skill/identity/flow reporting modules) was never actually invoked by any committed
   code — a manual grep is what caught it, and this mechanizes that grep so it does
   not depend on remembering to do it by hand. It is advisory (free-text heuristics
   both miss dynamic-dispatch/registry-based wiring and can false-positive on an
   entrypoint script that omits the `import.meta.main` guard), so every finding still
   needs the manual G1-style verification above before it becomes a GAP entry — but a
   row the tool flags is a row to check first, not last.

---

### Phase 2c — Module Convention Probe

For **every file the step modifies or creates**:

1. **Survey the dominant convention in the existing file.**
   Before evaluating whether the new code is well-structured, read 5–10
   existing examples of the same concern (event emission, error handling,
   import style, type usage) in the same file or module.

1. **Check the new code against that convention.**
   If the existing file uses one pattern for a concern (event emission,
   error handling, type usage, import style) and the new code uses a
   different pattern, flag divergence (🔵 Conceptual). Both approaches
   may be syntactically valid and pass lint, but inconsistency within a
   module creates maintenance debt.

1. **Justify intentional divergence.**
   If the plan explicitly chooses a different convention, verify the
   Architecture Notes justify why. Without justification, flag as
   underspecified (🔵 Conceptual).

---

### Phase 3 — Standards Compliance Check

Check every step for all four §F sub-sections (Actions / Architecture Notes /
Planned Tests / Success Criteria). Check §3D documentation update compliance.

---

### Phase 4 — Scenario Framework Coverage Verification

For every step affecting the request → plan → execution → review → memory → update
flow: verify existing scenarios exercise the behaviour, check scenario assertions,
determine if new scenarios are needed.

---

### Phase 5 — Security Gap Analysis

For every step touching input parsing, file-system access, auth, secrets,
network calls, process execution, or shared mutable state — verify the nine
security checklist items. Each failure is a 🔒 Security gap.

---

### Phase 6 — Traceability & Configurability Check

Run `deno task check:event-coverage` (`scripts/check_event_coverage.ts`) as a
mechanized first pass — it AST-scans the step's touched files for (a) a class wired
to an `IEventLogger`/`IEventRegistry` dependency that never calls it, and (b) a
state-changing or cross-component-call method with no adjacent event. It is advisory,
like `check:reachability-ledger` (see the script's module header for known
false-positive sources: an event emitted by a caller instead of the flagged method, a
private helper one level removed, dynamic dispatch) — every finding needs manual
verification before it becomes a GAP entry, UNLESS the flagged class carries the
`@visible` JSDoc tag (#plan §2H) — a finding there is 🔴 Critical without further
triage, since the tag is the codebase's own explicit declaration that this component's
coverage is required, not a heuristic guess.

For every step introducing new behaviour, whether or not the tool flagged it: verify
event naming, payload typing, audit chain completeness, event assertions in tests;
verify config-driven vs. constant-driven values, config schema declaration, feature
enable/disable path, config validation tests. A state change or cross-component call
the plan's Actions describe with no corresponding event anywhere in the
implementation is a gap, independent of whether the step's own Success Criteria
claimed to add one. Also verify: did the step build a component that is genuinely
load-bearing for observability (critical-path or security-sensitive) without proposing
the `@visible` tag? Flag as 🔵 Conceptual — the implementation should have made this
decision explicit, matching #plan §2H's own guidance.

---

### Phase 7 — Code Quality Review

> **Delegated to `#review-code`.** The detailed code quality dimensions (style
> conventions, TypeScript idiomacy, defensive programming, performance, and
> dependency hygiene) are owned by the `#review-code` skill. Run it on every
> source file the step modifies or creates:
>
> ```
> #review-code packages/<package>/src/<file>.ts
> ```
>
> The `#review-code` skill checks, in order:
>
> - **Phase 4** — Architecture, Style & Conventions (module headers, interface
>   naming, import style, magic values, Record types, EventLogger, exports)
> - **Phase 5** — TypeScript Idiomacy & Type Safety (type annotations,
>   exhaustive conditionals, async/await hygiene, null safety, discriminated unions)
> - **Phase 6** — Defensive Programming & Error Robustness (input validation,
>   fail-closed, fallback chains, resource cleanup, timeout enforcement)
> - **Phase 7** — Performance & Dependency Hygiene (sync I/O, redundant parsing,
>   memory bounds, unused imports, circular deps, dependency footprint)
>
> A finding in any of these dimensions that was **introduced by this phase's
> implementation** is a gap — classify using the severity table in Phase 8 below.
> Use the gap classification from `#review-code`'s report directly; do not
> re-evaluate from scratch.

---

### Phase 8 — Gap Classification

| Symbol         | Meaning                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critical    | Blocks correctness — code diverges from plan in a breaking way. Also: fail-open on security check, circular dependency, missing type safety that causes runtime error.                                                                |
| 🔒 Security    | Security vulnerability or missing security control (OWASP Top 10). Also: resource leak without cleanup, unbounded memory on untrusted input, missing timeout, path traversal bypass, silent error swallow in security-sensitive path. |
| 🟡 Feasibility | Plan claim is unverifiable or implementation-risky. Also: sync I/O in async path blocking event loop, missing fallback causing hard crash, unnecessary parser initialisation, redundant I/O.                                          |
| 🟠 Testing     | Missing or under-specified test; implementation may ship uncovered. Also: bare `catch {}` discarding diagnostic info, budget-check running after completion, uncovered edge case.                                                     |
| 🔵 Conceptual  | Minor mismatch, missing doc marker, or style divergence. Also: unused export without consumer, multi-line import that fmt would flatten, missing `import type`.                                                                       |

Build a gap summary table before detailed entries.

---

### Phase 9 — Write Gaps and Remediation Steps Into the Document

Append at end of planning document using the exact format below.

#### Required markdown format

```markdown
---

## Post-Gap Analysis — <ISO date> — Verdict: ⚠️ GAPS FOUND / ✅ IMPLEMENTATION COMPLETE

### Gap Summary

| # | Step   | Severity    | Description            |
| - | ------ | ----------- | ---------------------- |
| 1 | Step N | 🔴 Critical | <one-line description> |
| 2 | Step N | 🔒 Security | <one-line description> |

### Gap Detail

#### GAP-1 — 🔴 Critical — Step N: <title>

**Finding:** <detailed explanation>
**Expected (plan says):** <quoted plan text>
**Actual (code shows):** <what is actually in the code>
**Impact:** <consequence if not fixed>

---

## Gap Remediation Plan

### Step <N+1>: Remediate GAP-1 — <title>

**Actions:**

- <file>: <specific change>

**Architecture Notes:** <DI / pattern rationale>

**Planned Tests:**

- `<test name>` — <what it verifies>

**Success Criteria:**

- <measurable criterion>
```

Author criteria as `- [ ] <text>` and tests as `` `<name>` `` (aspirational, no `→` path — the
implementing module is decided during execution). When #next-steps implements the remediation
step it rewrites each met item to `- ✅ <text> →` `` `<staged-path>` `` (or `- ⚠️ deferred
<text> →` `` `<LedgerSymbol>` ``), and the plan-step commit gate blocks any `- [ ]` left in the
committed step. See #next-steps steps 23–26.

---

### Phase 10 — Finalize

1. Bump document version in frontmatter.
1. Update Status line to `🚧 Gap Remediation In Progress`.
1. Run markdown lint.

---

## Output format

1. Brief chat summary: total gaps by severity and overall plan health.
1. Gap summary table — one row per gap (step, severity, description).
1. Confirmation that the planning document was updated with remediation steps in §F TDD-First format.
1. Any blocking critical or security gap requiring immediate attention.
1. Commit payload — after all remediation steps are written into the document, use
   `#commit` for the structured message. If the commit only appends gap findings /
   remediation-step definitions to the plan doc (no code implementing a step, no
   criterion/test flipped to `✅`), commit it as a normal docs commit (submodule-first per
   the submodule-workflow skill). But if a remediation commit ALSO implements a step —
   marking any criterion/test `- ✅ <text> →` `` `path` `` or `- ⚠️ deferred →` `` `token` `` —
   it is a plan-step commit: it MUST carry a `plan: <doc>#<step>` field and be committed via
   `scripts/commit_plan_step.ts <msg> --commit` so the plan-step gate runs (paths staged +
   backticked + added diff lines, ledger rows, no lingering `- [ ]`). See #next-steps step 26.

---
exaix:
  skill_id: post-gap-analysis
  related_skills: [review-code, remediate-code-gaps, test-development]
  triggers:
    keywords: [post-gap, implementation-review, post-implementation]
    task_types: [planning, review]
    tags: [post-gap, review]
  constraints:
    - "Verify what was built matches the plan"
    - "Delegate code quality review to review-code skill"
    - "Write remediation steps back into the plan document"
    - "Run semantic value verification on events, schemas, responses"
    - "Run integration surface audit — dead fields with no consumers are gaps"
  output_requirements:
    - "Gap summary table with findings per step"
    - "Detailed gap entries with Expected vs Actual"
    - "Remediation steps in TDD-First format"
    - "Documentation update step for interface/schema/CLI changes"
  quality_criteria:
    - name: plan_accuracy
      description: Each step verified against plan
      weight: 40
    - name: remediation_clarity
      description: Each gap has clear remediation steps
      weight: 30
    - name: delegation
      description: Code quality concerns delegated to review-code
      weight: 30
---
