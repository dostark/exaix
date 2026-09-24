---
name: review-phase-code
agent: senior-coder
tools:
  - read_file
  - patch_file
  - search_files
  - run_command
scope: dev
title: "Post-Gap Analysis Skill (#review-phase-code)"
description: Deep post-implementation review of a phase planning document — verifies what was built against the plan, delegates code quality review to #review-code, finds gaps, and writes remediation steps back into the document
short_summary: "Deep review of an existing phase planning document: checks implementation against plan, delegates code quality to #review-code, finds gaps, and writes remediation steps back into the document."
version: "1.9.1"
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
qwen_skill: review-phase-code
---

```text
Key points

- POST-implementation review: verify what was built against what the plan promised.
- Derive the required outcomes from the problem statement independently of the plan's completed step criteria;
  falsify each with production evidence + an adversarial case.
- A documented limitation/deferral/workaround is NOT resolved just because it is tracked —
  it stays a gap when it prevents a required outcome.
- Read the plan, then every source file it references.
- Check every done criterion/test (`- ✅ <text> → `path`` / `✅ WIRED`/`✅ CORE`) against
  real code, not the plan's prose. A `✅ → path` whose path does not implement it is a gap;
  a `⚠️ deferred` must have a live Reachability Ledger row.
- Supplied documents are context — use, not ignore.
- Classify gaps by severity and write them INTO the plan (appended), not just chat.
- New remediation steps use the planning README §F TDD-First format, numbered after the
  last existing step; a §3D documentation step is last when interfaces/schemas/CLI change.
- Bump the doc version and set Status to "🚧 Gap Remediation In Progress".
- Phase 2a semantic value verification on every step adding event/schema/response fields —
  values correct, not just present. Correlation/identity/provenance/status: verify the
  canonical persisted or indexed field, not an identically named payload.
- Phase 2b integration-surface audit on every new interface/output field — dead fields are
  gaps. Run `deno task check:reachability-ledger <plan-doc>` first as a mechanized pass.
- Phase 2c module-convention probe on modified/created files.
- Phase 5 security check on input/auth/path/secrets/external-data steps.
- Phase 6 traceability & configurability on EVERY step — run `check:event-coverage` first
  (advisory), verify findings by hand; a state change/cross-component call with no event is
  a gap even if the step never claimed one. A load-bearing component with no `@visible` tag
  proposed → 🔵 Conceptual. A finding on an `@visible`-tagged class is 🔴 Critical.
- Delegate code-quality review to #review-code (Phase 7) — don't duplicate.
- Reviewing > ~20 source files: batches of 5–10.

Canonical prompt (short):
"Deep-review exaix-dev-docs/planning/phase-NN-*.md against the actual codebase.
Find all gaps between plan claims and implementation, write them into the
document with remediation steps."

Examples
- "#review-phase-code exaix-dev-docs/planning/phase-63-flow-error-recovery.md"
- "#review-phase-code exaix-dev-docs/planning/phase-64-flow-namespace-blackboard.md
   Additional context: ARCHITECTURE.md, packages/flow/src/flow_runner.ts"

Do / Don't
- ✅ Read actual source — never trust the plan's description.
- ✅ Verify every criterion against real code and test files.
- ✅ Cross-check each step against README §F (Actions/Notes/Tests/Criteria).
- ✅ Classify gaps 🔴 Critical / 🔒 Security / 🟡 Feasibility / 🟠 Testing / 🔵 Conceptual.
- ✅ Verify values, not presence (Phase 2a).
- ✅ Derive outcomes independently and record falsification evidence.
- ✅ Exercise lifecycle alternatives — success, failure, cancellation, abandonment, early
  exit — not just happy path + thrown error.
- ✅ Verify canonical persisted/indexed values for correlation/identity/provenance/status.
- ✅ Trace output fields to consumers (Phase 2b); run `check:reachability-ledger` first.
- ✅ Check new code against module conventions (Phase 2c).
- ✅ Run Phase 5 on input/auth/path/secrets/external-payload steps.
- ✅ Include a numbered gap summary table.
- ✅ Write remediation steps in the full §F template.
- ✅ Add a §3D documentation step last on interface/schema changes.
- ✅ Bump the version and update frontmatter Status.
- ✅ End every remediation step with a step-manifest; verify with
  `deno run --allow-read scripts/check_step_manifests.ts <plan>`.
- ✅ Use supplied documents as context.
- ✅ Run Phase 6 on every step (`check:event-coverage` first, hand-verify findings; an
  `@visible` finding is 🔴). For a tagged class: a non-DomainEventType action is a gap even
  with a call; multi-event operations pass the trace ID as the logger's 4th arg each time;
  streaming/generator methods have a terminal event for early cancellation.
- ✅ Run Phase 4 scenario coverage on flow-affecting steps.
- ✅ Derive the source-declared event inventory independently when the phase claims
  exhaustive observability coverage and reconcile it one-for-one against runtime evidence —
  one representative event per component is not enough.
- ✅ Delegate Phase 7 (lint/fmt/TS/defensive/perf/deps) to #review-code — do not re-check.
- ❌ Mark a step gap-free without verifying its test files.
- ❌ Skip Phase 5 on external-data/path steps.
- ❌ Invent remediation steps for code that exists and passes.
- ❌ Report gaps only in chat — write them into the doc.
- ❌ Skip the gap summary table.
- ❌ Renumber existing steps — new ones continue the sequence.
- ❌ Accept hardcoded thresholds/timeouts — named constants or config fields.
- ❌ Accept a tracked limitation that prevents a required outcome.
- ❌ Skip event payload typing.
- ❌ Re-run #review-code's checklists — use its report.

Related: #review-phase-plan; #plan; #next-steps; #commit; #review-code (Phase 7);
test-development.

Workflow chain: #plan → #review-phase-plan → #next-steps → **#review-phase-code** → #commit
```

## See also

- [plan](../plan/SKILL.md) — structure, remediation step format
- [review-phase-plan](../review-phase-plan/SKILL.md) — pre-implementation analysis
- [remediate-code-gaps](../remediate-code-gaps/SKILL.md) — closing code-level steps

---

## Instructions for Agent

Deep post-implementation review. Output: (1) a chat summary; (2) edits written directly
into the plan — gap table, detailed gap entries, and numbered remediation steps appended.

### Phase 1 — Ingest

Read the whole plan: version, status, every step + completion marker, every path/symbol.
Read supplied documents as ground-truth. Read the problem statement, executive summary,
goal, and success metrics as requirements in their own right — not superseded by a done step.

### Phase 1b — Required Outcome & Falsification Matrix

Derive the system-level outcomes the problem statement requires, INDEPENDENTLY of done
criteria:

| Required outcome      | Production evidence                        | Adversarial case      | Verdict     |
| --------------------- | ------------------------------------------ | --------------------- | ----------- |
| <observable property> | <real call path / stored value / consumer> | <the way it can fail> | ✅ / gap ID |

Use outcomes materially implied by the phase's problem statement, executive summary, goal,
interfaces, or metrics. Example adversarial cases: cancellation, abandonment, and early exit for a
lifecycle; partial completion for multi-stage; invalid-but-well-typed value for a
constrained output. A done step does not prove an outcome — if an outcome can fail while
every criterion passes, it needs its own trace + probe. A tracked limitation stays a gap if
it prevents a required outcome.

### Phase 2 — Implementation Verification

Every completed step: verify the implementation exists, the planned tests exist and pass,
and each criterion is met against real code. Every incomplete step: check it wasn't
implemented anyway with the plan un-updated (🔵 Conceptual).

### Phase 2a — Semantic Value Verification

Per new/modified field in events, schemas, config, API responses:

1. Value correct, not just present — consistent with injected deps, config, state.
1. Cross-validate against component capabilities — trace constructor → emission.
1. Canonical storage/lookup: for correlation/identity/provenance/status/routing/auth,
   trace through the write and read boundary; a payload/log/cache match is not proof.

### Phase 2b — Integration Surface Audit

Per new interface/type/output field:

1. Grep for consumers; zero readers = dead data (🟠 if test-only, 🔵 if prod-unused).
1. Trace each consumer end-to-end; a claimed adjacent-service integration must be wired.
1. Orphaned interface slices: plan says component X reads the field but it never does —
   🔴 if a required integration, 🔵 if forward-compat-only.
1. Verify constructor wiring: every new class imported + instantiated by a production
   consumer. Test-only instantiation = production-dead (🔴 if the plan requires it, 🔵 if
   intentional-undocumented). Services inject via DI or register in factory/registry/
   bootstrap, or they are dead regardless of test counts.
1. Audit the Reachability Ledger against real call-sites, not its own prose: run
   `deno task check:reachability-ledger <plan-doc>` first — it greps ✅ rows' call-site cells
   for non-test references. Advisory (misses dynamic dispatch, can false-positive on an
   unguarded entrypoint) — verify flagged rows by hand, first not last.
1. Reconcile declared limitations with required outcomes — a deferral explains absence, it
   does not prove the phase solves its problem.

### Phase 2c — Module Convention Probe

Per modified/created file: survey 5–10 same-concern examples; divergence = 🔵 Conceptual;
intentional divergence needs an Architecture-Note justification or it is underspecified.

### Phase 3 — Standards Compliance

Check every step has all §F sub-sections and §3D doc compliance.

### Phase 4 — Scenario Framework Coverage

For flow-affecting steps: verify scenarios exercise the behavior, check assertions, decide
on new scenarios. Journal/event assertions: a missing required field must FAIL the assertion
(no non-empty container holding `undefined`); require request-trace scoping whenever the scenario claims correlation — a globally found
event is not evidence the request under test emitted it. Exhaustive-event claims: build an
exact inventory from production declarations; add a reconciliation table; every row cites a
test driving the real component through the real `EventLogger` asserting action + trace +
semantic payload; totals reconcile. For lifecycle/streaming/transaction/retry operations,
enumerate terminal alternatives (completion, failure, cancellation, abandonment, early
exit) and verify each has its observable outcome + test where behavior is new.

### Phase 5 — Security Gap Analysis

Per step touching input, FS, auth, secrets, network, process, shared state: verify the nine
checklist items; each failure is 🔒.

### Phase 6 — Traceability & Configurability

Run `deno task check:event-coverage` as the mechanized first pass (wired-but-silent logger;
state-changing/cross-component method with no adjacent event). Advisory (see the module
header's false-positive sources) — verify by hand UNLESS the class is `@visible` (then 🔴
without further triage). The `@visible` escalation also covers a tagged class whose primary
events lack a real Tier A/B runtime test — Gate 19 proves only the static shape, not that
the event fires with a real payload/trace (one component's events never fired because the
logger was never injected). For every new-behavior step: verify event naming, typed
payloads, audit chain completeness, test assertions, and config-driven vs constant values,
schema declaration, enable/disable path, validation tests. A described state change with no
implemented event is a gap even if the criteria never claimed one. A load-bearing component
with no `@visible` awareness → 🔵 Conceptual.

### Phase 7 — Code Quality Review

Delegated to `#review-code`. Run it on every touched source file; a finding INTRODUCED by
this phase's implementation is a gap classified per below — use #review-code's report, do
not re-evaluate.

### Phase 8 — Gap Classification

| Symbol         | Meaning                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critical    | Blocks correctness; fail-open security; circular dependency; type-safety runtime error                                                 |
| 🔒 Security    | OWASP violation; missing control; leak without cleanup; unbounded memory; missing timeout; traversal; silent swallow in sensitive path |
| 🟡 Feasibility | Unverifiable/risky claim; sync I/O in async path; missing fallback crash; redundant I/O                                                |
| 🟠 Testing     | Missing/underspecified test; bare catch{}; budget-check after completion; uncovered edge                                               |
| 🔵 Conceptual  | Minor mismatch; missing doc marker; style divergence; unused export; flattenable import; missing import type                           |

Build a gap summary table before detailed entries.

### Phase 9 — Write Gaps and Remediation Steps Into the Document

Append using exactly:

````markdown
---

## Post-Gap Analysis — <ISO date> — Verdict: ⚠️ GAPS FOUND / ✅ IMPLEMENTATION COMPLETE

<!-- GAP-N numbering is scoped to THIS Post-Gap section; a pre-existing Pre-Gap section's
     GAP-1..GAP-M is a separate numbering scope — do not renumber or continue it. -->

### Required Outcome & Falsification Matrix

| Required outcome | Production evidence | Adversarial case | Verdict |
| ---------------- | ------------------- | ---------------- | ------- |

### Gap Summary

| # | Step | Severity | Description |
| - | ---- | -------- | ----------- |

### Gap Detail

#### GAP-1 — 🔴 Critical — Step N: <title>

**Finding:** <detailed explanation>
**Expected (plan says):** <quoted plan text>
**Actual (code shows):** <reality>
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

```yaml
# step-manifest
step: <N+1>
title: "<remediation step title>"
agent_role: senior-coder
skills: [portal-grounding]
portal: exaix-self
target_branch: feat/phase-NN
depends_on: [<previous step>]
acceptance:
  tests:
    - "<the step's key planned test>"
  outcomes:
    - "<the observable outcome>"
```
````

Every remediation step MUST end with a step-manifest (same shared `target_branch`); the
pre-commit gate rejects the commit with "A phase
plan step is missing or has an invalid step-manifest" otherwise, at commit time only. Author criteria as
`- [ ] <text>` and tests as `` `<name>` `` (aspirational, no `→` path) — #next-steps rewrites
met items to the done form; the gate blocks any `- [ ]` left in a committed step.

### Phase 10 — Finalize

1. Bump the frontmatter version.
1. Set Status to `🚧 Gap Remediation In Progress`.
1. Run markdown lint.

## Output format

1. Chat summary: gaps by severity + plan health.
1. Gap summary table.
1. Confirmation the plan got §F remediation steps.
1. Blocking critical/security gaps needing immediate attention.
1. Commit payload. Findings-only doc edit → normal docs commit (submodule-first). A
   remediation commit that ALSO marks criteria/tests done → plan-step commit with
   `plan: <doc>#<step>` via `scripts/commit_plan_step.ts <msg> --commit`.

---
exaix:
  skill_id: review-phase-code
  related_skills: [review-code, remediate-code-gaps, test-development]
  triggers:
    keywords: [post-gap, implementation-review, post-implementation]
    task_types: [planning, review]
    tags: [post-gap, review]
  constraints:
    - "Verify what was built matches the plan"
    - "Falsify problem-statement outcomes independently of completed plan criteria"
    - "Delegate code quality review to review-code skill"
    - "Write remediation steps back into the plan document"
    - "Run semantic value verification on events, schemas, responses"
    - "Verify canonical persisted or indexed values for correlation, identity, provenance, status, routing, and authorization"
    - "Run integration surface audit — dead fields with no consumers are gaps"
  output_requirements:
    - "Gap summary table with findings per step"
    - "Required Outcome & Falsification Matrix with production evidence and an adversarial case per outcome"
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
