/**
 * @module TrajectoryArgsTest
 * @path tests/scenario_framework/tests/unit/trajectory_args_test.ts
 * @description Tests that args_contains, min_args, and max_args are enforced
 * when matching expected trajectory entries against observed tool calls.
 */

import { assertEquals } from "@std/assert";
import { type IToolCall, matchToolCallArgs } from "../../runner/trajectory_evaluator.ts";

const makeToolCall = (overrides: Partial<IToolCall> = {}): IToolCall => ({
  tool: "read_file",
  args: { path: "/tmp/test.txt", encoding: "utf-8" },
  ...overrides,
});

Deno.test("[TrajectoryArgs] args_contains match — all substrings present passes", () => {
  const call = makeToolCall({ args: { path: "/tmp/test.txt", content: "hello world", mode: "write" } });
  const result = matchToolCallArgs(call, ["/tmp/test", "hello"]);
  assertEquals(result.passed, true);
});

Deno.test("[TrajectoryArgs] args_contains mismatch — missing substring fails", () => {
  const call = makeToolCall({ args: { path: "/tmp/other.txt" } });
  const result = matchToolCallArgs(call, ["path:/tmp/test.txt"]);
  assertEquals(result.passed, false);
});

Deno.test("[TrajectoryArgs] args_contains empty list passes", () => {
  const call = makeToolCall();
  const result = matchToolCallArgs(call, []);
  assertEquals(result.passed, true);
});

Deno.test("[TrajectoryArgs] min_args enforces minimum argument count", () => {
  const call = makeToolCall({ args: { a: 1, b: 2 } });
  assertEquals(matchToolCallArgs(call, [], { minArgs: 2 }).passed, true);
  assertEquals(matchToolCallArgs(call, [], { minArgs: 3 }).passed, false);
});

Deno.test("[TrajectoryArgs] max_args enforces maximum argument count", () => {
  const call = makeToolCall({ args: { a: 1, b: 2, c: 3 } });
  assertEquals(matchToolCallArgs(call, [], { maxArgs: 3 }).passed, true);
  assertEquals(matchToolCallArgs(call, [], { maxArgs: 2 }).passed, false);
});

Deno.test("[TrajectoryArgs] both min_args and max_args enforced simultaneously", () => {
  const call = makeToolCall({ args: { a: 1, b: 2 } });
  assertEquals(matchToolCallArgs(call, [], { minArgs: 1, maxArgs: 3 }).passed, true);
  assertEquals(matchToolCallArgs(call, [], { minArgs: 3, maxArgs: 5 }).passed, false);
  assertEquals(matchToolCallArgs(call, [], { minArgs: 1, maxArgs: 1 }).passed, false);
});
