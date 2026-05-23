/**
 * @module DashboardCommandsTest
 * @path apps/exactl/tests/dashboard_commands_test.ts
 * @related-files []
 * @architectural-layer CLI
 * @description Verifies the CLI entry point for the TUI dashboard, ensuring correct
 * delegation to the dashboard launcher.
 */

import { assertEquals } from "@std/assert";
import { DashboardCommands } from "../src/commands/dashboard_commands.ts";
import { createCliTestContext } from "./helpers/test_setup.ts";

Deno.test("DashboardCommands.show delegates to launchDashboard", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const called: boolean[] = [];
    const commands = DashboardCommands.create(context, {
      launchDashboard: () => {
        called.push(true);
        return Promise.resolve();
      },
    });

    await commands.show();

    assertEquals(called.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("DashboardCommands.show throws on subprocess failure", async () => {
  const { context, cleanup } = await createCliTestContext();
  try {
    const commands = DashboardCommands.create(context, {
      launchDashboard: () => {
        throw new Error("TUI dashboard exited with code 1");
      },
    });

    await commands.show();
    throw new Error("Expected show() to throw");
  } catch (e) {
    assertEquals((e as Error).message, "TUI dashboard exited with code 1");
  } finally {
    await cleanup();
  }
});
