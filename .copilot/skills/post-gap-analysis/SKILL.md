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
description: Deep post-implementation review of a phase planning document — verifies what was built against the plan, evaluates code quality (style, TS idiomacy, defensive programming, performance, dependency hygiene), finds gaps, and writes remediation steps back into the document
short_summary: "Deep review of an existing phase planning document: checks implementation against plan, evaluates code quality (style, TS idiomacy, defensive programming, performance, dependencies), finds gaps, and writes remediation steps back into the document."
version: "1.5"
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
- Run a semantic value verification (Phase 2a) on every step that adds fields
  to events, schemas, or responses — verify values are correct, not just present.
- Run an integration surface audit (Phase 2b) on every step that introduces a
  new interface or output field — dead fields with no consumers are gaps.
- Run a module convention probe (Phase 2c) on every step that modifies or
  creates source files — new code should match the existing module's dominant
  style.
- Run a security gap check (Phase 5) on every step that touches input
  handling, auth, path resolution, secrets, or external data.
- Run a traceability & configurability check (Phase 6) on every step that
  introduces new EventLogger events, thresholds, timeouts, or opt-in features.
- Run a code quality review (Phase 7) on every source file — check style
  adherence, TypeScript idiomacy, defensive programming, performance, and
  dependency hygiene.
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
- ✅ Do check new code against existing module conventions — inconsistency within a file is a gap (Phase 2c).
- ✅ Do run Phase 5 security checks on every step touching input handling,
  auth/authorisation, path resolution, secrets, or external payloads.
- ✅ Do include a numbered gap summary table before the detailed gap entries.
- ✅ Do write new remediation steps using the full §F TDD-First template.
- ✅ Do add a documentation update step last (§3D) when interfaces or
  schemas change.
- ✅ Do bump the document version and update the Status field in the frontmatter.
- ✅ Do use any additionally supplied documents as context.
- ✅ Do run Phase 6 traceability & configurability checks on every step that
  introduces new `EventLogger` events, thresholds, timeouts, or opt-in features.
- ✅ Do run Phase 4 scenario framework coverage verification on every step that
  affects the request → plan → execution → review → memory → update flow.
- ✅ Do run Phase 7 (Code Quality Review) on every step that modifies or creates
  source files — check style adherence, TS idiomacy, defensive programming,
  performance, and dependency hygiene.
- ✅ Do run `deno lint` and `deno fmt --check` on every new or modified file
  and flag any violation not justified by a code comment.
- ✅ Do verify no `record-unknown` violations — `Record<string, unknown>` is
  banned; every map-like structure must have a typed interface.
- ✅ Do check for bare `catch {}` blocks that discard diagnostic information —
  a silent catch in a security-sensitive or diagnostic path is at minimum
  🟠 Testing.
- ✅ Do flag sync I/O (`readFileSync`, `statSync`) in async functions as a
  performance concern — prefer async variants in non-initialisation paths.
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

Related skills:
- #pre-gap-analysis — Pre-implementation gap analysis (no code to check yet)
- #plan         — Draft a new phase planning document from scratch
- #next-steps   — Re-enter the TDD loop to remediate gaps found here
- #commit       — Create a structured commit after remediation

Workflow chain (typical):
  #plan → #pre-gap-analysis → #next-steps → **#post-gap-analysis** → #commit
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

For every step introducing new behaviour: verify event naming, payload typing,
audit chain completeness, event assertions in tests; verify config-driven vs.
constant-driven values, config schema declaration, feature enable/disable path,
config validation tests.

---

### Phase 7 — Code Quality Review

For **every source file the step modifies or creates**, evaluate the implementation
against the following quality dimensions. Each failure below the dimension's bar
is a gap — classify by the severity that fits the concrete consequence.

#### 7a — Project Code Style & Convention Adherence

Check the new code against the project's enforced style rules and the dominant
conventions in the existing file:

1. **Lint & format compliance.** Verify `deno lint <file>` and `deno fmt --check`
   produce zero violations on the new code. Flag any lint suppression
   (`// deno-lint-ignore`) that isn't justified by a code comment.

1. **Import style.** The project's `check:style` rule requires:
   - Multi-line `import { ... }` blocks must be collapsed to single-line when they fit
     within the formatter's line width. A multi-line import that deno fmt would
     flatten is a style violation.
   - `import type` must be used when only type-level imports are used
     (`verbatim-module-syntax`). A runtime `import` used exclusively for type
     positions is a violation.
   - Inline `npm:`, `jsr:`, or `https:` specifiers in source files are forbidden
     (`no-import-prefix`). All external dependencies must be declared in
     `deno.json`'s `imports` map and referenced by bare specifier.
   - Import paths should use the project's `@exaix/*` / `@exaix-team/*` aliases
     wherever those aliases exist, rather than relative paths that reach into
     sibling or parent packages.

1. **Interface naming.** The project enforces `IFooBar` naming for interfaces
   (`check:style` rule `[interface-naming]`). A non-prefixed interface is a
   violation unless it has `@ungrounded` in its JSDoc header.

1. **Module header JSDoc.** Every source file must have a `@module`, `@path`,
   `@architectural-layer`, and (for non-exempt files) `@related-files` entry.
   Missing or invalid headers fail `check:arch`.

1. **Magic-value discipline.** String or number literals that appear more than
   once across the codebase must be extracted into named constants
   (`check:magic`). This applies particularly to:
   - Kind strings (`"function"`, `"class"`, `"const"`, etc.) used in
     `CAPTURE_KIND` maps — extract to shared constants.
   - Capture names (`"name"`, `"definition."`) — extract to shared constants.
   - Thresholds, timeouts, file-size limits — must live in
     `packages/core/src/types/constants.ts` or a config-schema field.

1. **`Record<string, unknown>` prohibition.** The project bans
   `Record<string, unknown>` in favour of specific interfaces
   (`check:style` rule). Use a typed interface instead.

#### 7b — TypeScript Idiomacy & Type Safety

Evaluate whether the code uses TypeScript effectively and idiomatically:

1. **Proper type annotations.** Public API surfaces (exported functions, class
   methods, interface fields) must have explicit type annotations. Avoid relying
   on implicit `any` — every `find()` callback parameter, `catch` variable, and
   generic type argument should be typed.

1. **Exhaustive conditionals.** Switch/if-else chains over union types should be
   exhaustive. Missing branches that silently fall through are a 🟡 Feasibility
   gap (latent bug when a new variant is added).

1. **Generic constraints.** Generic type parameters should be constrained where
   possible (`<T extends SomeBase>`) rather than unbounded `<T>`.

1. **Async/await hygiene.**
   - `async` functions that contain no `await` are lint violations
     (`require-await`) unless they exist solely to satisfy an `Promise`-returning
     interface. In the latter case the violation must be justified.
   - Promise chains (`.then()/.catch()`) should prefer `async`/`await` unless
     there is a clear parallel-execution reason.
   - `void` operator on promise-returning expressions must be intentional
     (fire-and-forget). Unexplained `void` is a 🟡 Feasibility gap.

1. **Null safety.** Use `??` (nullish coalescing) over `||` for default values
   when `0` / `""` / `false` are valid inputs. Use `?.` (optional chaining)
   over `&&` for property access.

1. **Discriminated unions.** Where a value can be one of several shapes, prefer
   discriminated unions (`{ type: "a", ... } | { type: "b", ... }`) over
   optional fields on a single interface.

#### 7c — Defensive Programming & Error Robustness

Evaluate error handling, edge-case coverage, and fail-soft behaviour:

1. **Input validation at trust boundaries.** Every file path, language string,
   or external input received from an untrusted source (portal source, user
   config) must be validated before use. A missing validation step that could
   lead to path traversal, injection, or logic bypass is a 🔒 Security gap.

1. **Fail-closed vs fail-open.** Security-relevant decisions (path access,
   permission checks, policy evaluation) must fail closed (deny on error/ambiguity)
   rather than fail open. A check that defaults to "allow" on error is 🔴 Critical.

1. **Fallback chains.** Extractors and resolvers should have a fallback chain
   (preferred → degraded → safe default) so a failure in one link does not
   crash the whole operation. A missing fallback that causes a hard crash on
   recoverable failure is 🟡 Feasibility.

1. **Resource cleanup.** Temporary files, directory handles, and open file
   descriptors must be cleaned up in `finally` blocks or via
   `using`/`await using` (Deno 2). A leak in a long-running process is
   🔒 Security (resource exhaustion).

1. **Timeout enforcement.** Every operation that reads external data or runs a
   subprocess must have a timeout. Missing or excessively long timeouts are
   🔒 Security (DoS vector).

1. **Error context preservation.** Catch blocks should not swallow errors
   silently. Log or wrap with context before re-throwing. A bare `catch {}`
   that discards diagnostic information is 🟠 Testing (debuggability gap).

#### 7d — Performance & Resource Efficiency

Evaluate the implementation for obvious performance issues:

1. **Unnecessary synchronous I/O.** In an async context, `readFileSync`,
   `statSync`, and similar synchronous calls block the event loop. Prefer
   `readFile`, `stat`, etc. Flag sync I/O in an async function as 🟡 Feasibility
   (event-loop blockage under concurrent analysis).

1. **Redundant parsing or allocation.** Avoid parsing the same input twice,
   reading the same file more than once, or constructing intermediate data
   structures that are immediately discarded. A repeated parse in a hot loop
   is 🟡 Feasibility.

1. **File I/O batching.** When reading many small files (e.g. portal source),
   batch reads or use streaming rather than sequential `await` per file where
   the data is independent. Sequential reads over hundreds of files are
   🟡 Feasibility (unnecessary latency).

1. **Memory bounds on untrusted input.** WASM parse trees, in-memory file
   content, and result arrays must be bounded. Missing bounds on tree size,
   node count, or result set size are 🔒 Security (memory exhaustion).

1. **Early termination on budget exhaustion.** When a wall-clock budget or
   file-count cap is hit, processing must stop immediately rather than
   finishing the current batch. A soft budget that runs to completion before
   checking is 🟠 Testing (behavioural gap).

1. **Short-circuit for zero-cost cases.** If no files of the target language
   are found (empty `filePaths`), the extractor should return `[]` immediately
   without initialising the parser. Unnecessary initialisation is a minor
   🟡 Feasibility gap.

#### 7e — Dependency & Import Hygiene

1. **Unused imports and exports.** Every import must be consumed. An import
   that is only used in type positions must use `import type`. Unused exports
   (symbols exported from `mod.ts` that have no external consumer) should be
   flagged (🟠 Testing if intentional but unchecked, 🔵 Conceptual if
   forgotten).

1. **Circular dependency risk.** If the new code creates a new import edge
   between packages, verify it does not create a cycle. A new circular
   dependency is 🔴 Critical.

1. **npm dependency footprint.** Each new `npm:` dependency must be justified
   in the plan's Architecture Notes. An undocumented npm dependency that
   duplicates existing capability is 🟡 Feasibility.

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
1. Commit payload — use `#commit` after all remediation steps are written into the document.
