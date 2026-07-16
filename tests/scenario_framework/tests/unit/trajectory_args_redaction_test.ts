/**
 * @module TrajectoryArgsRedactionTest
 * @path tests/scenario_framework/tests/unit/trajectory_args_redaction_test.ts
 * @description Ensures that trajectory args-derived observed_value is
 * truncated/redacted before being included in criterion results.
 * The full raw args must not appear verbatim in the evidence.
 */

import { assertEquals } from "@std/assert";
import { redactArgs } from "../../runner/trajectory_evaluator.ts";

Deno.test("[TrajectoryRedaction] large args payload is truncated — full value absent", () => {
  const largeContent = "x".repeat(500);
  const args = { path: "/tmp/big.txt", content: largeContent };
  const redacted = redactArgs(args);
  assertEquals(redacted.includes(largeContent), false);
});

Deno.test("[TrajectoryRedaction] small args payload is not truncated", () => {
  const args = { path: "/tmp/small.txt", mode: "read" };
  const redacted = redactArgs(args);
  assertEquals(redacted.includes("/tmp/small.txt"), true);
  assertEquals(redacted.includes("read"), true);
});

Deno.test("[TrajectoryRedaction] sensitive-shaped args do not appear verbatim", () => {
  const sensitive = "SECRET_VALUE_12345";
  const args = { password: sensitive, token: "abc-def" };
  const redacted = redactArgs(args);
  assertEquals(redacted.includes(sensitive), false);
});

Deno.test("[TrajectoryRedaction] empty args produces short string", () => {
  const redacted = redactArgs({});
  assertEquals(redacted.length < 10, true);
});
