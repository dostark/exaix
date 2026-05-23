/**
 * @module PortalCliWiringRegressionTest
 * @path apps/exactl/tests/portal_cli_wiring_regression_test.ts
 * @description Regression test to ensure portal analyze and portal knowledge
 * commands are correctly wired in the Cliffy command tree.
 */

import { assertEquals, assertExists } from "@std/assert";
import { __test_command } from "../src/exactl.ts";

Deno.test("[regression] CLI wiring: portal analyze command is registered", () => {
  const portalCmd = __test_command.getCommand("portal");
  assertExists(portalCmd, "portal command should be registered");

  const analyzeCmd = portalCmd.getCommand("analyze");
  assertExists(analyzeCmd, "portal analyze subcommand should be registered");
  assertEquals(analyzeCmd.getName(), "analyze");

  // Verify options
  const modeOption = analyzeCmd.getOption("mode");
  assertExists(modeOption, "analyze should have --mode option");

  const forceOption = analyzeCmd.getOption("force");
  assertExists(forceOption, "analyze should have --force option");
});

Deno.test("[regression] CLI wiring: portal knowledge command is registered", () => {
  const portalCmd = __test_command.getCommand("portal");
  assertExists(portalCmd, "portal command should be registered");

  const knowledgeCmd = portalCmd.getCommand("knowledge");
  assertExists(knowledgeCmd, "portal knowledge subcommand should be registered");
  assertEquals(knowledgeCmd.getName(), "knowledge");

  // Verify options
  const jsonOption = knowledgeCmd.getOption("json");
  assertExists(jsonOption, "knowledge should have --json option");
});
