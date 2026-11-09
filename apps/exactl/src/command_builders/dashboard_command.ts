/**
 * @module ExaCtlDashboardCommand
 * @path apps/exactl/src/command_builders/dashboard_command.ts
 * @description Builds the exactl dashboard command tree from the shared runtime services.
 * @architectural-layer CLI
 * @dependencies [@cliffy/command, @exaix/cli]
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { documented } from "@exaix/cli";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { ExaCtlCommandName } from "../exactl_constants.ts";
import { commandDocFor } from "../command_docs/mod.ts";

function createDashboardCommand(runtime: IExaCtlRuntime) {
  const { dashboardCommands } = runtime;
  const command = new Command().action(async () => {
    await dashboardCommands.show();
  });
  return documented(command, commandDocFor([ExaCtlCommandName.DASHBOARD]), []);
}

export function buildDashboardCommand(runtime: IExaCtlRuntime): ReturnType<typeof createDashboardCommand> {
  return createDashboardCommand(runtime);
}
