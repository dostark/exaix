/**
 * @module PlanToRequestsSecurityTest
 * @path tests/integration/plan_to_requests_security_test.ts
 * @description Security tests for scripts/plan_to_requests.ts: a '..'-laden plan slug is
 *   rejected and a pre-existing symlinked PlanContext destination is refused, both without
 *   writing into the sandbox.
 * @architectural-layer Test
 * @related-files [scripts/plan_to_requests.ts]
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  CONTEXT_FIXTURE_PATH,
  CONTEXT_SLUG,
  makeFakeWorktree,
  runGenerator,
} from "./helpers/plan_to_requests_helpers.ts";

Deno.test("[plan-to-requests][plan-context][security] a '..'-laden plan slug is rejected and nothing is written", async () => {
  const wt = await makeFakeWorktree({ withGit: true });
  try {
    // The slug derives from the plan filename. A ".." inside it simulates traversal input.
    const evilDoc = join(await Deno.makeTempDir({ prefix: "evil-src-" }), "phase..evil.md");
    await Deno.writeTextFile(
      evilDoc,
      "# Evil\n\n## Step 1\n\n**Actions:**\n- x\n\n```yaml\n# step-manifest\nstep: 1\ntitle: t\n```\n",
    );

    const { code, stdout, stderr } = await runGenerator([
      evilDoc,
      "--out-dir",
      join(wt, "Workspace", "Requests"),
      "--plan-context-root",
      wt,
    ]);
    assertEquals(code !== 0, true, "must exit non-zero on an unsafe slug");
    assertEquals(
      (stdout + stderr).includes("phase..evil"),
      true,
      "the error must name the rejected slug (rejection-by-validation, not a silent skip)",
    );

    let planContextAbsent = false;
    try {
      await Deno.stat(join(wt, ".exa", "PlanContext"));
    } catch {
      planContextAbsent = true;
    }
    assertEquals(planContextAbsent, true, "nothing may be written into the sandbox on rejection");
  } finally {
    await Deno.remove(wt, { recursive: true });
  }
});

Deno.test("[plan-context][relocation][security] pre-existing symlinked PlanContext file is refused", async () => {
  const wt = await makeFakeWorktree({ withGit: false });
  const outside = await Deno.makeTempDir({ prefix: "plan-context-outside-" });
  try {
    const destDir = join(wt, ".exa", "PlanContext");
    const OUTSIDE_SENTINEL = "must remain untouched";
    const outsideTarget = join(outside, "captured-plan.md");
    await Deno.mkdir(destDir, { recursive: true });
    await Deno.writeTextFile(outsideTarget, OUTSIDE_SENTINEL);
    await Deno.symlink(outsideTarget, join(destDir, `${CONTEXT_SLUG}.md`));

    const result = await runGenerator([
      CONTEXT_FIXTURE_PATH,
      "--out-dir",
      join(wt, "Workspace", "Requests"),
      "--plan-context-root",
      wt,
    ]);

    assertEquals(result.code !== 0, true, "symlinked destination must fail closed");
    assertEquals(
      (result.stdout + result.stderr).toLowerCase().includes("symbolic link"),
      true,
      "failure must identify the rejected symbolic link",
    );
    assertEquals(await Deno.readTextFile(outsideTarget), OUTSIDE_SENTINEL, "symlink target must remain untouched");
  } finally {
    await Deno.remove(wt, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
