/**
 * @module ExaCtlDashboardCommand
 * @path apps/exactl/src/command_builders/dashboard_command.ts
 * @description Builds the exactl dashboard command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";
import { DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";

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

function createWatchCommand(runtime: IExaCtlRuntime) {
  const { display, watchCommandInstance } = runtime;
  return new Command()
    .description("Tail live execution events for a trace (SSE stream with historical fallback)")
    .arguments("<trace_id:string>")
    .action(async (_options, traceId: string) => {
      try {
        await watchCommandInstance.watch(traceId);
      } catch (error) {
        display.error("cli.error", "watch", {
          message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
        });
        Deno.exit(1);
      }
    });
}

export function buildWatchCommand(runtime: IExaCtlRuntime): ReturnType<typeof createWatchCommand> {
  return createWatchCommand(runtime);
}
