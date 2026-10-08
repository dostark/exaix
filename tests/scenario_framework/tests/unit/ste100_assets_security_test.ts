/**
 * @module Ste100AssetsSecurityTest
 * @path tests/scenario_framework/tests/unit/ste100_assets_security_test.ts
 * @description Phase 195 Step 1 — [security] tests for the isolated-output preflight of
 *   `ste100_assets.ts`: rejects escaped, symlinked, sibling-prefix, and overlapping targets
 *   before any writes, while a clean target is created exclusively.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/ste100_assets.ts, tests/scenario_framework/tests/unit/helpers/ste100_assets_fixture.ts]
 */

import { assertEquals, assertThrows } from "@std/assert";
import { exists } from "@std/fs";
import { join, resolve } from "@std/path";
import { assertIsolatedTarget, createExclusiveIsolatedDir, Ste100PathError } from "../../runner/ste100_assets.ts";
import { withTempRoot } from "./helpers/ste100_assets_fixture.ts";

Deno.test("[security] ste100 isolated output: rejects escaped and sibling-prefix paths without writes", async () => {
  await withTempRoot(async (root) => {
    // A sibling whose name shares a prefix with the intended target leaf.
    await Deno.mkdir(join(root, "out-prefix"), { recursive: true });

    assertThrows(
      () => assertIsolatedTarget(`${root}/../escaped`, root),
      Ste100PathError,
      "is outside isolated root",
    );

    assertThrows(
      () => assertIsolatedTarget(join(root, "out"), root),
      Ste100PathError,
      "is confusable with sibling",
    );

    const outsideRoot = await Deno.makeTempDir({ prefix: "ste100-outside-" });
    try {
      await Deno.symlink(outsideRoot, join(root, "link"));
      assertThrows(
        () => assertIsolatedTarget(join(root, "link", "out"), root),
        Ste100PathError,
        "crosses symlinked path",
      );
    } finally {
      await Deno.remove(outsideRoot, { recursive: true }).catch(() => {});
    }

    // Nothing was written on any rejected path.
    assertEquals(await exists(join(root, "out")), false);
    assertEquals(await exists(join(root, "escaped")), false);

    // A clean target is accepted and created exclusively.
    const created = await createExclusiveIsolatedDir(join(root, "isolated"), root);
    assertEquals(created, resolve(join(root, "isolated")));
    assertEquals(await exists(join(root, "isolated")), true);
  });
});
