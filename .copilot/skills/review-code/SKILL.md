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

- Review against Exaix standards, not generic style.
- Ten phases in order: Ingest → Correctness → Security → Style → TS quality → Defensive
  → Performance/Deps → Tests → Docs → Report.
- Run Phase 3b security on any change touching external input, file paths, auth,
  secrets, or network.
- Every new code path needs a named test.
- Every new source file needs a module-header JSDoc and must pass `deno task check:arch`.
- Findings are categorised, actionable items — never vague suggestions.
- Plan-level gap analysis (plan vs. reality, semantic values, integration surface): use
  #review-phase-code, not this skill.
- Reviewing > ~20 files: batches of 5–10. Read a batch, record findings, continue.

Canonical prompt (short):
"Review <files or diff> for correctness, security, test coverage, and
Exaix architecture compliance. Report findings as Critical / Major / Minor."

Examples
- "#review-code `packages/core/src/vault_service.ts` and `packages/core/tests/vault_service_test.ts`"
- "#review-code — review all staged changes before merging to main"

Do / Don't
- ✅ Work through all phases 1–10 — not only correctness and security.
- ✅ Read the actual source files — never review from memory.
- ✅ Check for missing tests on every new code path (not just coverage %).
- ✅ Apply Phase 3b for any input/FS/auth/secrets/network change.
- ✅ Verify new interfaces are exported from index/barrel files.
- ✅ Check for magic strings/numbers that belong in constants.
- ✅ Check module-header JSDoc on every new source file.
- ✅ Verify constructor DI matches the Exaix service pattern.
- ✅ Check TS idiomacy (exhaustive conditionals, null safety, discriminated unions).
- ✅ Check defensive programming (fail-closed, fallback chains, resource cleanup).
- ✅ Categorise every finding: 🔴 Critical / 🔒 Security / 🟡 Major / 🟠 Testing / 🔵 Minor.
- ✅ Reviewing your own output: prioritise edge cases and error paths you may have
  under-specified.
- ❌ Report style nitpicks as Critical.
- ❌ Approve a change with no tests for new logic.
- ❌ Skip security checks, even for "small" changes.
- ❌ Suggest out-of-scope refactors unless they block correctness.
- ❌ Use this skill for plan-level gap analysis — use #review-phase-code.

Related: #fix-bug (implement a Critical fix); #security (3+ security findings); #commit;
#review-research (subsystem-level review); #review-phase-code (plan-level).

Workflow chain: #next-steps (implement) → **#review-code** → #fix-bug (if needed) → #commit
```

## See also

- [exaix-development](../exaix-development/SKILL.md) — required patterns, prohibited anti-patterns
- [security](../security/SKILL.md) — OWASP checklist, security boundaries

---

## Instructions for Agent

Review the provided files or diff through the ten phases in order. Findings are categorised and actionable, never vague.

### Phase 1 — Ingest

1. Read every file in scope (do not rely on diff context only).
1. Learn the intended behaviour from the PR description, planning document, or commit message.
1. Identify affected Exaix subsystems (AI providers, CLI, services, TUI, MCP).

### Phase 2 — Correctness & Logic

For each changed function or method:

- Does the implementation match the stated intent?
- Are all branches handled (empty input, null, error paths)?
- Is state mutation correct (no accidental shared mutable state)?
- Are async operations awaited? Are errors surfaced, not silently swallowed?

### Phase 3 — Security (Phase 3b)

For every change touching external input, file paths, auth, secrets, network, or process
execution, verify:

1. **Input validation** — external inputs go through Zod or explicit type guards.
1. **Path traversal** — file paths route through `PathResolver`; no raw string concat.
1. **Secret handling** — secrets never logged, stored in plain text, or included in errors.
1. **Injection** — no dynamic SQL, shell, or template construction from unsanitised input.
1. **Auth boundary** — permission check precedes every side effect.
1. **Error leakage** — errors do not expose internal paths, stack traces, or secrets.
1. **TOCTOU** — file existence checked atomically with the operation.
1. **Dependency trust** — new external imports are intentional and trusted.
1. **Security tests** — at least one test exercises the security control.

Classify each failure as 🔒 Security.

### Phase 4 — Architecture, Style & Conventions

Check every new/modified source file against the enforced style rules and the dominant
conventions in the existing file:

1. **Module header JSDoc.** Every source file needs `@module`, `@path`,
   `@architectural-layer`, and (unless exempt) `@related-files`. Missing/invalid fails
   `check:arch`.
1. **Architectural layer.** Correct `@architectural-layer` for the location? CLI base →
   `packages/cli/`, TUI base → `packages/tui/`, services → `packages/*/src/`, etc.
1. **DI pattern.** Constructor injection; no service instantiation inside constructors.
   Consumers depend on `IFoo`, never on `Foo`.
1. **Interface naming.** `check:style` enforces `IFooBar` naming; a non-prefixed
   interface is a violation unless it carries `@ungrounded` in its JSDoc header.
1. **Import style** (`check:style`):
   - Multi-line `import { ... }` collapsed to single-line when they fit the line width.
   - `import type` for type-only imports (`verbatim-module-syntax`).
   - No inline `npm:`/`jsr:`/`https:` specifiers in source (`no-import-prefix`); declare
     deps in `deno.json` `imports` and use bare specifiers.
   - Prefer `@exaix/*` / `@exaix-team/*` aliases over relative paths reaching into sibling
     or parent packages.
1. **Lint & format.** `deno lint <file>` and `deno fmt --check` produce zero violations.
   Flag any `// deno-lint-ignore` without a justifying comment.
1. **Magic-value discipline.** No hardcoded strings/numbers that belong in
   `packages/core/src/types/constants.ts`. Literals repeated across the codebase become
   named constants (`check:magic`). Thresholds, timeouts, file-size limits live in
   constants or a config-schema field.
1. **Record types.** No `Record<string, unknown>` — define a specific interface
   (`check:style`).
1. **EventLogger.** A class owns audit-logger infrastructure only when it accepts
   `IEventLogger`/`IEventRegistry` by constructor injection (never `new EventLogger(…)`
   inside a package — `check:style` `[package-instantiates-event-logger]`). For a class
   that DOES accept one: does at least one method call it, and does every significant
   state-changing or cross-component method call it with a named, typed payload
   interface (never `Record<string, unknown>`)? Every event `action` must be a
   `DomainEventType` member (`check:event-strings`), never an inline string literal.
   `deno task check:event-coverage` is the mechanized first pass — advisory, verify by
   hand (see the script's header for known false positives), UNLESS the class carries the
   `@visible` JSDoc tag (`#plan` §2H), in which case any coverage gap is 🔴 Critical.
   For a `@visible`-tagged class specifically:
   - a logger call whose action is a raw string rather than a registered
     `DomainEventType` member is Critical even though a call exists;
   - an operation emitting multiple lifecycle events (started/completed/failed) must pass
     that operation's trace ID as the logger call's fourth argument on every one — a value
     only inside the payload does not correlate, because `EventLogger.log` mints an
     independent random trace ID when the fourth argument is absent;
   - a streaming/async-generator method must emit a terminal event for early consumer
     cancellation (caller `break`/`return()`s out of `for await` before exhaustion), not
     only normal completion and thrown errors — a `finally` block or equivalent fires one
     terminal event across all three exit paths.
   A `@visible`-tagged class also needs a real Tier A/B runtime test proving its primary
   events fire, not only a clean static pass — see `#plan` §2H and `#review-phase-code`
   Phase 6.
1. **Exports.** Every new interface/type is exported from the appropriate index file.
1. **check:arch.** Would it pass? All new files GROUNDED (or explicitly tagged
   `@ungrounded`) — `@visible` uses the same JSDoc-tag mechanism for observability
   coverage, not architecture grounding (see CODE_STYLE.md "JSDoc Header Tags").

### Phase 5 — TypeScript Idiomacy & Type Safety

1. **Explicit annotations.** Public surfaces (exported functions, class methods,
   interface fields) carry explicit types. Avoid implicit `any`: every `find()` callback
   parameter, `catch` variable, and generic type argument typed.
1. **Exhaustive conditionals.** Switch/if-else over unions exhaustive. A falling-through
   missing branch is 🟡 Major (latent bug on a new variant).
1. **Generic constraints.** Constrain generics (`<T extends SomeBase>`) over unbounded `<T>`.
1. **Async/await hygiene.** `async` without `await` is a lint violation (`require-await`)
   unless the function exists to satisfy a `Promise`-returning interface — then justified.
   Prefer `async`/`await` over `.then()/.catch()` unless parallel execution needs chains.
   `void` on a promise must be intentional; unexplained `void` is 🟡 Major.
1. **Null safety.** `??` over `||` when `0`/`""`/`false` are valid; `?.` over `&&`.
1. **Discriminated unions.** Prefer `{ type: "a", … } | { type: "b", … }` over optional
   fields on one interface.

### Phase 6 — Defensive Programming & Error Robustness

1. **Input validation at trust boundaries.** Every path, language string, or external
   input from an untrusted source (portal source, user config) validated before use. A
   missing check enabling traversal/injection/bypass is 🔒 Security.
1. **Fail-closed vs fail-open.** Security decisions (path access, permission checks,
   policy) fail closed (deny on error/ambiguity); a check defaulting to allow is 🔴 Critical.
1. **Fallback chains.** Extractors/resolvers: preferred → degraded → safe default, so one
   failure does not crash the operation. A missing fallback hard-crashing on a recoverable
   failure is 🟡 Major.
1. **Resource cleanup.** Temp files, directory handles, open descriptors cleaned in
   `finally` or via `using`/`await using` (Deno 2). A leak in a long-running process is
   🔒 Security (resource exhaustion).
1. **Timeout enforcement.** Every external-data or subprocess operation has a timeout.
   Missing/excessively long timeouts are 🔒 Security (DoS).
1. **Error context preservation.** Catch blocks do not silently swallow; log or wrap with
   context before re-throw. A bare `catch {}` discarding diagnostics is 🟠 Testing.

### Phase 7 — Performance & Dependency Hygiene

1. **Synchronous I/O in async context.** `readFileSync`/`statSync` block the event loop.
   Prefer `readFile`/`stat`. Sync I/O in an async function is 🟡 Major.
1. **Redundant parsing/allocation.** Avoid double parsing, re-reading the same file,
   discarded structures. A repeated parse in a hot loop is 🟡 Major.
1. **File I/O batching.** Many small independent files: batch or stream, not sequential
   `await` per file. Sequential reads over hundreds of files are 🟡 Major.
1. **Memory bounds on untrusted input.** WASM trees, in-memory file content, result arrays
   bounded. Missing bounds (tree size, node count, result size) are 🔒 Security.
1. **Unused imports/exports.** Every import consumed; type-only → `import type`. Unused
   exports (importable from `mod.ts` with no external consumer) flagged (🟠 if
   intentional-unchecked, 🔵 if forgotten).
1. **Circular dependency risk.** A new import edge between packages must not create a
   cycle. A new circular dependency is 🔴 Critical.
1. **npm footprint.** Each new `npm:` dependency justified. An undocumented duplicate of
   existing capability is 🟡 Major.
1. **Zero-cost short-circuit.** No files of the target type? Return immediately. Unneeded
   initialisation is 🔵 Minor.

### Phase 8 — Test Coverage

For every new code path:

- Named unit test? Named integration test (where applicable)?
- Edge cases: empty input, null, max size, error path?
- Correct helpers (`initTestDbService`, `createCliTestContext`, etc.)?
- Descriptive names ("returns X when Y", not "test 1")?
- Timer-based TUI tests: `sanitizeOps: false, sanitizeResources: false`?

### Phase 9 — Documentation Compliance (§3D)

If the change introduces or modifies:

- A public interface or schema → update `ARCHITECTURE.md`.
- A CLI flag or user-facing behaviour → `docs/Exaix_User_Guide.md` MUST update in the
  same commit. Grep the file for the feature name — absent means blocked.
- An MCP tool handler → `TOOLS.md` (`deno task docs-sync-schemas`).
- A new pattern/convention → mention in `CODE_STYLE.md`.

Missing User Guide updates: 🔴 Critical (blocking). Other missing doc updates: 🟡 Major.

### Phase 10 — Classify and Report

Findings table:

| # | File | Line/Symbol | Severity | Finding |
| - | ---- | ----------- | -------- | ------- |
| 1 | `packages/<package>/src/<module>.ts` | `functionName` | 🔴 Critical | <description> |

Severity scale:

| Symbol | Meaning |
| ------ | ------- |
| 🔴 Critical | Blocks correctness or breaks an invariant — fix before merge |
| 🔒 Security | Security control missing or bypassed (OWASP Top 10) |
| 🟡 Major | Significant quality or coverage gap — should fix before merge |
| 🟠 Testing | Missing or inadequate test — may ship without coverage |
| 🔵 Minor | Style, naming, or low-risk omission — fix in follow-up |

## Related

- [AGENTS.md](../../../AGENTS.md#behavioral-guidelines) — behavioral guidelines
- [CODE_STYLE.md](../../../CODE_STYLE.md) — naming, type, import, constants rules

## Output Format

1. **Review verdict** — ✅ Approved / ⚠️ Approved with minor issues / ❌ Changes requested.
1. **Findings table** — all categorised findings.
1. **Detail section** — one paragraph per Critical/Security finding (risk + required fix).
1. **Suggested next action** — `#fix-bug` per Critical/Security finding, or `#commit` if clean.

## Examples

- `#review-code` scoped to a source file + its test
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
