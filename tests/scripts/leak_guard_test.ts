/**
 * @module LeakGuardTest
 * @path tests/scripts/leak_guard_test.ts
 * @description Regression tests for scripts/leak_guard.ts against a submodule-backed
 *   exaix-team/ tree (Phase 171 Step 7) — in particular that an uninitialized
 *   submodule (an empty gitlink directory, as seen by a contributor who has not yet run
 *   `git submodule update --init`) does not crash the scan.
 * @architectural-layer Test
 * @related-files [scripts/leak_guard.ts]
 */

import { assertEquals } from "@std/assert";
import { runLeakGuard } from "../../scripts/leak_guard.ts";

Deno.test("[leak-guard] an uninitialized (empty) submodule directory does not throw and reports zero errors", async () => {
  const emptyDir = await Deno.makeTempDir({ prefix: "leak_guard_uninit_submodule_" });
  try {
    const result = await runLeakGuard({ allowlist: [emptyDir] });
    assertEquals(result.passed, true);
    assertEquals(result.errors, []);
  } finally {
    await Deno.remove(emptyDir, { recursive: true });
  }
});

Deno.test("[leak-guard] the real exaix-team submodule tree scans clean", async () => {
  const result = await runLeakGuard({ allowlist: ["exaix-team"] });
  assertEquals(result.passed, true);
  assertEquals(result.errors, []);
});
