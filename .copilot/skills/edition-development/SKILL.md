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
version: "1.0"
topics: ["edition", "solo", "team", "enterprise", "composer", "seam", "option-c", "build", "ci", "leak-guard", "architecture"]
qwen_skill: edition-development
---

# Edition Development Skill (#edition-development)

Key points

- Exaix ships **three tiers**: Solo (MIT), Team (BSL), Enterprise (private submodule)
- **Option-C layout:** `packages/` (MIT always compiled) · `packages-team/` (BSL, same repo) · `exaix-enterprise/` (private submodule, never published)
- **`IEditionComposer`** is the single attach point for paid capabilities. `SoloComposer` is the default (stores modules, invokes no hooks).
- **`ICapabilityModule`** fills optional seam hooks. All hooks are optional; a module registers only what it provides.
- **`ISeamRegistryPlaceholder`** avoids circular deps between `@exaix/core` and consumer packages like `@exaix/flow`. Concrete types resolved at app-entry level.
- Edition conditionals (`edition ===`, `EXAIX_EDITION`) are **forbidden** outside the composer, `packages-team/`, `exaix-enterprise/`, `scripts/`, and `apps/common/`.
- **Leak-guard** (`scripts/leak_guard.ts`) blocks enterprise paths/headers before OSS publishing.
- **build:solo|team|enterprise** compile distinct binaries with edition-specific entry points and prefixes.

Canonical prompt (short):
"Implement a {edition-tier} feature for Exaix. Determine the correct directory, create an ICapabilityModule, wire it through the composer, add build support, and write tests."

---

## Step 1 — Determine the correct directory

| Code type | Directory | License | Available in |
|---|---|---|---|
| Core contracts, shared logic | `packages/<name>/` | MIT | All editions |
| Team-only feature | `packages-team/<name>/` | BSL | Team + Enterprise |
| Enterprise-only feature | `exaix-enterprise/<name>/` | Proprietary | Enterprise only |
| App wiring | `apps/<name>/` | MIT | All editions |
| Build/CI tooling | `scripts/` | MIT | All editions |

**Rule:** If the feature could be consumed by any edition, put the interface in `packages/`. Put the edition-specific implementation in `packages-team/` or `exaix-enterprise/`.

---

## Step 2 — Define or use the seam interface

A **seam** has:
- An **interface** in the owning `packages/<consumer>/` (e.g. `IFlowStepHandler` in `@exaix/flow`)
- A **registry** in the same package (e.g. `IFlowStepHandlerRegistry`)
- A **hook** on `ICapabilityModule` in `@exaix/core` (e.g. `registerFlowStepHandlers?()`)
- A **default** in Solo (no-op or standard behavior)

### Current seams

| Seam | Interface | Hook | Solo default |
|---|---|---|---|
| Flow-step handlers | `IFlowStepHandler` | `registerFlowStepHandlers?()` | `GateStepHandler`, `AgentStepHandler` |
| Symbol extractors | `ISymbolExtractor` | `registerSymbolExtractors?()` | `TypeScriptExtractor` |
| Guardrail runner | `IGuardrailRunner` | `registerGuardrailRunner?()` | Built-in guardrails |
| Routing strategy | `IProviderRoutingStrategy` | `registerProviderRoutingStrategy?()` | `DefaultRoutingStrategy` |
| Entitlement | `IAuthorizer` | `registerEntitlement?()` | `AllowAllAuthorizer` |

### Adding a new seam

```typescript
// 1. Define in owning package
// packages/foo/src/my_seam.ts
export interface IMySeam { doSomething(): void; }
export interface IMySeamRegistry { register(name: string, seam: IMySeam): void; }

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
import type { ICapabilityModule, ISeamRegistryPlaceholder, IAuthorizer } from "@exaix/core";

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

### Current Solo wiring (all three app entries use this)

```typescript
import { SoloComposer } from "@exaix/core";
const composer = new SoloComposer();
// SoloComposer stores modules, doesn't invoke hooks
```

### Future Team wiring (when TeamComposer is built)

```typescript
import { TeamComposer } from "packages-team/team-composer/mod.ts";
import { TeamFeatureModule } from "packages-team/team-feature/mod.ts";

const composer = new TeamComposer();
composer.registerCapabilityModule(new TeamFeatureModule());
// TeamComposer iterates getModules() and invokes each hook with concrete registries
```

**App entries to update:** `apps/daemon/main.ts`, `apps/exactl/src/init.ts`, `apps/agent-entrypoint/main.ts`.

---

## Step 5 — Build and verify

```bash
# Solo (MIT, excludes packages-team/ and exaix-enterprise/)
deno task build:solo        # entry: apps/daemon/main.ts, prefix: exaix
deno task build:team        # entry: apps/daemon/main.ts, prefix: exaix-team
deno task build:enterprise  # entry: exaix-enterprise/mod.ts, prefix: exaix-enterprise

# Check edition conditionals
deno task check:no-edition-conditionals

# Leak guard (before publishing)
deno run -A scripts/leak_guard.ts --allowlist packages apps --check-headers
deno run -A scripts/leak_guard.ts --check-gitmodules
```

---

## Step 6 — Write tests

| Test type | Location | What to test |
|---|---|---|
| Composer unit tests | `packages/core/tests/` | `SoloComposer` construction, module registration, authorizer |
| Authorizer unit tests | `packages/core/tests/` | `AllowAllAuthorizer` permits, decision shape |
| Composition smoke tests | `tests/integration/` | Solo zero-module no-crash + stub module with all hooks |
| Seam-specific tests | `packages/<seam>/tests/` | Seam interface contract, registry behavior, default impl |

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
      registerFlowStepHandlers: (_r) => { called.push("flow"); },
      registerSymbolExtractors: (_r) => { called.push("symbols"); },
      registerGuardrailRunner: (_r) => { called.push("guardrail"); },
      registerProviderRoutingStrategy: (_r) => { called.push("routing"); },
      registerEntitlement: (_a) => { called.push("entitlement"); },
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

2. **Never import from `packages-team/` or `exaix-enterprise/` in MIT packages or apps.** Solo builds exclude those directories — any import would be a compile error.

3. **Leak-guard must pass before publishing.** The CI release pipeline blocks on it. Leaks detected: enterprise path imports in source, proprietary license headers, `.gitmodules` enterprise entry.

4. **All new interfaces must have `@module` / `@path` / `@architectural-layer` headers** for `check:arch` grounding. Tag deferred seams with `@ungrounded` if they have no production consumer yet.

---

## Examples

**Example 1: Add a Team-only flow-step handler.**

1. Define the handler in `packages-team/team-flow/src/` implementing `IFlowStepHandler`
2. Create a `TeamFlowModule` implementing `ICapabilityModule` with `registerFlowStepHandlers`
3. The module receives an `ISeamRegistryPlaceholder` (resolved to `IFlowStepHandlerRegistry` by the Team composer)
4. In `apps/daemon/main.ts`, replace `SoloComposer` with `TeamComposer` and register `TeamFlowModule`
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

---

## Reference

- **Full architecture document:** `exaix-dev-docs/dev/Exaix_Edition_Architecture.md` — comprehensive guide covering all contracts, seam lifecycle, build internals, CI pipeline, and publishing process.
- **Design doc:** `exaix-dev-docs/dev/Exaix_Edition_Separation_Design.md` — original design decisions, Option-C rationale, §16 registry.
- **ARCHITECTURE.md §Edition Model Overview:** high-level edition model summary with layout diagram.
- **Sources:** `packages/core/src/composer/` (contracts), `packages/core/src/authorizer/` (IAuthorizer), `scripts/ci.ts` (build), `scripts/leak_guard.ts` (publish gate).
