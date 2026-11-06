/**
 * @module PortalCliWiringRegressionTest
 * @path apps/exactl/tests/portal_cli_wiring_regression_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Regression test to ensure portal knowledge analyze and portal knowledge show
 * commands are correctly wired in the Cliffy command tree.
 */

import { assertEquals, assertExists } from "@std/assert";
import { __test_command } from "../src/exactl.ts";

Deno.test("[regression] CLI wiring: portal knowledge analyze command is registered", () => {
  const portalCmd = __test_command.getCommand("portal");
  assertExists(portalCmd, "portal command should be registered");

  const knowledgeGroup = portalCmd.getCommand("knowledge");
  assertExists(knowledgeGroup, "portal knowledge subcommand should be registered");
  const analyzeCmd = knowledgeGroup.getCommand("analyze");
  assertExists(analyzeCmd, "portal knowledge analyze subcommand should be registered");
  assertEquals(analyzeCmd.getName(), "analyze");

  // Verify options
  const modeOption = analyzeCmd.getOption("mode");
  assertExists(modeOption, "analyze should have --mode option");

  const forceOption = analyzeCmd.getOption("force");
  assertExists(forceOption, "analyze should have --force option");
});

Deno.test("[regression] CLI wiring: portal knowledge show command is registered", () => {
  const portalCmd = __test_command.getCommand("portal");
  assertExists(portalCmd, "portal command should be registered");

  const knowledgeCmd = portalCmd.getCommand("knowledge")?.getCommand("show");
  assertExists(knowledgeCmd, "portal knowledge show subcommand should be registered");
  assertEquals(knowledgeCmd.getName(), "show");

  // Verify options
  const jsonOption = knowledgeCmd.getOption("json");
  assertExists(jsonOption, "knowledge should have --json option");
});
