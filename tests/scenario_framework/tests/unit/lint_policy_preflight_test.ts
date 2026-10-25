/**
 * @module LintPolicyPreflightTest
 * @path tests/scenario_framework/tests/unit/lint_policy_preflight_test.ts
 * @description Verifies the scenario-runner preflight installs the portal lint policy exactly
 *   once for a selection that needs it, and never for one that does not.
 * @architectural-layer Test
 * @related-files [tests/scenario_framework/runner/lint_policy_preflight.ts, tests/scenario_framework/runner/main.ts]
 */

import { assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { ensureLintPolicy, LINT_POLICY_TASK, needsLintPolicy } from "../../runner/lint_policy_preflight.ts";

/** A temp repo whose packaging task appends one line per invocation. */
async function makeRepo(taskCommand: string): Promise<string> {
  const repoRoot = await Deno.makeTempDir({ prefix: "lint-policy-preflight-repo-" });
  const tasks = { [LINT_POLICY_TASK]: taskCommand };
  await Deno.writeTextFile(join(repoRoot, "deno.json"), JSON.stringify({ tasks }));
  return repoRoot;
}

Deno.test("[lint-policy-preflight] a selection without the lint policy never invokes the packaging task", async () => {
  const repoRoot = await makeRepo("echo invoked >> marker.txt");
  try {
    assertEquals(needsLintPolicy([{ lint_policy: false }]), false);
    await ensureLintPolicy([{ lint_policy: false }], repoRoot);
    assertEquals(await exists(join(repoRoot, "marker.txt")), false);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("[lint-policy-preflight] a selection with the lint policy invokes the packaging task exactly once", async () => {
  const repoRoot = await makeRepo("echo invoked >> marker.txt");
  try {
    assertEquals(needsLintPolicy([{ lint_policy: false }, { lint_policy: true }]), true);
    await ensureLintPolicy([{ lint_policy: true }, { lint_policy: true }], repoRoot);
    const marker = await Deno.readTextFile(join(repoRoot, "marker.txt"));
    assertEquals(marker.trim().split("\n"), ["invoked"]);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("[lint-policy-preflight] a failing packaging task is an explicit setup failure", async () => {
  const repoRoot = await makeRepo("exit 3");
  try {
    await assertRejects(
      () => ensureLintPolicy([{ lint_policy: true }], repoRoot),
      Error,
      LINT_POLICY_TASK,
    );
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});
