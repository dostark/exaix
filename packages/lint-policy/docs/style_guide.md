---
title: "Exaix Lint Policy Style Guide"
description: Exaix-specific style rules enforced by the lint-policy package, split out of the generic style guide
agent_priority: mandatory
copilot_knowledge_base: true
capabilities: [linting_rules, naming_conventions]
links:
  - "packages/lint-rules/docs/style_guide.md"
  - "packages/lint-policy/docs/style_rules.md"
---

> The Exaix-specific additions to the generic TypeScript style rules in
> [packages/lint-rules/docs/style_guide.md](../../lint-rules/docs/style_guide.md). Rule ids and
> severities come from `packages/lint-policy/catalog.json`; the generated reference is
> [style_rules.md](./style_rules.md). `CODE_STYLE.md` holds the remaining Exaix rules.

## Magic Values {#magic-values}

### Automated Enforcement

A dedicated AST-based script (`packages/lint-policy/src/checkers/check_magic_values.ts`) scans the entire
codebase using the TypeScript compiler API to detect repeated literals that
should be extracted into named constants or enums. It is invoked as part of the
pre-commit gates via `deno task check:magic` (or directly:
`deno run -A packages/lint-policy/src/checkers/check_magic_values.ts`).

**Detection thresholds** (the script's actual defaults — keep this table in sync with
`packages/lint-policy/src/checkers/check_magic_values.ts` `--local-*-threshold` / `--global-*-threshold`):

| Scope  | String literals | Number literals |
| ------ | --------------- | --------------- |
| Module | > 3 occurrences | > 4 occurrences |
| Global | > 5 occurrences | > 6 occurrences |

**Whitelisted values (never flagged):**

- Strings: `""`, `" "`, `"\n"`, `"\t"`, `"true"`, `"false"`, `"null"`,
  `"undefined"`
- Numbers: `0`, `1`, `-1`, `100`, `1000`
- Strings shorter than 3 characters that don't start with a lowercase letter
  (e.g., `"ID"`, `"OK"` are allowed; `"ab"` is not flagged)

- **Magic string unions.** Avoid inline string literal unions (e.g., `"a" | "b"`)
  directly in functional code. These are difficult to maintain and track.
  Instead, define a TypeScript `enum` in the appropriate package or a shared named type alias.
  This rule is enforced as an error in production code.

## Canonical Subpackage Boundary {#canonical-subpackage-boundary}

Extends the generic "No Re-exporting" rule.

**Canonical subpackage boundary:** if the root import map exposes an exact canonical subpackage alias such as `@exaix/core/status` or `@exaix/ai/providers`, the parent package entrypoint must not promote that subpackage's exports through `@exaix/core` or `@exaix/ai`. Keep the boundary explicit: consumers import subpackage-owned symbols from the canonical subpackage barrel, not from the parent package barrel.

**Root-owned surface exception:** a package may still expose symbols from modules that define the parent package's primary root API even if the import map also offers a convenience grouping alias for that root-owned surface. In this repository, `@exaix/core/types` is treated as a root-owned grouping, so `@exaix/core` may continue to export those contracts.

```ts
// packages/core/mod.ts
export type { IToolRegistry } from "./src/interfaces/i_tool_registry.ts";
export type { IActivityRecord } from "./src/types/database.ts";
export { PortalOperation } from "./src/enums.ts";
```

**Prohibited in parent package entrypoints when a canonical subpackage barrel exists:**

```ts
// packages/core/mod.ts
export * from "./src/status/mod.ts"; // ❌ Import from @exaix/core/status instead
export { RetryPolicy } from "./src/request/retry_policy.ts"; // ❌ Import from @exaix/core/request instead
```

## Interface Aliasing Exception {#interface-aliasing-exception}

Extends the generic "No Aliasing Interfaces on Import" rule.

**Exception:** Aliasing is permitted in `packages/core/src/parsing/markdown.ts` when used for backward compatibility shims or interface compatibility bridges.

## Comment Discipline Additions {#comment-discipline-additions}

Extends the generic "Comment Discipline" rules. Longer explanations belong in a README,
`ARCHITECTURE.md`, or the relevant `exaix-dev-docs/` document, not inline in source.

- **Comment prose follows ASD-STE100 and Exaix STE Extension v1.** Write
  line/block comments, module headers, and JSDoc descriptions as concise,
  result-first prose under the shared Issue 9 limits: at most 20 words per
  sentence, no semicolons in eligible prose, and at most six descriptive
  sentences per paragraph.
  Preserve directives, JSDoc tags, identifiers, commands, one-line literal
  spans, and exact quotations. Keep necessary invariants and rationale;
  omit self-reflection and facts already clear from the code. Bullets are
  allowed when they make steps easier to scan, within the existing
  three-line limit. Documentation-file exemptions do **not** exempt
  source-comment prose.

## Enforcement Status {#enforcement-status}

How the generic type-safety rules are enforced in this repository today. Severities come from
`packages/lint-policy/catalog.json`.

- **Gates (`severity: error`):** `exaix/no-chained-type-assertions`,
  `exaix/no-pass-through-type-alias`, and the style-checker rules
  `ts-suppression-pragmas`, `deno-lint-no-explicit-any`, `promise-response-alias`,
  and `promise-response-return`.
- **Parked (`severity: off`, opt-in):** `exaix/no-explicit-unknown`,
  `exaix/no-any-escape`, `exaix/no-unsafe-dictionary`, and
  `exaix/no-object-parameters`. The rule-ceiling ratchet holds each one at a
  measured count, so the count can only fall. Each rule becomes a gate when its
  count reaches zero.
