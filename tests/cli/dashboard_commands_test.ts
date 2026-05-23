/**
 * @module DashboardCommandsTest
 * @path tests/cli/dashboard_commands_test.ts
 * @description Verifies the CLI entry point for the TUI dashboard, ensuring correct
 * delegation to the dashboard launcher and terminal initialization.
 */

import { assertEquals } from "@std/assert";
import { DashboardCommands } from "../../apps/exactl/src/commands/dashboard_commands.ts";
import type { launchTuiDashboard } from "../../src/tui/tui_dashboard.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

Deno.test("DashboardCommands.show delegates to dashboard launcher", async () => {
  const { context, db, cleanup } = await createCliTestContext();
  try {
    // Use correct type for calls array, matching launchTuiDashboard options
    type LaunchDashboardOptions = Parameters<typeof launchTuiDashboard>[0];
    const calls: Array<LaunchDashboardOptions | undefined> = [];

    const commands = DashboardCommands.create(
      context,
      {
        launchDashboard: (options: LaunchDashboardOptions) => {
          calls.push(options);
          return Promise.resolve(undefined);
        },
      },
    );

    await commands.show();

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.databaseService, db);
  } finally {
    await cleanup();
  }
});
