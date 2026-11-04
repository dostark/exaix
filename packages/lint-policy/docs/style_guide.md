---
title: "Exaix Lint Policy Style Guide"
description: Exaix-specific style rules enforced by the lint-policy package, split out of the generic style guide
agent_priority: mandatory
copilot_knowledge_base: true
capabilities: [linting_rules, naming_conventions]
links:
  - "unslop-ts/docs/style_guide.md"
  - "packages/lint-policy/docs/style_rules.md"
---

> The Exaix additions to the generic TypeScript rules in
> [unslop-ts/docs/style_guide.md](../../../unslop-ts/docs/style_guide.md). Read the generic guide first. This
> guide changes a rule only where it says so.
>
> - `unslop.config.json` sets every rule id, severity, scope, option, and limit.
> - [style_rules.md](./style_rules.md) is the generated reference for the compiled policy.
> - [docs/CODE_STYLE.md](../../../docs/CODE_STYLE.md) holds the rules that exist only because of the Exaix
>   architecture.

## Magic Values {#magic-values}

The generic guide defines the rule and the detector: [No Magic Values](../../../unslop-ts/docs/style_guide.md#no-magic-values).
This section records how Exaix runs it.

### Running the check

Run `deno task check:magic`. The host script `packages/lint-policy/src/checkers/check_magic_values.ts`
reads every `.ts` and `.tsx` file of the repository and calls the engine detector. The pre-commit hook and
`deno run -A scripts/ci.ts check` run it as a gate.

The host skips these files:

- test files, unless you pass `--include-tests`;
- fixtures under `tests/fixtures/`;
- the `scripts/` and `.copilot/` folders;
- the engine submodule and the checkers' own sources.

| Option                             | Effect                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| `--no-numbers` or `--strings-only` | Skips number literals                                  |
| `--include-tests`                  | Scans test files                                       |
| `--local-string-threshold=N`       | Overrides the module threshold for strings (default 3) |
| `--global-string-threshold=N`      | Overrides the global threshold for strings (default 5) |
| `--local-number-threshold=N`       | Overrides the module threshold for numbers (default 4) |
| `--global-number-threshold=N`      | Overrides the global threshold for numbers (default 6) |

The thresholds are the engine defaults, because the catalog does not change them. The `wholeTree.magicLiterals`
section of the catalog adds three things: the extra string `other`, a list of domain status words
(`pending`, `resumed`, `fulfilled`, `rejected`, `amended`, `expired`, `cancelled`), and the structural list
properties `capabilities` and `tags` on top of the engine defaults. A `checkNumbers: false` value in the catalog
turns number checks off. A command-line flag can turn them off, but no flag turns them on.

### Duplicate constants

The same pass looks for a top-level constant that two files in `packages/` or `apps/` declare with the same name
and value. Keep one owner and import it. An allow entry in the catalog needs a reason, and the check fails when
an entry no longer matches a duplicate.

### Union types

Define an inline union of string literals as an enum in `packages/core/src/types/enums.ts`, or as a shared
named union type. The active `exaix/magic-union-type` rule checks production files and excludes test scope.

## Canonical Subpackage Boundary {#canonical-subpackage-boundary}

Extends [No Re-exporting](../../../unslop-ts/docs/style_guide.md#no-re-exporting) for package entry points.

### Package entry points

A package entry point, such as `mod.ts` or `index.ts`, may re-export interfaces, types, and values that other
modules of the same package define. The catalog excludes these files from `exaix/re-export-imported`. An entry
point must not re-export from another package or from the retired root `src/` folder. The `package-boundary`
check reports a relative import that reaches another package or the retired folder. The
entry-point zone of `exaix/import-boundaries` reports an entry point that names the retired folder.

```ts
// packages/core/mod.ts
export * from "../ai/src/provider.ts"; // ❌ Forwards code of another package
```

### Canonical subpackages

When the root import map exposes an exact alias for a subpackage, such as `@exaix/core/status` or
`@exaix/ai/providers`, the parent package entry point must not re-export that subpackage. Consumers import
subpackage symbols from the subpackage alias. The `package-subpath-promotion` check reports a violation.

```ts
// packages/core/mod.ts
export * from "./src/status/mod.ts"; // ❌ Import from @exaix/core/status instead
export { RetryPolicy } from "./src/request/retry_policy.ts"; // ❌ Import from @exaix/core/request instead
```

**Exception:** a package may export the symbols of the modules that define its own root API, even when the
import map also has a grouping alias for them. The check treats `@exaix/core/types` as such a grouping, so
`@exaix/core` may export those contracts.

```ts
// packages/core/mod.ts
export { PortalAnalysisMode, PortalExecutionStrategy, PortalOperation, PortalStatus } from "./src/types/portal.ts";
```

## Interface Aliasing Exception {#interface-aliasing-exception}

Extends [Interface Conventions](../../../unslop-ts/docs/style_guide.md#interface-conventions).

The catalog excludes one file, `packages/core/src/parsing/markdown.ts`, from `exaix/no-interface-rename-on-import`.
Do not rename an interface on import anywhere else. The file has no interface rename now, so the exclusion has
no effect today.

## Unslop Isolation {#unslop-isolation}

unslop-ts stays independent of Exaix, and the Exaix runtime holds no unslop code. The
`exaix/unslop-isolation` rule reports any module outside `packages/lint-policy/` whose file name
contains `unslop`, and any import of `@dostark/unslop-ts` or a `unslop-ts/` path there. The rule
runs at `scope: all` with no path exclusion, so scripts and tests follow the same rule as production
modules. A portal uses unslop-ts through an installed policy directory and its lint configuration,
not through Exaix modules.

```ts
// packages/execution/src/unslop_adapter.ts   ❌ An unslop module outside lint-policy
import { parseCatalog } from "@dostark/unslop-ts"; // ❌ An engine import outside lint-policy
```

`packages/lint-policy/` is the only owner of engine tooling: the policy compiler and plugin, the
rule pack, the style checkers, and the portal tools under `src/tools/`.

## Comment Discipline Additions {#comment-discipline-additions}

Extends [Comment Discipline](../../../unslop-ts/docs/style_guide.md#comment-discipline).

- **Phrases to avoid.** The catalog adds these phrases to `exaix/ephemeral-comment`: a phase or step number, a
  GAP identifier, a pre-gap or post-gap reference, gap analysis details, "tried", "didn't work", and the `§`
  symbol for a section reference. The module header follows the same rule. It names no plan phase or step.
- **Where long explanations go.** Put a longer explanation in a README, in `ARCHITECTURE.md`, or in the matching
  document under `exaix-dev-docs/`. Do not put it in the source.
- **Write comments in ASD-STE100 and the Exaix STE Extension v1.** This applies to line comments, block
  comments, module headers, and JSDoc descriptions. Write short, result-first prose:
  - at most 20 words in a sentence;
  - no semicolons;
  - at most six descriptive sentences in a paragraph.

  Keep directives, JSDoc tags, identifiers, commands, one-line literals, and exact quotations as they are. Keep
  the invariants and the reason that a reader needs. Leave out self-reflection and facts that the code already
  shows. Bullets are allowed when they make steps easier to scan, within the three-line comment limit. The
  exemption that applies to documentation files does not apply to comments in source. The
  `deno task check:ste100-comments:staged` gate checks staged files.

## Test Assertions {#test-assertions}

This section overrides the generic guide's Test Assertions section for Exaix. Prefer an assertion that shows the
actual and expected values when it preserves the original behavior. For a known string substring check,
`assertStringIncludes(text, part)` can show more useful failure output than a boolean assertion.

Do not replace `Array.includes` blindly. It uses SameValueZero and compares objects by identity, while
`assertArrayIncludes` uses structural equality for objects. Preserve the original predicate when identity or
SameValueZero matters. A boolean assertion remains appropriate when a helper would change the meaning. A named
boolean alone does not improve its failure output. Add a descriptive message where practical, without coercing the
subject merely to use an assertion helper.

```ts
assertStringIncludes(output, "ready");

const hasExpectedObject = items.includes(expectedObject);
assert(hasExpectedObject, "Expected the same object in the items");
```

When rewriting an assertion, preserve its true or false expectation, message, argument order, and evaluation count.
The repeated-call rule reports adjacent assertions with the same call as their first argument. Reuse one result only
when the call is pure and the test intends one evaluation. Keep separate calls and results for stateful behavior.

The constant-substring rule identifies a named imported uppercase constant used as the subject of the configured
substring assertion forms. Assert a consumer's behavior, or an independent expected value when that value is the
contract. An imported constant used as the expected substring is not the reported subject. Namespace imports and
other assertion forms are outside this detector's current matching scope; that does not make a tautological test useful.

`exaix/no-constant-substring-assert`, `exaix/no-repeated-assert-call`, and the syntactic
`exaix/no-boolean-assert` rule are active. A match is not proof of a weak test, and clearing a match does not
prove better diagnostics.

## Error Inputs {#error-inputs}

Extends [No `unknown` as a stored type](../../../unslop-ts/docs/style_guide.md). The `exaix/no-explicit-unknown` rule
allows `unknown` only for a catch binding and a type-predicate subject. A read-only consumer of a thrown value takes
the value through a generic parameter instead of storing `unknown`.

- A consumer declares `<TError>(..., error: TError, ...)`. It still admits every value that code can throw, and it keeps
  the value's identity and its subclass. The generic is an incoming boundary only. Narrow the value with the existing
  runtime checks before reading a member. Do not relabel a top type with an alias.
- `IRejectedPlanHandler.handleError<TError>` in `packages/request/src/rejected_plan_handler.ts` follows this form. It is
  still exported through `packages/request/src/mod.ts` as `@exaix/request`, so an existing handler stays assignable in
  both directions.
- The `FlowRunner` recovery methods return the final `IStepResult` and do not return an object that carries an untyped
  error. `IStepResult` is still owned by `packages/flow/src/flow_runner.ts` and exported through `packages/flow/mod.ts` as
  `@exaix/flow`. No shared error alias, wrapper class or barrel exists for this contract.

## Enforcement Status {#enforcement-status}

The version 2 input is `unslop.config.json`; the separate `layout.json` holds path tokens. Management
writes use `unslop:write`. The report tasks are `lint:report` and `lint:report:write`. The
version 1 file `../tests/fixtures/catalog_v1.json` is a maintained compatibility baseline. Each activation updates its
legacy severity and opt-in fields, so it is not frozen activation state.

The version 2 policy gives every rule a status. Check `unslop.config.json` or the generated
[style_rules.md](./style_rules.md) for the details of one rule.

- **Plugin gates (`severity: error`):** `exaix/barrel-only-reexports`, `exaix/decorative-comment`, `exaix/dynamic-import`,
  `exaix/ephemeral-comment`, `exaix/ephemeral-filename`, `exaix/exported-interface-naming`,
  `exaix/exported-interface-placement`, `exaix/ignore-needs-reason`,
  `exaix/import-boundaries`, `exaix/import-inside-statement`, `exaix/import-placement`, `exaix/inline-type-import`,
  `exaix/long-comment`, `exaix/magic-union-type`, `exaix/max-cognitive-complexity`, `exaix/max-cyclomatic-complexity`,
  `exaix/max-function-lines`, `exaix/max-params`, `exaix/no-boolean-assert`, `exaix/no-chained-type-assertions`, `exaix/no-constant-substring-assert`,
  `exaix/no-explicit-unknown`, `exaix/no-forbidden-lint-ignore`, `exaix/no-interface-rename-on-import`,
  `exaix/no-object-parameters`, `exaix/no-pass-through-type-alias`, `exaix/no-repeated-assert-call`,
  `exaix/no-typeof-escape`, `exaix/no-unsafe-dictionary`,
  `exaix/promise-response-alias`,
  `exaix/promise-response-return`,
  `exaix/re-export-imported`, `exaix/require-deno-shebang`,
  `exaix/require-module-header`, `exaix/require-script-usage`, `exaix/test-inline-multiline-fixture`,
  `exaix/ts-suppression-pragmas`, and `exaix/unslop-isolation`.
- **Test-scoped plugin gates (`scope: test`):** `exaix/no-boolean-assert`, `exaix/no-constant-substring-assert`,
  `exaix/no-repeated-assert-call`, and `exaix/test-inline-multiline-fixture`. Production files are out of their scope.
- **Production-scoped plugin gates (`scope: prod`):** `exaix/magic-union-type`. Test files are out of its scope.
- **Parked plugin rules (`severity: off`, opt-in):**
  `exaix/max-class-size`,
  `exaix/no-conditional-empty-object-spread`,
  `exaix/no-runtime-typeof`,
  `exaix/prefer-named-imports`,
  `exaix/require-optional-wrapper`, and `exaix/require-safety-comment`.
- **Script gates (`engine: script`, `severity: error`):** `duplicate-constant`, `duplicate-type`,
  `edition-conditional-outside-composer`, `edition-leak`, `module-header-tag`, `package-boundary`,
  `package-canonical-import`, `package-instantiates-event-logger`, `package-related-files-boundary`,
  `package-subpath-promotion`, `package-testing-import`, and `script-placement`.
- **Script warnings (`engine: script`, `severity: warn`):** `concrete-cross-domain`, `layer-constant-leak`,
  `package-concrete-logger-type`, and `package-uses-config-reader`.

Plugin rules run with `deno task lint`. Script rules run with `deno task check:style` and
`deno task check:magic`. To run a parked rule, list it in the `EXAIX_LINT_RULES` environment variable.

A parked rule has findings that nobody has fixed yet. The rule-ceiling ratchet holds each of them at a measured
count per package, in `packages/lint-policy/rule_ceilings.json`. The count can fall but cannot rise, and a rule
becomes a gate when its count reaches zero. Two parked rules have no ceiling for other reasons:
`exaix/max-class-size` runs through a separate manual task, and `exaix/require-optional-wrapper` is enforced on
staged files by `deno task check:optional-params:staged`.

Lower a ceiling to the new count in the same change that reduces the count.

Two parked rules are ratchet-only on purpose: `exaix/require-safety-comment` and `exaix/no-runtime-typeof`. Fixing
their findings needs a design change, not a lint burn-down. A mass of `SAFETY:` comments would add noise, and a
`typeof` check at a boundary needs schema validation. Reduce them when a change touches the code.

The engine still defines `exaix/no-conditional-empty-object-spread`, but Exaix does not select it and keeps no ceiling
for it. A spread of a conditional with an empty branch is the correct way to omit a field that has no value, because a
missing field is not the same as `undefined`.
