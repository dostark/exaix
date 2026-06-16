/**
 * @module CompositionSmokeTest
 * @path tests/integration/composition_smoke_test.ts
 * @description Edition-composition smoke tests (Phase 115 Step 9a) — confirms every seam
 * is reachable through IEditionComposer and ICapabilityModule, Solo defaults load
 * cleanly, and stub modules integrate without crash.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { AllowAllAuthorizer, type IAuthorizer } from "@exaix/core";
import { type ICapabilityModule, type ISeamRegistryPlaceholder, SoloComposer } from "@exaix/core/composer";

describe("Solo composition — zero modules", () => {
  it("constructs SoloComposer without crash", () => {
    const composer = new SoloComposer();
    assertEquals(composer instanceof SoloComposer, true);
  });

  it("default authorizer is AllowAllAuthorizer (always permits)", () => {
    const composer = new SoloComposer();
    const auth: IAuthorizer = composer.authorizer;
    assertEquals(auth.authorize("any", "resource").allowed, true);
    assertEquals(auth instanceof AllowAllAuthorizer, true);
  });

  it("getModules returns empty array", () => {
    const composer = new SoloComposer();
    assertEquals(composer.getModules(), []);
  });
});

describe("Team composition — stub module with all hooks", () => {
  it("registers a module with all hooks and retrieves it", () => {
    const called: string[] = [];
    const stub: ICapabilityModule = {
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
      registerEntitlement: (_authorizer: IAuthorizer) => {
        called.push("entitlement");
      },
    };

    const composer = new SoloComposer();
    composer.registerCapabilityModule(stub);

    assertEquals(composer.getModules().length, 1);
    assertEquals(composer.getModules()[0], stub);
    // SoloComposer stores but does not invoke hooks.
    // TeamComposer will iterate modules and call each hook with concrete registries.
    assertEquals(called, []);
  });

  it("accepts multiple stub modules", () => {
    const composer = new SoloComposer();
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    assertEquals(composer.getModules().length, 3);
  });

  it("module with only registerEntitlement hook is valid", () => {
    const composer = new SoloComposer();
    const module: ICapabilityModule = {
      registerEntitlement: (_auth: IAuthorizer) => {},
    };
    composer.registerCapabilityModule(module);
    assertEquals(composer.getModules().length, 1);
  });
});
