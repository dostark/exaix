---
agent: senior-coder
scope: dev
title: "Phase Planning Document Deep Review (#post-gap-analysis)"
short_summary: "Deep review of an existing phase planning document: checks implementation against plan, finds gaps, and writes remediation steps back into the document."
version: "1.1"
topics: ["planning", "gap-analysis", "review", "tdd", "architecture", "quality", "security"]
---

```text
Key points
- This is a POST-implementation review, not a pre-implementation gap analysis.
  Verify what was actually built against what the plan promised.
- Read the planning document first, then read every source file it references.
- Check every step marked ✅ IMPLEMENTED or [x] against the real code,
  not against the plan's description of the code.
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
- Run a security gap check (Phase 3b) on every step that touches input
  handling, auth, path resolution, secrets, or external data. Security gaps
  use the 🔒 severity symbol and are always prioritised above 🟡 Feasibility.
- Run a traceability & configurability check (Phase 3c) on every step that
  introduces new EventLogger events, thresholds, timeouts, or opt-in features.
  Untyped events and hardcoded values are gaps.

Canonical prompt (short):
"Deep-review .copilot/planning/phase-NN-*.md against the actual codebase.
Find all gaps between plan claims and implementation, write them into the
document with remediation steps."

Examples
- "#post-gap-analysis .copilot/planning/phase-63-flow-error-recovery.md"
- "#post-gap-analysis .copilot/planning/phase-64-flow-namespace-blackboard.md
   Additional context: ARCHITECTURE.md, src/flows/flow_runner.ts"

Do / Don't
- ✅ Do read the actual source files — never trust the plan's description alone.
- ✅ Do verify every success criterion by inspecting real code and test files.
- ✅ Do cross-check each step against .copilot/planning/README.md §F
  requirements (Actions / Architecture Notes / Planned Tests / Success Criteria).
- ✅ Do classify every gap with a severity symbol (🔴 Critical / � Security /
  🟡 Feasibility / 🟠 Testing / 🔵 Conceptual) so the team can triage quickly.
- ✅ Do run Phase 3b security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do include a numbered gap summary table before the detailed gap entries.
- ✅ Do write new remediation steps using the full §F TDD-First template.
- ✅ Do add a documentation update step last (§3D) when interfaces or
  schemas change.
- ✅ Do bump the document version and update the Status field in the frontmatter.
- ✅ Do use any additionally supplied documents as context.
- ✅ Do run Phase 3c traceability & configurability checks on every step that
  introduces new `EventLogger` events, thresholds, timeouts, or opt-in features.
- ✅ Do run Phase 3d scenario framework coverage verification on every step that
  affects the request → plan → execution → review → memory → update flow.
- ❌ Don't mark a plan step as gap-free unless you verified its test files.
- ❌ Don't skip Phase 3b for steps that handle external data or file paths —
  even if the plan did not mention security.
- ❌ Don't invent remediation steps for code that already exists and passes.
- ❌ Don't report gaps only in chat — they MUST be written into the document.
- ❌ Don't skip the gap summary table — it is required for agent traceability.
- ❌ Don't renumber existing steps — new steps continue from the last existing
  step number.
- ❌ Don't accept hardcoded threshold or timeout literals — they must be named
  constants in `src/shared/constants.ts` or config-schema fields.
- ❌ Don't skip event payload typing — untyped events block audit chain
  verification and make integration tests fragile.

Related templates:
- #pre-gap-analysis — Pre-implementation gap analysis (no code to check yet)
- #plan         — Draft a new phase planning document from scratch
- #step         — Implement a single remediation step from the gap list
- #review       — Code review of a finished feature (not plan-level)
```

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

1. **Read the planning document in full.**
   Record:
   - Document version and Status.
   - Every stated goal and success metric (§C, §H).
   - Every step and its completion marker (`✅ IMPLEMENTED`, `[x]`, or unmarked).
   - Every file path, symbol name, interface, schema field, and constant the
     plan mentions.
   - The last existing step number (you will continue numbering from there).

1. **Read all additionally supplied documents.**
   Treat them as ground-truth context (architecture references, prior phase
   plans, design decisions). Note any conflicts with the planning document.

---

### Phase 2 — Implementation Verification

For **every step marked as complete** (`✅ IMPLEMENTED` or all sub-items `[x]`):

1. **Verify the actual implementation exists.**
   Open each file the step references. Confirm the described classes, functions,
   schema fields, and constants are present and match the plan's specification.

1. **Verify the planned tests exist and pass.**
   Locate each test named in "Planned Tests". Confirm test files exist and the
   test identifiers match. Run `deno test --allow-all <test-file>` if the test
   file was touched by this step.

1. **Verify success criteria are met.**
   For each criterion, identify the concrete code or test assertion that
   satisfies it. If you cannot find one, it is a gap.

For **every step not yet marked complete**:

1. **Check whether it was implemented anyway** (code exists but plan not updated).
   If so, note it as a documentation gap (🔵 Conceptual) and mark it in the
   gap table.

---

### Phase 3 — Standards Compliance Check

1. **Check plan structure against `.copilot/planning/README.md`.**
   For every step, verify it contains all four §F sub-sections:
   - `Actions` — explicit file paths and changes
   - `Architecture Notes` — DI / constructor / pattern rationale
   - `Planned Tests` — named unit and integration tests
   - `Success Criteria` — measurable, objective outcomes

   A step missing any of these is a gap (severity based on which sub-section).

1. **Check §3D documentation update compliance.**
   Was there a documentation update step (or sub-task) for each step that
   introduced or changed interfaces, schemas, CLI behaviour, or architecture?
   If not, add one gap per missing update.

---

### Phase 3d — Scenario Framework Coverage Verification

For **every step** that affects the **request → plan → execution → review → memory → update**
flow (or any sub-path of it), verify whether the scenario framework at
`tests/scenario_framework/` provides end-to-end coverage for the implemented behaviour:

1. **Review existing scenarios**: Check `tests/scenario_framework/scenarios/agent_flows/`. The
   `plan-amendment-lifecycle` scenario covers request → plan → amendment → execution → archive but
   does **not** verify memory bank updates or review/quality gate phases. Determine whether any
   existing scenario exercises the step's new behaviour.

1. **Verify observability**: Confirm the step's behaviour produces observable outputs (CLI/daemon
   output, journal events, file-system artifacts) that scenario steps can assert on. If not, flag a
   gap.

1. **Check scenario assertions**: If existing scenarios cover the flow path, verify they assert on
   the new behaviour (e.g., parallel group journal events, checkpoint resume state, namespace
   artifact paths). Missing assertions are gaps.

1. **Determine if new scenarios are needed**: If the implemented behaviour adds a distinct
   observable phase (e.g., `parallel-group-merge`, `flow-checkpoint-resume`) not exercised by
   `plan-amendment-lifecycle`, flag a gap to create a new scenario under
   `tests/scenario_framework/scenarios/agent_flows/`.

1. **Check integration test coverage**: Verify whether `plan_amendment_scenario_test.ts` or the
   synthetic runner tests have been extended if the implementation changes end-to-end behaviour.

For each gap found, produce an entry:

```text
#### G{N}: {short title}  🟠 Testing
- **Checklist item:** Scenario framework coverage verification
- **Plan claim:** "{quoted sentence from plan}"
- **Actual state:** {what scenarios currently exercise / do not exercise}
- **Impact:** {end-to-end regression risk if left untested at scenario level}
- **Resolved by:** Step {PhaseNN.M} below
```

---

### Phase 3b — Security Gap Analysis

For **every step** that touches any of the following areas, apply the checklist
below. A finding becomes a gap classified 🔒 Security — always triaged above
🟡 Feasibility.

**Trigger areas** (check if the step modifies or introduces):

- Input parsing / deserialisation of external data (JSON, TOML, YAML, user input)
- File-system access, path construction, or directory traversal
- Authentication, authorisation, or permission checks
- Secrets / credentials / API keys (storage, logging, transmission)
- Network calls or HTTP response handling
- Process/command execution (`Deno.Command`, `eval`-like patterns)
- Shared mutable state accessed by multiple async paths

**Security checklist** — one finding per failed item:

1. **Input validation** — Is all external input validated against a strict Zod
   schema (or equivalent) before use? Are unexpected fields stripped?

1. **Path traversal** — Does every file-system path go through `PathResolver`
   (or equivalent allow-list check)? Are `../` sequences and absolute paths
   from user data rejected?

1. **Secret handling** — Are secrets never logged, never included in error
   messages, never written to plain-text files, and never stored in code?

1. **Injection** — Are all shell commands built from a fixed argument array
   (no string interpolation)? Are SQL/template literals parameterised?

1. **Auth boundary** — Is every protected action gated by an authorisation
   check? Are permission checks performed before side effects, not after?

1. **Error leakage** — Do error messages returned to callers omit internal
   stack traces and file paths that could aid an attacker?

1. **Concurrency & TOCTOU** — If shared state is read then written in separate
   async steps, is a mutex or equivalent guard in place?

1. **Dependency trust** — Does the step add new third-party imports? If so,
   are they pinned to a specific version/hash?

1. **Security tests** — Is there at least one negative test (malformed input,
   path escape attempt, oversized payload) for each new security boundary?

For each failed item, produce a gap entry using severity 🔒 Security:

```text
#### G{N}: {short title}  🔒 Security
- **Checklist item:** {item number and name above}
- **Location in plan:** Step N.M — "{quoted sentence from plan}"
- **Actual state:** {what the code does / omits}
- **Impact:** {attack vector or data-exposure risk if left unresolved}
- **To fix:** {concrete one-sentence instruction referencing OWASP Top 10 where applicable}
- **Resolved by:** Step {PhaseNN.M} below
```

---

### Phase 3c — Traceability & Configurability Check

For **every step that introduces new behaviour**, apply the two checklists below.
A finding becomes a gap classified 🟠 Testing (missing assertion) or 🟡 Feasibility
(missing design decision). Gaps that leave a core audit chain broken are 🔴 Critical.

#### Traceability (Event Logging)

1. **Event naming** — Does the implementation emit every `EventLogger` event the
   plan named? Are event-name strings stored as constants in
   `src/shared/constants.ts`, not inlined as literals in the code?

1. **Event payload typing** — Are event payloads typed with a declared interface
   or Zod schema? Code emitting `Record<string, unknown>` without a named type
   is a gap.

1. **Audit chain completeness** — For every state transition the step introduces
   (e.g., `pending → approved`), is there a corresponding journal event in the
   code? An unmapped transition breaks the audit chain.

1. **Event assertions in tests** — Does the test suite include at least one test
   that asserts the correct event was emitted with the correct payload?

#### Configurability

1. **Config-driven vs. constant-driven** — For every threshold, timeout, limit,
   or feature toggle introduced, is the value (a) a named constant in
   `src/shared/constants.ts`, (b) a user-facing config field in
   `exa.config.toml` / a Zod config schema in `src/config/`, or (c) neither?
   Hardcoded literals without a named constant are a gap.

1. **Config schema declaration** — If a new config field was added, is it
   declared in the relevant Zod config schema in `src/config/` with a
   `.default()` value?

1. **Feature enable/disable path** — If the step introduces opt-in behaviour,
   is there a config key that enables it, and is the disabled path tested?

1. **Config validation tests** — Is there at least one test that rejects an
   invalid config value (e.g., negative threshold, zero timeout)?

For each unresolved item, produce a gap entry:

```text
#### G{N}: {short title}  🟠 Testing / 🟡 Feasibility
- **Checklist item:** {item name above}
- **Plan claim:** "{quoted sentence from plan}"
- **Actual state:** {what the code does or omits}
- **Impact:** {consequence if left unresolved}
- **Resolved by:** Step {PhaseNN.M} below
```

---

### Phase 4 — Gap Classification

1. **Classify every gap** using the severity taxonomy:

| Symbol          | Meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| 🔴 Critical     | Blocks correctness — code diverges from plan in a breaking way     |
| � Security      | Security vulnerability or missing security control (OWASP Top 10)  |
| �🟡 Feasibility | Plan claim is unverifiable or implementation-risky                 |
| 🟠 Testing      | Missing or under-specified test; implementation may ship uncovered |
| 🔵 Conceptual   | Minor mismatch, missing doc marker, or style divergence            |

1. **Build the gap summary table** (required):

```text
| ID | Gap (short) | Severity | Plan Section | In Tests? |
|----|-------------|----------|--------------|-----------|
| G1 | ...         | High     | Step N.M     | ❌        |
```

---

### Phase 5 — Write Gaps and Remediation Steps Into the Document

Append the following sections **at the end of the planning document** in order:

#### 5a. Deep Review section header

```markdown
---

## Deep Review — {ISO date}

### Assessment: {short verdict, e.g., "Core delivery ✅, N gaps found across M severity levels"}

> This section was added by deep review on {date}. Gaps are listed by decreasing
> severity. All remediation steps follow the [TDD-First format](./../README.md#F).
```

#### 5b. Detailed gap entries (one per gap)

```markdown
#### G{N}: {short title} {severity symbol}

- **Plan claim:** "{quoted sentence from plan}"
- **Actual state:** {what the code/test really contains}
- **Impact:** {consequence if left unresolved}
- **Resolved by:** Step {PhaseNN.M} below
```

#### 5c. Gap summary table (as built in Phase 4)

#### 5d. Gap Remediation Plan header

```markdown
## Gap Remediation Plan

Steps {N+1} – {N+K} below address the gaps. Ordered by severity then dependency.
All steps follow the TDD-First policy per .copilot/planning/README.md §F.
```

#### 5e. One remediation step per gap (or one combined step for thematically related gaps)

Each step must use this **exact** template from README.md §F:

```markdown
### Step {PhaseNN.M} (G{X}): {action title}

- **Actions**:
  - [ ] {file path}: {specific change}
- **Architecture Notes**: {DI / pattern rationale}
- **Planned Tests**:
  - [ ] `{test file}`: `{test name}` — {what it verifies}
- **Success Criteria**:
  - [ ] {measurable, objective outcome}
```

#### 5f. Mandatory documentation update step (when applicable)

If any remediation step adds or changes interfaces, schemas, CLI behaviour, or
architecture, add a final step:

```markdown
### Step {PhaseNN.last} (§3D): Update Documentation

- **Actions**:
  - [ ] Update `ARCHITECTURE.md` if new components or data flows are introduced.
  - [ ] Update `docs/` if user-facing behaviour changes.
  - [ ] Run `deno task docs-sync-schemas` if MCP tool schemas changed.
  - [ ] Update `.copilot/cross-reference.md` if new task→doc mappings are needed.
- **Planned Tests**:
  - [ ] `deno task docs-agent-validate` — 0 errors
  - [ ] `deno task docs-bench` — all hallucination benchmark tests pass
- **Success Criteria**:
  - [ ] All referenced documentation matches the implemented changes.
  - [ ] `deno task docs-agent-validate` exits 0.
```

---

### Phase 6 — Finalize the Document

1. **Bump the document version** (`version: "1.2"` → `"1.3"`) in the YAML frontmatter.

1. **Update the Status line** to:

```markdown
> **Status**: 🚧 Gap Remediation In Progress
```

1. **Run markdown lint** to confirm no new lint errors:

```bash
deno run --allow-read --allow-write scripts/markdown_lint.ts .copilot/planning/<doc>
```

Fix any errors introduced by the new content before finishing.

---

## Template

**Planning document to review:**
{PLANNING_DOC_PATH}

**Additional context documents (optional):**
{ADDITIONAL_DOCS}
