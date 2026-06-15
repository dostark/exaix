/**
 * @module TeamComposerTest
 * @path packages-team/team-composer/tests/team_composer_test.ts
 * @description Unit tests for TeamComposer (Phase 116 Step 2).
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ICapabilityModule } from "@exaix/core";
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
});
