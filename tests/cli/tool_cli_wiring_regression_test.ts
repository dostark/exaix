/**
 * @module ToolCliWiringRegressionTest
 * @path tests/cli/tool_cli_wiring_regression_test.ts
 * @description Regression test to ensure tool confirmation commands are registered in the Cliffy tree.
 */

import { assertEquals, assertExists } from "@std/assert";
import { __test_command } from "../../apps/exactl/src/exactl.ts";

Deno.test("[regression] CLI wiring: tool confirmation commands are registered", () => {
  const toolCmd = __test_command.getCommand("tool");
  assertExists(toolCmd, "tool command should be registered");

  const pendingCmd = toolCmd.getCommand("pending");
  const confirmCmd = toolCmd.getCommand("confirm");
  const denyCmd = toolCmd.getCommand("deny");

  assertExists(pendingCmd, "tool pending subcommand should be registered");
  assertExists(confirmCmd, "tool confirm subcommand should be registered");
  assertExists(denyCmd, "tool deny subcommand should be registered");

  assertEquals(pendingCmd.getName(), "pending");
  assertEquals(confirmCmd.getName(), "confirm");
  assertEquals(denyCmd.getName(), "deny");

  const reasonOption = denyCmd.getOption("reason");
  assertExists(reasonOption, "tool deny should have --reason option");
});
