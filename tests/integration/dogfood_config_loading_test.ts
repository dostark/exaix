/**
 * @module DogfoodConfigLoadingTest
 * @path tests/integration/dogfood_config_loading_test.ts
 * @description Tests that configs/dogfood.toml loads correctly via ConfigService
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { ConfigService } from "@exaix/core/config";
import { join } from "@std/path";
import { readConfigFixture } from "./helpers/config_fixture.ts";

Deno.test("dogfood config loads without error via ConfigService", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "dogfood-config-test-" });

  try {
    const configPath = join(tempDir, "dogfood.toml");
    await Deno.writeTextFile(configPath, readConfigFixture("dogfood-config-loading"));

    const service = new ConfigService(configPath);
    const config = service.get();

    assertExists(config.system);
    assertEquals(config.system.root, join(tempDir, ".dogfood"));
    assertEquals(config.system.log_level, "info");

    assertExists(config.paths);
    assertEquals(config.paths.workspace, "Workspace");
    assertEquals(config.paths.portals, "Portals");
    assertEquals(config.paths.memory, "Memory");

    assertExists(config.ai);
    assertEquals(config.ai.provider, "ollama");
    assertEquals(config.ai.model, "ollama/llama3");

    assertExists(config.portals);
    assert(config.portals.length >= 1);
    assertEquals(config.portals[0].alias, "exaix-self");
    assertEquals(config.portals[0].target_path, "__WORKTREE_PATH__");
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
});
