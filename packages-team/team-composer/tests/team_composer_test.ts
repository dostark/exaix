/**
 * @module TeamComposerTest
 * @path packages-team/team-composer/tests/team_composer_test.ts
 * @description Unit tests for TeamComposer (Phase 116 Step 2).
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ICapabilityModule, IModelRegistryProvider } from "@exaix/core/composer";
import type { IModelRegistry } from "@exaix/core/types";
import { TeamComposer } from "../src/team_composer.ts";

describe("TeamComposer", () => {
  it("accepts zero modules and runs clean", () => {
    const composer = new TeamComposer();
    assertEquals(typeof composer.registerCapabilityModule, "function");
  });

  it("getModules returns empty array when no modules registered", () => {
    const composer = new TeamComposer();
    assertEquals(composer.getModules(), []);
  });

  it("getModules returns registered modules", () => {
    const composer = new TeamComposer();
    const stub: ICapabilityModule = {};
    composer.registerCapabilityModule(stub);
    assertEquals(composer.getModules().length, 1);
    assertEquals(composer.getModules()[0], stub);
  });

  it("accepts multiple modules", () => {
    const composer = new TeamComposer();
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    composer.registerCapabilityModule({});
    assertEquals(composer.getModules().length, 3);
  });

  it("module with undefined hooks does not throw", () => {
    const composer = new TeamComposer();
    const module: ICapabilityModule = {};
    // None of the optional hooks are defined — must not throw
    composer.registerCapabilityModule(module);
    assertEquals(composer.getModules().length, 1);
  });

  it("getModelRegistryProvider returns undefined without registration", () => {
    const composer = new TeamComposer();
    assertEquals(composer.getModelRegistryProvider(), undefined);
  });

  it("register then getModelRegistryProvider returns the registered provider", () => {
    const composer = new TeamComposer();
    const stubRegistry: IModelRegistry = {} as IModelRegistry;
    let created = false;
    const stubProvider: IModelRegistryProvider = {
      createModelRegistry: () => {
        created = true;
        return stubRegistry;
      },
    };
    composer.registerModelRegistryProvider(stubProvider);
    assertEquals(composer.getModelRegistryProvider(), stubProvider);
    const registry = composer.getModelRegistryProvider()!.createModelRegistry({
      providerRegistry: {},
      healthChecker: { checkProvider: () => Promise.resolve(true) },
    });
    assertEquals(created, true);
    assertEquals(registry, stubRegistry);
  });

  it("registerModelRegistryProvider called twice — last wins", () => {
    const composer = new TeamComposer();
    const stub: IModelRegistry = {} as IModelRegistry;
    const p1: IModelRegistryProvider = { createModelRegistry: () => stub };
    const p2: IModelRegistryProvider = { createModelRegistry: () => stub };
    composer.registerModelRegistryProvider(p1);
    composer.registerModelRegistryProvider(p2);
    assertEquals(composer.getModelRegistryProvider(), p2);
  });
});
