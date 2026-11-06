/**
 * @module ToolCliWiringRegressionTest
 * @path apps/exactl/tests/tool_cli_wiring_regression_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Regression test to ensure tool confirmation commands are registered in the Cliffy tree.
 */

import { assertEquals, assertExists } from "@std/assert";
import { __test_command } from "../src/exactl.ts";

Deno.test("[regression] CLI wiring: approval commands are registered and the wait and tool roots are gone", () => {
  const approvalCmd = __test_command.getCommand("approval");
  assertExists(approvalCmd, "approval command should be registered");

  for (const verb of ["list", "show", "approve", "reject", "amend", "expire", "cancel"]) {
    assertEquals(approvalCmd.getCommand(verb)?.getName(), verb, `approval ${verb} should be registered`);
  }

  const reasonOption = approvalCmd.getCommand("reject")?.getOption("reason");
  assertExists(reasonOption, "approval reject should have --reason option");

  assertEquals(__test_command.getCommand("tool"), undefined);
  assertEquals(__test_command.getCommand("wait"), undefined);
});
