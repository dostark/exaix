---
name: review
agent: senior-coder
tools:
  - read_file
  - search_files
  - run_command
scope: dev
title: "Review Skill (#review)"
description: Systematic code review — correctness, security, test coverage, architecture, and Exaix conventions
short_summary: "Autonomous code review against Exaix standards: correctness, security (Phase 3b), test coverage, architecture grounding, and style compliance."
version: "1.0"
topics: ["code-review", "quality-assurance", "security", "testing", "architecture", "best-practices"]
qwen_skill: review
---

```text
Key points
- Review code against Exaix standards, not just generic style.
- Always check security (Phase 3b) for any change touching external input,
  file paths, auth, secrets, or network calls.
- Test coverage is mandatory: every new code path needs a named test.
- Architecture grounding: every new src/ file must have a module-header
  JSDoc and pass deno task check:arch.
- Report findings as categorised, actionable items — not vague suggestions.
- When reviewing more than ~20 files, work in batches of 5–10: read a batch, record findings, then continue.

Canonical prompt (short):
"Review <files or diff> for correctness, security, test coverage, and
Exaix architecture compliance. Report findings as Critical / Major / Minor."

Examples
- "#review src/services/vault_service.ts and tests/services/vault_service_test.ts"
- "#review — review all staged changes before merging to main"

Do / Don't
- ✅ Do read the actual source files — never review from memory.
- ✅ Do check for missing tests on every new code path (not just coverage %).
- ✅ Do apply Phase 3b security checks for any input/FS/auth/secrets/network change.
- ✅ Do verify all new interfaces are exported from index/barrel files.
- ✅ Do check for magic strings/numbers that belong in constants.
- ✅ Do check that module-header JSDoc is present in every new src/ file.
- ✅ Do verify constructor DI matches the established Exaix service pattern.
- ✅ Do categorise every finding: 🔴 Critical / 🔒 Security / 🟡 Major / 🟠 Testing / 🔵 Minor.
- ✅ When reviewing your own output, prioritize edge cases and error paths you may have under-specified — not just correctness of what you wrote.
- ❌ Don't report style nitpicks as Critical.
- ❌ Don't approve a change that has no tests for new logic.
- ❌ Don't skip security checks — even for "small" changes.
- ❌ Don't suggest refactoring out of scope unless it is blocking correctness.

Related skills:
- #fix      — Implement a fix for a Critical finding
- #security — Deep security audit (when 3+ security findings exist)
- #commit   — Structured commit after implementing review fixes

Workflow chain:
  #next-steps (implement) → **#review** → #fix (if needed) → #commit
```

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

### Phase 4 — Architecture & Exaix Conventions

Check every new or modified source file:

- **Module header** — Does it have `/** @module ... @path ... @description ... */`?
- **Architectural layer** — Is the layer (`@architectural-layer`) correct for the file location?
- **DI pattern** — Constructor-based injection; no service instantiation inside constructors.
- **Interface naming** — Exported interfaces start with `I`; no bare `Foo` interfaces.
- **Magic values** — No hardcoded strings or numbers that belong in `src/shared/constants.ts`.
- **Record types** — No `Record<string, unknown>`; define a specific interface instead.
- **EventLogger** — Every state transition emits a typed event with a named payload interface.
- **Exports** — Every new interface/type is exported from the appropriate index file.
- **check:arch** — Would `deno task check:arch` pass? (all new files must be GROUNDED)

---

### Phase 5 — Test Coverage

For every new code path:

- Is there a named unit test?
- Is there a named integration test (where applicable)?
- Are edge cases covered (empty input, null, max size, error path)?
- Are tests using the correct helpers (`initTestDbService`, `createCliTestContext`, etc.)?
- Are test names descriptive ("returns X when Y", not "test 1")?
- Are timer-based TUI tests using `sanitizeOps: false, sanitizeResources: false`?

---

### Phase 6 — Documentation Compliance (§3D)

If the change introduces or modifies:

- A public interface or schema → `ARCHITECTURE.md` should be updated.
- A CLI flag or user-facing behaviour → `docs/Exaix_User_Guide.md` should be updated.
- An MCP tool handler → `TOOLS.md` should be updated (`deno task docs-sync-schemas`).
- A new pattern or convention → `CODE_STYLE.md` should mention it.

Flag missing doc updates as 🟡 Major.

---

### Phase 7 — Classify and Report

Build a findings table:

| # | File      | Line/Symbol    | Severity    | Finding       |
| - | --------- | -------------- | ----------- | ------------- |
| 1 | `src/...` | `functionName` | 🔴 Critical | <description> |
| 2 | `src/...` | `fieldName`    | 🔒 Security | <description> |

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

- [CODE_STYLE.md](../../CODE_STYLE.md) — authoritative naming, type, import, and constants rules

## Output Format

1. **Review verdict** — ✅ Approved / ⚠️ Approved with minor issues / ❌ Changes requested.
2. **Findings table** — all categorised findings.
3. **Detail section** — one paragraph per Critical or Security finding explaining the risk
   and the required fix.
4. **Suggested next action** — use `#fix` for each Critical/Security finding, or
   `#commit` if the review is clean.
