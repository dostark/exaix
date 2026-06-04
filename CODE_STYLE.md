---
title: "Code Style & Standards"
description: Coding standards and stylistic requirements for Exaix
agent_priority: mandatory
copilot_knowledge_base: true
version: 1.2
capabilities: [linting_rules, naming_conventions, testing_patterns]
links:
  - "packages/core/src/constants.ts"
  - "scripts/check_code_style.ts"
  - "scripts/check_code_style.md"
copilot_instructions: .copilot/blueprints/senior-coder.md
---

> 🚨 Original documents now point to this file for the authoritative style rules.

---

## 1. Strict Type Safety {#strict-type-safety}

- **Every** variable, parameter, return value, and data structure **must** have an
  explicit type annotation. Never rely on implicit inference to avoid writing a
  type.
- **No `any`.** Explicit `any` and implicit `any` (from missing annotations) are
  forbidden. Use generics (`<T>`), named interfaces, or Zod-inferred types.
- **No `as any` casting.** Do not bypass the type system; use proper guards,
  narrowing, or define the correct type instead.
- **No `as typeof var` casting.** This is equivalent to `any` and defeats
  safety – define explicit interfaces or use proper inference.
- **No `unknown` as a stored type.** `unknown` may only appear briefly inside a
  `catch (e: unknown)` block or during runtime narrowing. It must **never** be
  used as a parameter type, return type, field type, or alias. Name the shape
  with an interface or a type alias instead.
- **No double casting (`... as unknown as ...`).** This pattern hides bugs and is
  prohibited. Use type guards or structural typing to narrow correctly.
- **No TypeScript suppression pragmas.** Never use `@ts-expect-error`,
  `@ts-ignore`, `@ts-nocheck`, or similar comments to bypass the compiler. All
  type errors must be resolved by writing correct types or refactoring the
  code; suppressing them defeats the purpose of TypeScript and is strictly
  prohibited. (This rule applies equally in test code.)
- **No lint ignores for `any`.** Never add
  `// deno-lint-ignore no-explicit-any` to silence problems. Address the root
  cause with proper typing.
- **No `Promise<Response>` return types.** Using `Promise<Response>` as a
  function return type is prohibited because it hides the actual response
  structure. Instead, define a specific interface describing the expected
  response shape and return `Promise<YourResponseType>`. This ensures callers
  have proper type information and prevents runtime errors from unexpected
  response formats.
- **No aliasing raw `unknown` or `Promise<Response>`.** Do not create type
  aliases that merely rename a weak type, such as `type UnknownValue = unknown;`
  or `type MockFetch = () => Promise<Response>;`. These fake aliases disguise
  poor typing and make it harder to reason about actual data shapes. Define the
  real structure explicitly with a named interface or type alias, or use runtime
  validation and narrow from `unknown` at the point of access.
- **No deceptive type aliases for mocks.** Do not create type aliases like
  `type MockFetch = () => Promise<Response>` to hide weak typing. This pattern
  is deceptive because it gives the appearance of strong typing while still
  obscuring the actual response structure. Instead:
  - Use `as typeof globalThis.fetch` when mocking fetch in tests – this
    preserves the actual fetch signature and is the recommended approach
  - Define interfaces with specific response types for custom mocks
  - Use dependency injection with properly typed interfaces
- **No `as typeof <var>` casting in production code.** Casting via
  `as typeof variable` is treated as an 'any' escape and is forbidden in
  production code. Exception: `as typeof globalThis.fetch` is allowed in test
  code for mocking the fetch API, as this preserves the correct type signature.
- **Intersection type extensions.** Casting that includes an intersection (e.g., `as typeof Deno & { ... }`) is permitted to extend global or core namespaces with additional properties.
- **Always name it.** If a type doesn't exist yet, create one explicitly. When
  the keys are known, prefer specific interfaces over `Record<string, …>`.
- **No `Record<string, any>`.** This type is extremely weak and effectively
  re-introduces `any` for every property. Define a precise interface or type
  alias describing the expected shape.

- **No `Record<string, unknown>` or `{ [key: string]: unknown }`.** Both are prohibited. Instead:
  - Define a specific interface describing the expected shape
  - Use a type alias for known structures (but not as a mask for `Record<string, unknown>` or `{ [key: string]: unknown }`)
  - Use generics with constraints when the structure varies
  - When the structure is truly dynamic, use a runtime schema validator (e.g., Zod) and narrow from `unknown` at the point of access

- **No masking type aliases.** Do not create type aliases that simply mask or rename `Record<string, unknown>` or `{ [key: string]: unknown }` (e.g., `type CopilotObject = Record<string, unknown>`). This is strictly prohibited. Always define a specific interface or use runtime validation and proper narrowing.

These rules are enforced by linting and are referenced by multiple existing
checklists (pre‑commit, CI, etc.).

---

## 2. No Magic Numbers or Strings {#no-magic-values}

- Never hardcode numeric literals or string constants in production or test code
  (timeouts, status values, provider names, etc.).
- **User‑configurable values** belong in `exa.config.sample.toml` with a
  comment, the matching Zod schema (`packages/core/src/config/schema.ts`), and a default in
  `packages/core/src/config/constants.ts` (the config service handles loading).
- **Internal constants** belong in a module‑scoped `constants.ts` file within the relevant package. Use descriptive names and group related values.
- **CLI/TUI defaults** go in `apps/exactl/src/cli.config.ts` or
  `packages/tui/src/config.ts` respectively.
- **Test‑specific constants** belong in `tests/config/constants.ts` (e.g.
  prompts, mock keys, environment variable names).
- **Enums.** Whenever a set of fixed strings is used (statuses, types,
  providers), define a TypeScript `enum` in the appropriate package (e.g. `packages/core/src/enums.ts`) and reference it.
  Compare against `RequestStatus.PENDING`, never the literal string.

### Automated Enforcement

A dedicated AST-based script (`scripts/check_magic_values.ts`) scans the entire
codebase using the TypeScript compiler API to detect repeated literals that
should be extracted into named constants or enums. It is invoked as part of the
pre-commit gates via `deno task check:magic` (or directly:
`deno run -A scripts/check_magic_values.ts`).

**Detection thresholds:**

| Scope  | String literals | Number literals |
| ------ | --------------- | --------------- |
| Module | > 2 occurrences | > 3 occurrences |
| Global | > 3 occurrences | > 4 occurrences |

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

### Event Type Strings {#event-type-strings}

Every event action argument passed to `IEventLogger.info()`, `.warn()`, `.error()`, `.fatal()`, or `.debug()` — and to `IEventRegistry.emit()` — **must** be a `DomainEventType` member imported from `@exaix/core/events`. Inline string literals are forbidden at these call sites.

**Prohibited:**

```ts
await this.logger.info("execution.started", traceId, payload); // ← inline string
```

**Required:**

```ts
import { DomainEventType } from "@exaix/core/events";
await this.logger.info(DomainEventType.ExecutionStarted, traceId, payload);
```

This is enforced by `deno task check:event-strings` (Gate 13 in the pre-commit pipeline). For the full event type table, see `docs/Reference_Data.md#event-taxonomy`.

### Adding a New Event Type — Contributor Checklist {#add-event-type}

Follow these steps every time a new event type is needed:

1. **Add the member to `DomainEventType`** in `packages/core/src/events/domain_event_types.ts`.
   - Use `DomainVerb` naming: `ExecutionStarted`, `FlowStepCompleted`, `GitCommitted`.
   - Use `domain.subdomain.verb` string values: `"execution.started"`, `"flow.step.completed"`.
   - Group it with related members using a comment block.

2. **Register the publisher** at bootstrap (typically in the relevant `apps/` init file):

   ```ts
   registry.registerPublisher("my_service", [...existing, DomainEventType.MyNewEvent]);
   ```

3. **Emit at the call site** using `registry.emit()` for domain events or `logger.info()` for internal infrastructure events:

   ```ts
   await registry.emit("my_service", DomainEventType.MyNewEvent, { traceId, ...payload });
   ```

4. **Update `docs/Reference_Data.md#event-taxonomy`** — add a row with the member name, string value, and domain.

5. **Run `deno task check:event-strings`** — must pass with zero violations.

**What is skipped (not counted):**

- Property/enum member names (e.g., `{ foo: "bar" }` — `"foo"` is a name, not a
  value)
- Import/export paths and module declarations
- Decorator arguments (framework metadata)
- JSX attribute values
- Template literal tokens
- Type literal strings (e.g., `type Foo = "a" | "b"`)

When a violation is found the script prints the value, kind, occurrence count,
and file/line location, then exits with code 1.

Search helpers are provided in the repository to locate inadvertent magic values
(`grep -rEn ...` commands are included in older docs).

---

## 3. Import Statements {#import-statements}

All import declarations **must** appear at the top of the file and **must not** be nested inside any other statement (such as functions, conditionals, or loops). Imports must be top-level only.

**Prohibited:**

```ts
if (condition) {
  await import("./foo.ts"); // ❌ Not allowed
}

function loadModule() {
  return import("./bar.ts"); // ❌ Not allowed
}
```

**Allowed (with justification comment for dynamic import):**

```ts
// Dynamic import required to break circular dependency between X and Y.
const { Y } = await import("./y.ts");
```

### No Re-exporting

Exporting entities imported from other modules is prohibited. Each module must only export the entities it definitionally contains (classes, functions, interfaces, etc., defined within the file). This maintains clear module boundaries and avoids "barrel" files which can obfuscate the origin of symbols and complicate dependency analysis.

**Prohibited:**

```ts
export { Foo } from "./bar.ts"; // ❌ Inline re-export
export * from "./bar.ts"; // ❌ Wildcard re-export

import { Baz } from "./qux.ts";
export { Baz }; // ❌ Explicit re-export
```

**Allowed exception:** package entrypoint files like `mod.ts` or `index.ts` may re-export public interfaces, types, or values defined in other modules within the same package to expose the package's public API. This is only allowed for same-package modules owned by that package root surface; re-exporting from external packages, repo root retired `src/*` paths, or another package's source directories remains prohibited. This restriction is enforced as `[src-barrel-re-export]` for barrel files under the retired `src/`.

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

**Prohibited in package entrypoints:**

```ts
export * from "../../apps/other_app/src/some_export.ts";
```

Package entrypoints must only expose package-local source exports, not direct imports from other packages' source trees.

### Multi-line Named Imports

The style checker does not enforce a specific format for named imports. Use your judgment to balance readability and conciseness. `deno fmt` will automatically format imports according to its configured line width.

**Example:**

```ts
// Single-line for a few imports
import { BarService, FooService } from "./services.ts";

// Multi-line for many imports (optional, for readability)
import { BarService, BazService, FooService, QuuxService, QuxService } from "./services.ts";
```

### Dynamic Imports

Dynamic imports with `await import()` are **discouraged**. If you must use a dynamic import (for example, to load a large optional module, for conditional loading, or to break a circular dependency), you **must** document the rationale in a comment immediately above the import statement explaining why a static import is not possible or not desirable.

**Good:**

```ts
// Dynamic import required to break circular dependency between X and Y.
const { Y } = await import("./y.ts");
```

**Bad:**

```ts
// No explanation for dynamic import
const { join } = await import("@std/path");
```

The code style checker will strictly enforce that all imports appear at the top level. Dynamic imports should only be used when absolutely necessary and always provide a justification comment.

## 4. Package Test Boundary Isolation {#package-test-boundaries}

Package-local tests under `packages/<package>/tests/` must remain self-contained and must not import test fixtures, helpers, or other test modules from outside the package boundary.

- **No cross-package test imports:** `packages/<package>/tests/` files must not import from root-level `tests/`, from other packages' test directories, or from any module outside their own package.
- **Fixtures belong inside the package:** Store package-specific test fixtures under `packages/<package>/tests/fixtures/` or package-local helper code under `packages/<package>/tests/helpers/`.
- **Use package testing subpaths when they exist:** If a package exposes a public testing surface such as `@exaix/<package>/testing`, any tests outside that package must import package-specific helpers, config builders, fixtures, or test-only data structures through that public subpath.
- **No deep imports into another package's test internals:** Once a package-specific testing subpath exists, outside consumers must not import from `packages/<package>/tests/...` or equivalent relative deep paths.
- **No root shim indirection for package-owned test support:** When `@exaix/<package>/testing` exists, do not keep routing package-specific test helpers through root `tests/helpers/*` shims except as temporary compatibility layers being actively drained.
- **Use canonical public package barrels:** When the workspace root import map declares an exact package or subpackage alias such as `@exaix/mcp/server`, `@exaix/git/testing`, or `@exaix/core/types`, outside consumers must import through that exact alias. Do not deep-import the underlying repository path like `packages/...`, and do not deep-import file paths beneath the canonical alias such as `@exaix/mcp/server/resources.ts` or `@exaix/core/types/json.ts`.
- **Package root aliases are not a license for arbitrary source imports:** `@exaix/<package>` is only valid for the symbols exported by that package root barrel. Use only explicitly declared canonical subpath barrels for narrower public surfaces.
- **Avoid inline multiline structured text in tests:** It is highly recommended to avoid embedding YAML frontmatter, markdown documents, JSON payloads, or other multiline fixture text directly in a test file using backtick template literals. Move this content into a package-local fixture and load it from the test instead to keep test files readable.
- **Package tests may depend on package source code only:** They may import from `packages/<package>/src/` and from shared runtime dependencies, but not from external test infrastructure.
- **Package-owned modules must not import retired root implementation paths:** Files under package-owned runtime or support surfaces such as `packages/<package>/server/`, `packages/<package>/testing/`, or `packages/<package>/src/` must not import retired root implementation modules such as `src/services/core/db.ts`. Use the package-owned source-of-truth path or canonical package alias instead.
- **Package headers must not point at retired root ownership paths:** In package-owned modules, `@related-files` must not reference retired root compatibility modules such as `src/services/core/db.ts`. Header metadata must point at the package-owned source-of-truth path, not the old root shim or legacy runtime location.
- **Boundary enforcement:** This prevents one package's test setup from leaking into another package or into repository-wide test fixtures, preserving package portability and isolation.

**Prohibited when a testing subpath exists:**

```ts
import { TEST_DEFAULT_BRANCH } from "../../packages/git/tests/helpers/constants.ts";
import { setupGitRepo } from "../helpers/git_test_helper.ts";
```

**Required:**

```ts
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing";
```

These rules are enforced in part by `scripts/check_code_style.ts` via the `[package-test-boundary]`, `[package-src-boundary]`, `[package-related-files-boundary]`, and `[package-testing-import]` error tags. The public testing-subpath import rule must be followed wherever a package exposes `@exaix/<package>/testing`.

- Barrel re-export violations from source are reported as `[src-barrel-re-export]`.

- Canonical package and subpackage barrel enforcement is reported as `[package-canonical-import]`.

- Structured multiline test fixtures are also flagged as `[test-inline-multiline-fixture]` in test files.

### No Inline Type Imports

Using `import(...)` inside a type annotation or return type — instead of a top-level `import type` statement — is **prohibited**. All imports, including type-only imports, must be explicit top-level declarations.

**Prohibited:**

```ts
// ❌ Inline import inside a type annotation
function foo(): Promise<import("./bar.ts").IBar | null> { ... }

// ❌ Inline import in a method return type
getKnowledge(alias: string): Promise<import("../shared/schemas/portal_knowledge.ts").IPortalKnowledge | null> { ... }
```

**Required:**

```ts
// ✅ Top-level import declaration
import type { IBar } from "./bar.ts";
import type { IPortalKnowledge } from "../shared/schemas/portal_knowledge.ts";

function foo(): Promise<IBar | null> { ... }
getKnowledge(alias: string): Promise<IPortalKnowledge | null> { ... }
```

The style checker enforces this as an **error** (`inline-type-import` rule).

### No Aliasing Interfaces on Import

Renaming interfaces during import (using the `as` keyword) to remove the `I` prefix or otherwise change their name is prohibited. Exported interfaces must be used with their original defined names to maintain consistency and clarity across the codebase.

**Prohibited:**

```ts
import { ILogEntry as LogEntry } from "./logger.ts"; // ❌ Removing I prefix
import { IRequest as UserRequest } from "./request.ts"; // ❌ Renaming interface
```

**Allowed:**

```ts
import { ILogEntry } from "./logger.ts";
import { IRequest } from "./request.ts";
```

If a naming conflict occurs, it is better to refactor the local names or the conflicting modules than to alias the interfaces.

**Exception:** Aliasing is permitted in `packages/core/src/parsing/markdown.ts` when used for backward compatibility shims or interface compatibility bridges.

Good:

```ts
import { join } from "@std/path";
import { MyService } from "./service.ts";

export class MyClass { ... }
```

Bad:

```ts
export class MyClass {
  async method() {
    const { join } = await import("@std/path");
    // …
  }
}
```

---

## 5. Dependency Injection & Interfaces {#di-and-interfaces}

- **Interface naming:** **All exported interfaces** (injectable or otherwise)
  **must** use the `IInterfaceName` prefix convention (starting with a capital `I`).
  This makes it obvious at a glance that the symbol is an interface rather than
  a class or type alias.
- **Placement:** **All exported interfaces must be declared at the very top of
  the module**, immediately following imports (and any module-level descriptive
  header comments). They must appear before any functional code such as
  classes, functions, or variable initializations (e.g., `const`, `let`, `var`).
  Keeping them grouped at the top ensures that the API surfaces of the module
  are visible at a glance and prevents hoisting-related confusion.
- Every injectable class `Foo` **must** export a companion interface `IFoo`.
  Consumers depend on the interface, never on the concrete implementation.
- Dependencies are supplied via constructors; module‑level singletons or static
  accessors are prohibited.
- Test mocks **must** implement the full interface; avoid `as any` or partial
  objects unless the test explicitly documents why the missing members aren’t
  invoked.
- Factory functions and registries reference `IFoo`, not `Foo`.
- Prefer narrow interfaces: if a consumer only needs two methods, define an
  interface with those two rather than importing a fat interface.

Example:

```ts
export interface IGitService { commit(msg: string): Promise<void>; }
export class GitService implements IGitService { ... }

export class PlanExecutor {
  constructor(private git: IGitService, private db: IDatabaseService) {}
}
```

---

## 6. Environment Variables {#env-vars}

Environment‑variable rules were formalised in Phase 28 and are part of the
style guide:

- **Production overrides** are limited to the `EXA_LLM_*` family:
  `PROVIDER`, `MODEL`, `BASE_URL`, and `TIMEOUT_MS`.
- **All** env vars **must** be validated via the Zod schema in
  `packages/core/src/config/env_schema.ts` – use `getValidatedEnvOverrides()`, not
  `Deno.env.get()` directly.
- **Test variables** use the `EXA_TEST_*` prefix and helpers such as
  `isTestMode()` and `isCIMode()` for detection.
- Never read `EXA_LLM_*` vars without validation; direct access is prohibited.

These guidelines ensure consistent error handling and prevent a class of
runtime bugs.

---

## 7. Module Structure & Placement {#module-structure}

- **Module Structure Order:** Every module **must** follow this specific structural order:
  1. **Header Comment:** A brief description of the module and the Implementation Plan step it satisfies (warning if missing).
  1. **Imports:** All import declarations.
  1. **Exports:** All exported interfaces, types, and enums.
  1. **Functional Code:** Classes, functions, and variable initializations.
- **Top-of-module placement:** Imports and exported interfaces must appear at the top of the file, before any functional code.

---

## 8. Module Boundaries & TUI Isolation {#tui-boundaries}

Exaix enforces a strict boundary between the Terminal User Interface (TUI) and the core system. This decoupling is essential for maintainability and independent evolution of the layers.

- **Strict TUI Isolation**: Code in `apps/tui/src/` is prohibited from importing any modules from `apps/exactl/src/`, or `packages/core/src/config/`.
- **Communication via Interfaces**: TUI components must interact with core functionality exclusively through service interfaces defined in `packages/core/src/types/`.
- **Allowed TUI Dependencies**:
  - Other modules within `apps/tui/src/` (using relative paths).
  - Shared assets, enums, schemas, types in `packages/schemas/` and `packages/core/`, and other packages under `packages/`.
- **No Direct Instantiation**: TUI code must never instantiate core service classes. Instead, services must be accessed through the `ITuiApplicationContext` or provided via dependency injection.
- **TUI-owned Helpers**: Utilities specifically for terminal rendering and interaction (e.g., keyboard handling, tree views, spinners) must reside in `packages/tui/src/helpers/`. These are private to the TUI and must not be imported by Core modules.
- **Core-to-TUI Direction**: External callers may only invoke the TUI entry point (`apps/tui/main.ts` via `Deno.Command` subprocess) to launch the dashboard interface.

These rules are enforced by `scripts/check_code_style.ts` via:

- `[tui-boundary-cli]`
- `[tui-boundary-services]`
- `[tui-boundary-config]`
- `[tui-boundary-helpers]`
- `[core-boundary-tui-helpers]`
- `[package-src-boundary]`

Boundary checks run as part of the standard quality gates in pre-commit hooks and CI.

---

## 9. Module Boundaries & CLI Isolation {#cli-boundaries}

Exaix enforces a strict boundary between the CLI command layer and core implementations to preserve interface-driven separation.

- **CLI boundary scope**: `apps/exactl/src/commands/`, `apps/exactl/src/handlers/`, and `apps/exactl/src/command_builders/`.
- **No direct core service imports**: Files in the CLI boundary scope must not import directly from package internals except through canonical `@exaix/*` aliases.
- **No direct config service imports**: Files in the CLI boundary scope must not import `packages/core/src/config/service.ts` directly — use the `@exaix/core` alias.
- **Allowed dependencies in CLI boundary scope**:
  - `@exaix/schemas` (interfaces, types, enums, constants, schemas, status)
  - `@exaix/cli` (context, base class, CLI-owned helpers)
  - `@exaix/core/parsing` (cross-cutting parser utility)
  - `@exaix/ai` (`IModelProvider` interface only)
- **CLI helpers ownership rule**: `packages/cli/helpers/**` is CLI-owned; modules outside `apps/exactl/src/` must not import it.

These rules are enforced by:

- `scripts/check_code_style.ts` — regex-based checks
  (`[cli-boundary-services]`, `[cli-boundary-config]`, `[core-boundary-cli-helpers]`, etc.)
- `scripts/check_magic_values.ts` — AST-based magic value detection
  (`[MODULE]`, `[GLOBAL]` violation tags)

---

## 10. Related Documents {#related-docs}

This file is the single authoritative source for code style. The following documents reference it but do not duplicate its content:

- [`CLAUDE.md`](CLAUDE.md) — delegates to this file for all style rules
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — links to this file for coding standards
- [`scripts/check_code_style.md`](scripts/check_code_style.md) — companion reference for the code-style checker and boundary-oriented import rules
- [`.copilot/workflows/exaix-development.md`](.copilot/workflows/exaix-development.md)
- [`.copilot/README.md`](.copilot/README.md)

---

## 11. Function & Method Complexity {#complexity-rules}

- **Parameter Limit:** Functions and methods **must not** exceed **7 parameters**.
- If a method requires 8 or more parameters, it **must** be refactored to use:
  - A structured **Parameter Object** (a dedicated interface for the arguments).
  - A shared context object (like `IApplicationContext`).
  - Smaller, more focused methods.
- This rule applies to constructors, regular functions, and class methods alike. Refactoring into a parameter object improves readability, maintainability, and makes it easier to add optional parameters in the future.

---

## 12. Utility Scripting & Headers {#utility-scripts}

- **Preferred Runtime**: Deno TypeScript is the strictly preferred runtime for all repository maintenance, automation, and CI/CD utility scripts. Avoid Bash or standalone Node.js scripts to leverage type safety and the Deno standard library.
- **Shebang**: Every script in `scripts/` must begin with the standard Deno shebang:
  `#!/usr/bin/env -S deno run -A`
- **Standardized Header**: All scripts must feature a unified JSDoc-style header immediately following the shebang.
- **Mandatory Metadata Tags**:
  - `@module [Name]`: The logical name of the utility.
  - `@path scripts/[filename].ts`: The relative path to the script.
  - `@description [Text]`: A concise summary of the script's purpose.
- **Usage Context**: Following the metadata, a script must include a clear `Usage:` section providing at least one example command (e.g., `deno run -A scripts/foo.ts`). For complex utilities, also include `Options:` and `Commands:` blocks.
- **Temporary & Debug Scripts**: All scripts intended for one-off debugging or temporary use must be created outside of the `scripts/` directory (e.g., in the repository root or a dedicated `tmp/` folder) and must clearly indicate their ephemeral purpose in the filename (e.g., `debug_test_failure.ts` or `tmp_fix_metadata.ts`). The `scripts/` directory is reserved for permanent, well-documented repository utilities that are integrated into the project's quality gates.

Example:

```typescript
#!/usr/bin/env -S deno run -A
/**
 * @module MyUtility
 * @path scripts/my_utility.ts
 * @description Performs a specific maintenance task.
 *
 * Usage:
 *   deno run -A scripts/my_utility.ts [options]
 */
```

---

## 13. Package Module Purity {#package-module-purity}

A _pure package module_ can be consumed by an external project with no
knowledge of the Exaix daemon. The canonical test is in
[`ARCHITECTURE.md §"Packages vs. Services — Placement Model"`](./ARCHITECTURE.md).
The rules in this section are the **enforceable subset** of that model — they
target the most common ways packages accidentally acquire daemon-awareness.

### No instantiation of runtime infrastructure

Package source files under `packages/<name>/src/` must not create runtime
infrastructure instances:

- **No `new EventLogger(...)`** — Packages do not own audit-event infrastructure.
  If a package needs to surface trace information, accept `IEventLogger` as an
  _optional_ constructor parameter. The service layer creates and passes the
  logger instance.
- **No `new ConfigService(...)`** — Packages receive a typed `Config` value
  from their callers; they do not read config files or environment variables.

```ts
// ❌ Wrong — bootstraps runtime infrastructure inside a package
import { EventLogger } from "@exaix/core/logger";

class MemoryBankService {
  private logger = new EventLogger({ prefix: "[Memory]" }); // ← runtime infra
}

// ✅ Correct — logger is injected by the service layer
import type { IEventLogger } from "@exaix/core/logger";

class MemoryBankService {
  constructor(private readonly logger?: IEventLogger) {}
}
```

### Prefer `IEventLogger` over the concrete `EventLogger` class

Package source files should use `IEventLogger` (the interface) rather than the
concrete `EventLogger` class for field types, constructor parameters, and type
annotations. The concrete class couples the package to the runtime logger
implementation.

```ts
// ⚠️ Avoid — couples package type to a concrete runtime class
import type { EventLogger } from "@exaix/core/logger";
protected readonly logger?: EventLogger;

// ✅ Prefer — depends on the public interface contract only
import type { IEventLogger } from "@exaix/core/logger";
protected readonly logger?: IEventLogger;
```

### No reading runtime config or environment variables

Package source files must not call `getValidatedEnvOverrides()` or instantiate
`ConfigService`. Both read runtime state (env vars, TOML files) that belongs
exclusively to the app startup layer (e.g. `apps/daemon/`).

- Receive config as a typed `Config` constructor parameter — the service layer
  reads the config file and injects the plain value object.
- `isTestMode()` / `isCIMode()` are permitted in packages for test-conditional
  behaviour only.

```ts
// ❌ Wrong — reads env vars inside a package
import { getValidatedEnvOverrides } from "@exaix/core/config";
const overrides = getValidatedEnvOverrides();

// ✅ Correct — config is passed in as a plain typed value
import type { Config } from "@exaix/schemas";
constructor(private readonly config: Config) {}
```

### Automated enforcement

`scripts/check_code_style.ts` enforces these rules for all files under
`packages/<name>/src/`, with two exemptions:

- `packages/core/` — defines the runtime entities themselves
- `packages/mcp/server/` — the declared bridge zone between package contracts
  and runtime wiring

| Error tag                             | Severity | What it detects                                                                    |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `[package-instantiates-event-logger]` | error    | `new EventLogger(` inside a package `src/` file                                    |
| `[package-concrete-logger-type]`      | warn     | Importing concrete `EventLogger` instead of `IEventLogger` from `@exaix/core`      |
| `[package-uses-config-reader]`        | warn     | `getValidatedEnvOverrides` or `new ConfigService(` imported or called in a package |

---

> ⚠️ Keep this file short and focused. Architectural patterns such as timeout
> protection, file locking, or error classification belong in other guides
> (e.g. `.copilot/workflows/exaix-development.md`) and **are not** repeated here unless they
> directly impact the way code is written.

---

## Footer — Agent Knowledge Base

- **Copilot Rules**: [.copilot/rules.md](./.copilot/rules.md)
- **Blueprints**: [.copilot/blueprints/](./.copilot/blueprints/)
- **Planning**: [.copilot/planning/](./.copilot/planning/)
- **Manifest**: [.copilot/manifest.json](./.copilot/manifest.json)
