---
title: "check_code_style.ts — Error Tag Reference"
description: Complete reference for all error and warning tags emitted by scripts/check_code_style.ts
agent_priority: reference
copilot_knowledge_base: true
version: 1.0
capabilities: [error_tags, boundary_rules, import_rules]
links:
  - "scripts/check_code_style.ts"
  - "CODE_STYLE.md"
  - "ARCHITECTURE.md"
---

# `check_code_style.ts` — Error Tag Reference

This document is the companion reference for `scripts/check_code_style.ts`.
It lists every error and warning tag the script emits, the rule that governs
it, and where to read the full definition.

Run the checker:

```bash
deno run -A scripts/check_code_style.ts          # scan whole repo
deno run -A scripts/check_code_style.ts src/      # scan a subtree
deno run -A scripts/check_code_style.ts --convert-warnings-to-errors
```

---

## Type Safety

| Tag                           | Severity | Rule (CODE_STYLE.md) | What it detects                                             |
| ----------------------------- | -------- | -------------------- | ----------------------------------------------------------- |
| `[explicit-any-array]`        | error    | §1                   | `: any[]` type annotation                                   |
| `[explicit-unknown]`          | error    | §1                   | `: unknown` as a stored type (outside `catch`)              |
| `[explicit-unknown-array]`    | error    | §1                   | `: unknown[]` type annotation                               |
| `[unknown-type-alias]`        | error    | §1                   | Type alias that renames raw `unknown`                       |
| `[promise-response-alias]`    | error    | §1                   | Type alias that masks `Promise<Response>`                   |
| `[promise-response-return]`   | error    | §1                   | `Promise<Response>` as a return type                        |
| `[ts-suppression-pragmas]`    | error    | §1                   | `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` pragmas     |
| `[deno-lint-no-explicit-any]` | error    | §1                   | `// deno-lint-ignore no-explicit-any` comment               |
| `[explicit-any-cast]`         | error    | §1                   | `as any` cast (production files only)                       |
| `[typeof-cast]`               | error    | §1                   | `as typeof <var>` cast (except `globalThis.fetch` in tests) |
| `[double-cast]`               | error    | §1                   | `as unknown as` double cast                                 |
| `[record-any]`                | error    | §1                   | `Record<string, any>` type                                  |
| `[record-unknown]`            | error    | §1                   | `Record<string, unknown>` type                              |
| `[index-signature-unknown]`   | error    | §1                   | `{ [key: string]: unknown }` index signature                |

---

## Import Rules

| Tag                                      | Severity | Rule | What it detects                                                    |
| ---------------------------------------- | -------- | ---- | ------------------------------------------------------------------ |
| `[import-inside-statement]`              | error    | §3   | `import(...)` nested inside a function, condition, or loop         |
| `[dynamic-import]`                       | warn     | §3   | `import(...)` without a rationale comment above it                 |
| `[inline-type-import]`                   | error    | §3   | `import("./foo").IFoo` inside a type annotation                    |
| `[re-export-imported]`                   | error    | §3   | Re-exporting an imported entity outside `mod.ts` / `index.ts`      |
| `[package-entrypoint-root-src-reexport]` | error    | §3   | Package entrypoint (`mod.ts`) re-exporting from repo `src/*` paths |
| `[no-interface-rename-on-import]`        | error    | §3   | Aliasing an `I`-prefixed interface on import (e.g., `IFoo as Foo`) |
| `[import-placement]`                     | error    | §7   | Import declared after an interface/type or after functional code   |

---

## Magic Values

| Tag                  | Severity | Rule | What it detects                                                    |
| -------------------- | -------- | ---- | ------------------------------------------------------------------ |
| `[magic-union-type]` | error    | §2   | Inline string literal union (e.g. `"a" \| "b"`) in production code |

---

## Module Structure

| Tag                              | Severity | Rule | What it detects                                                        |
| -------------------------------- | -------- | ---- | ---------------------------------------------------------------------- |
| `[module-header]`                | warn     | §7   | File has no descriptive header comment                                 |
| `[module-header-tag]`            | error    | §7   | Header is missing a mandatory tag (`@module`, `@path`, `@description`) |
| `[exported-interface-naming]`    | error    | §5   | Exported interface name does not start with a capital `I`              |
| `[exported-interface-placement]` | error    | §5   | Exported interface declared after functional code                      |
| `[max-params]`                   | error    | §11  | Function or method with more than 7 parameters                         |

---

## Scripts

| Tag                  | Severity | Rule | What it detects                                              |
| -------------------- | -------- | ---- | ------------------------------------------------------------ |
| `[script-shebang]`   | error    | §12  | Script in `scripts/` missing `#!/usr/bin/env -S deno run -A` |
| `[script-usage]`     | error    | §12  | Script header missing a `Usage:` section                     |
| `[script-placement]` | error    | §12  | Debug/temp script (`debug_*`, `tmp_*`) inside `scripts/`     |

---

## TUI Boundary

| Tag                           | Severity | Rule | What it detects                                             |
| ----------------------------- | -------- | ---- | ----------------------------------------------------------- |
| `[tui-boundary-cli]`          | error    | §8   | TUI module importing from `src/cli/`                        |
| `[tui-boundary-services]`     | error    | §8   | TUI module importing from `src/services/` (except adapters) |
| `[tui-boundary-config]`       | error    | §8   | TUI module importing from `src/config/`                     |
| `[tui-boundary-helpers]`      | error    | §8   | TUI module importing from `src/helpers/`                    |
| `[core-boundary-tui-helpers]` | error    | §8   | Non-TUI module importing from `src/tui/helpers/`            |

---

## CLI Boundary

| Tag                           | Severity | Rule | What it detects                                                             |
| ----------------------------- | -------- | ---- | --------------------------------------------------------------------------- |
| `[cli-boundary-services]`     | error    | §9   | CLI command/handler/formatter importing from `src/services/` (not adapters) |
| `[cli-boundary-config]`       | error    | §9   | CLI command/handler/formatter importing from `src/config/service.ts`        |
| `[core-boundary-cli-helpers]` | error    | §9   | Non-CLI module importing from `src/cli/helpers/`                            |

---

## Package Boundaries

These tags enforce that files under `packages/<name>/` remain self-contained.
See [CODE_STYLE.md §4](../CODE_STYLE.md#package-test-boundaries) for the test
boundary rules and [§13](../CODE_STYLE.md#package-module-purity) for the
module purity rules.

| Tag                                   | Severity | What it detects                                                                                |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `[package-boundary]`                  | error    | Package file importing from `src/`, `tests/`, or another package via relative path             |
| `[package-src-boundary]`              | error    | Package file importing a retired root implementation path (e.g., `src/services/core/db.ts`)    |
| `[package-related-files-boundary]`    | error    | Package module `@related-files` header pointing at a retired root path                         |
| `[package-subpath-promotion]`         | error    | Parent package entrypoint (`mod.ts`) re-exporting a canonical subpackage surface               |
| `[package-testing-import]`            | error    | Test file deep-importing from `packages/<name>/tests/` when `@exaix/<name>/testing` exists     |
| `[package-canonical-import]`          | error    | File importing a package path that should use a declared `@exaix/...` alias instead            |
| `[package-instantiates-event-logger]` | error    | Package `src/` file calling `new EventLogger(` (see §13 — package module purity)               |
| `[package-concrete-logger-type]`      | warn     | Package `src/` file importing concrete `EventLogger` class instead of `IEventLogger` (see §13) |
| `[package-uses-config-reader]`        | warn     | Package `src/` file calling `getValidatedEnvOverrides()` or `new ConfigService(` (see §13)     |

---

## Test Quality

| Tag                               | Severity | What it detects                                                                  |
| --------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `[test-inline-multiline-fixture]` | warn     | Inline multiline YAML/Markdown/JSON fixture in a test file (move to `fixtures/`) |

---

## Exclusion Comments

Warnings (not errors) may be suppressed with a `// style-exclude:<CODE> - <rationale>` comment
on the line immediately above the flagged line. Valid codes are listed in
`scripts/style_warning_exclusions.json`. Errors cannot be suppressed this way.

---

## Exemptions

The following locations are permanently exempt from specific package boundary rules:

| Exempt path               | Reason                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/core/`          | Defines the runtime entities (`EventLogger`, `ConfigService`) that other packages must not use |
| `packages/mcp/server/`    | Declared bridge zone — concrete runtime wiring between package contracts and the MCP server    |
| `src/services/core/db.ts` | Legacy compatibility shim — exempt from `re-export-imported` rule                              |
| `tests/helpers/`          | Root testing compatibility shims — exempt from `re-export-imported` rule                       |
