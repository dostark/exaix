/**
 * @module LogOutputTest
 * @path apps/exactl/tests/log_output_test.ts
 * @description Runs `log list`, `log wait` and `log verify` in process over a stubbed journal and checks the JSON, the JSON lines and the exit behavior.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/command_builders/log_command.ts, apps/exactl/src/commands/journal_commands.ts]
 */

import "./helpers/set_test_mode.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { IActivityRecord } from "@exaix/core/types";
import { ExaCtlExitCode } from "@exaix/cli/errors/exactl_errors.ts";
import { withCapturedSink } from "./helpers/captured_output.ts";
import { expectExitWithLogs, withTestMod } from "./helpers/test_utils.ts";

const ROW: IActivityRecord = {
  id: "row-1",
  trace_id: "7b1d4e60-1c2a-4e3b-9f10-2a6c8d9e0f11",
  actor: "system",
  agent_role: "senior-coder",
  action_type: "request.created",
  target: "request-1.md",
  payload: "{}",
  timestamp: "2026-01-01T00:00:00.000Z",
  cost_usd: 0.5,
} as IActivityRecord;

Deno.test("log list -o json rows match the journal rows the scenario runner reads", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.context.db.queryActivity = () => Promise.resolve([ROW]);
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["log", "list", "-n", "200", "-o", "json"]);
    });
    assertEquals(JSON.parse(out), [ROW]);
  });
});

Deno.test("log list passes -n as the limit and prints a table by default", async () => {
  await withTestMod(async (mod, ctx) => {
    let limit: number | undefined;
    ctx.context.db.queryActivity = (filter) => {
      limit = filter.limit;
      return Promise.resolve([ROW]);
    };
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["log", "list", "-n", "7"]);
    });
    assertEquals(limit, 7);
    assertStringIncludes(out, "request.created");
    assertStringIncludes(out, "$0.500000");
  });
});

Deno.test("log list --count prints one count row per action type", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.context.db.queryActivity = () => Promise.resolve([{ ...ROW, count: 3 } as IActivityRecord]);
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse(["log", "list", "--count"]);
    });
    assertStringIncludes(out, "Count");
    assertStringIncludes(out, "3");
  });
});

Deno.test("log wait -o jsonl emits the matching event as one line", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.context.db.preparedGet = <T>() => Promise.resolve({ action_type: "daemon.ready" } as T);
    const { out } = await withCapturedSink(ctx.outputSink, async () => {
      await mod.__test_command.parse([
        "log",
        "wait",
        "--event",
        "daemon.ready",
        "--since-rowid",
        "0",
        "--timeout",
        "2",
        "-o",
        "jsonl",
      ]);
    });
    assertEquals(out.trimEnd().split("\n").map((line) => JSON.parse(line)), [
      { type: "journal.event", action_type: "daemon.ready" },
    ]);
  });
});

Deno.test("log wait without --event is a usage error", async () => {
  await withTestMod(async (mod) => {
    const { err, errors } = await expectExitWithLogs(async () => {
      await mod.__test_command.parse(["log", "wait"]);
    });
    assertEquals(err.message, `DENO_EXIT:${ExaCtlExitCode.USAGE}`);
    assertStringIncludes(errors.join("\n"), "log wait requires --event");
  });
});

Deno.test("log verify prints the report as JSON and exits 1 when the chain is broken", async () => {
  await withTestMod(async (mod, ctx) => {
    ctx.context.db.verifyJournalIntegrity = () =>
      Promise.resolve({
        ok: false,
        rows_checked: 4,
        unhashed_prefix: 0,
        first_broken_id: "row-3",
        expected_hash: "a",
        actual_hash: "b",
      });
    let printed = "";
    const original = ctx.outputSink.out;
    ctx.outputSink.out = (text) => {
      printed += text;
      return Promise.resolve();
    };
    try {
      const { exitCalled } = await expectExitWithLogs(async () => {
        await mod.__test_command.parse(["log", "verify", "-o", "json"]);
      });
      assert(exitCalled);
    } finally {
      ctx.outputSink.out = original;
    }
    const report = JSON.parse(printed);
    assertEquals([report.ok, report.first_broken_id], [false, "row-3"]);
  });
});
