/**
 * @module EditionComposerTest
 * @path packages/core/tests/edition_composer_test.ts
 * @description Unit tests for IEditionComposer, ICapabilityModule, and SoloComposer (Phase 115 Step 6b).
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  type IAuthorizer,
  type ICapabilityModule,
  type IEditionComposer,
  type ISeamRegistryPlaceholder,
  SoloComposer,
} from "../mod.ts";

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
