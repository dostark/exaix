---
agent: senior-coder
scope: dev
title: "Planning Document Pre-Implementation Gap Analysis (#pre-gap-analysis)"
short_summary: "Deep gap analysis of a phase planning document before implementation begins: verifies the plan is complete, unambiguous, and safe to code against."
version: "1.0"
topics: ["planning", "gap-analysis", "architecture", "risk", "quality", "security", "tdd"]
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
- A security feasibility check (Phase 3b) is mandatory for every step that
  touches input handling, auth, path resolution, secrets, or external data.
  Security gaps use the 🔒 severity symbol and are always prioritised above
  🟡 Feasibility.
- Bump the document version (e.g., 1.0 → 1.1) after writing all gaps in.

Canonical prompt (short):
"Pre-gap-analyse .copilot/planning/phase-NN-*.md. Read every source file it
references and report every ambiguity, missing contract, and implementation
risk before we start coding. Write the gaps into the document."

Examples
- "#pre-gap-analysis .copilot/planning/phase-65-flow-scheduler.md"
- "#pre-gap-analysis .copilot/planning/phase-48-acceptance-criteria-propagation.md
   Additional context: ARCHITECTURE.md, src/flows/flow_runner.ts"

Do / Don't
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
- ✅ Do run Phase 3b security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do write all gaps and a Pre-Implementation Actions list into the document.
- ✅ Do bump the document version after writing gaps in.
- ✅ Do use any additionally supplied documents as context.
- ❌ Don't mark a step gap-free unless its data sources, types, and tests are
  fully specified.
- ❌ Don't skip Phase 3b for steps that handle external data or file paths —
  even if the plan did not mention security.
- ❌ Don't report gaps only in chat — they MUST be written into the document.
- ❌ Don't skip the gap summary table — it is required for agent traceability.
- ❌ Don't ignore backward-compatibility risk on schema changes.
- ❌ Don't assume tests cover a path — verify the plan's Planned Tests section
  explicitly names them.

Related templates:
- #post-gap-analysis — Deep post-implementation review (code already written)
- #plan             — Draft a new phase planning document from scratch
- #step             — Implement individual steps from the plan
- #review           — Code review of a finished feature (not plan-level)
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

### Phase 2 — Source Verification

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
   - Every threshold or limit is a named constant in `src/shared/constants.ts`,
     not a hardcoded literal.

1. **Verify cross-component ownership.**
   For every type or field shared between two or more components:
   - Is there a single authoritative definition?
   - Is it imported rather than duplicated?
   - Is the owning module's export path declared in the plan?

---

### Phase 3 — Standards Compliance Check

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
   name, timeout) that belongs in `src/shared/constants.ts`.

---

### Phase 3b — Security Feasibility Check

For **every step** that touches any of the following areas, apply the checklist
below. A finding is a gap classified 🔒 Security — always triaged above
🟡 Feasibility.

**Trigger areas** (check if the step modifies or introduces):

- Input parsing / deserialisation of external data (JSON, TOML, YAML, user input)
- File-system access, path construction, or directory traversal
- Authentication, authorisation, or permission checks
- Secrets / credentials / API keys (storage, logging, transmission)
- Network calls or HTTP response handling
- Process/command execution (`Deno.Command`, `eval`-like patterns)
- Shared mutable state accessed by multiple async paths

**Security checklist** — one finding per unspecified or missing item:

1. **Input validation** — Does the plan specify a strict Zod schema (or
   equivalent) to validate all external input before use, with unexpected
   fields stripped?

1. **Path traversal** — Does the plan route every file-system path through
   `PathResolver` (or equivalent allow-list check)? Does it reject `../`
   sequences and absolute paths originating from user data?

1. **Secret handling** — Does the plan explicitly prohibit logging secrets,
   including them in error messages, writing them to plain-text files, or
   storing them in source code?

1. **Injection** — Does the plan build all shell commands from a fixed argument
   array (no string interpolation)? Are SQL/template literals parameterised?

1. **Auth boundary** — Does the plan gate every protected action with an
   explicit authorisation check performed before any side effect?

1. **Error leakage** — Does the plan require that error messages returned to
   callers omit internal stack traces and file paths?

1. **Concurrency & TOCTOU** — If the plan reads then writes shared state across
   separate async steps, does it specify a mutex or equivalent guard?

1. **Dependency trust** — If the step adds new third-party imports, does the
   plan pin them to a specific version or hash?

1. **Security tests** — Does the plan name at least one negative test (malformed
   input, path escape attempt, oversized payload) for each new security boundary?

For each unspecified item, produce a gap entry using severity 🔒 Security:

```text
#### G{N}: {short title}  🔒 Security
- **Checklist item:** {item number and name above}
- **Location in plan:** Step N.M — "{quoted sentence from plan}"
- **Problem:** {what the plan omits or leaves unspecified}
- **Impact:** {attack vector or data-exposure risk if left unresolved}
- **To fix:** {concrete one-sentence instruction referencing OWASP Top 10 where applicable}
```

---

### Phase 4 — Gap Classification

1. **Classify every gap** using the severity taxonomy:

| Symbol | Meaning |
| --- | --- |
| 🔴 Critical | Blocks implementation — plan is contradictory or a required symbol is missing |
| 🔒 Security | Security control unspecified or missing (OWASP Top 10) |
| 🟡 Feasibility | Risky assumption or unspecified algorithm — needs a design decision |
| 🟠 Testing | Missing or under-specified test — step may ship without coverage |
| 🔵 Conceptual | Minor ambiguity or style issue — low risk, but should be clarified |

1. **Build the gap summary table** (required):

```text
| ID | Gap (short) | Severity | Plan Section | Blocks Coding? |
|----|-------------|----------|--------------|----------------|
| G1 | ...         | Critical | Step N.M     | ✅ Yes          |
| G2 | ...         | Security | Step N.M     | ⚠️ Conditionally |
| G3 | ...         | Testing  | Step N.M     | ❌ No           |
```

---

### Phase 5 — Write Gaps Into the Document

Append the following sections **at the end of the planning document** in order:

#### 5a. Pre-Gap Analysis section header

```markdown
---

## Pre-Gap Analysis — {ISO date}

### Assessment: {short verdict, e.g., "Plan ready ✅" or "N gaps must be resolved before coding"}

> This section was added by pre-gap analysis on {date}. All gaps must be
> resolved and the plan updated before implementation of any affected step.
```

#### 5b. Detailed gap entries (one per gap)

```markdown
#### G{N}: {short title}  {severity symbol}

- **Location in plan:** Step N.M — "{quoted sentence from plan}"
- **Problem:** {what is undefined, missing, or contradictory}
- **Impact:** {what breaks at runtime or compile-time if left unresolved}
- **To fix:** {concrete, one-sentence instruction}
```

#### 5c. Gap summary table (as built in Phase 4)

#### 5d. Pre-Implementation Actions list

```markdown
## Pre-Implementation Actions

Resolve in order before writing any implementation code:

1. {fix for highest-severity gap}
1. {fix for next gap}
...
```

---

### Phase 6 — Finalize the Document

1. **Bump the document version** (e.g., `version: "1.0"` → `"1.1"`) in the
   YAML frontmatter to signal the plan has been reviewed.

1. **Run markdown lint** to confirm no new lint errors were introduced:

```bash
deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>
```

Fix any errors before finishing.

---

## Template

**Planning document:**
{PLANNING_DOC_PATH}

**Additional context documents (optional):**
{ADDITIONAL_DOCS}
