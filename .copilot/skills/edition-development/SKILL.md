---
name: edition-development
agent: copilot
tools:
  - read_file
  - patch_file
  - write_file
  - run_command
  - glob
  - grep
scope: dev
title: "Edition Development Skill (#edition-development)"
description: Guide for developing edition-specific features within Exaix's three-tier edition architecture — Option-C layout, seam wiring, composer contracts, build targets, and CI/release pipeline
short_summary: "Develop edition-specific features (Solo/Team/Enterprise) following Exaix's composition architecture, Option-C layout, and seam-based extension model."
version: "1.1.0"
topics: [
  "edition",
  "solo",
  "team",
  "enterprise",
  "composer",
  "seam",
  "option-c",
  "build",
  "ci",
  "leak-guard",
  "architecture",
]
qwen_skill: edition-development
---

# Edition Development Skill (#edition-development)

Key points

- Exaix ships **three tiers**: Solo (MIT), Team (BSL), Enterprise (private submodule)
- **Option-C layout:** `packages/` (MIT always compiled) · `packages-team/` (BSL, same repo) · `exaix-enterprise/` (private submodule, never published)
- **`IEditionComposer`** + **`ICapabilityModule`** seam shipped in **Phase 115**. `SoloComposer` stores modules but invokes no hooks; `TeamComposer` (Phase 116) is wired in the daemon when `EXAIX_EDITION=team`.
- **`ISeamRegistryPlaceholder`** avoids circular deps between `@exaix/core` and consumer packages. Concrete types are resolved at the app-entry level via `as unknown as ISeamRegistryPlaceholder` — this is the intended bridge (the placeholder is replaced by a concrete type when the first consumer exists, per the JSDoc).
- **Module hooks are invoked post-construction.** Build the seam owner first (e.g., `FlowRunner`), then iterate `composer.getModules()` and call each hook with the concrete registry cast to `ISeamRegistryPlaceholder`.
- Edition conditionals (`edition ===`, `EXAIX_EDITION`) are **forbidden** outside `apps/daemon/main.ts`, `apps/exactl/src/init.ts`, `packages-team/`, `exaix-enterprise/`, `scripts/`, and `apps/common/`. Enforced by `deno task check:no-edition-conditionals`.
- **Leak-guard** (`scripts/leak_guard.ts`) blocks enterprise paths/headers before OSS publishing.
- **build:solo|team|enterprise** (`deno.json` lines 105-107) compile distinct binaries via `scripts/ci.ts build --edition <name>`.

Canonical prompt (short):
"Implement a {edition-tier} feature for Exaix. Determine the correct directory, create an ICapabilityModule, wire it through the composer, add build support, and write tests."

---

## Step 1 — Determine the correct directory

| Code type                    | Directory                  | License     | Available in      |
| ---------------------------- | -------------------------- | ----------- | ----------------- |
| Core contracts, shared logic | `packages/<name>/`         | MIT         | All editions      |
| Team-only feature            | `packages-team/<name>/`    | BSL         | Team + Enterprise |
| Enterprise-only feature      | `exaix-enterprise/<name>/` | Proprietary | Enterprise only   |
| App wiring                   | `apps/<name>/`             | MIT         | All editions      |
| Build/CI tooling             | `scripts/`                 | MIT         | All editions      |

**Rule:** If the feature could be consumed by any edition, put the interface in `packages/`. Put the edition-specific implementation in `packages-team/` or `exaix-enterprise/`.

---

## Step 2 — Define or use the seam interface

A **seam** has:

- An **interface** in the owning `packages/<consumer>/` (e.g. `IFlowStepHandler` in `@exaix/flow`)
- A **registry** in the same package (e.g. `IFlowStepHandlerRegistry`)
- A **hook** on `ICapabilityModule` in `@exaix/core` (e.g. `registerFlowStepHandlers?()`)
- A **default** in Solo (no-op or standard behavior)

### Current seams

| Seam               | Interface                  | Hook                                 | Solo default                          |
| ------------------ | -------------------------- | ------------------------------------ | ------------------------------------- |
| Flow-step handlers | `IFlowStepHandler`         | `registerFlowStepHandlers?()`        | `GateStepHandler`, `AgentStepHandler` |
| Symbol extractors  | `ISymbolExtractor`         | `registerSymbolExtractors?()`        | `TypeScriptExtractor`                 |
| Guardrail runner   | `IGuardrailRunner`         | `registerGuardrailRunner?()`         | Built-in guardrails                   |
| Routing strategy   | `IProviderRoutingStrategy` | `registerProviderRoutingStrategy?()` | `DefaultRoutingStrategy`              |
| Entitlement        | `IAuthorizer`              | `registerEntitlement?()`             | `AllowAllAuthorizer`                  |

### Adding a new seam

```typescript
// 1. Define in owning package
// packages/foo/src/my_seam.ts
export interface IMySeam {
  doSomething(): void;
}
export interface IMySeamRegistry {
  register(name: string, seam: IMySeam): void;
}

// 2. Add hook to ICapabilityModule in @exaix/core
// packages/core/src/composer/edition_composer.ts
export interface ICapabilityModule {
  registerMySeam?(registry: ISeamRegistryPlaceholder): void;
}

// 3. Use ISeamRegistryPlaceholder to avoid circular deps
// Opaque until the Team composer resolves concrete types.
```

---

## Step 3 — Implement the capability module

```typescript
// packages-team/team-feature/src/team_module.ts
import type { IAuthorizer, ICapabilityModule, ISeamRegistryPlaceholder } from "@exaix/core";

export class TeamFeatureModule implements ICapabilityModule {
  registerFlowStepHandlers?(registry: ISeamRegistryPlaceholder): void {
    // Register Team-specific step handlers into the concrete registry
  }

  registerEntitlement?(authorizer: IAuthorizer): void {
    // Register Team-tier authorization policy
  }
}
```

---

## Step 4 — Wire through the composer

The daemon (`apps/daemon/main.ts`) already implements the edition bootstrap pattern (Phase 115/116).
`apps/exactl/src/init.ts` follows the same pattern for the CLI.

### Daemon edition bootstrap (Phase 115/116 pattern)

```typescript
// apps/daemon/main.ts — edition-aware bootstrap
const editionType = Deno.env.get("EXAIX_EDITION") ?? EDITION_SOLO;
let _editionComposer: SoloComposer | TeamComposer;
if (editionType === EDITION_TEAM) {
  bootstrapTeamProviders();
  _editionComposer = new TeamComposer();
} else {
  _editionComposer = new SoloComposer();
}
```

### Register a capability module and invoke its hooks

Build the seam owner first, then wire module hooks post-construction.
This is the pattern established by Phase 113 (voting):

```typescript
// 1. Build the seam owner (FlowRunner, etc.)
const flowRunner = new FlowRunner({ agentExecutor, config, eventLogger });

// 2. Construct the service and capability module (Team-only)
const votingService = new VotingConsensusService(agentExecutor, logger);
const votingModule = new VotingCapabilityModule(votingService, logger);

// 3. Register module with the composer
_editionComposer.registerCapabilityModule(votingModule);

// 4. Invoke module hooks against the seam owner's registry
const registry = flowRunner.getStepHandlerRegistry();
for (const module of _editionComposer.getModules()) {
  module.registerFlowStepHandlers?.(registry as unknown as ISeamRegistryPlaceholder);
}

// 5. Guard with EXAIX_EDITION check (only Team edition wires the module)
if (editionType === EDITION_TEAM) {
  // steps 2–4 above
}
```

### Casting `ISeamRegistryPlaceholder` in the capability module

Inside the module's hook implementation, cast back to the concrete registry type:

```typescript
// packages-team/voting/src/voting_capability_module.ts
export class VotingCapabilityModule implements ICapabilityModule {
  readonly #votingService: IVotingConsensusService;
  readonly #logger: IEventLogger;

  constructor(votingService: IVotingConsensusService, logger: IEventLogger) {
    this.#votingService = votingService;
    this.#logger = logger;
  }

  registerFlowStepHandlers(registry: ISeamRegistryPlaceholder): void {
    const flowRegistry = registry as unknown as FlowStepHandlerRegistry;
    flowRegistry.register(
      new VotingStepHandler({
        votingService: this.#votingService,
        eventLogger: this.#logger,
      }),
    );
  }
}
```

### Why post-construction instead of constructor injection?

- `GateStepHandler` receives `gateEvaluator` via `FlowRunner` options because `gateEvaluator` is available at construction time.
- Voting and other Team features need `FlowRunner`'s registry _after_ construction — they register handlers externally via `getStepHandlerRegistry()`.
- The `ICapabilityModule` seam is the single attach point: the module receives the registry, not the FlowRunner constructor options.

**App entries to update:** `apps/daemon/main.ts` (primary), `apps/exactl/src/init.ts` (CLI).

---

## Step 5 — Build and verify

```bash
# Solo (MIT, excludes packages-team/ and exaix-enterprise/)
deno task build:solo        # entry: apps/daemon/main.ts, prefix: exaix
deno task build:team        # entry: apps/daemon/main.ts, prefix: exaix-team
deno task build:enterprise  # entry: exaix-enterprise/mod.ts, prefix: exaix-enterprise

# Check edition conditionals — ensures no edition === / EXAIX_EDITION leaks
# into MIT packages. Forbidden everywhere except:
#   apps/daemon/main.ts, apps/exactl/src/init.ts,
#   packages-team/, exaix-enterprise/, scripts/, apps/common/
deno task check:no-edition-conditionals

# Full CI pipeline per edition
deno task ci:solo           # check + test + coverage + build (Solo)
deno task ci:team           # check + test + coverage + build (Team)

# Leak guard (before publishing Solo OSS)
deno run -A scripts/leak_guard.ts --allowlist packages apps --check-headers
deno run -A scripts/leak_guard.ts --check-gitmodules
```

---

## Step 6 — Write tests

| Test type               | Location                 | What to test                                                 |
| ----------------------- | ------------------------ | ------------------------------------------------------------ |
| Composer unit tests     | `packages/core/tests/`   | `SoloComposer` construction, module registration, authorizer |
| Authorizer unit tests   | `packages/core/tests/`   | `AllowAllAuthorizer` permits, decision shape                 |
| Composition smoke tests | `tests/integration/`     | Solo zero-module no-crash + stub module with all hooks       |
| Seam-specific tests     | `packages/<seam>/tests/` | Seam interface contract, registry behavior, default impl     |

### Composition smoke test pattern

```typescript
describe("Solo composition — zero modules", () => {
  it("constructs SoloComposer without crash", () => {
    const composer = new SoloComposer();
    assertEquals(composer instanceof SoloComposer, true);
  });
  it("default authorizer is AllowAllAuthorizer", () => {
    const composer = new SoloComposer();
    assertEquals(composer.authorizer.authorize("any", "resource").allowed, true);
  });
});

describe("Team composition — stub module with all hooks", () => {
  it("registers a module with all hooks", () => {
    const stub: ICapabilityModule = {
      registerFlowStepHandlers: (_r) => {
        called.push("flow");
      },
      registerSymbolExtractors: (_r) => {
        called.push("symbols");
      },
      registerGuardrailRunner: (_r) => {
        called.push("guardrail");
      },
      registerProviderRoutingStrategy: (_r) => {
        called.push("routing");
      },
      registerEntitlement: (_a) => {
        called.push("entitlement");
      },
    };
    const composer = new SoloComposer();
    composer.registerCapabilityModule(stub);
    assertEquals(composer.getModules().length, 1);
  });
});
```

---

## Guardrails to follow

1. **Never put edition conditionals in core packages.** The `[edition-conditional-outside-composer]` rule in `check_code_style.ts` enforces this. Allowed only in: `src/composer/`, `packages-team/`, `exaix-enterprise/`, `scripts/`, `apps/common/`.

2. **Never import from `packages-team/` or `@exaix-team/*` in MIT source files.** The `[mit-team-import]` rule in `check_code_style.ts` enforces this across `packages/`. Test files (`/tests/`, `/testing/`) are exempt — integration tests legitimately import Team classes. When MIT source needs a Team type, extract the interface to `packages/core/types/`.

3. **Leak-guard must pass before publishing.** The CI release pipeline blocks on it. Leaks detected: enterprise path imports in source, proprietary license headers, `.gitmodules` enterprise entry.

4. **All new interfaces must have `@module` / `@path` / `@architectural-layer` headers** for `check:arch` grounding. Tag deferred seams with `@ungrounded` if they have no production consumer yet.

---

## Output Format

1. **Edition tier** — Solo / Team / Enterprise.
1. **Directory selected** — `packages/`, `packages-team/`, or `exaix-enterprise/`.
1. **Seam interface** — interface name, registry, and hook on `ICapabilityModule`.
1. **Capability module** — file path and hook implementation.
1. **Wiring changes** — files modified in `apps/daemon/main.ts` or `apps/exactl/src/init.ts`.
1. **Build verification** — `deno task build:<edition>` result.
1. **CI gate results** — `check:style`, `check:arch`, `check:no-edition-conditionals`.
1. **Commit payload** — use `#commit` for the structured commit.

## Examples

**Example 1: Add a Team-only flow-step handler.**

1. Define the handler in `packages-team/team-flow/src/` implementing `IFlowStepHandler`
2. Create a `TeamFlowModule` implementing `ICapabilityModule` with `registerFlowStepHandlers`
3. The module receives an `ISeamRegistryPlaceholder` (cast to `IFlowStepHandlerRegistry` in the module)
4. In `apps/daemon/main.ts`, within the `if (editionType === EDITION_TEAM)` block, construct the module, register it with the composer, and call `registerFlowStepHandlers` against the FlowRunner's registry
5. Test: add a stub hook in `tests/integration/composition_smoke_test.ts`
6. Build: `deno task build:team`

**Example 2: Add an Enterprise-only entitlement check.**

1. Define an `EnterpriseAuthorizer` implementing `IAuthorizer` in `exaix-enterprise/src/`
2. Create an `EnterpriseModule` implementing `ICapabilityModule` with `registerEntitlement`
3. The hook receives the concrete `IAuthorizer` instance from the composer
4. Test: verify `EnterpriseAuthorizer.authorize()` returns expected decisions
5. Build: `deno task build:enterprise`
6. Before publishing Solo/Team OSS, run `deno run -A scripts/leak_guard.ts --allowlist packages apps --check-headers`

**Example 3: Add a new seam for capacity rate-limiting.**

1. Define `ICapacityManager` and `ICapacityManagerRegistry` in `packages/core/src/capacity/`
2. Add `registerCapacityManager?(registry: ISeamRegistryPlaceholder)` to `ICapabilityModule`
3. Export from `packages/core/mod.ts`
4. Create a stub hook test in `tests/integration/composition_smoke_test.ts`
5. Implement the Solo default as a no-op or pass-through
6. Wire the concrete registry in the future Team/Enterprise composer

**Example 4: Phase 113 voting module — first concrete seam consumer (reference implementation).**

The voting module (`packages-team/voting/src/voting_capability_module.ts`) is the **first production
consumer** of `ICapabilityModule.registerFlowStepHandlers`. Follow this pattern for new Team features:

1. Create the capability module alongside the service (MIT package). The edition gating happens at
   the daemon level via `EXAIX_EDITION`, not in the module itself.
2. The module's hook casts `ISeamRegistryPlaceholder` to `FlowStepHandlerRegistry` and registers
   the handler.
3. In the daemon, construct the service, construct the module, register with `TeamComposer`,
   then iterate modules and invoke hooks against the FlowRunner's registry.
4. Handler-level tests prove the module registers correctly.
5. Integration tests (`packages-team/voting/tests/voting_capability_module_test.ts`) prove the full path with `EXAIX_EDITION=team`.

Key files to reference:

- `packages-team/voting/src/voting_capability_module.ts` — the module
- `packages/flow/src/step_handlers/voting_step_handler.ts` — the handler
- `apps/daemon/main.ts` (Team edition bootstrap) — the wiring

---

## Reference

- **Full architecture document:** `exaix-dev-docs/dev/Exaix_Edition_Architecture.md` — comprehensive guide covering all contracts, seam lifecycle, build internals, CI pipeline, and publishing process.
- **Design doc:** `exaix-dev-docs/dev/Exaix_Edition_Separation_Design.md` — original design decisions, Option-C rationale, §16 registry.
- **ARCHITECTURE.md §Edition Model Overview:** high-level edition model summary with layout diagram.
- **Sources:** `packages/core/src/composer/` (contracts), `packages/core/src/authorizer/` (IAuthorizer), `scripts/ci.ts` (build), `scripts/leak_guard.ts` (publish gate).

---
exaix:
  skill_id: edition-development
  triggers:
    keywords: [edition, edition-model, tier, community, pro, enterprise, option-c]
    task_types: [feature, refactor]
    tags: [edition, architecture]
  constraints:
    - "Follow Exaix three-tier edition architecture (Community, Pro, Enterprise)"
    - "Use Option-C layout for edition-specific code"
    - "Wire via seam interfaces in packages/core/src/composer/"
    - "Respect build targets and CI pipeline per edition"
    - "Do not introduce edition conditionals in shared code paths"
  output_requirements:
    - "Edition-specific implementation in correct tier directory"
    - "Seam interface wired in composer contract"
    - "Build target updated for the new edition"
    - "CI pipeline includes edition-specific gate"
  quality_criteria:
    - name: seam_compliance
      description: Edition features wired through composer contracts, not conditionals
      weight: 40
    - name: build_integrity
      description: Each edition builds independently with correct dependencies
      weight: 30
    - name: boundary_discipline
      description: Shared code paths contain no edition-specific branching
      weight: 30
---
