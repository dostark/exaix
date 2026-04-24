---
title: "Code Style & Standards"
description: Coding standards and stylistic requirements for Exaix
agent_priority: mandatory
copilot_knowledge_base: true
version: 1.1
capabilities: [linting_rules, naming_conventions, testing_patterns]
links:
  - "src/shared/constants.ts"
  - "scripts/check_code_style.ts"
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
  comment, the matching Zod schema (`src/config/schema.ts`), and a default in
  `src/config/constants.ts` (the config service handles loading).
- **Internal constants** belong in `src/constants.ts` or a module‑scoped
  `constants.ts` file. Use descriptive names and group related values.
- **CLI/TUI defaults** go in `src/cli/cli.config.ts` or
  `src/tui/tui.config.ts` respectively.
- **Test‑specific constants** belong in `tests/config/constants.ts` (e.g.
  prompts, mock keys, environment variable names).
- **Enums.** Whenever a set of fixed strings is used (statuses, types,
  providers), define a TypeScript `enum` in `src/enums.ts` and reference it.
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
  Instead, define a TypeScript `enum` in `src/enums.ts` or a shared named type alias.
  This rule is enforced as an error in production code.

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

**Allowed exception:** package entrypoint files like `mod.ts` or `index.ts` may re-export public interfaces, types, or values defined in other modules within the same package to expose the package's public API. This is only allowed for same-package modules; re-exporting from external packages or arbitrary non-root modules remains prohibited.

```ts
// packages/core/mod.ts
export type { IToolRegistry } from "./src/interfaces/i_tool_registry.ts";
export type { IActivityRecord } from "./src/types/database.ts";
export { PortalOperation } from "./src/enums.ts";
```

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
- **Avoid inline multiline structured text in tests:** It is highly recommended to avoid embedding YAML frontmatter, markdown documents, JSON payloads, or other multiline fixture text directly in a test file using backtick template literals. Move this content into a package-local fixture and load it from the test instead to keep test files readable.
- **Package tests may depend on package source code only:** They may import from `packages/<package>/src/` and from shared runtime dependencies, but not from external test infrastructure.
- **Package source must not import repository source directly:** Files under `packages/<package>/src/` must not import from repository `src/*` paths directly. Use package public APIs instead.
- **Boundary enforcement:** This prevents one package's test setup from leaking into another package or into repository-wide test fixtures, preserving package portability and isolation.

These rules are enforced by `scripts/check_code_style.ts` via the `[package-test-boundary]` and `[package-src-boundary]` error tags.

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

**Exception:** Aliasing is permitted in `src/parsers/markdown.ts` when used for backward compatibility shims or interface compatibility bridges.

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

## 4. Dependency Injection & Interfaces {#di-and-interfaces}

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

## 5. Environment Variables {#env-vars}

Environment‑variable rules were formalised in Phase 28 and are part of the
style guide:

- **Production overrides** are limited to the `EXA_LLM_*` family:
  `PROVIDER`, `MODEL`, `BASE_URL`, and `TIMEOUT_MS`.
- **All** env vars **must** be validated via the Zod schema in
  `src/config/env_schema.ts` – use `getValidatedEnvOverrides()`, not
  `Deno.env.get()` directly.
- **Test variables** use the `EXA_TEST_*` prefix and helpers such as
  `isTestMode()` and `isCIMode()` for detection.
- Never read `EXA_LLM_*` vars without validation; direct access is prohibited.

These guidelines ensure consistent error handling and prevent a class of
runtime bugs.

---

## 6. Module Structure & Placement {#module-structure}

- **Module Structure Order:** Every module **must** follow this specific structural order:
  1. **Header Comment:** A brief description of the module and the Implementation Plan step it satisfies (warning if missing).
  1. **Imports:** All import declarations.
  1. **Exports:** All exported interfaces, types, and enums.
  1. **Functional Code:** Classes, functions, and variable initializations.
- **Top-of-module placement:** Imports and exported interfaces must appear at the top of the file, before any functional code.

---

## 7. Module Boundaries & TUI Isolation {#tui-boundaries}

Exaix enforces a strict boundary between the Terminal User Interface (TUI) and the core system. This decoupling is essential for maintainability and independent evolution of the layers.

- **Strict TUI Isolation**: Code in `src/tui/` is prohibited from importing any modules from `src/cli/`, `src/services/`, or `src/config/`.
- **Communication via Interfaces**: TUI components must interact with core functionality exclusively through service interfaces defined in `src/shared/interfaces/`.
- **Allowed TUI Dependencies**:
  - Other modules within `src/tui/` (using relative paths).
  - Shared assets, enums, schemas, and types located in `src/shared/`.
- **No Direct Instantiation**: TUI code must never instantiate core service classes. Instead, services must be accessed through the `ITuiApplicationContext` or provided via dependency injection.
- **TUI-owned Helpers**: Utilities specifically for terminal rendering and interaction (e.g., keyboard handling, tree views, spinners) must reside in `src/tui/helpers/`. These are private to the TUI and must not be imported by Core modules.
- **Core-to-TUI Direction**: The core system may only import from `src/tui/` to initialize and launch the dashboard interface.

These rules are enforced by `scripts/check_code_style.ts` via:

- `[tui-boundary-cli]`
- `[tui-boundary-services]`
- `[tui-boundary-config]`
- `[tui-boundary-helpers]`
- `[core-boundary-tui-helpers]`
- `[package-src-boundary]`

Boundary checks run as part of the standard quality gates in pre-commit hooks and CI.

---

## 8. Module Boundaries & CLI Isolation {#cli-boundaries}

Exaix enforces a strict boundary between the CLI command layer and core implementations to preserve interface-driven separation.

- **CLI boundary scope**: `src/cli/commands/`, `src/cli/handlers/`, `src/cli/formatters/`, and `src/cli/command_builders/`.
- **No direct core service imports**: Files in the CLI boundary scope must not import from `src/services/` except `src/services/adapters/`.
- **No direct config service imports**: Files in the CLI boundary scope must not import `src/config/service.ts`.
- **Allowed dependencies in CLI boundary scope**:
  - `src/shared/**` (interfaces, types, enums, constants, schemas, status)
  - `src/cli/**` (context, base class, CLI-owned helpers)
  - `src/parsers/markdown.ts` (cross-cutting parser utility)
  - `src/ai/types.ts` (`IModelProvider` interface only)
- **CLI helpers ownership rule**: `src/cli/helpers/**` is CLI-owned; modules outside `src/cli/` must not import it.

These rules are enforced by:

- `scripts/check_code_style.ts` — regex-based checks
  (`[cli-boundary-services]`, `[cli-boundary-config]`, `[core-boundary-cli-helpers]`, etc.)
- `scripts/check_magic_values.ts` — AST-based magic value detection
  (`[MODULE]`, `[GLOBAL]` violation tags)

---

## 9. Related Documents {#related-docs}

This file is the single source for code style. Original sections remain in the
following documents only as cross‑references:

- [`CLAUDE.md`](CLAUDE.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md)
- [`.copilot/workflows/exaix-development.md`](.copilot/workflows/exaix-development.md)
- [`.copilot/README.md`](.copilot/README.md)

When editing those documents in the future, update the link above if this file's
location changes.

---

## 10. Function & Method Complexity {#complexity-rules}

- **Parameter Limit:** Functions and methods **must not** exceed **7 parameters**.
- If a method requires 8 or more parameters, it **must** be refactored to use:
  - A structured **Parameter Object** (a dedicated interface for the arguments).
  - A shared context object (like `IApplicationContext`).
  - Smaller, more focused methods.
- This rule applies to constructors, regular functions, and class methods alike. Refactoring into a parameter object improves readability, maintainability, and makes it easier to add optional parameters in the future.

---

## 11. Utility Scripting & Headers {#utility-scripts}

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
