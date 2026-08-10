/**
 * @module EvalReportCliDispatchTest
 * @path apps/exactl/tests/eval_report_cli_dispatch_test.ts
 * @description Phase 140a Step 4 — RED-first test. `exactl eval report --view cost` must be
 * reachable through the actual command tree (mod.__test_command.parse), not only correctly
 * implemented as an isolated EvalCommands.report() method — proving the command is registered
 * and wired, not production-dead.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/eval_commands.ts]
 */

import { assert, assertEquals } from "@std/assert";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("eval report --view cost dispatches through the real command tree to evalCommands.report", async () => {
  await withTestMod(async (mod, ctx) => {
    let called = false;
    let receivedOptions: { view?: string; scenario?: string; last?: number } | undefined;
    ctx.evalCommands.report = (options: { view?: string; scenario?: string; last?: number }) => {
      called = true;
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--view", "cost", "--scenario", "my-scenario"]);

    assert(called, "evalCommands.report should have been called via CLI dispatch");
    assertEquals(receivedOptions?.view, "cost");
    assertEquals(receivedOptions?.scenario, "my-scenario");
  });
});

Deno.test("eval report defaults --view to cost when omitted", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { view?: string; scenario?: string; last?: number } | undefined;
    ctx.evalCommands.report = (options: { view?: string; scenario?: string; last?: number }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report"]);

    assertEquals(receivedOptions?.view, "cost");
  });
});

Deno.test("eval report --view external --format json dispatches format through the real command tree (Phase 144 Step 4)", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { view?: string; format?: string } | undefined;
    ctx.evalCommands.report = (options: { view?: string; format?: string }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report", "--view", "external", "--format", "json"]);

    assertEquals(receivedOptions?.view, "external");
    assertEquals(
      receivedOptions?.format,
      "json",
      "--format must reach evalCommands.report — it was previously unwired on this command",
    );
  });
});
