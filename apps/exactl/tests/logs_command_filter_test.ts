/**
 * @module LogsCommandFilterTest
 * @path apps/exactl/tests/logs_command_filter_test.ts
 * @description Tests for the `exactl logs` command filter shortcut — bare event
 *   names like `model_resolved` are expanded to `action_type=model_resolved`.
 * @architectural-layer Test
 * @dependencies [@std/assert]
 * @related-files [apps/exactl/src/commands/journal_commands.ts]
 */

import { assertEquals } from "@std/assert";
import { normalizeLogsFilter } from "../src/commands/journal_commands.ts";

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
