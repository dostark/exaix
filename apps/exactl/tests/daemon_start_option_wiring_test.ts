/**
 * @module DaemonStartOptionWiringTest
 * @path apps/exactl/tests/daemon_start_option_wiring_test.ts
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/commands/daemon_commands.ts]
 * @architectural-layer CLI
 * @description Regression test that `exactl daemon start` registers a numeric `--ready-timeout`
 * option. The value flows into DaemonCommands.start, and that path has its own unit tests.
 */

import { assertEquals, assertExists } from "@std/assert";
import { __test_command } from "../src/exactl.ts";

Deno.test("[regression] CLI wiring: daemon start registers a numeric --ready-timeout option", () => {
  const daemonCmd = __test_command.getCommand("daemon");
  assertExists(daemonCmd, "daemon command should be registered");
  const startCmd = daemonCmd.getCommand("start");
  assertExists(startCmd, "daemon start subcommand should be registered");
  const option = startCmd.getOption("ready-timeout");
  assertExists(option, "daemon start should have a --ready-timeout option");
  assertEquals(option.args[0]?.type, "number", "--ready-timeout should take a number");
});
