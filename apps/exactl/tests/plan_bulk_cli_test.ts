/**
 * @module PlanBulkCliTest
 * @path apps/exactl/tests/plan_bulk_cli_test.ts
 * @description Runs the real exactl binary against the id-or-all rule of plan approve and plan amendment commands.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/exactl_cli_process.ts]
 * @related-files [apps/exactl/src/command_builders/plan_command.ts, apps/exactl/src/command_builders/bulk_targets.ts]
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const USAGE_EXIT_CODE = 2;

Deno.test("plan approve with ids and --all is a usage error", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["plan", "approve", "p-1", "--all"]]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "Pass plan ids or --all, not both.");
});

Deno.test("plan approve without an id or --all is a usage error", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["plan", "approve"]]);
  assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(run.stderr, "Pass at least one plan id or --all.");
});

Deno.test("plan amendment approve and show follow the same id-or-all rule", async () => {
  const runs = await runExactlSequenceInTempWorkspace([
    ["plan", "amendment", "approve", "a-1", "--all"],
    ["plan", "amendment", "show"],
    ["memory", "proposal", "approve", "p-1", "--all"],
    ["memory", "proposal", "approve", "p-1", "--dry-run"],
  ]);
  for (const run of runs) assertEquals(run.code, USAGE_EXIT_CODE, run.stderr);
  assertStringIncludes(runs[0].stderr, "Pass amendment ids or --all, not both.");
  assertStringIncludes(runs[1].stderr, "Pass at least one amendment id or --all.");
  assertStringIncludes(runs[2].stderr, "Pass proposal ids or --all, not both.");
  assertStringIncludes(runs[3].stderr, "--dry-run takes no proposal id.");
});

Deno.test("plan approve --all on a workspace without plans exits 0", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["plan", "approve", "--all"]]);
  assertEquals(run.code, 0, run.stderr);
});
