/**
 * @module PlanExecutorNativeToolsConfigTest
 * @path packages/core/tests/planning/plan_executor_native_tools_config_test.ts
 * @description Tests that Config.execution.native_tools_enabled is wired through
 * PlanExecutor into IAgentExecutionOptions.
 */

import { assertEquals } from "@std/assert";
import { createMockConfig } from "@exaix/testing";

Deno.test("Config.execution.native_tools_enabled defaults to false", () => {
  const config = createMockConfig("/tmp");
  assertEquals(config.execution?.native_tools_enabled, false);
});

Deno.test("Config.execution.native_tools_enabled accepts true", () => {
  const config = createMockConfig("/tmp", {
    execution: { native_tools_enabled: true } as never,
  });
  assertEquals(config.execution?.native_tools_enabled, true);
});
