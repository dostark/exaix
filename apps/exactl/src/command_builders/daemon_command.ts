/**
 * @module ExaCtlDaemonCommand
 * @path apps/exactl/src/command_builders/daemon_command.ts
 * @description Builds the exactl daemon command tree from the shared runtime services.
 * @architectural-layer CLI
 * @related-files [apps/exactl/src/exactl.ts, apps/exactl/src/exactl_runtime.ts]
 */

import { Command } from "@cliffy/command";
import { CLI_DEFAULTS } from "@exaix/cli/config.ts";
import {
  BINARY_VERSION,
  DAEMON_AGENT_ROLE_ID,
  DEFAULT_UNKNOWN_ERROR_MESSAGE,
  WORKSPACE_SCHEMA_VERSION,
} from "@exaix/core";
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

function createVersionCommand(runtime: IExaCtlRuntime) {
  const { services } = runtime;
  return new Command()
    .description("Show Exaix binary and workspace schema version information")
    .option("--json", "Output as JSON")
    .action((options) => {
      const onDiskSchemaVersion = (() => {
        try {
          return services.config.getSchemaVersion();
        } catch {
          return WORKSPACE_SCHEMA_VERSION;
        }
      })();

      const wsv = parseSemVerSegments(WORKSPACE_SCHEMA_VERSION);
      const ondisk = parseSemVerSegments(onDiskSchemaVersion);

      const migrationRequired = wsv.major > ondisk.major ||
        (wsv.major === ondisk.major && wsv.minor > ondisk.minor);
      const binaryTooOld = ondisk.major > wsv.major ||
        (ondisk.major === wsv.major && ondisk.minor > wsv.minor);
      const compatible = !migrationRequired && !binaryTooOld;

      const compatibilityLabel = migrationRequired
        ? "⚠️  Minor migration required"
        : binaryTooOld
        ? "❌ Binary older than workspace — update exactl"
        : "✅ OK";

      if (options.json) {
        const configPath = (() => {
          try {
            return services.config.getConfigPath();
          } catch {
            return "";
          }
        })();
        console.log(
          JSON.stringify({
            binary_version: BINARY_VERSION,
            workspace_schema_version: WORKSPACE_SCHEMA_VERSION,
            on_disk_schema_version: onDiskSchemaVersion,
            compatible,
            migration_required: migrationRequired,
            config_path: configPath,
          }),
        );
        return;
      }

      const configPath = (() => {
        try {
          return services.config.getConfigPath();
        } catch {
          return "(not available)";
        }
      })();

      console.log("Exaix CLI");
      console.log(`  Binary version:             ${BINARY_VERSION}`);
      console.log(`  Workspace schema version:   ${WORKSPACE_SCHEMA_VERSION}`);
      console.log(`  Config path:                ${configPath}`);
      console.log(`  On-disk schema version:     ${onDiskSchemaVersion}`);
      console.log(`  Compatibility:              ${compatibilityLabel}`);
    });
}

export function buildVersionCommand(runtime: IExaCtlRuntime): ReturnType<typeof createVersionCommand> {
  return createVersionCommand(runtime);
}

/** Minimal inline SemVer parser (avoids circular import of scripts/check_version.ts) */
function parseSemVerSegments(v: string): { major: number; minor: number; patch: number } {
  const [major, minor, patch] = v.split(".").map(Number);
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
}

function createMigrateCommand(runtime: IExaCtlRuntime) {
  const { daemonCommands } = runtime;
  return new Command()
    .description("Workspace migration utilities")
    .command(
      "check",
      new Command()
        .description("Check binary vs workspace schema compatibility")
        .option("--json", "Output as JSON")
        .action((options) => {
          const exitCode = daemonCommands.migrate({ check: true, json: options.json });
          Deno.exit(exitCode);
        }),
    );
}

export function buildMigrateCommand(runtime: IExaCtlRuntime): ReturnType<typeof createMigrateCommand> {
  return createMigrateCommand(runtime);
}
