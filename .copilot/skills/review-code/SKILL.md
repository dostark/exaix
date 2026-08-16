---
name: review-code
agent: senior-coder
tools:
  - read_file
  - search_files
  - run_command
scope: dev
title: "Review-Code Skill (#review-code)"
description: Systematic code review — correctness, security, test coverage, architecture, and Exaix conventions
short_summary: "Autonomous code review against Exaix standards: correctness, security (Phase 3b), test coverage, architecture grounding, and style compliance."
version: "1.3.0"
topics: ["code-review", "quality-assurance", "security", "testing", "architecture", "best-practices"]
qwen_skill: review-code
---

```text
Key points
- Review code against Exaix standards, not just generic style.
- Work through Phases 1–10 in order: Ingest → Correctness → Security → Style
  → TS quality → Defensive → Performance/Deps → Tests → Docs → Report.
- Always check security (Phase 3b) for any change touching external input,
  file paths, auth, secrets, or network calls.
- Test coverage is mandatory: every new code path needs a named test.
- Architecture grounding: every new source file must have a module-header
  JSDoc and pass deno task check:arch.
- Report findings as categorised, actionable items — not vague suggestions.
- For deeper post-implementation gap analysis (plan vs. reality, semantic
  values, integration-surface audit), use #post-gap-analysis instead.
- When reviewing more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue.

Canonical prompt (short):
"Review <files or diff> for correctness, security, test coverage, and
Exaix architecture compliance. Report findings as Critical / Major / Minor."

Examples
- "#review-code `packages/core/src/vault_service.ts` and `packages/core/tests/vault_service_test.ts`"
- "#review-code — review all staged changes before merging to main"

Do / Don't
- ✅ Do work through all phases 1–10 — don't stop after correctness and security.
- ✅ Do read the actual source files — never review from memory.
- ✅ Do check for missing tests on every new code path (not just coverage %).
- ✅ Do apply Phase 3b security checks for any input/FS/auth/secrets/network change.
- ✅ Do verify all new interfaces are exported from index/barrel files.
- ✅ Do check for magic strings/numbers that belong in constants.
- ✅ Do check that module-header JSDoc is present in every new source file.
- ✅ Do verify constructor DI matches the established Exaix service pattern.
- ✅ Do check TypeScript idiomacy (exhaustive conditionals, null safety, discriminated unions).
- ✅ Do check defensive programming (fail-closed, fallback chains, resource cleanup).
- ✅ Do categorise every finding: 🔴 Critical / 🔒 Security / 🟡 Major / 🟠 Testing / 🔵 Minor.
- ✅ When reviewing your own output, prioritize edge cases and error paths you may have under-specified — not just correctness of what you wrote.
- ❌ Don't report style nitpicks as Critical.
- ❌ Don't approve a change that has no tests for new logic.
- ❌ Don't skip security checks — even for "small" changes.
- ❌ Don't suggest refactoring out of scope unless it is blocking correctness.
- ❌ Don't use #review-code for plan-level gap analysis — use #post-gap-analysis instead.

Related skills:
- #fix-bug            — Implement a fix for a Critical finding
- #security           — Deep security audit (when 3+ security findings exist)
- #commit             — Structured commit after implementing review fixes
- #review-research    — Subsystem-level review (broader scope than individual PR/change)
- #post-gap-analysis  — Plan-level gap analysis: checks implementation against plan,
                        semantic values, integration-surface audit, scenario coverage

Workflow chain:
  #next-steps (implement) → **#review-code** → #fix-bug (if needed) → #commit
```

## See also

- [exaix-development](../exaix-development/SKILL.md) — required patterns, prohibited anti-patterns
- [security](../security/SKILL.md) — OWASP checklist, security boundaries

---

## Instructions for Agent

You are performing a **systematic code review** of the files or diff provided.

### Phase 1 — Ingest

1. Read every file in scope (don't rely on diff context only).
2. Understand the intended behaviour from the PR description, planning document,
   or commit message.
3. Identify which Exaix subsystems (AI providers, CLI, services, TUI, MCP) are affected.

---

### Phase 2 — Correctness & Logic

For each changed function or method:

- Does the implementation match the stated intent?
- Are all branches handled (including empty input, null, error paths)?
- Is state mutation correct (no accidental shared-mutable-state bugs)?
- Are async operations properly awaited? Are errors surfaced or silently swallowed?

---

### Phase 3 — Security (Phase 3b)

For every change touching external input, file paths, auth, secrets, network, or
process execution, verify:

1. **Input validation** — All external inputs go through Zod or explicit type guards.
2. **Path traversal** — All file paths route through `PathResolver`; no raw string concat.
3. **Secret handling** — Secrets are never logged, stored in plain text, or included in errors.
4. **Injection** — No dynamic SQL, shell, or template construction from unsanitised input.
5. **Auth boundary** — Permission check occurs before every side effect.
6. **Error leakage** — Error messages do not expose internal paths, stack traces, or secrets.
7. **TOCTOU** — File existence checked atomically with the operation.
8. **Dependency trust** — Any new external import is intentional and from a trusted source.
9. **Security tests** — At least one test exercises the security control.

Classify each failure as 🔒 Security.

---

### Phase 4 — Architecture, Style & Conventions

Check every new or modified source file against the project's enforced style
rules and the dominant conventions in the existing file:

1. **Module header JSDoc.** Every source file must have a `@module`, `@path`,
   `@architectural-layer`, and (for non-exempt files) `@related-files` entry.
   Missing or invalid headers fail `check:arch`.

1. **Architectural layer.** Is the layer (`@architectural-layer`) correct for
   the file location? CLI base → `packages/cli/`, TUI base → `packages/tui/`,
   services → `packages/*/src/`, etc.

1. **DI pattern.** Constructor-based injection; no service instantiation inside
   constructors. Consumers depend on `IFoo`, never on `Foo`.

1. **Interface naming.** The project enforces `IFooBar` naming for interfaces
   (`check:style` rule `[interface-naming]`). A non-prefixed interface is a
   violation unless it has `@ungrounded` in its JSDoc header.

1. **Import style.** The `check:style` rule requires:
   - Multi-line `import { ... }` blocks must be collapsed to single-line when
     they fit within the formatter's line width.
   - `import type` must be used when only type-level imports are used
     (`verbatim-module-syntax`).
   - Inline `npm:`, `jsr:`, or `https:` specifiers in source files are forbidden
     (`no-import-prefix`). All external dependencies must be declared in
     `deno.json`'s `imports` map and referenced by bare specifier.
   - Import paths should use `@exaix/*` / `@exaix-team/*` aliases wherever
     those aliases exist, rather than relative paths reaching into sibling
     or parent packages.

1. **Lint & format compliance.** Verify `deno lint <file>` and
   `deno fmt --check` produce zero violations. Flag any lint suppression
   (`// deno-lint-ignore`) that isn't justified by a code comment.

1. **Magic-value discipline.** No hardcoded strings or numbers that belong in
   `packages/core/src/types/constants.ts`. String/number literals that appear
   more than once across the codebase must be extracted into named constants
   (`check:magic`). Thresholds, timeouts, file-size limits must live in
   constants or a config-schema field.

1. **Record types.** No `Record<string, unknown>` — define a specific
   interface instead (`check:style` rule).

1. **EventLogger.** A class only owns audit-logger infrastructure if it accepts
   `IEventLogger`/`IEventRegistry` via constructor injection (never `new EventLogger(...)`
   inside a package — `check:style` rule `[package-instantiates-event-logger]`). For a
   class that DOES accept one: does at least one method call it, and does every
   significant state-changing or cross-component-call method call it with a named,
   typed payload interface (never `Record<string, unknown>`)? Every emitted event's
   action argument must be a `DomainEventType` member (`check:event-strings`), never an
   inline string literal. `deno task check:event-coverage` is the mechanized first pass
   for this item — advisory, verify findings by hand (see the script's module header
   for known false-positive sources), UNLESS the class carries the `@visible` JSDoc tag
   (`#plan` §2H), in which case any coverage gap is 🔴 Critical, not advisory — the tag
   is the codebase's own explicit declaration that this component's coverage is
   required.

1. **Exports.** Every new interface/type is exported from the appropriate
   index file.

1. **check:arch.** Would `deno task check:arch` pass? All new files must be
   GROUNDED (or explicitly tagged `@ungrounded`) — `@visible` (item 6 above) uses the
   same JSDoc-tag mechanism for a different contract (observability coverage, not
   architecture grounding), documented in `CODE_STYLE.md`'s "JSDoc Header Tags" section.

---

### Phase 5 — TypeScript Idiomacy & Type Safety

Evaluate whether the code uses TypeScript effectively and idiomatically:

1. **Proper type annotations.** Public API surfaces (exported functions, class
   methods, interface fields) must have explicit type annotations. Avoid relying
   on implicit `any` — every `find()` callback parameter, `catch` variable, and
   generic type argument should be typed.

1. **Exhaustive conditionals.** Switch/if-else chains over union types should
   be exhaustive. Missing branches that silently fall through are a 🟡 Major gap
   (latent bug when a new variant is added).

1. **Generic constraints.** Generic type parameters should be constrained where
   possible (`<T extends SomeBase>`) rather than unbounded `<T>`.

1. **Async/await hygiene.**
   - `async` functions that contain no `await` are lint violations
     (`require-await`) unless they exist solely to satisfy a `Promise`-returning
     interface. In the latter case the violation must be justified.
   - Promise chains (`.then()/.catch()`) should prefer `async`/`await` unless
     there is a clear parallel-execution reason.
   - `void` operator on promise-returning expressions must be intentional
     (fire-and-forget). Unexplained `void` is a 🟡 Major gap.

1. **Null safety.** Use `??` (nullish coalescing) over `||` for default values
   when `0` / `""` / `false` are valid inputs. Use `?.` (optional chaining)
   over `&&` for property access.

1. **Discriminated unions.** Where a value can be one of several shapes, prefer
   discriminated unions (`{ type: "a", ... } | { type: "b", ... }`) over
   optional fields on a single interface.

---

### Phase 6 — Defensive Programming & Error Robustness

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
   recoverable failure is 🟡 Major.

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

---

### Phase 7 — Performance & Dependency Hygiene

Evaluate the implementation for obvious performance issues and import hygiene:

1. **Unnecessary synchronous I/O.** In an async context, `readFileSync`,
   `statSync`, and similar synchronous calls block the event loop. Prefer
   `readFile`, `stat`, etc. Flag sync I/O in an async function as 🟡 Major
   (event-loop blockage under concurrent analysis).

1. **Redundant parsing or allocation.** Avoid parsing the same input twice,
   reading the same file more than once, or constructing intermediate data
   structures that are immediately discarded. A repeated parse in a hot loop
   is 🟡 Major.

1. **File I/O batching.** When reading many small files (e.g. portal source),
   batch reads or use streaming rather than sequential `await` per file where
   the data is independent. Sequential reads over hundreds of files are
   🟡 Major (unnecessary latency).

1. **Memory bounds on untrusted input.** WASM parse trees, in-memory file
   content, and result arrays must be bounded. Missing bounds on tree size,
   node count, or result set size are 🔒 Security (memory exhaustion).

1. **Unused imports and exports.** Every import must be consumed. An import
   that is only used in type positions must use `import type`. Unused exports
   (symbols exported from `mod.ts` that have no external consumer) should be
   flagged (🟠 Testing if intentional but unchecked, 🔵 Minor if forgotten).

1. **Circular dependency risk.** If the new code creates a new import edge
   between packages, verify it does not create a cycle. A new circular
   dependency is 🔴 Critical.

1. **npm dependency footprint.** Each new `npm:` dependency must be justified.
   An undocumented npm dependency that duplicates existing capability is
   🟡 Major.

1. **Short-circuit for zero-cost cases.** If no files of the target type
   are found, the handler should return immediately without unnecessary
   initialisation. Unnecessary initialisation is a 🔵 Minor gap.

---

### Phase 8 — Test Coverage

For every new code path:

- Is there a named unit test?
- Is there a named integration test (where applicable)?
- Are edge cases covered (empty input, null, max size, error path)?
- Are tests using the correct helpers (`initTestDbService`, `createCliTestContext`, etc.)?
- Are test names descriptive ("returns X when Y", not "test 1")?
- Are timer-based TUI tests using `sanitizeOps: false, sanitizeResources: false`?

---

### Phase 9 — Documentation Compliance (§3D)

If the change introduces or modifies:

- A public interface or schema → `ARCHITECTURE.md` should be updated.
- A CLI flag or user-facing behaviour → `docs/Exaix_User_Guide.md` MUST be updated in the
  same commit. Grep the file for the feature name to verify coverage — absent means blocked.
- An MCP tool handler → `TOOLS.md` should be updated (`deno task docs-sync-schemas`).
- A new pattern or convention → `CODE_STYLE.md` should mention it.

Flag missing User Guide updates as 🔴 Critical (blocking). Flag other missing doc updates as 🟡 Major.

---

### Phase 10 — Classify and Report

Build a findings table:

| # | File                                 | Line/Symbol    | Severity    | Finding       |
| - | ------------------------------------ | -------------- | ----------- | ------------- |
| 1 | `packages/<package>/src/<module>.ts` | `functionName` | 🔴 Critical | <description> |
| 2 | `packages/<package>/src/<module>.ts` | `fieldName`    | 🔒 Security | <description> |

Severity scale:

| Symbol      | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| 🔴 Critical | Blocks correctness or breaks an invariant — must fix before merge |
| 🔒 Security | Security control missing or bypassed (OWASP Top 10)               |
| 🟡 Major    | Significant quality or coverage gap — should fix before merge     |
| 🟠 Testing  | Missing or inadequate test — may ship without coverage            |
| 🔵 Minor    | Style, naming, or low-risk omission — fix in follow-up            |

---

## Related

- [CLAUDE.md](../../../CLAUDE.md#behavioral-guidelines) — universal behavioral guidelines (think before coding, simplicity, surgical changes, goal-driven execution)
- [CODE_STYLE.md](../../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output Format

1. **Review verdict** — ✅ Approved / ⚠️ Approved with minor issues / ❌ Changes requested.
2. **Findings table** — all categorised findings.
3. **Detail section** — one paragraph per Critical or Security finding explaining the risk
   and the required fix.
4. **Suggested next action** — use `#fix-bug` for each Critical/Security finding, or
   `#commit` if the review is clean.

## Examples

- `#review-code` scoped to a specific source file and its test — review just that pair
- `#review-code — review all staged changes before merging to main`

---
exaix:
  skill_id: review-code
  related_skills: [exaix-development, security]
  triggers:
    keywords: [review, code-review, pr-review, cr]
    task_types: [feature, bugfix, refactor]
    tags: [code-review, quality]
  constraints:
    - "Check correctness, security, test coverage, architecture, style"
    - "Reference Exaix conventions (CODE_STYLE.md, ARCHITECTURE.md)"
    - "Do not implement changes — report findings only"
    - "Work through all 10 phases in order"
    - "Apply Phase 3b security for any input/FS/auth/secrets/network change"
  output_requirements:
    - "Review verdict: Approved / Approved with minor issues / Changes requested"
    - "Findings table with severity per finding"
    - "Detail section for Critical and Security findings"
    - "Suggested next action"
  quality_criteria:
    - name: dimension_coverage
      description: All five review dimensions covered
      weight: 30
    - name: actionability
      description: Each finding includes concrete suggestion
      weight: 30
    - name: evidence_quality
      description: Findings reference specific file:line or symbol
      weight: 40
---
