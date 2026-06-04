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
version: "1.2"
topics: ["planning", "gap-analysis", "architecture", "risk", "quality", "security", "tdd"]
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
- A security feasibility check (Phase 6) is mandatory for every step that
  touches input handling, auth, path resolution, secrets, or external data.
  Security gaps use the 🔒 severity symbol and are always prioritised above
  🟡 Feasibility.
- A traceability & configurability check (Phase 7) is required for every step
  that introduces new EventLogger events, thresholds, timeouts, or opt-in
  features. Untyped events and hardcoded values are gaps.
- When verifying more than ~20 source files, work in batches of 5–10: read a batch, record findings, then continue.
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
- ✅ Do read every source file cited in the planning document — never trust
  the plan's description of what a file contains.
- ✅ Do follow every input/output data-flow chain end-to-end.
- ✅ Do check constructor signatures for every newly injected dependency.
- ✅ Do verify Zod schemas have .default() on every optional new field.
- ✅ Do check that every new interface is exported from an index/barrel file.
- ✅ Do look for magic numbers/strings that belong in constants.
- ✅ Do classify every gap with a severity symbol (🔴 Critical / 🔒 Security /
  🟡 Feasibility / 🟠 Testing / 🔵 Conceptual) so the team can triage quickly.
- ✅ Do include a numbered gap summary table before the detailed gap entries.
- ✅ Do run Phase 6 security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do write all gaps and a Pre-Implementation Actions list into the document.
- ✅ Do bump the document version after writing gaps in.
- ✅ Do use any additionally supplied documents as context.
- ✅ Do run Phase 7 traceability & configurability checks on every step that
  introduces new `EventLogger` events, thresholds, timeouts, or opt-in features.
- ✅ Do run Phase 5 scenario framework coverage checks on every step that
  affects the request → plan → execution → review → memory → update flow.
- ❌ Don't mark a step gap-free unless its data sources, types, and tests are
  fully specified.
- ❌ Don't skip Phase 2 architectural alignment for any planning document —
  even if the plan seems straightforward.
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

Related skills:
- #plan             — Draft a new phase planning document from scratch (precedes this skill)
- #next-steps       — Execute the plan step-by-step after analysis is clean (follows this skill)
- #post-gap-analysis — Deep post-implementation review (code already written)
- #commit           — Create a structured commit after gap fixes

Workflow chain (typical):
  #plan → **#pre-gap-analysis** → #next-steps → #post-gap-analysis → #commit
```

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

1. **Map every claimed improvement to existing infrastructure.**
   For each stated goal or improvement in the plan, answer:
   - Does this capability already exist in a shipped Phase? (check Phases 37,
     64, 65, 82, 84, and any others relevant to the plan's domain.)
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

### Phase 3 — Source Verification

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

---

### Phase 4 — Standards Compliance Check

1. **Check plan structure against `.copilot/planning/README.md`.**
   For every step, verify it contains all four §F sub-sections:
   - `Actions` — explicit file paths and the changes to make
   - `Architecture Notes` — DI / constructor / pattern rationale
   - `Planned Tests` — named unit and integration tests (not just "add tests")
   - `Success Criteria` — measurable, objective outcomes

   A step missing any sub-section is a gap (severity depends on which one).

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

- Event naming, payload typing, audit chain completeness, event assertions.
- Config-driven vs. constant-driven values, config schema declaration,
  feature enable/disable path, config validation tests.

---

### Phase 8 — Gap Classification

Classify every gap:

| Symbol         | Meaning                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| 🔴 Critical    | Blocks implementation — plan is contradictory or a required symbol is missing |
| 🔒 Security    | Security control unspecified or missing (OWASP Top 10)                        |
| 🟡 Feasibility | Risky assumption or unspecified algorithm — needs a design decision           |
| 🟠 Testing     | Missing or under-specified test — step may ship without coverage              |
| 🔵 Conceptual  | Minor ambiguity or style issue — low risk, but should be clarified            |

Build a gap summary table before detailed entries.

---

### Phase 9 — Write Gaps Into the Document

Append at the end of the planning document using the exact format below.

#### Required markdown format

```markdown
---

## Pre-Gap Analysis — <ISO date> — Verdict: ⚠️ GAPS FOUND / ✅ READY TO IMPLEMENT

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

1. 🔴 [GAP-1] <action>
2. 🔒 [GAP-2] <action>
3. 🟡 [GAP-3] <action>
```

---

### Phase 10 — Finalize

1. Bump the document version in frontmatter.
1. Run `deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>`.

---

## Output format

1. Brief chat summary: total gaps by severity and whether the plan is safe to implement.
1. Gap summary table — one row per gap (step, severity, description).
1. Confirmation that the planning document was updated with the gap sections and Pre-Implementation Actions list.
1. Version bump confirmation — the document version was bumped in frontmatter.
1. Any blocking issue that must be resolved before implementation can begin.
