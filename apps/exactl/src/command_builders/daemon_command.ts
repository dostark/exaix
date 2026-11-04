/**
 * @module ExaCtlDaemonCommand
 * @path apps/exactl/src/command_builders/daemon_command.ts
 * @description Builds the exactl daemon command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import { DAEMON_AGENT_ROLE_ID, DEFAULT_UNKNOWN_ERROR_MESSAGE } from "@exaix/core";
import { GIT_CMD_STATUS } from "@exaix/git/constants.ts";
import type { IExaCtlRuntime } from "../exactl_runtime.ts";

function createDaemonCommand(runtime: IExaCtlRuntime) {
  const { display, daemonCommands } = runtime;
  return new Command()
    .description("Control the Exaix daemon")
    .command(
      "start",
      new Command()
        .description("Start the Exaix daemon")
        .option(
          "--ready-timeout <ms:number>",
          "Milliseconds to wait for daemon.ready (default: daemon.ready_timeout_ms)",
        )
        .action(async (options) => {
          try {
            await daemonCommands.start({ readyTimeoutMs: options.readyTimeout });
          } catch (error) {
            display.error("cli.error", "daemon start", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "stop",
      new Command()
        .description("Stop the Exaix daemon")
        .action(async () => {
          try {
            await daemonCommands.stop();
          } catch (error) {
            display.error("cli.error", "daemon stop", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "restart",
      new Command()
        .description("Restart the Exaix daemon")
        .action(async () => {
          try {
            await daemonCommands.restart();
          } catch (error) {
            display.error("cli.error", "daemon restart", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      GIT_CMD_STATUS,
      new Command()
        .description("Check daemon status")
        .option("--json", "Output as JSON")
        .action(async (options) => {
          try {
            const status = await daemonCommands.status();
            if (options.json) {
              console.log(JSON.stringify({
                status: status.running ? "running" : "stopped",
                pid: status.pid ?? null,
                uptime: status.uptime ?? null,
                binary_version: status.version,
                workspace_schema_version: status.workspace_schema_version,
              }));
              return;
            }
            display.info("daemon.status", DAEMON_AGENT_ROLE_ID, {
              status: status.running ? "Running ✓" : "Stopped ✗",
              pid: status.pid ?? null,
              uptime: status.uptime ?? null,
              binary: status.version,
              schema: status.workspace_schema_version,
            });
          } catch (error) {
            display.error("cli.error", "daemon status", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    )
    .command(
      "logs",
      new Command()
        .description("Show daemon logs")
        .option("-n, --lines <lines:number>", "Number of lines to show", { default: CLI_DEFAULTS.LOG_LINES })
        .option("-f, --follow", "Follow log output")
        .action(async (options) => {
          try {
            await daemonCommands.logs(options.lines, options.follow);
          } catch (error) {
            display.error("cli.error", "daemon logs", {
              message: error instanceof Error ? error.message : DEFAULT_UNKNOWN_ERROR_MESSAGE,
            });
            Deno.exit(1);
          }
        }),
    );
}

export function buildDaemonCommand(runtime: IExaCtlRuntime): ReturnType<typeof createDaemonCommand> {
  return createDaemonCommand(runtime);
}
