/**
 * @module GodObjectsComparisonSecurityTest
 * @path packages/lint-policy/tests/god_objects_compare_security_test.ts
 * @description Rejects mismatched comparison policies before writes and verifies matching custom policies.
 * @architectural-layer Test
 * @related-files [scripts/god_objects_compare.ts, packages/lint-policy/tests/helpers/god_objects_comparison.ts]
 */
import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withCeilingProject } from "./helpers/ceiling_project.ts";
import { compareOver, GOD_RULE, SMALL_CLASS } from "./helpers/god_objects_comparison.ts";

Deno.test("god-objects-compare-custom-config [security]: reject mismatches before writes and measure a matching custom policy", async () => {
  await withCeilingProject(GOD_RULE, { "packages/x/src/small.ts": SMALL_CLASS }, async (dir) => {
    const policyPath = join(dir, "unslop.config.json");
    const customPath = join(dir, "custom.json");
    const before = await Deno.readTextFile(policyPath);
    await Deno.writeTextFile(customPath, before);
    const mismatch = await compareOver(dir, ["--config=custom.json"]);
    assertNotEquals(mismatch.code, 0, mismatch.stdout);
    assertStringIncludes(mismatch.stderr, "--config must match");
    assertEquals(await Deno.readTextFile(policyPath), before);
    assertEquals(await Deno.readTextFile(customPath), before);
    for (const name of ["unslop.project.ts", "plugin.ts"]) {
      const path = join(dir, name);
      await Deno.writeTextFile(path, (await Deno.readTextFile(path)).replaceAll("unslop.config.json", "custom.json"));
    }
    const matching = await compareOver(dir, ["--config=custom.json"]);
    assertEquals(matching.code, 0, matching.stderr);
    assertStringIncludes(matching.stdout, "god-class flags 0 class(es); legacy-score flags 1 class(es).");
    assertEquals(await Deno.readTextFile(policyPath), before);
    assertEquals(await Deno.readTextFile(customPath), before);
  });
});
