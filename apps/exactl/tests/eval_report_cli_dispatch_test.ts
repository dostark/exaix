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

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { withTestMod } from "./helpers/test_utils.ts";
import { __test_command } from "../src/exactl.ts";

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

Deno.test("eval report --run-ids splits a comma-separated list and reaches evalCommands.report (Phase 145 GAP-1 remediation)", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { view?: string; runIds?: string[] } | undefined;
    ctx.evalCommands.report = (options: { view?: string; runIds?: string[] }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse([
      "eval",
      "report",
      "--view",
      "robustness",
      "--run-ids",
      "founding-clean,founding-attacked",
    ]);

    assertEquals(receivedOptions?.runIds, ["founding-clean", "founding-attacked"]);
  });
});

Deno.test("eval report omitting --run-ids reaches evalCommands.report as undefined (Phase 145 GAP-1 remediation)", async () => {
  await withTestMod(async (mod, ctx) => {
    let receivedOptions: { runIds?: string[] } | undefined;
    ctx.evalCommands.report = (options: { runIds?: string[] }) => {
      receivedOptions = options;
    };

    await mod.__test_command.parse(["eval", "report"]);

    assertEquals(receivedOptions?.runIds, undefined);
  });
});

Deno.test("eval report --view option lists robustness and interactive in its help text (Phase 145 GAP-3 remediation)", () => {
  const evalCmd = __test_command.getCommand("eval");
  assertExists(evalCmd, "eval command should be registered");
  const reportCmd = evalCmd.getCommand("report");
  assertExists(reportCmd, "eval report subcommand should be registered");
  const viewOption = reportCmd.getOption("view");
  assertExists(viewOption, "eval report should have --view option");
  assertStringIncludes(viewOption!.description, "robustness");
  assertStringIncludes(viewOption!.description, "interactive");
});
