/**
 * @module EvalReportFamilyViewTest
 * @path apps/exactl/tests/eval_report_family_view_test.ts
 * @description Tests for eval report --view families. Verifies the CLI dispatches
 *   correctly. Phase 141 Step 9 (GAP-2 remediation).
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/commands/eval_commands.ts, apps/exactl/src/exactl.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("eval report --view families dispatches through the real command tree", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    let receivedOptions: { view?: string; scenario?: string; last?: number; pack?: string } | undefined;
    ctx.evalCommands.report = (options: { view?: string; scenario?: string; last?: number; pack?: string }) => {
      called = true;
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--view", "families", "--pack", "swe_tasks"]);

    assert(called, "evalCommands.report should have been called via CLI dispatch");
    assertEquals(receivedOptions?.view, "families");
    assertEquals(receivedOptions?.pack, "swe_tasks");
  });
});

Deno.test("eval report --view families works without --pack", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { view?: string; pack?: string } | undefined;
    ctx.evalCommands.report = (options: { view?: string; pack?: string }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--view", "families"]);

    assertEquals(receivedOptions?.view, "families");
  });
});
