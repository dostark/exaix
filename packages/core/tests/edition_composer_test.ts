/**
 * @module EditionComposerTest
 * @path packages/core/tests/edition_composer_test.ts
 * @description Unit tests for IEditionComposer, ICapabilityModule, and SoloComposer (Phase 115 Step 6b).
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { IAuthorizer } from "../mod.ts";
import type { IModelRegistry } from "../src/types/i_model_registry.ts";
import {
  type ICapabilityModule,
  type IEditionComposer,
  type IModelRegistryProvider,
  type ISeamRegistryPlaceholder,
  SoloComposer,
} from "../src/composer/mod.ts";

describe("SoloComposer", () => {
  it("accepts zero modules and runs clean", () => {
    const composer: IEditionComposer = new SoloComposer();
    assertEquals(composer instanceof SoloComposer, true);
    assertEquals(typeof composer.registerCapabilityModule, "function");
  });

  it("getModules returns empty array when no modules registered", () => {
    const composer = new SoloComposer();
    assertEquals(composer.getModules(), []);
  });

  it("getModules returns registered modules", () => {
    const composer = new SoloComposer();

    const stub: ICapabilityModule = {};
    composer.registerCapabilityModule(stub);

    assertEquals(composer.getModules().length, 1);
    assertEquals(composer.getModules()[0], stub);
  });

  it("accepts multiple modules", () => {
    const composer = new SoloComposer();
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    assertEquals(composer.getModules().length, 3);
  });

  it("SoloComposer implements IEditionComposer interface", () => {
    const composer: IEditionComposer = new SoloComposer();
    const module: ICapabilityModule = {};
    composer.registerCapabilityModule(module);
    // interface contract satisfied — no crash
  });

  it("getModelRegistryProvider returns undefined without registration (Solo default)", () => {
    const composer = new SoloComposer();
    assertEquals(composer.getModelRegistryProvider(), undefined);
  });

  it("register then getModelRegistryProvider returns the registered provider", () => {
    const composer = new SoloComposer();
    const stubRegistry = {} as IModelRegistry;
    let created = false;
    const stubProvider: IModelRegistryProvider = {
      createModelRegistry: () => {
        created = true;
        return stubRegistry;
      },
    };
    composer.registerModelRegistryProvider(stubProvider);
    const retrieved = composer.getModelRegistryProvider();
    assertEquals(retrieved, stubProvider);
    // Verify the factory actually works
    retrieved!.createModelRegistry({
      providerRegistry: {},
      healthChecker: { checkProvider: () => Promise.resolve(true) },
    });
    assertEquals(created, true);
  });

  it("registerModelRegistryProvider called twice — last wins", () => {
    const composer = new SoloComposer();
    const stub = {} as IModelRegistry;
    const p1: IModelRegistryProvider = { createModelRegistry: () => stub };
    const p2: IModelRegistryProvider = { createModelRegistry: () => stub };
    composer.registerModelRegistryProvider(p1);
    composer.registerModelRegistryProvider(p2);
    assertEquals(composer.getModelRegistryProvider(), p2);
  });

  it("getModelRegistryProvider called multiple times consistently returns the same value", () => {
    const composer = new SoloComposer();
    assertEquals(composer.getModelRegistryProvider(), undefined);
    assertEquals(composer.getModelRegistryProvider(), undefined);
    const stub = {} as IModelRegistry;
    const stubProvider: IModelRegistryProvider = { createModelRegistry: () => stub };
    composer.registerModelRegistryProvider(stubProvider);
    assertEquals(composer.getModelRegistryProvider(), stubProvider);
    assertEquals(composer.getModelRegistryProvider(), stubProvider);
  });
});

describe("ICapabilityModule structure", () => {
  it("accepts a module with all hooks", () => {
    const called: string[] = [];
    const module: ICapabilityModule = {
      registerFlowStepHandlers: (_registry: ISeamRegistryPlaceholder) => {
        called.push("flow");
      },
      registerSymbolExtractors: (_registry: ISeamRegistryPlaceholder) => {
        called.push("symbols");
      },
      registerGuardrailRunner: (_registry: ISeamRegistryPlaceholder) => {
        called.push("guardrail");
      },
      registerProviderRoutingStrategy: (_registry: ISeamRegistryPlaceholder) => {
        called.push("routing");
      },
      registerEntitlement: (_auth: IAuthorizer) => {
        called.push("entitlement");
      },
    };

    const composer = new SoloComposer();
    composer.registerCapabilityModule(module);

    // SoloComposer stores but does not invoke hooks — the app-level composer
    // (TeamComposer) will iterate modules and call each hook with the right registry.
    assertEquals(composer.getModules().length, 1);
    assertEquals(called, []);
  });
});
