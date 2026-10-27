/**
 * @module BindingCutoverOpsTest
 * @path tests/scenario_framework/tests/unit/binding_cutover_ops_test.ts
 * @description Checks declarative scenario helpers for config edits and lock replay.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/scripts/binding_cutover_ops.ts]
 */

import * as pathBuilders from "@exaix/shared";
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { saveLock, setExploreService } from "../../scripts/binding_cutover_ops.ts";
import { withTempDir } from "@exaix/testing";

const FIXTURE =
  '"flow:binding-split/step:explore-*" = { service = "compat-fixture", model = "openai/compat-fixture-v1" }';
const MOCK = '"flow:binding-split/step:explore-*" = { service = "mock", model = "mock/mock-model" }';

Deno.test("[phase204] cutover helper edits only the explore selector and restores it", async () => {
  await withTempDir(async (root) => {
    const configPath = join(root, "exa.config.toml");
    await Deno.writeTextFile(configPath, `[ai]\nprovider = "mock"\n[bindings]\n${FIXTURE}\n`);
    await setExploreService(root, "mock");
    assertEquals(await Deno.readTextFile(configPath), `[ai]\nprovider = "mock"\n[bindings]\n${MOCK}\n`);
    await setExploreService(root, "compat-fixture");
    assertEquals(await Deno.readTextFile(configPath), `[ai]\nprovider = "mock"\n[bindings]\n${FIXTURE}\n`);
    await assertRejects(() => setExploreService(root, "unknown"), Error, "Unsupported service");
  });
});

Deno.test("[phase204] cutover helper copies the newest lock for replay", async () => {
  await withTempDir(async (root) => {
    const dir = pathBuilders.runtimePath(root, "bindings");
    await Deno.mkdir(dir, { recursive: true });
    const oldPath = join(dir, "old.lock.json");
    const latestPath = join(dir, "latest.lock.json");
    await Deno.writeTextFile(oldPath, "old");
    await Deno.writeTextFile(latestPath, "latest");
    await Deno.utime(oldPath, new Date(0), new Date(0));
    await saveLock(root, "latest");
    assertEquals(await Deno.readTextFile(pathBuilders.runtimePath(root, "fifth.lock.json")), "latest");
  });
});

Deno.test("[phase204] cutover helper copies the earliest lock for drift replay and refuses to overwrite", async () => {
  await withTempDir(async (root) => {
    const dir = pathBuilders.runtimePath(root, "bindings");
    await Deno.mkdir(dir, { recursive: true });
    const oldPath = join(dir, "old.lock.json");
    const latestPath = join(dir, "latest.lock.json");
    await Deno.writeTextFile(oldPath, "old");
    await Deno.writeTextFile(latestPath, "latest");
    await Deno.utime(oldPath, new Date(0), new Date(0));
    await saveLock(root, "earliest");
    assertEquals(await Deno.readTextFile(pathBuilders.runtimePath(root, "first.lock.json")), "old");
    await assertRejects(() => saveLock(root, "earliest"), Error, "already exists");
  });
});
