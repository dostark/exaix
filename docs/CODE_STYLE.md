---
title: "Code Style & Standards"
description: Coding standards and stylistic requirements for Exaix
agent_priority: mandatory
copilot_knowledge_base: true
version: 1.4
capabilities: [linting_rules, naming_conventions, testing_patterns]
links:
  - "../packages/core/src/types/constants.ts"
  - "../packages/lint-policy/src/checkers/check_code_style.ts"
  - "../packages/lint-policy/docs/style_rules.md"
  - "../packages/lint-policy/docs/style_guide.md"
  - "../unslop-ts/docs/style_guide.md"
copilot_instructions: ../Blueprints/Agents/senior-coder.md
---

> This guide holds the rules that exist because of the Exaix architecture. The generic TypeScript rules are in
> the [generic style guide](../unslop-ts/docs/style_guide.md). The Exaix additions to those rules are in the
> [lint-policy guide](../packages/lint-policy/docs/style_guide.md). Read the generic guide first.

## Related Documents {#related-docs}

| Document                                                         | Holds                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Generic style guide](../unslop-ts/docs/style_guide.md)          | The generic TypeScript and Deno rules, owned by the lint engine     |
| [Lint-policy guide](../packages/lint-policy/docs/style_guide.md) | The Exaix additions to the generic rules and the rule status        |
| [Rule reference](../packages/lint-policy/docs/style_rules.md)    | The generated table of every rule, its severity, scope, and options |
| This guide                                                       | The rules that depend on the Exaix architecture                     |

[`AGENTS.md`](../AGENTS.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md),
[`.copilot/skills/exaix-development/SKILL.md`](../.copilot/skills/exaix-development/SKILL.md), and
[`.copilot/README.md`](../.copilot/README.md) point to this guide and do not repeat it.

Find a rule by topic:

- **Constants, settings, and event names:** [No Magic Values](#no-magic-values),
  [Event Type Strings](#event-type-strings)
- **Imports and package surfaces:** [Import Statements](#import-statements), [Package Imports](#package-imports),
  [Package Test Boundary Isolation](#package-test-boundaries)
- **Layer and edition boundaries:** [TUI](#tui-boundaries), [CLI](#cli-boundaries),
  [Edition Tier](#edition-tier-boundary), [Package Purity](#package-module-purity),
  [Layer-Aware Constants](#layer-aware-constant-imports)
- **Design conventions:** [Interfaces](#di-and-interfaces), [Environment Variables](#env-vars),
  [Optional Parameters](#optional-params), [Workspace Paths](#exaix-path-construction),
  [Tool Names](#tool-naming)
- **Module structure and observability:** [Module Structure](#module-structure),
  [Event Logging Decorators](#log-method-family)
- **Runtime behavior:** [Native Tool-Round Replay](#native-tool-round-replay),
  [Filesystem Watching](#fs-watching), [Skill Folders](#skill-folders)
- **Scripts, comments, and lint:** [Utility Scripts](#utility-scripts),
  [Comment Discipline](#comment-discipline), [Lint Policy](#lint-policy)

## No Magic Values {#no-magic-values}

The generic rule is in the [generic guide](../unslop-ts/docs/style_guide.md#no-magic-values): name every
value, and use an enum for a fixed set of strings. Exaix adds these rules.

### Tunable defaults

Wrap every user-tunable `DEFAULT_*` constant, in any package, with `configurable()`. Import it from
`@exaix/core/config`. Inside `packages/core/src/`, import it from `packages/core/src/config/registry.ts`.

```ts
export const OPENAI_COMPATIBLE_MAX_RESPONSE_BYTES: number = configurable({
  key: "openai_compatible.max_response_bytes",
  default: 8 * 1024 * 1024,
  type: ConfigValueType.NUMBER,
  description: "Maximum compatible Chat Completions response body size in bytes",
  min: 1,
  max: 64 * 1024 * 1024,
  swap: SwapClass.RESTART,
});
```

The call registers the constant, so `exactl config get` and `set`, the MCP config tools, and the in-memory store
of the daemon can see it. The exported value does not change.

| Field                | Rule                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `key`                | Required. A dotted path that is unique in the repository           |
| `default`            | Required. Byte-identical to the value that the constant had before |
| `type`               | Required. `ConfigValueType.NUMBER`, `STRING`, or `BOOLEAN`         |
| `description`        | Required. Written for agents                                       |
| `swap`               | Required. `SwapClass.HOT` or `SwapClass.RESTART`                   |
| `min`, `max`, `enum` | Optional. Validation bounds and allowed values                     |

`IConfigurableOpts` in `packages/core/src/config/registry.ts` lists the other fields. Do not wrap:

- structural enums whose TypeScript literal type must stay intact for a Zod schema, such as `MockStrategy` and
  `McpTransportType`;
- array or object values;
- sentinel placeholders, such as `"default"` and `"Unknown"`;
- structural event-name strings.

Run `deno task check:config-keys` to find duplicate keys. It prints the number of keys.

### Schema bounds

When a Zod schema needs minimum and maximum values for a configurable key, read them from the registry with
`resolveConfigurableBounds(key)` from `@exaix/core/config`. `packages/schemas/src/config.ts` wraps this in its
local helpers `c(key)` and `cBounds(key)`. Do not declare separate MIN and MAX constants. The registry is the
only source of bounds.

### Other constants

- Internal constants go in a `constants.ts` file in the module's package. Use descriptive names and group related
  values.
- Defaults for the CLI and the TUI go in `packages/cli/src/config.ts` and `packages/tui/src/config.ts`.
- Constants that only tests use, such as prompts, mock keys, and environment variable names, go in
  `packages/testing/src/constants.ts`.
- Define a fixed set of strings, such as statuses, types, and providers, as an enum in the package that owns the
  concept, for example `packages/core/src/types/enums.ts`. Compare with `RequestStatus.PENDING`, never with the
  literal string.

## Event Type Strings {#event-type-strings}

Every event name that you pass to `IEventLogger.info()`, `.warn()`, `.error()`, `.fatal()`, or `.debug()`, or to
`IEventRegistry.emit()`, must be a `DomainEventType` member from `@exaix/core/events`. Do not write the string.

```ts
// ❌ Inline string
await this.logger.info("execution.started", traceId, payload);
```

```ts
// ✅ Registered member
import { DomainEventType } from "@exaix/core/events";

await this.logger.info(DomainEventType.ExecutionStarted, traceId, payload);
```

`deno task check:event-strings` reports a string literal in these calls. It runs in the pre-commit hook and in
`deno run -A scripts/ci.ts check`. The table of event types is in
[`docs/Reference_Data.md`](./Reference_Data.md#event-taxonomy).

### Adding a New Event Type {#add-event-type}

1. Add the member to `DomainEventType` in `packages/core/src/events/domain_event_types.ts`.
   - Name the member `DomainVerb`, such as `ExecutionStarted`, `FlowStepCompleted`, or `GitCommitted`.
   - Give it a `domain.subdomain.verb` value, such as `"execution.started"` or `"flow.step.completed"`.
   - Place it with related members.
1. Register the publisher at bootstrap, usually in the init file of the owning app:

   ```ts
   registry.registerPublisher("my_service", [...existing, DomainEventType.MyNewEvent]);
   ```

1. Emit the event at the call site. Use `registry.emit()` for a domain event and `logger.info()` for an internal
   infrastructure event:

   ```ts
   await registry.emit("my_service", DomainEventType.MyNewEvent, { traceId, ...payload });
   ```

1. Add a row with the member name, the string value, and the domain to the
   [event taxonomy](./Reference_Data.md#event-taxonomy).
1. Run `deno task check:event-strings`. It must report no violation.

## Import Statements {#import-statements}

The generic import rules are in the [generic guide](../unslop-ts/docs/style_guide.md#imports): imports at the
top, dynamic imports, inline type imports, and re-exports. Exaix adds the rule below. The next two sections cover
[package surfaces](#package-imports) and [test isolation](#package-test-boundaries).

### No production dependency on `tests/`

A deployable module under `packages/`, `exaix-team/`, or `apps/` must not import from the `tests/` folder of the
repository. A deployed workspace leaves out test code. A production module that imports it, even for a type or
through a dead path, fails to resolve when it loads and breaks the deployed `exactl` and daemon.

```ts
// apps/exactl/src/commands/eval_commands.ts
import { EvalSqliteStore } from "../../../../tests/scenario_framework/runner/history_sqlite.ts"; // ❌
import { EvalSqliteStore } from "@exaix/eval-history"; // ✅ the shared code lives in a package
```

When production code needs shared test-side code, move that code into a package under `packages/` and import
the package alias.

**Exemptions:**

- Test files, which are paths that contain `/tests/` or end in `_test.ts` or `.test.ts`, may import helpers and
  fixtures from `tests/`.
- Test-infrastructure modules, which are the `@exaix/testing` package and any `*/testing/` shim, never ship, so
  they may bridge to `tests/`.

The production-to-tests zone of `exaix/import-boundaries` enforces this rule in `deno task lint`.

## Package Imports {#package-imports}

Import another package through its public alias, never through its file path.

- **Use the exact alias.** When the root import map declares an alias for a package or subpackage, such as
  `@exaix/mcp/server`, `@exaix/git/testing`, or `@exaix/core/types`, import through that alias. Do not
  deep-import the file path (`packages/...`), and do not append a file path to the alias (for example
  `@exaix/mcp/server/resources.ts`).
- **A root alias is not a path.** `@exaix/<package>` gives only the symbols that the package root exports.
  Use the declared subpath aliases for narrower surfaces.
- **No cross-package relative imports.** A module in `packages/<package>/` does not reach into another package
  with a relative path.
- **No retired root paths.** A package module does not import the retired root `src/` folder. Use the package
  that owns the code now. Only `packages/mcp/server/` and its tests are exempt.
- **No promotion.** A parent package entry point does not re-export a subpackage that has its own alias. See
  [Canonical Subpackage Boundary](../packages/lint-policy/docs/style_guide.md#canonical-subpackage-boundary).

| Check                       | Reports                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `package-canonical-import`  | A deep import of a package path or an alias subpath that has an exact alias    |
| `package-boundary`          | A relative import into another package, or into the retired root `src/` folder |
| `package-subpath-promotion` | A parent entry point that re-exports a canonical subpackage                    |
| `exaix/import-boundaries`   | The retired-root zone: a package module that imports a retired root path       |

## Package Test Boundary Isolation {#package-test-boundaries}

A test in `packages/<package>/tests/` depends on its own package only. It does not borrow fixtures, helpers, or
test modules from outside the package. This keeps each package portable.

- **Allowed imports:** the package source under `packages/<package>/src/` and shared runtime dependencies.
- **Package-local support:** keep fixtures in `packages/<package>/tests/fixtures/` and helpers in
  `packages/<package>/tests/helpers/`.
- **No cross-package test imports:** do not import from root-level `tests/` or from the test folders of other
  packages. The checker makes two exceptions: the root `tests/helpers/` folder, and the use of
  `packages/ai/tests/` by `@exaix/testing`.
- **Public testing subpaths:** when a package exposes `@exaix/<package>/testing`, every test outside that
  package imports its helpers, builders, and fixtures from that subpath. Nobody deep-imports
  `packages/<package>/tests/...`, and nobody routes the helpers through a root `tests/helpers/*` shim. The only
  exception is a temporary shim that you are removing.
- **Fixtures as files:** do not embed multi-line YAML, Markdown, JSON, or other structured text in a test with
  a template literal. Put it in a package-local fixture and load it. See
  [Test Fixtures](../unslop-ts/docs/style_guide.md#test-fixtures).

```ts
import { TEST_DEFAULT_BRANCH } from "../../packages/git/tests/helpers/constants.ts"; // ❌
import { setupGitRepo, TEST_DEFAULT_BRANCH } from "@exaix/git/testing"; // ✅
```

| Check                                 | Reports                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `package-boundary`                    | A package test that imports root `tests/` fixtures (other than `tests/helpers/`) |
| `package-testing-import`              | A test outside a package that deep-imports its tests instead of `/testing`       |
| `exaix/test-inline-multiline-fixture` | A multi-line structured fixture inline in a test (opt-in)                        |

## Module Boundaries & TUI Isolation {#tui-boundaries}

The terminal UI (`apps/tui/src/`) shows data and takes input. It reaches core behavior through service
interfaces. It does not depend on the CLI app or on core classes.

- Do not import code from the CLI app (`apps/exactl/src/`) in new TUI code.
- Do not import the retired `services/`, `config/`, or `helpers/` folders by a relative path. The code now lives in
  `packages/core/src/services/`, `packages/core/src/config/`, and `packages/tui/src/helpers/`. Import the
  `@exaix/*` aliases instead.
- Use the service interfaces in `packages/core/src/types/`. A view does not instantiate a core service class.
  Views receive their services from the service factory and the view registry.
- Put helpers for terminal drawing and interaction, such as keyboard handling, tree views, and spinners, in
  `packages/tui/src/helpers/`. Only TUI code imports them.
- Other code starts the dashboard only through its entry point, `apps/tui/main.ts`, as a subprocess.
- TUI code may depend on other modules of `apps/tui/src/` through relative paths, and on shared assets, enums,
  schemas, and types in `packages/`.

Zones of `exaix/import-boundaries` in `packages/lint-policy/tests/fixtures/catalog_v1.json` enforce these rules. They cover:

- TUI sources and TUI tests that import the retired CLI, services, config, or helpers folders;
- other code that imports the TUI helpers.

No zone checks a direct import of `apps/exactl/src/`. The service factory
`apps/tui/src/services/tui_service_factory.ts` still imports CLI command classes to build the adapters that the
views use.

## Module Boundaries & CLI Isolation {#cli-boundaries}

The CLI command layer reaches the core only through the package aliases. The boundary covers
`apps/exactl/src/commands/`, `apps/exactl/src/handlers/`, and `apps/exactl/src/command_builders/`.

- Do not import the retired `services/` folder by a relative path. The adapters folder is the only exception.
- Do not import the config service file by a relative path. Use the `@exaix/core` alias.
- `apps/exactl/src/helpers/` belongs to the CLI. Modules outside `apps/exactl/src/` do not import it.

Zones of `exaix/import-boundaries` in `packages/lint-policy/tests/fixtures/catalog_v1.json` enforce these rules.

## Edition Tier Import Boundary {#edition-tier-boundary}

Exaix has three editions: **Solo** (Apache 2.0; `packages/` and `apps/`), **Team** (`exaix-team/`, BSL), and
**Enterprise** (`exaix-enterprise/`). A lower edition must not import from a higher edition. Such an import
couples the free source and build to code with a different license. For example, a Solo app that imports Team
code would ship Team source in the free deployment.

```ts
import { TeamComposer } from "@exaix-team/team-composer"; // ❌ Solo → Team, in apps/exactl/src/init.ts
import { Y } from "@exaix-enterprise/mod.ts"; // ❌ Team → Enterprise, in exaix-team/
```

Two references to a higher edition are allowed:

```ts
// 1. A type-only import. The compiler erases it.
import type { TeamComposer } from "@exaix-team/team-composer";

// 2. A dynamic import in a dispatch entry, behind an edition guard.
if (editionType === EDITION_TEAM) {
  const { TeamComposer } = await import("@exaix-team/team-composer");
}
```

A dispatch entry is a file under `apps/daemon/`, `apps/exactl/`, or the same folders of `exaix-team/apps/`. The
guard `editionType === EDITION_…` must appear in the 12 lines above the import. A dynamic import without the
guard is a violation, because it loads Team code in a Solo run.

**Exemptions:**

- Test files and `*/testing/` shims.
- The Team-tier module `apps/daemon/src/bootstrap_team.ts`. It is loaded only in the Team branch and may import
  `@exaix-team/*` statically. `exaix-team/apps/mcp-server/` is a Team-tier app inside the `exaix-team` submodule.

**Remediation:** when lower-edition code needs a type from a higher edition, move the interface into
`packages/core/src/types/`, and let both sides depend on it. When it needs a value, use the guarded dynamic
import in the dispatch entry.

Edition-selection code, such as `edition ===` and `EXAIX_EDITION`, belongs only in the edition composer. The
`edition-conditional-outside-composer` check reports it elsewhere. The catalog lists the folders that it exempts.

| Check                                  | Reports                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `edition-leak`                         | A lower-edition module that imports a higher edition |
| `edition-conditional-outside-composer` | An edition conditional outside the composer          |

### Why the static rule is the guarantee {#edition-static-guarantee}

`edition-leak` guards the artifact that Exaix ships: the source-run deploy of `scripts/deploy_workspace.ts`. The
rule keeps one invariant. Every reference from lower-edition source to a higher edition is type-only or an
edition-guarded dynamic import. A Solo run therefore never executes an upper-edition import. The deploy can
leave `exaix-team/` out of the workspace and rewrite the `workspace` list in `deno.json`, and Solo still starts.

`deno compile` is the exception, and it is not the shipped artifact. It embeds the whole resolved module graph,
including dynamic imports, so a compiled Solo binary still contains Team code. No source rule can change that.
A Team-free binary would need a Solo import map that points `@exaix-team/*` at stub modules. That map does not
exist yet. Use the source-run deploy for a Team-free Solo distribution. See
`exaix-dev-docs/dev/Exaix_Edition_Architecture.md`.

### The graph gate {#edition-graph-gate}

`edition-leak` reads source text, so a gap in its patterns could let a leak pass. `deno task check:edition-graph`
(`scripts/check_edition_graph.ts`) double-checks it. It resolves the daemon and exactl module graphs with
`deno info --json` and fails on a static runtime edge from a lower edition into a higher one. It uses the same
`editionTierOfPath` classification as the rule. Guarded dynamic edges and type-only edges are not leaks. On a
clean tree both gates agree. The graph gate runs in the code-quality workflow, in `deno run -A scripts/ci.ts check`,
and in the pre-commit hook after `check:style`.

## Package Module Purity {#package-module-purity}

A pure package module is usable by a project that knows nothing about the Exaix daemon. The test is in
[`ARCHITECTURE.md`](../ARCHITECTURE.md). The rules below are the enforceable part. They stop packages from
acquiring daemon knowledge.

### No runtime infrastructure in a package

Source files under `packages/<name>/src/` must not create runtime infrastructure.

- **No `new EventLogger(...)`.** A package does not own audit-event infrastructure. Accept an `IEventLogger`
  as an optional constructor parameter. The service layer creates it and passes it in.
- **No `new ConfigService(...)`.** A package receives a typed `Config` value from its caller. It does not read
  config files.

```ts
import { EventLogger } from "@exaix/core/logger";
class MemoryBankService {
  private logger = new EventLogger({ prefix: "[Memory]" }); // ❌ creates runtime infrastructure
}

import type { IEventLogger } from "@exaix/core/logger";
class MemoryBankService {
  constructor(private readonly logger?: IEventLogger) {} // ✅ injected by the service layer
}
```

### Depend on interfaces

Type a logger field or parameter as `IEventLogger`, not as the concrete `EventLogger` class. The class ties the
package to the runtime logger.

### Receive configuration

Take configuration as a typed `Config` constructor parameter. The service layer reads the file and injects the
plain value. A package may use `isTestMode()` and `isCIMode()` for test-conditional behavior only. The checker
does not detect direct `Deno.env` reads, so review them by hand.

```ts
import type { Config } from "@exaix/schemas";
constructor(private readonly config: Config) {} // ✅
```

### Enforcement

`packages/lint-policy/src/checkers/check_code_style.ts` checks `packages/<name>/src/`, except `packages/core/`
(which defines the runtime entities) and `packages/mcp/server/` (the declared bridge between package contracts
and runtime wiring). It skips comment lines.

| Tag                                   | Severity | Reports                                                                  |
| ------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `[package-instantiates-event-logger]` | error    | `new EventLogger(`                                                       |
| `[package-concrete-logger-type]`      | warn     | An import of the concrete `EventLogger` from `@exaix/core`               |
| `[package-uses-config-reader]`        | warn     | An import of `ConfigService` from `@exaix/core`, or `new ConfigService(` |

## Layer-Aware Constant Imports {#layer-aware-constant-imports}

A high-level class, such as an orchestrator, coordinator, or controller, does not import the implementation
details of the services that it delegates to.

**Rule:** when class `A` delegates a concern to service `S`, and `S` needs a constant, primitive, or class `C` to
do the work, `S` imports `C`. `A` does not.

**You have a layer violation when:**

- an orchestrator imports a subprocess runner that only the delegated git service uses;
- a coordinator imports a `DEFAULT_*` timeout for a git command that it never runs;
- a high-level class builds a concrete class with `new` instead of accepting its interface;
- a composition root imports a token-estimation constant when the context service already exposes
  `estimateTokensSync()`.

```ts
// ❌ The git timeout belongs to the delegated service
import { DEFAULT_GIT_STATUS_TIMEOUT_MS } from "@exaix/git";
await SafeSubprocess.run("git", ["status"], { timeoutMs: DEFAULT_GIT_STATUS_TIMEOUT_MS });

// ❌ A concrete class: accept the interface through the constructor
import { ToolRegistry } from "@exaix/tool-runtime";
this._toolRegistry = new ToolRegistry({/* … */});

// ❌ An encapsulated constant: call the service method instead
import { TOKEN_ESTIMATION_CHARS_PER_TOKEN } from "@exaix/core";
const tokens = Math.ceil(text.length / TOKEN_ESTIMATION_CHARS_PER_TOKEN); // use ctx.estimateTokensSync(text)
```

**Acceptable at a high level:** framework enums that drive the class's own dispatch (for example
`ExecutionStrategyName` and `SecurityMode`), the names of events that the class emits itself, and type-only
imports of service interfaces.

**Remediation:**

1. Move the constant into the module of the service that uses it.
1. When the service must expose a computation, add a wrapper method, such as `estimateTokensSync()` on
   `ExecutionContextService`. Do not export the raw constant.
1. For a concrete class, remove the inline `new`, accept the interface through the constructor, and let the
   caller inject the instance.

### Enforcement

Two AST checks in `packages/lint-policy/src/checkers/check_code_style.ts` apply to `packages/` source. They use
the TypeScript compiler API and name no symbols.

| Tag                       | Severity | Reports                                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------------ |
| `[concrete-cross-domain]` | warn     | `new X()` for a class that the file imported from another domain package |
| `[layer-constant-leak]`   | warn     | A bare constant value imported from another domain package               |

Both skip the framework packages (`@exaix/core`, `@exaix/schemas`, `@exaix/shared`, `@exaix/ai` and its
`@exaix/ai-*` providers, `@exaix/cli`, `@exaix/tui`, and `@exaix/testing`), same-package imports, test files, and
the bridge files that the catalog lists under `layout.layerLeakExempt`. Imports from the framework packages are
therefore a review concern, not a checked one. See the [rule reference](../packages/lint-policy/docs/style_rules.md).

## Dependency Injection & Interfaces {#di-and-interfaces}

The naming and placement of interfaces are in the
[generic guide](../unslop-ts/docs/style_guide.md#interface-conventions): the `I` prefix, exported interfaces at
the top of the module, and no rename on import. Exaix adds these rules.

- Every injectable class `Foo` exports a companion interface `IFoo`. Consumers depend on the interface, never
  on the concrete class.
- Supply dependencies through constructors. Module-level singletons and static accessors are prohibited.
- Factories and registries refer to `IFoo`, not to `Foo`.
- Prefer a narrow interface. When a consumer needs two methods, define an interface with those two.
- A test mock implements the full interface. Do not use `as any` or a partial object, unless the test says why
  the missing members are never called.

```ts
export interface IGitService {
  commit(msg: string): Promise<void>;
}
export class GitService implements IGitService {}

export class PlanExecutor {
  constructor(private git: IGitService, private db: IDatabaseService) {}
}
```

## Environment Variables {#env-vars}

Settings belong in configuration. Add a `configurable()` key, as described in [No Magic Values](#no-magic-values),
instead of a new environment variable.

- **Production overrides** are the `EXA_LLM_*` family: `EXA_LLM_PROVIDER`, `EXA_LLM_MODEL`,
  `EXA_LLM_BASE_URL`, and `EXA_LLM_TIMEOUT_MS`. `EXA_LLM_ENDPOINT` is the older name of the base URL. The code
  that reads them is `ProviderFactory` in `packages/ai/src/provider_factory.ts` and the default routing
  strategy in `packages/ai/src/routing/`.
- **Test variables** use the `EXA_TEST_*` prefix. Detect test and CI runs with `isTestMode()` and `isCIMode()`
  from `packages/core/src/config/env_schema.ts`. `isTestMode()` reads `EXA_TEST_MODE` and `EXA_TEST_CLI_MODE`.
  `isCIMode()` reads `EXA_CI_MODE` and then `CI`.

## Optional Parameter Usage {#optional-params}

The generic rules for the four optional-parameter cases (redundant, unused, marked but not optional, and bare)
are in the [generic guide](../unslop-ts/docs/style_guide.md#optional-parameters). Exaix configures the optional
wrapper and runs the checks as described here.

### The `Opt<T, R>` wrapper

`Opt` and `Reason` are in `packages/core/src/types/optional_marker.ts` and are exported from
`@exaix/core/types`. `Opt<T, R>` is `T | undefined` at run time and adds no cost.

Wrap the type of every optional parameter with `Opt<T, Reason.X>`, and also give it `?` or a default value. The
second type argument must be a member of the closed `Reason` enum. It proves that someone reviewed the choice.
A wrapped parameter is exempt from the call-site checks.

```ts
// An abstract method: implementations vary
protected abstract attemptGenerate(prompt: string, options?: Opt<IModelOptions, Reason.AbstractBoundary>): Promise<IGenerateResult>;

// A test factory with default overrides
function createStub(overrides: Opt<Partial<IDatabaseService>, Reason.TestOverride> = {}): IDatabaseService;
```

Wrapping a parameter that has neither `?` nor a default value is an error (`MARKED_NOT_OPTIONAL`).

| Reason                        | Use it for                                         | Typical pattern                      |
| ----------------------------- | -------------------------------------------------- | ------------------------------------ |
| `Reason.TestOverride`         | A test factory                                     | `overrides: Partial<T> = {}`         |
| `Reason.TestStub`             | A test stub                                        | `responseContent = "..."`            |
| `Reason.RecursiveOmit`        | A recursive helper                                 | `depth = 0`, `prefix = ""`           |
| `Reason.CoercionDefault`      | A coercion fallback                                | `fallback = Status.PENDING`          |
| `Reason.FactoryPreset`        | A factory preset                                   | `config?: IFooConfig`                |
| `Reason.SensibleDefault`      | A sensible constant default                        | `limit = 10`, `minLength = 3`        |
| `Reason.UiDefault`            | A UI rendering default                             | `char = " "`, `disabled = false`     |
| `Reason.AbstractBoundary`     | An abstract or interface boundary                  | `options?` on a base method          |
| `Reason.OptionalDependency`   | A dependency that only some paths need             | `logger?`, `costTracker?`            |
| `Reason.TraceAbsent`          | A trace ID that is absent in some contexts         | `traceId?: string`                   |
| `Reason.CancellationOptional` | A cancellation signal that callers may omit        | `options?: { signal?: AbortSignal }` |
| `Reason.QueryFilter`          | A query filter                                     | `options?: IBuildSnapshotOptions`    |
| `Reason.OptionalInput`        | A data input that enriches the output              | `analysis?`, `frontmatter?`          |
| `Reason.ExecutionConfig`      | An execution setting that falls back to config     | `timeoutS?`, `modelId?`              |
| `Reason.OptionalContext`      | Context that enriches logs and events              | `requestId?`, `portal?`              |
| `Reason.ShapeValidation`      | A value from an untyped input, checked at run time | A retired parameter shape            |

There is no catch-all. When no reason fits, add a new member to the `Reason` enum.

### Enforcement

The whole-tree check `optional-params` (`unslop-ts/src/rules/whole_tree/optional_params.ts`, run through
`unslop-ts/src/cli/whole_tree.ts`) reads production `.ts` and `.tsx` files with the TypeScript compiler API. It
compares each function that has optional parameters with every call site of the same name.

| Task                                     | Reports                                                   | Runs in                        |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------ |
| `deno task check:optional-params --fail` | Redundant, unused, and marked-but-not-optional parameters | `ci.ts check`                  |
| `deno task check:optional-params:staged` | Bare optional parameters in staged files                  | Pre-commit hook, `ci.ts check` |

Without `--fail` the first task is advice. Bare optional parameters that already exist are reported as advice
only, and the staged task stops new ones. The opt-in plugin rule `exaix/require-optional-wrapper` finds bare
optional parameters during linting.

## Workspace Path Construction {#exaix-path-construction}

Build Exaix workspace paths with the helper functions of `@exaix/shared`. Do not join the default segments in
the caller. The helpers are in `packages/shared/src/paths.ts`.

- Build `<root>/Workspace/Requests/...` with `requestsPath(root, ...)`. Use the siblings `plansPath`,
  `activePath`, `archivePath`, `rejectedPath`, `workspacePath`, and `runtimePath` for the other folders.
- Build the blueprint and memory branches with `blueprintsPath`, `agentsPath`, `flowsPath`, `memoryPath`, and the
  `memory*Path` family.
- A caller that joins a `DEFAULT_*_PATH` constant, or writes a root segment as a literal, re-derives the
  layout. A layout change then misses that caller. The helpers own the default, so no caller repeats it.
- Read `config.paths.<key>` directly. The schema fills a missing key, so a `paths.<key> ?? "<default>"` fallback
  repeats the default and is dead code.
- A shipped config under `configs/` does not restate a `[paths]` default. The schema fills a missing key from
  the same constant, so a restated value is a second owner of the layout.

In tests:

- A `paths` object spreads `ExaPathDefaults` and names only the keys that it overrides. Listing every key with
  its default constant re-spells the table.
- A test reads a config document from a fixture. See
  [Test Fixtures](../unslop-ts/docs/style_guide.md#test-fixtures).
- A scenario step names a config fixture with `content_from`, not with an inline `content` block.

**Exception:** a test may compose the segments when the composition is the rule under test (for example the
flow-catalog guard), or when the literal must stay a shell variable or a glob. Mark that line with
`path-builder-exclude` and the reason.

`deno task check:path-builders` enforces this section.

## Tool Naming {#tool-naming}

A canonical tool name is `<verb>_<object>` in snake_case. The first token is one of `read`, `write`, `list`,
`search`, `create`, `run`, `fetch`, `move`, `copy`, `delete`, `patch`, `find`, `query`, `get`, and `remember`.
Git tools use the `git_<verb>` namespace. Exaix control-plane tools use the MCP-only `exaix_<verb>_<object>`
namespace (`TOOL_NAME_VERBS` in `packages/core/src/types/constants.ts` lists the first tokens).

- Native Exaix names match exactly. Do not add case folding, whitespace trimming, or compatibility aliases.
- General-purpose aliases live in the shared alias map. An alias must not shadow a canonical name or point to a
  different operation.
- When a rename retires a native name, reject the old name in runtime calls and in raw permission and approval
  rules.
- When one operation exists in both `ToolName` and `McpToolName`, use the same canonical name in both catalogs.
  Add every literal intersection to `SHARED_TOOL_OPERATIONS`.

`deno task check:tool-naming` checks the verbs, the shared-operation declarations, and the shared names. It cannot
tell that two differently named tools mean the same thing. Review each new unmatched export, and either declare
it distinct or add it to the shared-operation table. See
[the tool catalog parity section](../ARCHITECTURE.md#tool-catalog-parity-toolregistry-vs-tool_manifest).

## Native Tool-Round Replay {#native-tool-round-replay}

A provider response that carries tool calls replays as one round. Code that builds or reads a round follows these
rules.

- Store the assistant artifacts of the response in their original order, as one unit. Do not rebuild them from
  the canonical calls.
- A per-call provider signature, such as the `thoughtSignature` of Gemini, stays on the call that carries it. The
  replay keeps that call first and returns the other calls as transcript blocks.
- Dispatch runs the calls in the order that the model returned them. Replay bytes and dispatch order are separate
  concerns.
- Enforce the cap before a call runs. A refused call still gets a result, in its original position.

Tests: `packages/execution/tests/planning_tool_loop_test.ts` and
`packages/ai-google/tests/google_provider_tools_request_test.ts`.

## Filesystem Watching {#fs-watching}

`Deno.watchFs` is not idempotent. It can emit several events for one change, and the order differs by operating
system ([denoland/deno#12874](https://github.com/denoland/deno/issues/12874)). A plain `for await` loop over the
watcher processes every change twice, and one uncaught error in the loop stops the whole watcher and often the
daemon.

- Consume the watcher through `consumeFsEvents` or `watchFsDebounced` from `@exaix/core/fs`. They debounce per
  path, filter write events, isolate the error of each event with `onError`, and accept an optional
  `shouldProcess` guard.
- If you must write the loop yourself, it must:
  - debounce or otherwise collapse duplicate events;
  - make the action idempotent by comparing content or state before it acts, and never call an operation that
    throws when it runs a second time, such as a state-machine `resume()`;
  - catch errors so that the failure of one event cannot leave the loop.

## Skill Folders {#skill-folders}

- A skill is a folder `<name>/SKILL.md` with an optional `exaix.yaml` sidecar and a `references/` folder. Read
  it only through `SkillFolderLoader` or `SkillsService`. Feature code does not parse the files.
- Resource limits and fallback settings come from the `skills.*` config keys, through the root plan of the
  current config generation. Do not add a literal limit next to them.
- Parse and render each skill once. `renderSkillEntry` is the only function that turns a skill into prompt text,
  so budgets, pins, and usage rows all measure the same block.
- Change status through the service lifecycle (`approveSkill`, `deprecateSkill`). An approval names the
  reviewed revision, and a content update returns the skill to draft.
- Never write skill bodies or host paths into events or CLI errors. Use typed reasons.

## Module Structure {#module-structure}

Every module follows the order of the [generic guide](../unslop-ts/docs/style_guide.md#module-order): header
comment, imports, exported types, then code.

### Re-export placement {#barrel-only-reexports}

A module re-export (`export … from "…"`) belongs in the package barrel (`mod.ts`) or a directory
`index.ts`. An ordinary module states its own surface and imports what it uses; forwarding another
module's symbols from it hides where those symbols live and adds a second public path that the
barrel cannot police.

| Check                   | Reports                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `barrel-only-reexports` | A module re-export in a file that is not `mod.ts` or `index.ts` |

The engine rule `barrel-only-reexports` owns this check; the policy enables it as
`exaix/barrel-only-reexports` with the default barrel suffixes. Its `barrelSuffixes` and `allowPaths`
options tune the suffixes and exempt path prefixes.

Test files and helpers are exempt, because compatibility shims under `tests/` intentionally forward
test support. When a symbol belongs to a lower layer, import it from that layer and re-export it from
the package barrel instead of the module that happens to declare it.

### Named imports {#prefer-named-imports}

Import a symbol by name when a module consumes it. A namespace import (`import * as ns from "…"`)
hides which symbols the module uses, so a boundary review cannot see the dependency and a rename
inside the namespace is invisible to the consumer. Write `import { load } from "…"` instead of
`import * as ns from "…"` when every use is `ns.load`.

| Check                  | Reports                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `prefer-named-imports` | A namespace import whose members are all read as `ns.member` |

The engine rule `prefer-named-imports` ships in unslop-ts as an opt-in rule; a package enables it as
`exaix/prefer-named-imports` with a package-local reason. The rule stays silent for spread, computed,
whole-object, and member-free uses, so a facade that forwards the namespace stays valid. Keep such a
facade intentional and mark it with `// unslop-ignore-next-line prefer-named-imports` above the
import. Test files and helpers follow the same rule.

### Fallow-aligned audit {#unused-exports-parity}

The engine ships a parity mode that mirrors fallow's dead-export definition. Run
`deno task check:unused-exports:parity` to list every export that no consumer imports, including
re-exports, entry-point declarations, test helpers, script helpers, default exports, and namespaces. The audit
matches each import to the module that defines the export, so a name that another module imports does not hide an
unused one, and a barrel entry that nobody imports through the barrel is a finding. The files that a manifest exports
are public API. The `publicEntries` option of the rule lists tool-consumed entries such as the prebuilt bundle and
the lint demo examples.

`deno task check:unused-enum-members` adds the enum members that no `Enum.Member` reference reaches. The report is
advisory and stays outside the CI gates: a member can be part of a closed set whose values arrive as data, such as
a protocol code or a stored status. Put `// unslop-ignore-next-line unused-enum-member` above the enum for such a set,
or delete a member that nothing needs.
Every parity finding is an error, but the task is advisory and stays outside the CI gates until the
reported surface is cleaned. `check:unused-exports:parity` is the relaxed local audit (warnings), while
`check:unused-exports:parity:strict` runs in CI and fails on any finding; `check:unused-exports:compare`
prints the diff against fallow. `configurable(…)` registrations and `__test_*` hooks stay exempt, and an intentional value
export carries `// unslop-ignore-next-line unused-export` above the declaration.

### Manifest-based unused files {#unused-files-manifest}

`deno task check:unused-files` starts the unused-file walk at the entry points of every `deno.json` and
`package.json`: `exports`, the code paths in `tasks`, `lint.plugins`, and the files that `deno test` discovers. A script,
a `mod.ts` barrel, and a file in a `tests` folder are not entries by name, so a dead one is reported. The
`manifest` section of the `unused-files` rule in `unslop.config.json` holds the exemptions: `extraEntries` for a tool
that runs a file outside the manifests, `referenceGlobs` for scenario YAML and workflow files that name a script, and
`walkSkipPatterns` for generated and fixture trees. `check:unused-files:fail` fails on any finding and runs in CI.
Rename a test that `deno test` does not discover (`foo_test.ts`) or delete the file.

### Module headers {#module-headers}

Each source file starts with a JSDoc header. The tags are:

| Tag                    | Required | Content                                                     |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `@module`              | Yes      | The logical name                                            |
| `@path`                | Yes      | The path of the file                                        |
| `@description`         | Yes      | A short summary                                             |
| `@architectural-layer` | Yes      | The layer of the module                                     |
| `@related-files`       | Yes      | Files of this repository that explain the module, as a list |
| `@ungrounded`          | No       | Exempts the file from the architecture grounding check      |

The header names no plan phase or step. See [Comment Discipline](#comment-discipline).

`deno task check:arch` resolves each `@related-files` entry against the tracked source, test, and package files
of this repository. An entry that names a path in a submodule, a sibling repository, a workflow file, or the
Dockerfile fails with `does not resolve to a known file or module`. Name a source or test file of this
repository instead. In a package module, an entry must also not name a retired root compatibility path.

| Check                            | Reports                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `module-header-tag`              | A non-test file whose header lacks `@module`, `@path`, or `@description` in the first 15 lines |
| `package-related-files-boundary` | A package header that names a retired root path in `@related-files`                            |
| `exaix/require-module-header`    | A file that does not start with a header comment                                               |

### JSDoc header tag `@visible` {#jsdoc-header-tags}

Tag a class with `@visible` in its own leading JSDoc comment to declare it load-bearing for the visibility
guarantee in `ARCHITECTURE.md`: every significant runtime transition emits a typed, versioned, trace-linked domain
event. The tag is a commitment that tools enforce, not documentation.

```ts
/**
 * @module ReviewRegistry
 * @path packages/core/src/artifact/review_registry.ts
 * @visible
 */
export class ReviewRegistry {}
```

- **When to tag:** a class on the request, plan, execution, review, and memory path, or a class that is
  sensitive for security or observability and whose coverage must never regress silently.
- **Where:** on the leading comment of the class, not in the `@module` header of the file. One file can declare
  more than one class.
- **Static check:** `scripts/check_event_coverage.ts --fail-on-tagged` treats a coverage finding on a tagged class
  as blocking. The pre-commit hook runs it on staged files. A finding is a class with no logger call, and also a
  call whose event name is not a registered `DomainEventType` member. A literal `DomainEventType.X` counts, and so
  does a parameter or field of a private helper in the same class that is typed `TDomainEventType`, resolved one
  level deep.
- **Runtime proof:** a clean static check is not enough. A tagged class needs a Tier A test (package level, real
  `EventLogger` and database, no daemon) or a Tier B test (scenario end to end, full daemon) that shows its main
  events fire at run time with a sound payload. The static check cannot prove that a production caller reaches
  the call site, that the payload is filled, or that the trace ID is right. A logger that no production call site
  injects is the usual cause of an event that never fires. See `.copilot/skills/plan/SKILL.md`.
- **Trace correlation:** when a method emits more than one lifecycle event for the same operation, such as
  started, completed, and failed, pass the trace ID of the operation as the fourth argument of every logger
  call: `logger.info(action, target, payload, traceId)`. A trace ID inside `payload` only is not enough.
  `EventLogger.log` creates a new random trace ID for an event with no fourth argument, and that breaks the
  correlation in the journal. `packages/ai/src/traced_provider.ts` shows the pattern.
- **Streams and generators:** a streaming or generator method emits exactly one terminal event for every way out:
  normal end, an error, and early cancellation by the consumer (`break` or `return()` in a `for await` loop).
  Track whether a terminal event has fired. In a `finally` block, emit a cancellation event only when neither
  success nor failure fired. `TracedProvider.generateStream` shows the pattern.

`scripts/validate_architecture.ts` reads the `@ungrounded` tag the same way: a plain regular expression over the
comment text. The skills `.copilot/skills/clean-codebase/SKILL.md`, `.copilot/skills/edition-development/SKILL.md`,
and `.copilot/skills/review-code/SKILL.md` describe that tag.

## Event Logging Decorators {#log-method-family}

`packages/core/src/logger/decorator.ts` exports three TC39 Stage 3 method decorators. They emit `started`,
`completed`, and `failed` events through an event logger, instead of hand-written try/catch and log code.

| Decorator            | Wraps                                      | Notes                                                          |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `LogMethod`          | An `async` method that returns a `Promise` |                                                                |
| `LogSyncMethod`      | A synchronous method                       | Never awaits the call                                          |
| `LogGeneratorMethod` | An async generator method                  | Brackets the iteration, not the call. Adds a `cancelled` phase |

For a generator, `started` fires before the first pull. `completed` fires after the source generator returns.
`failed` fires on a throw before the generator starts or during iteration.

**Action.** The option `action` is required. The decorators never derive an event name from the class or method
name. Pass one `TDomainEventType`, which every phase shares and the `target` field tells apart (`"started"`,
`"completed"`, `"failed"`, `"cancelled"`). Or pass an `ILifecycleActions` object that gives each phase its own
registered type. `LogGeneratorMethod` takes `IGeneratorLifecycleActions`, which adds `cancelled`. Use the
per-phase form when the phases must stay separate in the taxonomy, as the `Llm…` events of `TracedProvider` do.

**Trace ID.** Each wrapped call gets one trace ID and passes it as the fourth argument of every phase it emits.
By default it is `crypto.randomUUID()`. For `LogMethod` and `LogSyncMethod`, the option `traceIdMapper` can
supply it from the arguments. The events of one call can always be joined in the Activity Journal.

**Payloads.** A mapper replaces the default payload. It does not merge with it, so a mapper that needs
`duration_ms` must include it.

| Decorator                    | Option                                                           | Default                      |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `LogMethod`, `LogSyncMethod` | `payloadMapper(args, result?)` shapes the `completed` payload    | `{ duration_ms }`            |
| `LogGeneratorMethod`         | `startedPayloadMapper(args)` shapes the `started` payload        | `{ args: toSafeJson(args) }` |
| `LogGeneratorMethod`         | `payloadMapper(args, yieldCount, durationMs)` shapes `completed` | `{ duration_ms }`            |

Override `startedPayloadMapper` when the raw arguments are unsuitable for the audit journal, for example a large
prompt that you want to log as its length. A generator has no single result, so it takes `yieldCount` and
`durationMs` instead. A payload mapper cannot read instance fields (`this`). The options are evaluated in a plain
function and not in a class method. A mapper sees only the call arguments and the values that the decorator
tracks.

**Logger source.** The first argument is either an `IEventLogger`, evaluated once when the class is defined, or a
`LoggerResolver<This>`, which is `(instance: This) => IEventLogger | undefined` and is resolved at call time
against the instance. Use the resolver outside `packages/core/` for a class whose logger comes through its
constructor: `@LogSyncMethod((self: Calculator) => self.logger, { action: … })`. The static form, such as
`@LogSyncMethod(this.logger, …)`, is not valid syntax, and a self-constructed `new EventLogger(...)` at the
decorator is allowed by `[package-instantiates-event-logger]` only inside `packages/core/`.

**Coverage check.** `scripts/check_event_coverage.ts` treats a method as covered when it carries one of the three
decorators and the `action` option is a literal `DomainEventType.X`. This is the same way it treats a direct
`.info()`, `.warn()`, or `.error()` call in the method body, or in a private helper of the same class whose action
parameter is typed `TDomainEventType`, one level deep.

## Utility Scripting & Headers {#utility-scripts}

- **Use Deno TypeScript** for repository maintenance, automation, and CI scripts. Avoid Bash and standalone
  Node.js scripts, so that scripts keep type safety and the Deno standard library.
- **Start with the shebang and the header.** Every script in `scripts/` follows the
  [Deno script rules](../unslop-ts/docs/style_guide.md#deno-scripts): the shebang
  `#!/usr/bin/env -S deno run -A` on line 1, then a JSDoc header, then the code.
- **Give the header its tags:** `@module` (the logical name), `@path` (`scripts/<file>.ts`), and
  `@description` (a short summary).
- **Add a `Usage:` section** after the tags with at least one example command, such as
  `deno run -A scripts/ci.ts`. A complex utility also lists `Options:` and `Commands:`.
- **Keep temporary scripts out of `scripts/`.** Put a one-off or debug script elsewhere, for example in the
  repository root or a `tmp/` folder, and name it so that its purpose is clear, such as `debug_test_failure.ts`
  or `tmp_fix_metadata.ts`. The `scripts/` folder holds permanent, documented utilities that the quality gates
  use. The `script-placement` check reports a `debug_` or `tmp_` file in `scripts/`.

```ts
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

## Comment Discipline {#comment-discipline}

The rules are in the [generic guide](../unslop-ts/docs/style_guide.md#comment-discipline), with the Exaix
additions in the [lint-policy guide](../packages/lint-policy/docs/style_guide.md#comment-discipline-additions).
The `deno lint` plugin checks the comments. It applies the date rule to every comment and the other rules to
comments after the module header.

| Rule                       | Reports                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `exaix/long-comment`       | A block comment or a run of line comments longer than three lines                                                                      |
| `exaix/ephemeral-comment`  | A calendar date, or a phase or step number, a GAP identifier, a pre- or post-gap reference, "tried", "didn't work", or a `§` reference |
| `exaix/decorative-comment` | A comment line with a repeated-punctuation separator or dash-wrapped text                                                              |
| `exaix/ephemeral-filename` | A test file name with a numbered plan phase (`phase147_…`). The words "phase" and "step" without a number are allowed.                 |

`exaix/decorative-comment` and `exaix/ephemeral-filename` are errors. `exaix/long-comment` and
`exaix/ephemeral-comment` are opt-in while existing findings remain. Select them with `EXAIX_LINT_RULES` to see
the findings. The rules read TypeScript only, so they do not check a YAML, TOML, or JSONC comment.

## Lint Policy {#lint-policy}

The Exaix lint rules live in two places. `packages/lint-policy` holds the Exaix rules, the version 2 policy, and the
[rule reference](../packages/lint-policy/docs/style_rules.md), and its
[guide](../packages/lint-policy/docs/style_guide.md) holds the Exaix additions. The `unslop-ts` engine holds the
generic rules, and its [guide](../unslop-ts/docs/style_guide.md) describes them.

| Task                         | Runs                                            |
| ---------------------------- | ----------------------------------------------- |
| `deno task lint`             | The plugin rules                                |
| `deno task check:style`      | The script checks of `check_code_style.ts`      |
| `deno task check:magic`      | The magic-value and duplicate-constant checks   |
| `deno task docs:style-rules` | Regenerates the rule reference from the catalog |

[Agent knowledge base manifest](../.copilot/manifest.json)
