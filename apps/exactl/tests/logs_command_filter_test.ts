/**
 * @module LogsCommandFilterTest
 * @path apps/exactl/tests/logs_command_filter_test.ts
 * @description Tests for the `exactl log list` filter shortcut — bare event
 *   names like `model_resolved` are expanded to `action_type=model_resolved`.
 * @architectural-layer Test
 * @dependencies [@std/assert, apps/exactl/tests/helpers/test_utils.ts]
 * @related-files [apps/exactl/src/commands/journal_commands.ts, apps/exactl/src/command_builders/log_command.ts]
 */

import { assertEquals } from "@std/assert";
import type { IJournalFilterOptions } from "@exaix/core/types";
import { normalizeLogsFilter } from "../src/commands/journal_commands.ts";
import { captureAllOutputs } from "./helpers/console_utils.ts";
import { withTestMod } from "./helpers/test_utils.ts";

Deno.test("[step132.8] normalizeLogsFilter converts bare event name to action_type filter", () => {
  const result = normalizeLogsFilter(["model_resolved"]);
  assertEquals(result, ["action_type=model_resolved"]);
});

Deno.test("[step132.8] normalizeLogsFilter passes through key=value pairs", () => {
  const result = normalizeLogsFilter(["action_type=model_resolved", "trace_id=abc"]);
  assertEquals(result, ["action_type=model_resolved", "trace_id=abc"]);
});

Deno.test("[step132.8] normalizeLogsFilter returns empty array for empty input", () => {
  const result = normalizeLogsFilter([]);
  assertEquals(result, []);
});

Deno.test("log list --filter with a bare event name filters by action_type", async () => {
  await withTestMod(async (mod, ctx) => {
    let captured: IJournalFilterOptions | undefined;
    ctx.context.db.queryActivity = (filters: IJournalFilterOptions) => {
      captured = filters;
      return Promise.resolve([]);
    };
    await captureAllOutputs(async () => {
      await mod.__test_command.parse(["log", "list", "--filter", "model_resolved"]);
    });
    assertEquals(captured?.actionType, "model_resolved");
  });
});

Deno.test("log list --filter still accepts key=value pairs", async () => {
  await withTestMod(async (mod, ctx) => {
    let captured: IJournalFilterOptions | undefined;
    ctx.context.db.queryActivity = (filters: IJournalFilterOptions) => {
      captured = filters;
      return Promise.resolve([]);
    };
    await captureAllOutputs(async () => {
      await mod.__test_command.parse(["log", "list", "--filter", "trace_id=abc"]);
    });
    assertEquals(captured?.traceId, "abc");
  });
});
