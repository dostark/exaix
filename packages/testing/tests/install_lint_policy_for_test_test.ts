/**
 * @module InstallLintPolicyForTestTest
 * @path packages/testing/tests/install_lint_policy_for_test_test.ts
 * @description Checks the shared helper that installs the portal lint policy once per test process.
 * @architectural-layer Test
 * @dependencies [@std/assert, @std/path, @exaix/testing]
 * @related-files [packages/testing/src/helpers/lint_policy.ts]
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { installLintPolicyForTest } from "@exaix/testing";

const POLICY_FILES = ["catalog.json", "deno.json", "manifest.json", "plugin.ts", "unslop_engine.js"];

Deno.test("lint-policy-test-helper: the helper returns an installed policy directory", async () => {
  const out = await Deno.makeTempDir({ prefix: "lint-policy-helper-" });
  try {
    const policyDir = await installLintPolicyForTest(join(out, "lint"));
    assertEquals(policyDir, join(out, "lint", "unslop"));
    for (const name of POLICY_FILES) {
      assertEquals((await Deno.stat(join(policyDir, name))).isFile, true, name);
    }
    assertEquals(JSON.parse(await Deno.readTextFile(join(policyDir, "deno.json"))), {
      lock: false,
      lint: { plugins: ["./plugin.ts"] },
    });
    assertStringIncludes(await Deno.readTextFile(join(policyDir, "manifest.json")), '"plugin": "unslop"');
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});

Deno.test("lint-policy-test-helper: repeated calls run the installer once", async () => {
  const out = await Deno.makeTempDir({ prefix: "lint-policy-helper-" });
  try {
    const target = join(out, "lint");
    const first = await installLintPolicyForTest(target);
    await Deno.remove(join(first, "manifest.json"));
    const second = await installLintPolicyForTest(target);
    assertEquals(second, first);
    // A second build would restore the manifest deleted above.
    await assertRejects(() => Deno.stat(join(second, "manifest.json")), Deno.errors.NotFound);
  } finally {
    await Deno.remove(out, { recursive: true });
  }
});
