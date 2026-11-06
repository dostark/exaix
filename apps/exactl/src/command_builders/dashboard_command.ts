/**
 * @module ExaCtlDashboardCommand
 * @path apps/exactl/src/command_builders/dashboard_command.ts
 * @description Builds the exactl dashboard command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";

function createDashboardCommand(runtime: IExaCtlRuntime) {
  const { dashboardCommands } = runtime;
  return new Command()
    .description("Launch the interactive dashboard")
    .action(async () => {
      await dashboardCommands.show();
    });
}

export function buildDashboardCommand(runtime: IExaCtlRuntime): ReturnType<typeof createDashboardCommand> {
  return createDashboardCommand(runtime);
}
