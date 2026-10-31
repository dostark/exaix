/**
 * @module HealthLcovTaskTest
 * @path tests/scripts/health_lcov_task_test.ts
 * @description Proves the health LCOV workflow rejects failed tests and reports fresh measured samples.
 * @architectural-layer Test
 * @related-files [scripts/health_lcov.ts, packages/lint-policy/tests/policy_config_test.ts]
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = fromFileUrl(new URL("../../scripts/health_lcov.ts", import.meta.url));
const LCOV_PATH = join(ROOT, "coverage", "lcov.info");

/** Runs the production LCOV workflow with one selected test path. */
async function workflow(testPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT, testPath],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

Deno.test("fix(health-lcov): failed tests cannot leave a stale measured report", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "health_lcov_failure_" });
  try {
    const failure = join(scratch, "failing_test.ts");
    await Deno.writeTextFile(
      failure,
      'Deno.test("failure", () => { throw new Error("intentional coverage failure"); });\n',
    );
    await Deno.mkdir(join(ROOT, "coverage"), { recursive: true });
    await Deno.writeTextFile(LCOV_PATH, "stale coverage must be removed\n");
    const failed = await workflow(failure);
    assertEquals(failed.code, 1);
    assertStringIncludes(failed.stdout + failed.stderr, "intentional coverage failure");
    assertEquals(await Deno.stat(LCOV_PATH).then(() => true, () => false), false);

    const passed = await workflow("packages/lint-policy/tests/policy_config_test.ts");
    assertEquals(passed.code, 0, passed.stderr.slice(-2000));
    assert(/coverage:?\s+lcov\s+[·(]\s*[1-9]\d* matched/i.test(passed.stdout), passed.stdout);
    assertStringIncludes(await Deno.readTextFile(LCOV_PATH), "SF:");
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});
