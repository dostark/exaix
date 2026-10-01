/**
 * @module BindingCutoverOpsTest
 * @path tests/scenario_framework/tests/unit/binding_cutover_ops_test.ts
 * @description Checks declarative scenario helpers for config edits and lock replay.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/binding_cutover_ops.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { saveLatestLock, setExploreService } from "../../scripts/binding_cutover_ops.ts";

const FIXTURE =
  '"flow:binding-split/step:explore-*" = { service = "compat-fixture", model = "openai/compat-fixture-v1" }';
const MOCK = '"flow:binding-split/step:explore-*" = { service = "mock", model = "mock/mock-model" }';

Deno.test("[phase204] cutover helper edits only the explore selector and restores it", async () => {
  const root = await Deno.makeTempDir();
  try {
    const configPath = join(root, "exa.config.toml");
    await Deno.writeTextFile(configPath, `[ai]\nprovider = "mock"\n[bindings]\n${FIXTURE}\n`);
    await setExploreService(root, "mock");
    assertEquals(await Deno.readTextFile(configPath), `[ai]\nprovider = "mock"\n[bindings]\n${MOCK}\n`);
    await setExploreService(root, "compat-fixture");
    assertEquals(await Deno.readTextFile(configPath), `[ai]\nprovider = "mock"\n[bindings]\n${FIXTURE}\n`);
    await assertRejects(() => setExploreService(root, "unknown"), Error, "Unsupported service");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("[phase204] cutover helper copies the newest lock for replay", async () => {
  const root = await Deno.makeTempDir();
  try {
    const dir = join(root, ".exa", "bindings");
    await Deno.mkdir(dir, { recursive: true });
    const oldPath = join(dir, "old.lock.json");
    const latestPath = join(dir, "latest.lock.json");
    await Deno.writeTextFile(oldPath, "old");
    await Deno.writeTextFile(latestPath, "latest");
    await Deno.utime(oldPath, new Date(0), new Date(0));
    await saveLatestLock(root);
    assertEquals(await Deno.readTextFile(join(root, ".exa", "fifth.lock.json")), "latest");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
