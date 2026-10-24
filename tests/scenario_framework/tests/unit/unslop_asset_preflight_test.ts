/**
 * @module UnslopAssetPreflightTest
 * @path tests/scenario_framework/tests/unit/unslop_asset_preflight_test.ts
 * @description Verifies the scenario-runner preflight builds the packaged portal lint
 *   assets exactly once for a selection that needs them, and never for one that does not.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/unslop_asset_preflight.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { ensureUnslopAssets, needsUnslopAssets, UNSLOP_PACKAGING_TASK } from "../../runner/unslop_asset_preflight.ts";

/** A temp repo whose packaging task appends one line per invocation. */
async function makeRepo(taskCommand: string): Promise<string> {
  const repoRoot = await Deno.makeTempDir({ prefix: "unslop-preflight-repo-" });
  const tasks = { [UNSLOP_PACKAGING_TASK]: taskCommand };
  await Deno.writeTextFile(join(repoRoot, "deno.json"), JSON.stringify({ tasks }));
  return repoRoot;
}

Deno.test("[unslop-preflight] a selection without unslop assets never invokes the packaging task", async () => {
  const repoRoot = await makeRepo("echo invoked >> marker.txt");
  try {
    assertEquals(needsUnslopAssets([{ unslop_assets: false }]), false);
    await ensureUnslopAssets([{ unslop_assets: false }], repoRoot);
    assertEquals(await exists(join(repoRoot, "marker.txt")), false);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("[unslop-preflight] a selection with unslop assets invokes the packaging task exactly once", async () => {
  const repoRoot = await makeRepo("echo invoked >> marker.txt");
  try {
    assertEquals(needsUnslopAssets([{ unslop_assets: false }, { unslop_assets: true }]), true);
    await ensureUnslopAssets([{ unslop_assets: true }, { unslop_assets: true }], repoRoot);
    const marker = await Deno.readTextFile(join(repoRoot, "marker.txt"));
    assertEquals(marker.trim().split("\n"), ["invoked"]);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("[unslop-preflight] a failing packaging task is an explicit setup failure", async () => {
  const repoRoot = await makeRepo("exit 3");
  try {
    await assertRejects(
      () => ensureUnslopAssets([{ unslop_assets: true }], repoRoot),
      Error,
      UNSLOP_PACKAGING_TASK,
    );
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
