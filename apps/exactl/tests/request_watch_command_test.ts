/**
 * @module RequestWatchCommandTest
 * @path apps/exactl/tests/request_watch_command_test.ts
 * @description Verifies `exactl request watch` resolves a request id to its trace id and watches a trace id directly.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/command_builders/request_command.ts, apps/exactl/src/commands/watch.ts]
 */

import "./helpers/set_test_mode.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { captureConsoleOutput } from "./helpers/console_utils.ts";
import { withTestMod } from "./helpers/test_utils.ts";
import { runExactlSequenceInTempWorkspace } from "./helpers/exactl_cli_process.ts";

const TRACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USAGE_EXIT_CODE = 2;

Deno.test("request watch <request-id> resolves the trace id", async () => {
  await withTestMod(async (mod, ctx) => {
    const shown: string[] = [];
    const watched: string[] = [];
    ctx.requestCommands.show = (id: string) => {
      shown.push(id);
      return Promise.resolve({ metadata: { trace_id: TRACE_ID }, content: "" } as never);
    };
    ctx.watchCommand.watch = (traceId: string) => {
      watched.push(traceId);
      return Promise.resolve();
    };
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["request", "watch", "request-abc123.md"]);
    });
    assertEquals(shown, ["request-abc123.md"]);
    assertEquals(watched, [TRACE_ID]);
  });
});

Deno.test("request watch --trace watches the trace without looking up a request", async () => {
  await withTestMod(async (mod, ctx) => {
    const shown: string[] = [];
    const watched: string[] = [];
    ctx.requestCommands.show = (id: string) => {
      shown.push(id);
      return Promise.reject(new Error("show must not run"));
    };
    ctx.watchCommand.watch = (traceId: string) => {
      watched.push(traceId);
      return Promise.resolve();
    };
    await captureConsoleOutput(async () => {
      await mod.__test_command.parse(["request", "watch", "--trace", TRACE_ID]);
    });
    assertEquals(shown, []);
    assertEquals(watched, [TRACE_ID]);
  });
});

Deno.test("request watch needs exactly one of a request id and --trace", async () => {
  const [neither, both] = await runExactlSequenceInTempWorkspace([
    ["request", "watch"],
    ["request", "watch", "request-abc123.md", "--trace", TRACE_ID],
  ]);
  assertEquals(neither.code, USAGE_EXIT_CODE, neither.stderr);
  assertEquals(both.code, USAGE_EXIT_CODE, both.stderr);
});

Deno.test("request watch --trace prints the empty-trace notice for an unknown trace", async () => {
  const [run] = await runExactlSequenceInTempWorkspace([["request", "watch", "--trace", TRACE_ID]]);
  assertEquals(run.code, 0, run.stderr);
  assertStringIncludes(run.stdout, `No events found for trace: ${TRACE_ID}`);
});
