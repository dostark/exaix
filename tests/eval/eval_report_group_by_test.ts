/**
 * @module EvalReportGroupByTest
 * @path tests/eval/eval_report_group_by_test.ts
 * @description Tests for eval report --group-by subsystem|entity flag.
 *   Verifies the flag dispatches correctly through the CLI command tree.
 */
import { assert, assertEquals } from "@std/assert";
import { withTestMod } from "../../apps/exactl/tests/helpers/test_utils.ts";

Deno.test("eval report --group-by subsystem dispatches through the real command tree", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    let receivedOptions: { groupBy?: string; view?: string; pack?: string } | undefined;
    ctx.evalCommands.report = (options: { groupBy?: string; view?: string; pack?: string }) => {
      called = true;
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--group-by", "subsystem"]);

    assert(called, "evalCommands.report should have been called via CLI dispatch");
    assertEquals(receivedOptions?.groupBy, "subsystem");
  });
});

Deno.test("eval report --group-by entity dispatches correctly", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { groupBy?: string } | undefined;
    ctx.evalCommands.report = (options: { groupBy?: string }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--group-by", "entity"]);

    assertEquals(receivedOptions?.groupBy, "entity");
  });
});

Deno.test("eval report --group-by with --tag dispatches combined options", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { groupBy?: string; pack?: string } | undefined;
    ctx.evalCommands.report = (options: { groupBy?: string; pack?: string }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--group-by", "entity", "--pack", "swe-tasks"]);

    assertEquals(receivedOptions?.groupBy, "entity");
    assertEquals(receivedOptions?.pack, "swe-tasks");
  });
});
